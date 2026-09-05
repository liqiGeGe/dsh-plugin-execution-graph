/**
 * Assistant-segment folding for the execution-graph timeline.
 *
 * Folding is an in-place view transform, not a re-layout: the timeline is always
 * laid out from the complete, unfolded snapshot (so column assignment, node
 * coordinates, and the viewport stay stable), and collapsing a segment only
 * decides which follower nodes are hidden and where a fold capsule bridges the
 * collapsed assistant to the next one. Keeping the full layout means a fold or
 * expand never re-ranks nodes across columns.
 */

import type { GraphSnapshot } from './graph-contract.ts'
import { nodeElementId } from './graph-contract.ts'

/**
 * Map each assistant-message's element id to the element ids of the nodes that
 * follow it in the timeline up to the next assistant-message (or the end of the
 * turn). Non-assistant nodes that appear before the first assistant message are
 * not owned by any segment.
 *
 * @param snapshot - Snapshot to scan (already narrowed to one turn).
 * @returns Assistant element id → following member element ids, in timeline order.
 */
export function assistantFoldMembers(snapshot: GraphSnapshot): ReadonlyMap<string, readonly string[]> {
  const ordered = snapshot.nodes
    .filter(node => node.kind !== 'turn-group')
    .slice()
    .sort((left, right) =>
      left.seq - right.seq || nodeElementId(left).localeCompare(nodeElementId(right)))
  const members = new Map<string, string[]>()
  const order: string[] = []
  let current: string | undefined
  for (const node of ordered) {
    const id = nodeElementId(node)
    if (node.kind === 'assistant-message') {
      current = id
      order.push(id)
      if (!members.has(id)) members.set(id, [])
    } else if (current !== undefined) {
      members.get(current)?.push(id)
    }
  }
  return members
}

/** Element ids of every assistant-message node present, in timeline order. */
export function assistantOrder(snapshot: GraphSnapshot): readonly string[] {
  const ids: string[] = []
  for (const node of snapshot.nodes) {
    if (node.kind !== 'assistant-message') continue
    ids.push(nodeElementId(node))
  }
  return ids
}

/**
 * One fold capsule bridging a collapsed assistant segment to the next kept
 * assistant message. Its geometry is resolved by the caller from the full
 * layout; here it only carries identity and the connection endpoints.
 */
export interface FoldCapsule {
  /** Capsule element id (`fold:<assistantId>`), usable as an edge endpoint. */
  readonly id: string
  /** Element id of the collapsed assistant-message card the capsule replaces. */
  readonly assistantId: string
  /** Element id of the next assistant message (may be absent for a trailing segment). */
  readonly nextAssistantId: string | undefined
  /** Number of follower nodes hidden inside this segment. */
  readonly count: number
}

/**
 * Resolve which assistant segments are collapsed and which follower nodes they
 * hide, plus the fold capsules that bridge each collapsed assistant to the next
 * one. Purely descriptive — the caller keeps the full layout and renders the
 * capsule over the assistant's position while hiding the follower nodes.
 *
 * @param snapshot - Snapshot to fold (already narrowed to one turn).
 * @param collapsed - Element ids of assistant-message nodes whose following
 * segment should be hidden.
 * @returns Hidden follower element ids and the bridging capsules.
 */
export function foldCapsuleView(
  snapshot: GraphSnapshot,
  collapsed: ReadonlySet<string>,
): { readonly hiddenIds: ReadonlySet<string>; readonly capsules: readonly FoldCapsule[] } {
  const members = assistantFoldMembers(snapshot)
  const order = assistantOrder(snapshot)
  const hiddenIds = new Set<string>()
  const capsules: FoldCapsule[] = []
  for (const [assistantId, followerIds] of members) {
    if (!collapsed.has(assistantId)) continue
    // An empty segment has nothing to fold; collapse state may outlive the
    // segment on a snapshot change, so only emit a capsule when members exist.
    if (followerIds.length === 0) continue
    for (const id of followerIds) hiddenIds.add(id)
    const position = order.indexOf(assistantId)
    const nextAssistantId = position >= 0 ? order[position + 1] : undefined
    capsules.push({
      id: `fold:${assistantId}`,
      assistantId,
      nextAssistantId,
      count: followerIds.length,
    })
  }
  return { hiddenIds, capsules }
}
