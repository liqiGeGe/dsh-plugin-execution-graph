/**
 * Browser graph plugin contributing one entry to the conversation view slot
 * without defining a service.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: ctx.slots on the client root context.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the 'conversation.view' SlotMap row and the target registries
// (ctx.uiConversation) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { GraphSnapshot } from './graph-contract.ts'
import { GraphView, type GraphViewInjected } from './GraphView.tsx'
import { EMPTY_GRAPH_SNAPSHOT, registerGraphConversationView } from './graph-snapshot-builder.ts'
import { registerGraphNodeDefinitions } from './graph-node-definitions.ts'
import { installGraphStyles } from './graph-styles.ts'
import { en, NS, zh } from './locales.ts'

/** Required services: the conversation slot, the target registries, and the locale service. */
export const inject = ['slots', 'uiConversation', 'locale']

/** Snapshot hook name; `InjectFace` turns it into the component's `useGraph` prop. */
const HOOK = 'graph'

/** Per-session source cache; unloading the plugin drops the map with it. */
const sources = new Map<SessionId, ObservableSnapshot<GraphSnapshot>>()

/**
 * Client plugin body: register the graph view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-graph: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  installGraphStyles(ctx)
  registerGraphNodeDefinitions(ctx)
  registerGraphConversationView(ctx)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'graph',
    order: 20,
    locale: NS,
    label: () => t('view.graph'),
    inject: (sessionId: SessionId): GraphViewInjected => {
      const target = ctx.uiConversation.binding(sessionId).target(HOOK)
      let source = sources.get(sessionId)
      if (source === undefined) {
        source = {
          getSnapshot: () => target.getSnapshot() ?? EMPTY_GRAPH_SNAPSHOT,
          subscribe: listener => target.subscribe(listener),
        }
        sources.set(sessionId, source)
      }
      return { hooks: { [HOOK]: source } }
    },
  }, GraphView))
}
