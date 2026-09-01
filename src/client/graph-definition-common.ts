import type { ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { GraphContribution, GraphConversationViewNode } from './graph-contract.ts'

/**
 * Wrap one contribution in the Engine-owned target envelope.
 *
 * @param context - Context that owns the contribution identity.
 * @param anchorSeq - Sequence used to order the contribution.
 * @param data - Graph-specific contribution payload.
 * @returns The contribution wrapped as a Graph view node.
 */
export function graphNode(
  context: ConversationNodeContext,
  anchorSeq: number,
  data: GraphContribution,
): GraphConversationViewNode {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: 'graph',
    anchorSeq,
    location: context.start?.location ?? { kind: 'unresolved' },
    data,
  }
}
