import type { Context } from '@deepseek-ai/cordis'
import type { ConversationMatch, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type { TextBlock } from '@deepseek-ai/dsh-llm/types'
import type {
  GraphAssistantMessageNode, GraphFileReadRange, GraphRequestHeaderNode,
  GraphToolLifecycle, GraphUserMessageNode,
} from './graph-contract.ts'
import { graphNode } from './graph-definition-common.ts'

/* jscpd:ignore-start -- Target-owned Definitions intentionally keep their event
 * state machines independent; see ../../../../../.agents/notes/implemented/
 * architecture/2026-08-09-client-conversation-node-assembly.md. */

/** Read-only fs tools whose `tool/result.meta` carries a file-read range. */
const FILE_READ_TOOL_NAMES: ReadonlySet<string> = new Set(['read', 'glob', 'grep'])

function isGraphFileReadRange(value: unknown): value is GraphFileReadRange {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { path?: unknown; lines?: unknown }
  return typeof candidate.path === 'string' && Array.isArray(candidate.lines)
}

/** Joins a `tool/result` block's inner content's text blocks, or `undefined` when none are present. */
function extractResultText(content: readonly { type: string; text?: unknown }[]): string | undefined {
  const text = content
    .filter((block): block is TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  return text === '' ? undefined : text
}

function locationTurn(match: ConversationMatch): number {
  return match.location.kind === 'step' || match.location.kind === 'turn'
    ? match.location.turn.turn
    : 0
}

function locationStep(match: ConversationMatch): number {
  return match.location.kind === 'step' ? match.location.step.step : 0
}

/** Graph-owned `request/header` fact: a prompt submitted or changed for a turn. */
const graphRequestHeaderDefinition: ConversationNodeDefinition<GraphRequestHeaderNode> = {
  kind: 'graph-request-header',
  target: 'graph',
  match: event => event.type === 'request/header'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'request/header') {
      throw new Error('graph-request-header start requires request/header')
    }
    return {
      kind: 'request-header',
      seq: match.event.seq,
      time: match.event.time,
      reason: match.event.data.reason,
      turn: locationTurn(match),
      ...(match.location.kind === 'step' ? { step: match.location.step.step } : {}),
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : graphNode(context, context.state.seq, context.state),
}

/** Graph-owned `assistant/message` fact: the LLM's submission for a turn/step. */
const graphAssistantMessageDefinition: ConversationNodeDefinition<GraphAssistantMessageNode> = {
  kind: 'graph-assistant-message',
  target: 'graph',
  match: event => event.type === 'assistant/message'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'assistant/message') {
      throw new Error('graph-assistant-message start requires assistant/message')
    }
    const { message } = match.event.data
    const callIds: string[] = []
    const textLines: string[] = []
    for (const block of message.content) {
      if (block.type === 'tool-call') callIds.push(String(block.id))
      else if (block.type === 'text') textLines.push(block.text)
    }
    return {
      kind: 'assistant-message',
      seq: match.event.seq,
      time: match.event.time,
      turn: match.event.data.turn,
      step: match.event.data.step,
      callIds,
      textPreview: textLines.join('\n'),
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : graphNode(context, context.state.seq, context.state),
}

/** Graph-owned `user/message` fact: a real human prompt's text for a turn. */
const graphUserMessageDefinition: ConversationNodeDefinition<GraphUserMessageNode> = {
  kind: 'graph-user-message',
  target: 'graph',
  match: event => event.type === 'user/message' && event.data.source.kind === 'user'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'user/message') {
      throw new Error('graph-user-message start requires user/message')
    }
    const text = match.event.data.content
      .filter((block): block is TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    return { kind: 'user-message', seq: match.event.seq, time: match.event.time, turn: locationTurn(match), text }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : graphNode(context, context.state.seq, context.state),
}

/**
 * Graph-owned `tool/call`→`tool/result` lifecycle, keyed by `callId` so both
 * events resolve to the same Context (never merged with any other call by
 * name — each `callId` gets its own Context and its own rendered nodes).
 */
const graphToolDefinition: ConversationNodeDefinition<GraphToolLifecycle> = {
  kind: 'graph-tool',
  target: 'graph',
  match: (event) => {
    if (event.type === 'tool/call') return { id: String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result') {
      return { id: String(event.data.message.source.callId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool/call') {
      throw new Error('graph-tool start requires tool/call')
    }
    return {
      kind: 'tool',
      call: {
        kind: 'tool-call',
        seq: match.event.seq,
        time: match.event.time,
        turn: match.event.data.turn,
        step: match.event.data.step,
        callId: String(match.event.data.callId),
        name: match.event.data.name,
        argsRaw: match.event.data.arguments,
      },
    }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const { call } = context.state
    const isFileReadTool = FILE_READ_TOOL_NAMES.has(call.name)
    const meta = match.event.data.meta
    const fileRead = isFileReadTool && isGraphFileReadRange(meta) ? meta : undefined
    const resultText = extractResultText(match.event.data.message.content[0].content)
    return {
      ...context.state,
      result: {
        kind: 'tool-result',
        seq: match.event.seq,
        time: match.event.time,
        turn: locationTurn(match),
        step: locationStep(match),
        callId: call.callId,
        name: call.name,
        isError: match.event.data.message.content[0].isError === true,
        durationMs: match.event.time - call.time,
        ...(fileRead === undefined ? {} : { fileRead }),
        ...(resultText === undefined ? {} : { resultText }),
      },
    }
  },
  buildViewNode: context => context.state === undefined
    ? null
    : graphNode(context, context.state.call.seq, context.state),
}
/* jscpd:ignore-end */

/**
 * Register every Graph-owned Definition.
 *
 * @param ctx - Plugin context receiving the Definitions.
 */
export function registerGraphNodeDefinitions(ctx: Context): void {
  ctx.conversationEvents.register(graphRequestHeaderDefinition)
  ctx.conversationEvents.register(graphAssistantMessageDefinition)
  ctx.conversationEvents.register(graphUserMessageDefinition)
  ctx.conversationEvents.register(graphToolDefinition)
}
