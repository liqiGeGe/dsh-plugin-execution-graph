import { describe, expect, it } from 'vitest'
import type {
  GraphAssistantMessageNode, GraphContribution, GraphConversationViewNode, GraphRequestHeaderNode,
  GraphUserMessageNode,
} from '../src/client/graph-contract.ts'
import { GraphSnapshotBuilder } from '../src/client/graph-snapshot-builder.ts'

function contribution(
  key: string,
  anchorSeq: number,
  turn: number,
  data: GraphContribution,
): GraphConversationViewNode {
  return {
    key,
    kind: key,
    id: key,
    target: 'graph',
    anchorSeq,
    location: { kind: 'turn', turn: { turn } } as unknown as GraphConversationViewNode['location'],
    data,
  }
}

function requestHeader(seq: number, turn: number): GraphRequestHeaderNode {
  return { kind: 'request-header', seq, time: seq, reason: 'initial', turn }
}

function userMessage(seq: number, turn: number, text: string): GraphUserMessageNode {
  return { kind: 'user-message', seq, time: seq, turn, text }
}

function assistantMessage(
  seq: number,
  turn: number,
  step: number,
  callIds: readonly string[],
): GraphAssistantMessageNode {
  return { kind: 'assistant-message', seq, time: seq, turn, step, callIds, textPreview: '' }
}

describe('GraphSnapshotBuilder', () => {
  it('synthesizes one turn-group per turn, ordered by turn number', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('header:1', 1, 1, requestHeader(1, 1)),
      contribution('header:2', 2, 2, requestHeader(2, 2)),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    const turnGroups = snapshot.nodes.filter(node => node.kind === 'turn-group')
    expect(turnGroups).toEqual([{ kind: 'turn-group', turn: 1 }, { kind: 'turn-group', turn: 2 }])
    expect(snapshot.edges).toContainEqual({
      kind: 'contains',
      from: { kind: 'turn-group', id: '1' },
      to: { kind: 'request-header', id: 'header:1' },
    })
    expect(snapshot.edges).toContainEqual({
      kind: 'contains',
      from: { kind: 'turn-group', id: '2' },
      to: { kind: 'request-header', id: 'header:2' },
    })
  })

  it('chains same-turn nodes in seq order with sequence edges', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('header:1', 1, 1, requestHeader(1, 1)),
      contribution('assistant:1', 2, 1, assistantMessage(2, 1, 1, [])),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    expect(snapshot.edges).toContainEqual({
      kind: 'sequence',
      from: { kind: 'request-header', id: 'header:1' },
      to: { kind: 'assistant-message', id: 'assistant:1' },
    })
  })

  it('connects an assistant message to its tool-call node with a triggers edge', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('assistant:1', 1, 1, assistantMessage(1, 1, 1, ['call-a'])),
      contribution('tool:call-a', 2, 1, {
        kind: 'tool',
        call: {
          kind: 'tool-call', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-a', name: 'read', argsRaw: '{}',
        },
      }),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    expect(snapshot.edges).toContainEqual({
      kind: 'triggers',
      from: { kind: 'assistant-message', id: 'assistant:1' },
      to: { kind: 'tool-call', id: 'call-a' },
    })
  })

  it('pairs a tool call with its result via a resolves edge and clears the running set', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('tool:call-a', 1, 1, {
        kind: 'tool',
        call: {
          kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'read', argsRaw: '{}',
        },
        result: {
          kind: 'tool-result', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-a', name: 'read', isError: false, durationMs: 1,
        },
      }),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    expect(snapshot.edges).toContainEqual({
      kind: 'resolves',
      from: { kind: 'tool-call', id: 'call-a' },
      to: { kind: 'tool-result', id: 'call-a' },
    })
    expect(snapshot.runningCallIds).toEqual(new Set())
  })

  it('keeps an unsettled call in the running set until a later apply settles it', () => {
    const builder = new GraphSnapshotBuilder()
    const call = contribution('tool:call-a', 1, 1, {
      kind: 'tool',
      call: {
        kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'read', argsRaw: '{}',
      },
    })

    const running = builder.replace({ nodes: [call] })
    expect(running.runningCallIds).toEqual(new Set(['call-a']))
    expect(running.nodes.filter(node => node.kind === 'tool-result')).toEqual([])

    const settled = contribution('tool:call-a', 1, 1, {
      kind: 'tool',
      call: {
        kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'read', argsRaw: '{}',
      },
      result: {
        kind: 'tool-result', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-a', name: 'read', isError: false, durationMs: 1,
      },
    })
    const settledSnapshot = builder.apply({ upserts: [settled] })
    expect(settledSnapshot.runningCallIds).toEqual(new Set())
    expect(settledSnapshot.nodes.filter(node => node.kind === 'tool-result')).toHaveLength(1)
  })

  it('starts empty and rejects a fresh builder before any replace/apply call', () => {
    const builder = new GraphSnapshotBuilder()
    expect(builder.empty).toEqual({ nodes: [], edges: [], runningCallIds: new Set() })
  })

  it('breaks an anchorSeq tie between contributions by key order', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('header:b', 1, 1, requestHeader(1, 1)),
      contribution('header:a', 1, 1, requestHeader(1, 1)),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    expect(snapshot.edges).toContainEqual({
      kind: 'sequence',
      from: { kind: 'request-header', id: 'header:a' },
      to: { kind: 'request-header', id: 'header:b' },
    })
  })

  it('breaks a same-turn, same-seq placement tie by node key id order', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('assistant:2', 1, 1, assistantMessage(1, 1, 1, [])),
      contribution('assistant:1', 1, 1, assistantMessage(1, 1, 1, [])),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    expect(snapshot.edges).toContainEqual({
      kind: 'sequence',
      from: { kind: 'assistant-message', id: 'assistant:1' },
      to: { kind: 'assistant-message', id: 'assistant:2' },
    })
  })

  it('drops a triggers edge whose targeted callId never became a tool-call node', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('assistant:1', 1, 1, assistantMessage(1, 1, 1, ['call-missing'])),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    expect(snapshot.edges.filter(edge => edge.kind === 'triggers')).toEqual([])
  })

  it('drops the request-header node when the turn already has a user-message opener', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('header:1', 1, 1, requestHeader(1, 1)),
      contribution('user:1', 2, 1, userMessage(2, 1, 'what is the plan?')),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    // The human prompt opens the turn; the request-header is redundant and dropped.
    expect(snapshot.nodes.some(node => node.kind === 'request-header')).toBe(false)
    expect(snapshot.nodes).toContainEqual({ kind: 'user-message', seq: 2, time: 2, turn: 1, text: 'what is the plan?' })
  })

  it('places a user-message contribution as the turn\'s sole opening node', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('header:1', 1, 1, requestHeader(1, 1)),
      contribution('user:1', 2, 1, userMessage(2, 1, 'hello')),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    // Only the user-message survives; it opens the turn (request-header is dropped).
    const kinds = snapshot.nodes.filter(node => node.kind !== 'turn-group').map(node => node.kind)
    expect(kinds).toEqual(['user-message'])
  })

  it('keeps a request-header node when a turn has no user-message', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('header:1', 1, 1, requestHeader(1, 1)),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    expect(snapshot.nodes).toContainEqual({ kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 })
  })

  it('leaves promptPreview absent for a request-header with no matching user-message', () => {
    const nodes: GraphConversationViewNode[] = [
      contribution('header:1', 1, 1, requestHeader(1, 1)),
    ]

    const snapshot = new GraphSnapshotBuilder().replace({ nodes })

    const header = snapshot.nodes.find(node => node.kind === 'request-header')
    expect(header).toEqual({ kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 })
  })
})
