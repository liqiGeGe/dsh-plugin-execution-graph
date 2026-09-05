import type { ConversationLocation, ConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'

/** One contiguous line read out of a file by a read-only fs tool call. */
export interface GraphFileReadLine {
  readonly number: number
  readonly text: string
}

/**
 * File-read range surfaced by a read-only fs tool's `tool/result.meta`
 * (`presentationMeta`, e.g. `packages/fs/tool-fs/src/read.ts`). This package
 * narrows the untyped `JsonValue` meta into this shape at the fold boundary;
 * no shared type exists upstream to import instead.
 */
export interface GraphFileReadRange {
  readonly path: string
  readonly offset?: number
  readonly lines: readonly GraphFileReadLine[]
  readonly totalLines?: number
}

/** Grouping container for one Agent turn; every other node in the turn nests under it. */
export interface GraphTurnGroupNode {
  readonly kind: 'turn-group'
  readonly turn: number
}

/** One `request/header` event: a prompt submitted or changed for a turn/step. */
export interface GraphRequestHeaderNode {
  readonly kind: 'request-header'
  readonly seq: number
  readonly time: number
  readonly reason: 'initial' | 'resume' | 'change'
  readonly turn: number
  readonly step?: number
  /** The turn's first real user-submitted `user/message` text, attached by the snapshot builder. Absent for a turn with no human message yet (e.g. a synthetic/context-only turn). */
  readonly promptPreview?: string
}

/**
 * One real human `user/message` event for a turn — never a steering message or
 * synthesized context, both of which carry no prompt text worth surfacing.
 * Rendered as the turn's opening node (its prompt); the snapshot builder also
 * folds its `text` onto that turn's `request-header` `promptPreview`.
 */
export interface GraphUserMessageNode {
  readonly kind: 'user-message'
  readonly seq: number
  readonly time: number
  readonly turn: number
  readonly text: string
}

/** One `assistant/message` event: the LLM's submission for a turn/step. */
export interface GraphAssistantMessageNode {
  readonly kind: 'assistant-message'
  readonly seq: number
  readonly time: number
  readonly turn: number
  readonly step: number
  readonly callIds: readonly string[]
  readonly textPreview: string
}

/** One `tool/call` event, never merged with any other call by tool name. */
export interface GraphToolCallNode {
  readonly kind: 'tool-call'
  readonly seq: number
  readonly time: number
  readonly turn: number
  readonly step: number
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
}

/** One `tool/result` event, paired to its `tool-call` node by `callId`. */
export interface GraphToolResultNode {
  readonly kind: 'tool-result'
  readonly seq: number
  readonly time: number
  readonly turn: number
  readonly step: number
  readonly callId: string
  readonly name: string
  readonly isError: boolean
  /** Elapsed milliseconds between the paired `tool-call` node's `time` and this result's `time`. */
  readonly durationMs: number
  readonly fileRead?: GraphFileReadRange
  /** Text blocks joined from the result's model-visible content, when any are present. */
  readonly resultText?: string
}

/**
 * One Graph-owned `tool/call`→`tool/result` lifecycle Context, keyed by
 * `callId` so both events resolve to the same Context (mirrors
 * `ui-trajectory`'s `ToolCallBlock` union). `result` is absent while the
 * call has not yet settled — the snapshot builder projects this single
 * Context into a `tool-call` node plus, once settled, a paired
 * `tool-result` node and their `resolves` edge.
 */
export interface GraphToolLifecycle {
  readonly kind: 'tool'
  readonly call: GraphToolCallNode
  readonly result?: GraphToolResultNode
}

/** Union of every business node kind this package's Definitions produce. */
export type GraphBusinessNode =
  | GraphTurnGroupNode
  | GraphUserMessageNode
  | GraphRequestHeaderNode
  | GraphAssistantMessageNode
  | GraphToolCallNode
  | GraphToolResultNode

/**
 * A business node the timeline actually places as a card. The layout drops
 * `turn-group` nodes (one turn is shown at a time, so its container box would be
 * redundant chrome), so every positioned node and every rendered card is one of
 * these kinds.
 */
export type GraphCardNode = Exclude<GraphBusinessNode, GraphTurnGroupNode>

/**
 * Union of every Context-level contribution a Graph Definition emits.
 * `GraphTurnGroupNode` is deliberately absent: no Definition emits one —
 * the snapshot builder synthesizes turn-group nodes itself from the turn
 * numbers already carried on the other contributions.
 */
export type GraphContribution =
  | GraphRequestHeaderNode
  | GraphAssistantMessageNode
  | GraphToolLifecycle
  | GraphUserMessageNode

/** Stable identity for one node, reused as an edge endpoint. */
export interface GraphNodeKey {
  readonly kind: GraphBusinessNode['kind']
  readonly id: string
}

/**
 * The `id` half of a node's {@link GraphNodeKey}, matching the identity the
 * snapshot builder writes into every edge endpoint: a tool node is keyed by its
 * `callId` (so a `triggers`/`resolves`/`sequence` edge naming that call resolves
 * to the same node), a turn-group by its `turn`, and every other node by its
 * event `seq`.
 *
 * @param node - Business node to identify.
 * @returns The node's edge-endpoint id.
 */
export function businessNodeId(node: GraphBusinessNode): string {
  switch (node.kind) {
    case 'turn-group': return String(node.turn)
    case 'tool-call':
    case 'tool-result': return node.callId
    case 'user-message':
    case 'request-header':
    case 'assistant-message': return String(node.seq)
  }
}

/**
 * Whole-node element id (`kind:id`), unique across kinds sharing one id half.
 *
 * @param node - Business node to identify.
 * @returns The `kind:id` element id used as the React Flow node id.
 */
export function nodeElementId(node: GraphBusinessNode): string {
  return `${node.kind}:${businessNodeId(node)}`
}

/**
 * Element id for one edge endpoint, matching {@link nodeElementId}.
 *
 * @param key - Edge-endpoint node key.
 * @returns The `kind:id` element id the endpoint resolves to.
 */
export function endpointElementId(key: GraphNodeKey): string {
  return `${key.kind}:${key.id}`
}

/** Same-group temporal ordering: this node was observed immediately after `from`. */
export interface GraphSequenceEdge {
  readonly kind: 'sequence'
  readonly from: GraphNodeKey
  readonly to: GraphNodeKey
}

/** Causal trigger: an assistant message's tool-call block produced a `tool-call` node. */
export interface GraphTriggersEdge {
  readonly kind: 'triggers'
  readonly from: GraphNodeKey
  readonly to: GraphNodeKey
}

/** Pairing: a `tool-call` node was settled by its matching `tool-result` node. */
export interface GraphResolvesEdge {
  readonly kind: 'resolves'
  readonly from: GraphNodeKey
  readonly to: GraphNodeKey
}

/** Containment: a turn-group node encloses one of its member nodes. */
export interface GraphContainsEdge {
  readonly kind: 'contains'
  readonly from: GraphNodeKey
  readonly to: GraphNodeKey
}

/** Union of every edge kind this package's snapshot builder produces. */
export type GraphEdge =
  | GraphSequenceEdge
  | GraphTriggersEdge
  | GraphResolvesEdge
  | GraphContainsEdge

/** Target envelope consumed by the graph snapshot builder. */
export interface GraphConversationViewNode extends ConversationViewNode {
  readonly target: 'graph'
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly data: GraphContribution
}

/** Complete directed-graph projection of one session's activity. */
export interface GraphSnapshot {
  readonly nodes: readonly GraphBusinessNode[]
  readonly edges: readonly GraphEdge[]
  /** `callId`s with a `tool-call` node and no paired `tool-result` node yet. */
  readonly runningCallIds: ReadonlySet<string>
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationViewSnapshotMap {
    /** Independently assembled data consumed by the Graph view. */
    graph: GraphSnapshot
  }
}

/** Max characters kept in a turn-selector option's prompt preview. */
const TURN_PREVIEW_MAX_CHARS = 40

/**
 * Truncate free text for a fixed-width UI slot (selector options, badges).
 * Collapses newlines to spaces first so multi-line previews stay one line.
 *
 * @param text - Untruncated source text.
 * @param maxChars - Maximum characters kept before the ellipsis marker.
 * @returns Text collapsed to one line and truncated with a trailing `…`.
 */
export function truncatePreview(text: string, maxChars: number = TURN_PREVIEW_MAX_CHARS): string {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim()
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}…` : collapsed
}

/**
 * Distinct turn numbers present in a snapshot, each paired with a truncated
 * preview of that turn's prompt: the first `assistant-message` textPreview
 * in the turn, falling back to the request-header's `reason` when the turn
 * has no assistant message yet (e.g. a request still in flight).
 *
 * @param snapshot - Snapshot to scan for turn numbers and preview text.
 * @returns Turns in ascending order, each with a one-line preview string.
 */
export function listTurnPreviews(
  snapshot: GraphSnapshot,
): readonly { turn: number; preview: string }[] {
  const turns = new Set<number>()
  const assistantPreviewByTurn = new Map<number, string>()
  const reasonByTurn = new Map<number, string>()
  for (const node of snapshot.nodes) {
    turns.add(node.turn)
    if (node.kind === 'assistant-message' && node.textPreview !== '' && !assistantPreviewByTurn.has(node.turn)) {
      assistantPreviewByTurn.set(node.turn, node.textPreview)
    }
    if (node.kind === 'request-header' && !reasonByTurn.has(node.turn)) {
      reasonByTurn.set(node.turn, node.reason)
    }
  }
  return [...turns].sort((a, b) => a - b).map(turn => ({
    turn,
    preview: truncatePreview(assistantPreviewByTurn.get(turn) ?? reasonByTurn.get(turn) ?? ''),
  }))
}

/**
 * Restrict a snapshot to one turn's nodes and the edges between them.
 * `runningCallIds` passes through unfiltered: it is a `callId` set keyed
 * independently of turn, and an edge whose endpoint falls outside the kept
 * node set is dropped by the layout engine's own `hasNode` guard, so no
 * edge-side filtering is needed here.
 *
 * @param snapshot - Full snapshot to narrow.
 * @param turn - Turn number to keep, or `null` to pass the snapshot through unchanged.
 * @returns A snapshot containing only `turn`'s nodes, or `snapshot` itself when `turn` is `null`.
 */
export function filterSnapshotByTurn(snapshot: GraphSnapshot, turn: number | null): GraphSnapshot {
  if (turn === null) return snapshot
  const keptIds = new Set(
    snapshot.nodes
      .filter(node => node.turn === turn)
      .map(node => businessNodeId(node)),
  )
  return {
    nodes: snapshot.nodes.filter(node => node.turn === turn),
    edges: snapshot.edges.filter(edge => keptIds.has(edge.from.id) && keptIds.has(edge.to.id)),
    runningCallIds: snapshot.runningCallIds,
  }
}
