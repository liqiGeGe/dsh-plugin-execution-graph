import { describe, expect, it } from 'vitest'
import type { GraphBusinessNode, GraphEdge, GraphSnapshot } from '../src/client/graph-contract.ts'
import { layoutGraphSnapshot } from '../src/client/graph-layout.ts'

/** A `turn-group` plus `count` tool-call nodes chained head-to-tail by `sequence` edges (keyed by callId). */
function toolChainSnapshot(count: number): GraphSnapshot {
  const nodes: GraphBusinessNode[] = [{ kind: 'turn-group', turn: 1 }]
  const edges: GraphEdge[] = []
  for (let seq = 1; seq <= count; seq += 1) {
    nodes.push({
      kind: 'tool-call', seq, time: seq, turn: 1, step: 1, callId: `call-${seq}`, name: 'bash', argsRaw: '{}',
    })
    edges.push({
      kind: 'contains',
      from: { kind: 'turn-group', id: '1' },
      to: { kind: 'tool-call', id: `call-${seq}` },
    })
    if (seq > 1) {
      edges.push({
        kind: 'sequence',
        from: { kind: 'tool-call', id: `call-${seq - 1}` },
        to: { kind: 'tool-call', id: `call-${seq}` },
      })
    }
  }
  return { nodes, edges, runningCallIds: new Set() }
}

/**
 * A turn whose column tail (rank 9) holds two parallel tool-calls that both feed
 * the next-column head (rank 10) assistant message — the shape that used to
 * synthesize a merge junction and right-angle edges.
 */
function parallelMergeAtColumnTail(): GraphSnapshot {
  const nodes: GraphBusinessNode[] = []
  const edges: GraphEdge[] = []
  for (let seq = 1; seq <= 9; seq += 1) {
    nodes.push({ kind: 'assistant-message', seq, time: seq, turn: 1, step: 1, callIds: [], textPreview: `a${seq}` })
    if (seq > 1) {
      edges.push({ kind: 'sequence', from: { kind: 'assistant-message', id: String(seq - 1) }, to: { kind: 'assistant-message', id: String(seq) } })
    }
  }
  nodes.push({ kind: 'tool-call', seq: 10, time: 10, turn: 1, step: 1, callId: 'p1', name: 'bash', argsRaw: '{}' })
  nodes.push({ kind: 'tool-call', seq: 11, time: 11, turn: 1, step: 1, callId: 'p2', name: 'grep', argsRaw: '{}' })
  nodes.push({ kind: 'assistant-message', seq: 12, time: 12, turn: 1, step: 2, callIds: [], textPreview: 'head' })
  edges.push({ kind: 'sequence', from: { kind: 'assistant-message', id: '9' }, to: { kind: 'tool-call', id: 'p1' } })
  edges.push({ kind: 'sequence', from: { kind: 'assistant-message', id: '9' }, to: { kind: 'tool-call', id: 'p2' } })
  edges.push({ kind: 'sequence', from: { kind: 'tool-call', id: 'p1' }, to: { kind: 'assistant-message', id: '12' } })
  edges.push({ kind: 'sequence', from: { kind: 'tool-call', id: 'p2' }, to: { kind: 'assistant-message', id: '12' } })
  return { nodes, edges, runningCallIds: new Set() }
}

describe('layoutGraphSnapshot', () => {
  it('returns the empty layout when the snapshot has no non-turn-group nodes', () => {
    const snapshot: GraphSnapshot = {
      nodes: [{ kind: 'turn-group', turn: 1 }],
      edges: [],
      runningCallIds: new Set(),
    }

    expect(layoutGraphSnapshot(snapshot)).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })

  it('drops turn-group nodes and positions every remaining node with a finite top-left corner', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { kind: 'turn-group', turn: 1 },
        { kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 },
        { kind: 'assistant-message', seq: 2, time: 2, turn: 1, step: 1, callIds: [], textPreview: '' },
      ],
      edges: [
        { kind: 'contains', from: { kind: 'turn-group', id: '1' }, to: { kind: 'request-header', id: '1' } },
        { kind: 'sequence', from: { kind: 'request-header', id: '1' }, to: { kind: 'assistant-message', id: '2' } },
      ],
      runningCallIds: new Set(),
    }

    const layout = layoutGraphSnapshot(snapshot)

    expect(layout.nodes.map(positioned => positioned.node.kind)).toEqual(['request-header', 'assistant-message'])
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0]?.edge.kind).toBe('sequence')
    for (const positioned of layout.nodes) {
      expect(positioned.width).toBeGreaterThan(0)
      expect(positioned.height).toBeGreaterThan(0)
      expect(Number.isFinite(positioned.x)).toBe(true)
      expect(Number.isFinite(positioned.y)).toBe(true)
    }
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('carries a non-contains edge as React Flow source/target element ids', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 },
        { kind: 'assistant-message', seq: 2, time: 2, turn: 1, step: 1, callIds: [], textPreview: '' },
      ],
      edges: [
        { kind: 'sequence', from: { kind: 'request-header', id: '1' }, to: { kind: 'assistant-message', id: '2' } },
      ],
      runningCallIds: new Set(),
    }

    const layout = layoutGraphSnapshot(snapshot)

    expect(layout.edges).toEqual([
      { edge: snapshot.edges[0], source: 'request-header:1', target: 'assistant-message:2' },
    ])
  })

  it('drops an edge whose endpoint node is absent from the snapshot', () => {
    const snapshot: GraphSnapshot = {
      nodes: [{ kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 }],
      edges: [
        { kind: 'sequence', from: { kind: 'request-header', id: '1' }, to: { kind: 'assistant-message', id: 'missing' } },
      ],
      runningCallIds: new Set(),
    }

    const layout = layoutGraphSnapshot(snapshot)

    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toEqual([])
  })

  it('renders a tool-result node at the same width as other node kinds', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' },
        {
          kind: 'tool-result', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-a', name: 'bash',
          isError: false, durationMs: 1,
        },
      ],
      edges: [
        { kind: 'resolves', from: { kind: 'tool-call', id: 'call-a' }, to: { kind: 'tool-result', id: 'call-a' } },
      ],
      runningCallIds: new Set(),
    }

    const layout = layoutGraphSnapshot(snapshot)

    const call = layout.nodes.find(positioned => positioned.node.kind === 'tool-call')
    const result = layout.nodes.find(positioned => positioned.node.kind === 'tool-result')
    // A call and its result share one width so the pair aligns in a column.
    expect(result?.width).toBe(call?.width)
  })

  it('stacks a sequential chain top-to-bottom in one column', () => {
    const layout = layoutGraphSnapshot(toolChainSnapshot(3))

    const calls = layout.nodes
      .filter(positioned => positioned.node.kind === 'tool-call')
      .sort((left, right) => (left.node as { seq: number }).seq - (right.node as { seq: number }).seq)
    const xs = new Set(calls.map(positioned => positioned.x))
    expect(xs.size).toBe(1)
    expect(calls[0]!.y).toBeLessThan(calls[1]!.y)
    expect(calls[1]!.y).toBeLessThan(calls[2]!.y)
  })

  it('spreads parallel siblings horizontally at one timeline step, fanning out and back in', () => {
    // assistant → (call-a, call-b in parallel) → each resolves → both feed the next tool call.
    const snapshot: GraphSnapshot = {
      nodes: [
        { kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: ['call-a', 'call-b'], textPreview: '' },
        { kind: 'tool-call', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' },
        { kind: 'tool-call', seq: 3, time: 3, turn: 1, step: 1, callId: 'call-b', name: 'grep', argsRaw: '{}' },
      ],
      edges: [
        { kind: 'triggers', from: { kind: 'assistant-message', id: '1' }, to: { kind: 'tool-call', id: 'call-a' } },
        { kind: 'triggers', from: { kind: 'assistant-message', id: '1' }, to: { kind: 'tool-call', id: 'call-b' } },
      ],
      runningCallIds: new Set(),
    }

    const layout = layoutGraphSnapshot(snapshot)

    const assistant = layout.nodes.find(positioned => positioned.node.kind === 'assistant-message')!
    const a = layout.nodes.find(positioned => positioned.id === 'tool-call:call-a')!
    const b = layout.nodes.find(positioned => positioned.id === 'tool-call:call-b')!
    // Both calls share one timeline step below the assistant message, spread on the x axis.
    expect(a.y).toBe(b.y)
    expect(a.y).toBeGreaterThan(assistant.y)
    expect(a.x).not.toBe(b.x)
    // Fan-out: the assistant message drives an edge to each parallel call.
    expect(layout.edges.filter(positioned => positioned.source === assistant.id)).toHaveLength(2)
  })

  it('ranks a fan-in node below all its parallel predecessors', () => {
    // Two parallel calls (rank 1) both feed one converging assistant message (rank 2).
    const snapshot: GraphSnapshot = {
      nodes: [
        { kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: ['call-a', 'call-b'], textPreview: '' },
        { kind: 'tool-call', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' },
        { kind: 'tool-call', seq: 3, time: 3, turn: 1, step: 1, callId: 'call-b', name: 'grep', argsRaw: '{}' },
        { kind: 'assistant-message', seq: 4, time: 4, turn: 1, step: 2, callIds: [], textPreview: 'done' },
      ],
      edges: [
        { kind: 'triggers', from: { kind: 'assistant-message', id: '1' }, to: { kind: 'tool-call', id: 'call-a' } },
        { kind: 'triggers', from: { kind: 'assistant-message', id: '1' }, to: { kind: 'tool-call', id: 'call-b' } },
        { kind: 'sequence', from: { kind: 'tool-call', id: 'call-a' }, to: { kind: 'assistant-message', id: '4' } },
        { kind: 'sequence', from: { kind: 'tool-call', id: 'call-b' }, to: { kind: 'assistant-message', id: '4' } },
      ],
      runningCallIds: new Set(),
    }

    const layout = layoutGraphSnapshot(snapshot)

    const first = layout.nodes.find(positioned => positioned.id === 'assistant-message:1')!
    const a = layout.nodes.find(positioned => positioned.id === 'tool-call:call-a')!
    const b = layout.nodes.find(positioned => positioned.id === 'tool-call:call-b')!
    const converge = layout.nodes.find(positioned => positioned.id === 'assistant-message:4')!
    expect(a.y).toBe(b.y)
    expect(converge.y).toBeGreaterThan(a.y)
    expect(converge.y).toBeGreaterThan(first.y)
    // Fan-in: two edges converge on the same node.
    expect(layout.edges.filter(positioned => positioned.target === converge.id)).toHaveLength(2)
  })

  it('wraps a chain longer than 10 steps into a second column block, aligning wrapped rows', () => {
    const layout = layoutGraphSnapshot(toolChainSnapshot(12))

    const calls = layout.nodes
      .filter(positioned => positioned.node.kind === 'tool-call')
      .sort((left, right) => (left.node as { seq: number }).seq - (right.node as { seq: number }).seq)
    expect(calls).toHaveLength(12)

    const firstColumnX = calls[0]?.x
    for (const positioned of calls.slice(0, 10)) expect(positioned.x).toBe(firstColumnX)
    for (const positioned of calls.slice(10)) expect(positioned.x).not.toBe(firstColumnX)
    // Row 0 of block 2 (step 10) aligns vertically with row 0 of block 1 (step 0); same for row 1.
    expect(calls[10]?.y).toBe(calls[0]?.y)
    expect(calls[11]?.y).toBe(calls[1]?.y)
  })

  it('grows the canvas width when a chain wraps into a second column block', () => {
    const single = layoutGraphSnapshot(toolChainSnapshot(10))
    const wrapped = layoutGraphSnapshot(toolChainSnapshot(12))

    expect(wrapped.width).toBeGreaterThan(single.width)
  })
})

describe('layoutGraphSnapshot singleColumn', () => {
  it('keeps a long chain in one vertical column when singleColumn is set', () => {
    const layout = layoutGraphSnapshot(toolChainSnapshot(14), { singleColumn: true })

    const calls = layout.nodes
      .filter(positioned => positioned.node.kind === 'tool-call')
      .sort((left, right) => (left.node as { seq: number }).seq - (right.node as { seq: number }).seq)
    expect(calls).toHaveLength(14)
    const xs = new Set(calls.map(positioned => positioned.x))
    expect(xs.size).toBe(1)
    // Rows stack top to bottom without wrapping.
    const ys = calls.map(positioned => positioned.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
  })

  it('keeps every connector as a direct node-to-node edge in singleColumn mode', () => {
    const layout = layoutGraphSnapshot(toolChainSnapshot(20), { singleColumn: true })
    expect(layout.edges).toHaveLength(19)
    for (const edge of layout.edges) {
      expect(edge.source).not.toContain('junction:')
      expect(edge.target).not.toContain('junction:')
    }
  })

  it('single column is narrower but taller than the default wrapped layout', () => {
    const multi = layoutGraphSnapshot(toolChainSnapshot(14))
    const single = layoutGraphSnapshot(toolChainSnapshot(14), { singleColumn: true })

    expect(single.width).toBeLessThan(multi.width)
    expect(single.height).toBeGreaterThan(multi.height)
  })

  it('ignores singleColumn option when omitted (default wrapped layout preserved)', () => {
    const layout = layoutGraphSnapshot(toolChainSnapshot(12))
    const xs = new Set(layout.nodes.map(positioned => positioned.x))
    expect(xs.size).toBeGreaterThan(1)
  })

  it('uses default direct connectors when the timeline wraps into a second column', () => {
    const layout = layoutGraphSnapshot(parallelMergeAtColumnTail())

    // The two column-tail calls feed the next column's head directly: no
    // junction node and no synthesized right-angle route.
    expect(layout.edges).toContainEqual(expect.objectContaining({
      source: 'tool-call:p1',
      target: 'assistant-message:12',
    }))
    expect(layout.edges).toContainEqual(expect.objectContaining({
      source: 'tool-call:p2',
      target: 'assistant-message:12',
    }))
    for (const edge of layout.edges) {
      expect(edge.source).not.toContain('junction:')
      expect(edge.target).not.toContain('junction:')
    }
    expect('junctions' in layout).toBe(false)
  })

  it('sizes the wrapped layout without a junction extent', () => {
    const layout = layoutGraphSnapshot(parallelMergeAtColumnTail())
    const bottom = Math.max(...layout.nodes.map(entry => entry.y + entry.height))

    expect(layout.height).toBe(bottom)
  })
})
