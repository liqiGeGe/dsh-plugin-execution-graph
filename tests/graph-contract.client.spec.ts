import { describe, expect, it } from 'vitest'
import type { GraphBusinessNode, GraphSnapshot } from '../src/client/graph-contract.ts'
import {
  businessNodeId, endpointElementId, filterSnapshotByTurn, listTurnPreviews, nodeElementId, truncatePreview,
} from '../src/client/graph-contract.ts'

describe('businessNodeId', () => {
  const cases: readonly [string, GraphBusinessNode, string][] = [
    ['turn-group keyed by turn', { kind: 'turn-group', turn: 3 }, '3'],
    ['request-header keyed by seq', { kind: 'request-header', seq: 5, time: 1, reason: 'initial', turn: 1 }, '5'],
    ['assistant-message keyed by seq', { kind: 'assistant-message', seq: 7, time: 1, turn: 1, step: 1, callIds: [], textPreview: '' }, '7'],
    ['tool-call keyed by callId', { kind: 'tool-call', seq: 2, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' }, 'call-a'],
    ['tool-result keyed by callId', { kind: 'tool-result', seq: 3, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', isError: false, durationMs: 1 }, 'call-a'],
  ]
  for (const [name, node, expected] of cases) {
    it(name, () => { expect(businessNodeId(node)).toBe(expected) })
  }

  it('composes the whole-node element id from kind and id half', () => {
    expect(nodeElementId({ kind: 'tool-call', seq: 2, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' }))
      .toBe('tool-call:call-a')
  })

  it('composes an edge-endpoint element id matching the node element id', () => {
    expect(endpointElementId({ kind: 'tool-result', id: 'call-a' })).toBe('tool-result:call-a')
  })
})

describe('truncatePreview', () => {
  it('collapses internal whitespace/newlines to single spaces and trims the ends', () => {
    expect(truncatePreview('  a\n  b\tc  ')).toBe('a b c')
  })

  it('passes text at or under the limit through unchanged', () => {
    expect(truncatePreview('short', 10)).toBe('short')
  })

  it('truncates text over the limit and appends an ellipsis marker', () => {
    expect(truncatePreview('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`)
  })
})

describe('listTurnPreviews', () => {
  it('returns no turns for an empty snapshot', () => {
    const snapshot: GraphSnapshot = { nodes: [], edges: [], runningCallIds: new Set() }

    expect(listTurnPreviews(snapshot)).toEqual([])
  })

  it('previews a turn from its first assistant message, in ascending turn order', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { kind: 'assistant-message', seq: 2, time: 2, turn: 2, step: 1, callIds: [], textPreview: 'second turn' },
        { kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [], textPreview: 'first turn' },
      ],
      edges: [],
      runningCallIds: new Set(),
    }

    expect(listTurnPreviews(snapshot)).toEqual([
      { turn: 1, preview: 'first turn' },
      { turn: 2, preview: 'second turn' },
    ])
  })

  it('falls back to the request-header reason when a turn has no assistant message yet', () => {
    const snapshot: GraphSnapshot = {
      nodes: [{ kind: 'request-header', seq: 1, time: 1, reason: 'resume', turn: 1 }],
      edges: [],
      runningCallIds: new Set(),
    }

    expect(listTurnPreviews(snapshot)).toEqual([{ turn: 1, preview: 'resume' }])
  })

  it('previews an empty string for a turn known only by its synthesized turn-group node', () => {
    const snapshot: GraphSnapshot = {
      nodes: [{ kind: 'turn-group', turn: 3 }],
      edges: [],
      runningCallIds: new Set(),
    }

    expect(listTurnPreviews(snapshot)).toEqual([{ turn: 3, preview: '' }])
  })

  it('keeps the first assistant-message preview seen for a turn and ignores later ones', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [], textPreview: 'first' },
        { kind: 'assistant-message', seq: 2, time: 2, turn: 1, step: 2, callIds: [], textPreview: 'second' },
      ],
      edges: [],
      runningCallIds: new Set(),
    }

    expect(listTurnPreviews(snapshot)).toEqual([{ turn: 1, preview: 'first' }])
  })
})

describe('filterSnapshotByTurn', () => {
  const snapshot: GraphSnapshot = {
    nodes: [
      { kind: 'turn-group', turn: 1 },
      { kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' },
      { kind: 'tool-call', seq: 2, time: 2, turn: 2, step: 1, callId: 'call-b', name: 'grep', argsRaw: '{}' },
    ],
    edges: [
      { kind: 'contains', from: { kind: 'turn-group', id: '1' }, to: { kind: 'tool-call', id: 'call-a' } },
      { kind: 'sequence', from: { kind: 'tool-call', id: 'call-a' }, to: { kind: 'tool-call', id: 'call-b' } },
    ],
    runningCallIds: new Set(['call-a', 'call-b']),
  }

  it('passes the snapshot through unchanged when no turn is selected', () => {
    expect(filterSnapshotByTurn(snapshot, null)).toBe(snapshot)
  })

  it('keeps only the selected turn\'s nodes and drops edges crossing out of it', () => {
    const filtered = filterSnapshotByTurn(snapshot, 1)

    expect(filtered.nodes).toEqual([
      { kind: 'turn-group', turn: 1 },
      { kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' },
    ])
    expect(filtered.edges).toEqual([
      { kind: 'contains', from: { kind: 'turn-group', id: '1' }, to: { kind: 'tool-call', id: 'call-a' } },
    ])
  })

  it('passes runningCallIds through unfiltered regardless of the selected turn', () => {
    const filtered = filterSnapshotByTurn(snapshot, 1)

    expect(filtered.runningCallIds).toBe(snapshot.runningCallIds)
  })

  it('returns an empty node/edge set for a turn with no matching nodes', () => {
    const filtered = filterSnapshotByTurn(snapshot, 99)

    expect(filtered.nodes).toEqual([])
    expect(filtered.edges).toEqual([])
  })
})
