/**
 * Browser graph plugin contributing one entry to the conversation view slot
 * without defining a service.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { GraphView } from './GraphView.tsx'
import { registerGraphConversationView } from './graph-snapshot-builder.ts'
import { registerGraphNodeDefinitions } from './graph-node-definitions.ts'
import { installGraphStyles } from './graph-styles.ts'
import { en, NS, zh } from './locales.ts'

/** Required services: the conversation slot, registries, and the locale service. */
export const inject = ['slots', 'conversationEvents', 'conversationViews', 'locale']

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
  }, GraphView))
}
