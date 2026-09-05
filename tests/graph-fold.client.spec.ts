import { describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../src/client/graph-contract.ts'
import { assistantFoldMembers, foldCapsuleView } from '../src/client/graph-fold.ts'

/** Assistant at `seq`; its tool segment follows until the next assistant. */
function assistant(seq: number): GraphSnapshot['nodes'][number] {
  return { kind: 'assistant-message', seq, time: seq, turn: 1, step: 1, callIds: [], textPreview: `m${seq}` }
}

function toolCall(callId: string, seq: number): GraphSnapshot['nodes'][number] {
  return { kind: 'tool-call', seq, time: seq, turn: 1, step: 1, callId, name: 'bash', argsRaw: '{}' }
}

function toolResult(callId: string, seq: number): GraphSnapshot['nodes'][number] {
  return { kind: 'tool-result', seq, time: seq, turn: 1, step: 1, callId, name: 'bash', isError: false, durationMs: 1 }
}

/** assistant-a → tool-call → tool-result → assistant-b. */
function twoAssistantSnapshot(): GraphSnapshot {
  return {
    nodes: [
      assistant(1),
      toolCall('c1', 2),
      toolResult('c1', 3),
      assistant(4),
    ],
    edges: [
      { kind: 'sequence', from: { kind: 'assistant-message', id: '1' }, to: { kind: 'tool-call', id: 'c1' } },
      { kind: 'resolves', from: { kind: 'tool-call', id: 'c1' }, to: { kind: 'tool-result', id: 'c1' } },
      { kind: 'sequence', from: { kind: 'tool-result', id: 'c1' }, to: { kind: 'assistant-message', id: '4' } },
    ],
    runningCallIds: new Set(),
  }
}

/** Three assistants, each with its own single tool call/result segment. */
function threeAssistantSnapshot(): GraphSnapshot {
  return {
    nodes: [
      assistant(1), toolCall('a', 2), toolResult('a', 3),
      assistant(4), toolCall('b', 5), toolResult('b', 6),
      assistant(7), toolCall('c', 8), toolResult('c', 9),
    ],
    edges: [
      { kind: 'sequence', from: { kind: 'assistant-message', id: '1' }, to: { kind: 'tool-call', id: 'a' } },
      { kind: 'resolves', from: { kind: 'tool-call', id: 'a' }, to: { kind: 'tool-result', id: 'a' } },
      { kind: 'sequence', from: { kind: 'tool-result', id: 'a' }, to: { kind: 'assistant-message', id: '4' } },
      { kind: 'sequence', from: { kind: 'assistant-message', id: '4' }, to: { kind: 'tool-call', id: 'b' } },
      { kind: 'resolves', from: { kind: 'tool-call', id: 'b' }, to: { kind: 'tool-result', id: 'b' } },
      { kind: 'sequence', from: { kind: 'tool-result', id: 'b' }, to: { kind: 'assistant-message', id: '7' } },
      { kind: 'sequence', from: { kind: 'assistant-message', id: '7' }, to: { kind: 'tool-call', id: 'c' } },
      { kind: 'resolves', from: { kind: 'tool-call', id: 'c' }, to: { kind: 'tool-result', id: 'c' } },
    ],
    runningCallIds: new Set(),
  }
}

describe('assistantFoldMembers', () => {
  it('maps each assistant to its follower nodes up to the next assistant', () => {
    const members = assistantFoldMembers(twoAssistantSnapshot())

    expect([...members.keys()]).toEqual(['assistant-message:1', 'assistant-message:4'])
    expect(members.get('assistant-message:1')).toEqual(['tool-call:c1', 'tool-result:c1'])
    expect(members.get('assistant-message:4')).toEqual([])
  })

  it('groups parallel tool siblings under the triggering assistant', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        assistant(1),
        toolCall('c1', 2),
        toolCall('c2', 3),
        assistant(5),
      ],
      edges: [],
      runningCallIds: new Set(),
    }

    expect(assistantFoldMembers(snapshot).get('assistant-message:1'))
      .toEqual(['tool-call:c1', 'tool-call:c2'])
  })
})

describe('foldCapsuleView', () => {
  it('hides nothing and yields no capsules when nothing is collapsed', () => {
    const view = foldCapsuleView(twoAssistantSnapshot(), new Set())

    expect(view.hiddenIds.size).toBe(0)
    expect(view.capsules).toEqual([])
  })

  it('hides a collapsed segment and yields a capsule bridging to the next assistant', () => {
    const view = foldCapsuleView(twoAssistantSnapshot(), new Set(['assistant-message:1']))

    expect(view.hiddenIds).toEqual(new Set(['tool-call:c1', 'tool-result:c1']))
    expect(view.capsules).toEqual([
      {
        id: 'fold:assistant-message:1',
        assistantId: 'assistant-message:1',
        nextAssistantId: 'assistant-message:4',
        count: 2,
      },
    ])
  })

  it('collapsing an assistant with no followers yields no capsule and hides nothing', () => {
    const view = foldCapsuleView(twoAssistantSnapshot(), new Set(['assistant-message:4']))

    expect(view.hiddenIds.size).toBe(0)
    expect(view.capsules).toEqual([])
  })

  it('capsule for a trailing segment has no next assistant', () => {
    const snapshot: GraphSnapshot = {
      nodes: [assistant(1), toolCall('c1', 2), toolResult('c1', 3)],
      edges: [],
      runningCallIds: new Set(),
    }

    const view = foldCapsuleView(snapshot, new Set(['assistant-message:1']))

    expect(view.capsules[0]?.nextAssistantId).toBeUndefined()
    expect(view.capsules[0]?.count).toBe(2)
  })

  it('collapsing two assistants yields two independent capsules with no cross-talk', () => {
    const view = foldCapsuleView(threeAssistantSnapshot(), new Set(['assistant-message:1', 'assistant-message:4']))

    expect(view.hiddenIds).toEqual(new Set([
      'tool-call:a', 'tool-result:a', 'tool-call:b', 'tool-result:b',
    ]))
    expect(view.capsules).toEqual([
      { id: 'fold:assistant-message:1', assistantId: 'assistant-message:1', nextAssistantId: 'assistant-message:4', count: 2 },
      { id: 'fold:assistant-message:4', assistantId: 'assistant-message:4', nextAssistantId: 'assistant-message:7', count: 2 },
    ])
  })

  it('collapsing only the second assistant leaves the first segment fully visible', () => {
    const view = foldCapsuleView(threeAssistantSnapshot(), new Set(['assistant-message:4']))

    expect(view.hiddenIds).toEqual(new Set(['tool-call:b', 'tool-result:b']))
    expect(view.capsules).toHaveLength(1)
    expect(view.capsules[0]?.assistantId).toBe('assistant-message:4')
  })
})
