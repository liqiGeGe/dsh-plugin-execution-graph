import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type {
  ConversationEventInput, ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { registerGraphNodeDefinitions } from '../src/client/graph-node-definitions.ts'
import { graphNode } from '../src/client/graph-definition-common.ts'
import type { GraphSnapshot } from '../src/client/graph-contract.ts'
import { graphViewDefinition } from '../src/client/graph-snapshot-builder.ts'

const DEFINITIONS: ConversationNodeDefinition[] = []
const registrationContext = {
  conversationEvents: {
    register: (definition: ConversationNodeDefinition) => {
      DEFINITIONS.push(definition)
      return () => {}
    },
  },
} as unknown as Context

registerGraphNodeDefinitions(registrationContext)

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): undefined {
    return undefined
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [graphViewDefinition]
  }
}

function at(
  seq: number,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): ConversationEventInput {
  return {
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

function assembler(events: readonly ConversationEventInput[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(
    new TestEventDefinitions(),
    new TestViewDefinitions(),
  )
  value.replaceWindow(events, false)
  value.flush()
  return value
}

function snapshot(value: ConversationNodeAssembler): GraphSnapshot {
  const current = value.snapshot('graph') as GraphSnapshot | undefined
  if (current === undefined) throw new Error('graph view was not registered')
  return current
}

function assistantMessage(id: string, blocks: readonly { type: string; [key: string]: unknown }[]) {
  return {
    id,
    role: 'assistant',
    content: blocks,
    source: { kind: 'model', provider: 'test', model: 'test' },
  }
}

describe('Graph conversation Definitions', () => {
  it('folds a request header into a request-header node located at its step', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'request/header', { reason: 'initial' }, {
        location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } },
      }),
    ]))

    expect(current.nodes).toContainEqual({
      kind: 'request-header',
      seq: 3,
      time: 1_700_000_000_003,
      reason: 'initial',
      turn: 1,
      step: 1,
    })
  })

  it('folds a request header located at turn scope with no step field', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'request/header', { reason: 'resume' }, {
        location: { kind: 'turn', turn: { turn: 1 } },
      }),
    ]))

    expect(current.nodes).toContainEqual({
      kind: 'request-header',
      seq: 2,
      time: 1_700_000_000_002,
      reason: 'resume',
      turn: 1,
    })
  })

  it('defaults turn to 0 for a request header with an unresolved location', () => {
    const current = snapshot(assembler([
      at(1, 'request/header', { reason: 'initial' }, {
        location: { kind: 'unresolved' },
      }),
    ]))

    expect(current.nodes).toContainEqual({
      kind: 'request-header',
      seq: 1,
      time: 1_700_000_000_001,
      reason: 'initial',
      turn: 0,
    })
  })

  it('collects tool-call ids from an assistant message and joins text blocks for the preview', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-1', [
          { type: 'text', text: 'first line' },
          { type: 'tool-call', id: 'call-a', name: 'read', arguments: '{}' },
          { type: 'text', text: 'second line' },
          { type: 'tool-call', id: 'call-b', name: 'bash', arguments: '{}' },
        ]),
      }),
    ]))

    expect(current.nodes).toContainEqual({
      kind: 'assistant-message',
      seq: 3,
      time: 1_700_000_000_003,
      turn: 1,
      step: 1,
      callIds: ['call-a', 'call-b'],
      textPreview: 'first line\nsecond line',
    })
  })

  it('ignores assistant message blocks that are neither text nor tool-call', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-1', [
          { type: 'reasoning', text: 'internal thought' },
          { type: 'text', text: 'visible line' },
        ]),
      }),
    ]))

    expect(current.nodes).toContainEqual({
      kind: 'assistant-message',
      seq: 3,
      time: 1_700_000_000_003,
      turn: 1,
      step: 1,
      callIds: [],
      textPreview: 'visible line',
    })
  })

  it('never merges two tool calls by name and pairs each with its own result', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"cmd":"ls"}' }),
      at(4, 'tool/call', { turn: 1, step: 1, callId: 'call-2', name: 'bash', arguments: '{"cmd":"pwd"}' }),
      at(5, 'tool/result', {
        turn: 1, step: 1,
        message: { source: { callId: 'call-1' }, content: [{ isError: false, content: [] }] },
      }),
    ]))

    const calls = current.nodes.filter(node => node.kind === 'tool-call')
    expect(calls).toHaveLength(2)
    expect(calls.map(node => node.kind === 'tool-call' ? node.callId : undefined).sort())
      .toEqual(['call-1', 'call-2'])

    const results = current.nodes.filter(node => node.kind === 'tool-result')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ callId: 'call-1', isError: false, durationMs: 2 })
    expect(current.runningCallIds).toEqual(new Set(['call-2']))
  })

  it('does not sequence parallel tool calls against each other, but converges both into their shared next node', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-1', [
          { type: 'tool-call', id: 'call-a', name: 'read', arguments: '{}' },
          { type: 'tool-call', id: 'call-b', name: 'bash', arguments: '{}' },
        ]),
      }),
      at(4, 'tool/call', { turn: 1, step: 1, callId: 'call-a', name: 'read', arguments: '{}' }),
      at(5, 'tool/call', { turn: 1, step: 1, callId: 'call-b', name: 'bash', arguments: '{}' }),
      at(6, 'tool/result', {
        turn: 1, step: 1,
        message: { source: { callId: 'call-b' }, content: [{ isError: false, content: [] }] },
      }),
      at(7, 'tool/result', {
        turn: 1, step: 1,
        message: { source: { callId: 'call-a' }, content: [{ isError: false, content: [] }] },
      }),
      at(8, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-2', []),
      }),
    ]))

    const assistant1 = { kind: 'assistant-message', id: '3' } as const
    const callA = { kind: 'tool-call', id: 'call-a' } as const
    const callB = { kind: 'tool-call', id: 'call-b' } as const
    const resultA = { kind: 'tool-result', id: 'call-a' } as const
    const resultB = { kind: 'tool-result', id: 'call-b' } as const
    const assistant2 = { kind: 'assistant-message', id: '8' } as const

    const sequenceEdges = current.edges.filter(edge => edge.kind === 'sequence')

    // Siblings triggered by the same assistant message are never chained against each other.
    expect(sequenceEdges).not.toContainEqual({ kind: 'sequence', from: callA, to: callB })
    expect(sequenceEdges).not.toContainEqual({ kind: 'sequence', from: callB, to: callA })
    expect(sequenceEdges).not.toContainEqual({ kind: 'sequence', from: resultA, to: resultB })
    expect(sequenceEdges).not.toContainEqual({ kind: 'sequence', from: resultB, to: resultA })

    // Both parallel branches converge on the next node once they settle.
    expect(sequenceEdges).toContainEqual({ kind: 'sequence', from: resultA, to: assistant2 })
    expect(sequenceEdges).toContainEqual({ kind: 'sequence', from: resultB, to: assistant2 })

    expect(current.edges).toContainEqual({ kind: 'triggers', from: assistant1, to: callA })
    expect(current.edges).toContainEqual({ kind: 'triggers', from: assistant1, to: callB })
  })

  it('marks a tool result as an error and extracts a file-read range for a read-only fs tool', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'call-read', name: 'read', arguments: '{"path":"a.ts"}' }),
      at(4, 'tool/result', {
        turn: 1, step: 1,
        message: { source: { callId: 'call-read' }, content: [{ isError: false, content: [] }] },
        meta: { path: 'a.ts', lines: [{ number: 1, text: 'const a = 1' }] },
      }),
      at(5, 'tool/call', { turn: 1, step: 1, callId: 'call-bash', name: 'bash', arguments: '{}' }),
      at(6, 'tool/result', {
        turn: 1, step: 1,
        message: { source: { callId: 'call-bash' }, content: [{ isError: true, content: [] }] },
        meta: { path: 'a.ts', lines: [] },
      }),
    ]))

    const results = current.nodes.filter(node => node.kind === 'tool-result')
    const readResult = results.find(node => node.kind === 'tool-result' && node.callId === 'call-read')
    expect(readResult).toMatchObject({
      isError: false,
      fileRead: { path: 'a.ts', lines: [{ number: 1, text: 'const a = 1' }] },
    })

    const bashResult = results.find(node => node.kind === 'tool-result' && node.callId === 'call-bash')
    expect(bashResult).toMatchObject({ isError: true })
    expect(bashResult && 'fileRead' in bashResult ? bashResult.fileRead : undefined).toBeUndefined()
  })

  it('skips the file-read range for a read-only fs tool whose meta is not a file-read shape', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'call-glob', name: 'glob', arguments: '{"pattern":"*.ts"}' }),
      at(4, 'tool/result', {
        turn: 1, step: 1,
        message: { source: { callId: 'call-glob' }, content: [{ isError: false, content: [] }] },
        meta: 'not-an-object',
      }),
    ]))

    const result = current.nodes.find(node => node.kind === 'tool-result')
    expect(result).toMatchObject({ isError: false })
    expect(result && 'fileRead' in result ? result.fileRead : undefined).toBeUndefined()
  })

  it('joins text blocks from a tool result\'s content into resultText', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'call-bash', name: 'bash', arguments: '{}' }),
      at(4, 'tool/result', {
        turn: 1, step: 1,
        message: {
          source: { callId: 'call-bash' },
          content: [{
            isError: false,
            content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }],
          }],
        },
      }),
    ]))

    const result = current.nodes.find(node => node.kind === 'tool-result')
    expect(result).toMatchObject({ resultText: 'line one\nline two' })
  })

  it('leaves resultText absent when a tool result has no text blocks', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'call-bash', name: 'bash', arguments: '{}' }),
      at(4, 'tool/result', {
        turn: 1, step: 1,
        message: { source: { callId: 'call-bash' }, content: [{ isError: false, content: [] }] },
      }),
    ]))

    const result = current.nodes.find(node => node.kind === 'tool-result')
    expect(result && 'resultText' in result ? result.resultText : undefined).toBeUndefined()
  })

  it('locates a tool result at turn scope once its step has closed', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'call-bash', name: 'bash', arguments: '{}' }),
      at(4, 'step/end', { turn: 1, step: 1 }),
      at(5, 'tool/result', {
        message: { source: { callId: 'call-bash' }, content: [{ isError: false, content: [] }] },
      }),
    ]))

    const result = current.nodes.find(node => node.kind === 'tool-result')
    expect(result).toMatchObject({ turn: 1, step: 0 })
  })

  it('leaves a request-header/assistant-message state unchanged on their unreachable update passthrough', () => {
    const requestHeader = DEFINITIONS.find(definition => definition.kind === 'graph-request-header')
    const assistantMessage = DEFINITIONS.find(definition => definition.kind === 'graph-assistant-message')
    if (requestHeader === undefined || assistantMessage === undefined) {
      throw new Error('graph-request-header/graph-assistant-message Definitions were not registered')
    }
    const fakeMatch = { id: 'x', role: 'start' } as unknown as Parameters<typeof requestHeader.update>[1]

    const headerState = { kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 } as const
    const headerContext = { key: 'k', kind: requestHeader.kind, id: 'x', matches: [], start: undefined, current: new Map(), state: headerState }
    expect(requestHeader.update(headerContext, fakeMatch)).toBe(headerState)

    const messageState = {
      kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [], textPreview: '',
    } as const
    const messageContext = { key: 'k', kind: assistantMessage.kind, id: 'x', matches: [], start: undefined, current: new Map(), state: messageState }
    expect(assistantMessage.update(messageContext, fakeMatch)).toBe(messageState)
  })

  it('leaves a tool lifecycle unchanged when an update Match is not a tool/result event', () => {
    const tool = DEFINITIONS.find(definition => definition.kind === 'graph-tool')
    if (tool === undefined) throw new Error('graph-tool Definition was not registered')

    const call = {
      kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}',
    } as const
    const state = { kind: 'tool', call } as const
    const context = { key: 'k', kind: tool.kind, id: 'call-a', matches: [], start: undefined, current: new Map(), state }
    const nonResultMatch = {
      id: 'call-a', role: 'update', event: at(2, 'tool/call', { turn: 1, step: 1, callId: 'call-a', name: 'bash', arguments: '{}' }).event,
      location: { kind: 'unresolved' },
    } as unknown as Parameters<typeof tool.update>[1]

    expect(tool.update(context, nonResultMatch)).toBe(state)
  })

  it('builds no view node for a tool lifecycle Context with no state yet', () => {
    const tool = DEFINITIONS.find(definition => definition.kind === 'graph-tool')
    if (tool === undefined) throw new Error('graph-tool Definition was not registered')

    const context = {
      key: 'k', kind: tool.kind, id: 'call-a', matches: [], start: undefined, current: new Map(), state: undefined,
    }
    if (tool.buildViewNode === undefined) throw new Error('graph-tool Definition has no buildViewNode')
    expect(tool.buildViewNode(context)).toBeNull()
  })

  it('falls back to an unresolved location when a Context has no start Match', () => {
    const state = { kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 0 } as const
    const context = {
      key: 'k', kind: 'graph-request-header', id: 'x', matches: [], start: undefined, current: new Map(), state,
    }

    expect(graphNode(context, state.seq, state).location).toEqual({ kind: 'unresolved' })
  })

  it('builds no view node for a request-header/assistant-message Context with no state yet', () => {
    const requestHeader = DEFINITIONS.find(definition => definition.kind === 'graph-request-header')
    const assistantMessage = DEFINITIONS.find(definition => definition.kind === 'graph-assistant-message')
    if (requestHeader === undefined || assistantMessage === undefined) {
      throw new Error('graph-request-header/graph-assistant-message Definitions were not registered')
    }

    if (requestHeader.buildViewNode === undefined || assistantMessage.buildViewNode === undefined) {
      throw new Error('graph-request-header/graph-assistant-message Definitions have no buildViewNode')
    }

    const headerContext = { key: 'k', kind: requestHeader.kind, id: 'x', matches: [], start: undefined, current: new Map(), state: undefined }
    expect(requestHeader.buildViewNode(headerContext)).toBeNull()

    const messageContext = { key: 'k', kind: assistantMessage.kind, id: 'x', matches: [], start: undefined, current: new Map(), state: undefined }
    expect(assistantMessage.buildViewNode(messageContext)).toBeNull()
  })

  it('rejects a start Match whose event is not the Definition\'s own owned event type', () => {
    const requestHeader = DEFINITIONS.find(definition => definition.kind === 'graph-request-header')
    const assistantMessage = DEFINITIONS.find(definition => definition.kind === 'graph-assistant-message')
    const tool = DEFINITIONS.find(definition => definition.kind === 'graph-tool')
    if (requestHeader === undefined || assistantMessage === undefined || tool === undefined) {
      throw new Error('graph-request-header/graph-assistant-message/graph-tool Definitions were not registered')
    }
    const context = { key: 'k', kind: 'x', id: 'x', matches: [], start: undefined, current: new Map(), state: undefined }
    const wrongMatch = {
      id: 'x', role: 'start', event: at(1, 'turn/start', { turn: 1 }).event, location: { kind: 'unresolved' },
    } as unknown as Parameters<typeof requestHeader.start>[1]
    const reader = { previous: () => undefined }

    expect(() => requestHeader.start(context, wrongMatch, reader)).toThrow('graph-request-header start requires request/header')
    expect(() => assistantMessage.start(context, wrongMatch, reader)).toThrow('graph-assistant-message start requires assistant/message')
    expect(() => tool.start(context, wrongMatch, reader)).toThrow('graph-tool start requires tool/call')
  })

  it('folds a real user message\'s text onto its turn\'s request-header promptPreview and places it as a node', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'request/header', { reason: 'initial' }, {
        location: { kind: 'turn', turn: { turn: 1 } },
      }),
      at(3, 'user/message', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'what is the plan?' }],
        source: { kind: 'user' },
      }, {
        location: { kind: 'turn', turn: { turn: 1 } },
      }),
    ]))

    // The user message is placed as the turn's opening prompt node; the
    // request-header is dropped as a redundant second opener when a prompt exists.
    expect(current.nodes.some(node => node.kind === 'request-header')).toBe(false)
    expect(current.nodes).toContainEqual({
      kind: 'user-message',
      seq: 3,
      time: 1_700_000_000_003,
      turn: 1,
      text: 'what is the plan?',
    })
  })

  it('joins multiple text blocks in a user message and ignores non-user sources', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'request/header', { reason: 'initial' }, {
        location: { kind: 'turn', turn: { turn: 1 } },
      }),
      at(3, 'user/message', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }],
        source: { kind: 'user' },
      }, {
        location: { kind: 'turn', turn: { turn: 1 } },
      }),
      at(4, 'user/message', {
        id: 'm2',
        role: 'user',
        content: [{ type: 'text', text: 'steering, not a real prompt' }],
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'x' },
      }, {
        location: { kind: 'turn', turn: { turn: 1 } },
      }),
    ]))

    // The real prompt's text blocks join into the user-message node; the
    // request-header is dropped because a real prompt exists.
    expect(current.nodes.some(node => node.kind === 'request-header')).toBe(false)
    expect(current.nodes).toContainEqual(expect.objectContaining({
      kind: 'user-message',
      text: 'line one\nline two',
    }))
  })

  it('leaves promptPreview absent when a turn has no real user message yet', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'request/header', { reason: 'initial' }, {
        location: { kind: 'turn', turn: { turn: 1 } },
      }),
    ]))

    const header = current.nodes.find(node => node.kind === 'request-header')
    expect(header).toEqual({
      kind: 'request-header', seq: 2, time: 1_700_000_000_002, reason: 'initial', turn: 1,
    })
  })

  it('rejects a start Match whose event is not user/message for graph-user-message', () => {
    const userMessage = DEFINITIONS.find(definition => definition.kind === 'graph-user-message')
    if (userMessage === undefined) throw new Error('graph-user-message Definition was not registered')
    const context = { key: 'k', kind: 'x', id: 'x', matches: [], start: undefined, current: new Map(), state: undefined }
    const wrongMatch = {
      id: 'x', role: 'start', event: at(1, 'turn/start', { turn: 1 }).event, location: { kind: 'unresolved' },
    } as unknown as Parameters<typeof userMessage.start>[1]
    const reader = { previous: () => undefined }

    expect(() => userMessage.start(context, wrongMatch, reader)).toThrow('graph-user-message start requires user/message')
  })

  it('leaves a user-message state unchanged on its unreachable update passthrough', () => {
    const userMessage = DEFINITIONS.find(definition => definition.kind === 'graph-user-message')
    if (userMessage === undefined) throw new Error('graph-user-message Definition was not registered')
    const fakeMatch = { id: 'x', role: 'start' } as unknown as Parameters<typeof userMessage.update>[1]

    const state = { kind: 'user-message', seq: 1, turn: 1, text: 'hi' } as const
    const context = { key: 'k', kind: userMessage.kind, id: 'x', matches: [], start: undefined, current: new Map(), state }
    expect(userMessage.update(context, fakeMatch)).toBe(state)
  })

  it('builds no view node for a user-message Context with no state yet', () => {
    const userMessage = DEFINITIONS.find(definition => definition.kind === 'graph-user-message')
    if (userMessage === undefined) throw new Error('graph-user-message Definition was not registered')
    if (userMessage.buildViewNode === undefined) throw new Error('graph-user-message Definition has no buildViewNode')

    const context = {
      key: 'k', kind: userMessage.kind, id: 'x', matches: [], start: undefined, current: new Map(), state: undefined,
    }
    expect(userMessage.buildViewNode(context)).toBeNull()
  })
})
