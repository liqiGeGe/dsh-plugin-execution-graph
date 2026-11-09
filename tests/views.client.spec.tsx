// @vitest-environment jsdom
/**
 * View registration acceptance on the real framework stack: the plugin fiber
 * registers Graph into a real SlotRegistry view ring without an inject face,
 * GraphView renders the laid-out timeline for a session snapshot, and fiber
 * disposal removes the tab and both registries' entries (HMR safety).
 *
 * React Flow is mocked: jsdom has no layout engine (no ResizeObserver, zero-size
 * boxes), so the real `<ReactFlow>` renders nothing measurable. The mock renders
 * each node through the real `nodeTypes` card component and exposes the node/edge
 * props, so the card content, running/error state, selection wiring, and edge set
 * this package owns are all exercised; React Flow's own pan/zoom/measurement is
 * not this package's code to cover.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ComponentType, MouseEvent } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { setCenterMock } = vi.hoisted(() => ({ setCenterMock: vi.fn() }))
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { stubConfigForm, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { apply as localeApply, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { GraphView } from '../src/client/GraphView.tsx'
import { layoutGraphSnapshot } from '../src/client/graph-layout.ts'
import { en, zh } from '../src/client/locales.ts'
import type { GraphSnapshot } from '../src/client/graph-contract.ts'
import css from '../src/client/GraphView.module.css'

/**
 * Minimal React Flow stand-in. Renders every node through its registered
 * `nodeTypes` card and wires `onNodeClick`/`onPaneClick` to plain buttons so the
 * card content and selection behavior stay under test without a layout engine.
 */
vi.mock('@xyflow/react', () => {
  interface MockNode { id: string; type: string; data: unknown }
  interface MockEdge { id: string; source: string; target: string }
  const ReactFlow = ({ nodes, edges, nodeTypes, onNodeClick, onPaneClick, minZoom, children }: {
    nodes: MockNode[]
    edges: MockEdge[]
    nodeTypes: Record<string, ComponentType<{ data: unknown }>>
    onNodeClick?: (event: MouseEvent, node: MockNode) => void
    onPaneClick?: () => void
    minZoom?: number
    children?: unknown
  }) => (
    <div data-testid="rf" data-min-zoom={minZoom === undefined ? undefined : String(minZoom)}>
      <button type="button" data-testid="rf-pane" onClick={() => onPaneClick?.()}>pane</button>
      {nodes.map((node) => {
        const Card = nodeTypes[node.type]!
        return (
          <div
            key={node.id}
            role="button"
            tabIndex={0}
            data-node-id={node.id}
            onClick={event => onNodeClick?.(event as unknown as MouseEvent, node)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onNodeClick?.(event as unknown as MouseEvent, node) }}
          >
            <Card data={node.data} />
          </div>
        )
      })}
      <div data-testid="rf-edges">{edges.map(edge => <span key={edge.id} data-edge-id={edge.id} />)}</div>
      {children as never}
    </div>
  )
  return {
    ReactFlow,
    ReactFlowProvider: ({ children }: { children: unknown }) => <>{children as never}</>,
    Background: () => null,
    Controls: ({ children }: { children?: unknown }) => <div data-testid="rf-controls">{children as never}</div>,
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    // ViewportController and ScrollTopButton (rendered inside the provider) call useReactFlow.
    useReactFlow: () => ({ setCenter: setCenterMock, getZoom: () => 1 }),
  }
})

afterEach(() => {
  cleanup()
  setCenterMock.mockClear()
  delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard
  sessionState = { hasMore: false, loadingOlder: false }
  loadOlder = vi.fn(() => Promise.resolve())
})

/** jsdom has no clipboard; install a resolving stub for copy flows. */
function stubClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  })
}

let loadOlder = vi.fn(() => Promise.resolve())
let sessionState = { hasMore: false, loadingOlder: false }

const toolRunningClass = css.toolRunning
if (toolRunningClass === undefined) throw new Error('toolRunning class missing from GraphView.module.css')

/** Real-stack bench: root Context + real SlotRegistry ring + the plugin fiber. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.slots as SlotRegistry
  // Real assembly service so definition registrations are owned by the
  // plugin's fiber and disappear with it, exactly as in the client roster.
  const uiConversation = new UiConversation(ctx, { binding: () => undefined } as unknown as ISessions)
  const { events, views } = uiConversation
  ctx.provide('sessions', { binding: () => undefined } as never)
  slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  }, (_p: { renderSlot?: unknown }) => null)
  const chatBody = vi.fn(() => <div data-testid="chat-body" />)
  slots.register(
    { name: 'conversation.view', id: 'chat', order: 0, label: 'Chat' } as never, chatBody as never)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('configForms', { get: () => stubConfigForm().scope } as never)
  await ctx.plugin({ inject: [...localeInject], apply: localeApply }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, fiber, events, views }
}

function tabsOf(slots: SlotRegistry) {
  return slots.entries('conversation.view')
    .map(e => ({ id: e.options.id!, label: resolveSlotLabel(e.options.label) ?? e.options.id! }))
}

describe('plugin registration', () => {
  it('registers graph after chat on the ring with a snapshot inject face', async () => {
    const b = await bench()
    expect(tabsOf(b.slots)).toEqual([
      { id: 'chat', label: 'Chat' },
      { id: 'graph', label: 'Execution graph' },
    ])
    const entry = b.slots.entries('conversation.view').find(candidate => candidate.options.id === 'graph')
    expect(entry?.inject).toBeTypeOf('function')
  })

  it('labels the graph tab in the active locale', async () => {
    const b = await bench()
    const labelOf = () => tabsOf(b.slots).find(tab => tab.id === 'graph')?.label
    expect(labelOf()).toBe('Execution graph')
    const locale = b.ctx.get('locale') as { setLocale(id: string): void }
    locale.setLocale('zh')
    expect(labelOf()).toBe('执行图')
    locale.setLocale('en')
    expect(labelOf()).toBe('Execution graph')
  })

  it('fiber disposal removes the tab and leaves chat standing, clearing both registries', async () => {
    const b = await bench()
    expect(b.events.entries().length).toBeGreaterThan(0)
    expect(b.views.entries()).toHaveLength(1)

    await b.fiber.dispose()

    expect(tabsOf(b.slots).map(v => v.id)).toEqual(['chat'])
    expect(b.events.entries()).toEqual([])
    expect(b.views.entries()).toEqual([])
  })
})

describe('node half', () => {
  it('node apply is an intentional no-op (loader-managed lifecycle only)', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

describe('GraphView', () => {
  const t = (key: string, params?: Record<string, unknown>) => {
    const template = zh[key as keyof typeof zh] ?? key
    return params === undefined
      ? template
      : template.replaceAll(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? ''))
  }

  const enT = (key: string, params?: Record<string, unknown>) => {
    const template = en[key as keyof typeof en] ?? key
    return params === undefined
      ? template
      : template.replaceAll(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? ''))
  }

  function renderGraph(snapshot: GraphSnapshot, translate: typeof t = t) {
    const store = createSnapshotStore(snapshot)
    const props = {
      sessionId: 's1',
      useGraph: bindSnapshotSelector(store),
      useSession: (selector: (snapshot: typeof sessionState) => unknown) => selector(sessionState),
      loadOlder,
      t: translate,
    } as unknown as ComponentProps<typeof GraphView>
    return render(<GraphView {...props} />)
  }

  it('renders the empty state for a session with no recorded activity', () => {
    renderGraph({ nodes: [], edges: [], runningCallIds: new Set() })
    expect(screen.getByText('当前会话暂无活动')).toBeTruthy()
  })

  it('renders a tool-call card with its kind label, name, and args preview, and opens its detail', () => {
    renderGraph({
      nodes: [
        { kind: 'turn-group', turn: 1 },
        {
          kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{"cmd":"ls"}',
        },
      ],
      edges: [{
        kind: 'contains',
        from: { kind: 'turn-group', id: '1' },
        to: { kind: 'tool-call', id: 'call-a' },
      }],
      runningCallIds: new Set(['call-a']),
    })

    // Turn-group is dropped from the canvas; it survives only as a selector option.
    expect(screen.getByText('工具')).toBeTruthy() // kind label
    expect(screen.getByText('bash')).toBeTruthy() // tool name, same row as the kind label
    expect(screen.getByText('{"cmd":"ls"}')).toBeTruthy() // args preview, second row

    fireEvent.click(screen.getByRole('button', { name: /bash/ }))
    // The detail panel renders a `Payload` JSON tree (the args split into key/value),
    // so the `原始参数` section label appears; the card preview keeps the raw string.
    expect(screen.getByText('原始参数')).toBeTruthy()
    expect(screen.getByText('cmd:')).toBeTruthy() // JsonTree key row

    // Selection is sticky: clicking the same node again keeps the detail open.
    fireEvent.click(screen.getByRole('button', { name: /bash/ }))
    expect(screen.getByText('原始参数')).toBeTruthy()
  })

  it('applies the running border-animation class to a running tool call and not to a settled one', () => {
    const { container } = renderGraph({
      nodes: [
        {
          kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}',
        },
        {
          kind: 'tool-call', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-b', name: 'read', argsRaw: '{}',
        },
      ],
      edges: [],
      runningCallIds: new Set(['call-a']),
    })

    expect(container.getElementsByClassName(toolRunningClass)).toHaveLength(1)
    expect(screen.getByRole('button', { name: /bash/ }).querySelector(`.${toolRunningClass}`)).toBeTruthy()
    expect(screen.getByRole('button', { name: /read/ }).querySelector(`.${toolRunningClass}`)).toBeNull()
  })

  it('marks a settled call as no longer running and shows its result badge/detail', () => {
    renderGraph({
      nodes: [
        {
          kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'read', argsRaw: '{}',
        },
        {
          kind: 'tool-result', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-a', name: 'read', isError: false, durationMs: 1,
          fileRead: { path: 'a.ts', lines: [{ number: 1, text: 'const a = 1' }] },
        },
      ],
      edges: [{
        kind: 'resolves',
        from: { kind: 'tool-call', id: 'call-a' },
        to: { kind: 'tool-result', id: 'call-a' },
      }],
      runningCallIds: new Set(),
    })

    expect(screen.getByText('文件读取')).toBeTruthy()

    fireEvent.keyDown(screen.getAllByRole('button', { name: /read/ })[1] as HTMLElement, { key: 'Enter' })
    expect(screen.getByText('a.ts')).toBeTruthy()
    expect(screen.getByText('const a = 1')).toBeTruthy()

    // Selection is sticky: a second keydown keeps the detail open.
    fireEvent.keyDown(screen.getAllByRole('button', { name: /read/ })[1] as HTMLElement, { key: ' ' })
    expect(screen.getByText('a.ts')).toBeTruthy()
  })

  it('shows an error state for a failed tool result and drops the turn-group from the canvas', () => {
    renderGraph({
      nodes: [
        { kind: 'turn-group', turn: 1 },
        {
          kind: 'tool-result', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', isError: true, durationMs: 0,
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    expect(screen.getByText('出错')).toBeTruthy()
    // Turn-group never renders as a canvas card (only as a selector option).
    expect(screen.queryByRole('button', { name: /Turn 1|第 1 轮/ })).toBeNull()
  })

  it('opens the assistant message text preview in the detail panel', () => {
    renderGraph({
      nodes: [
        {
          kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [], textPreview: 'hello there',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /模型回复/ }))
    expect(screen.getAllByText('hello there').length).toBeGreaterThanOrEqual(2)
  })

  it('shows reasoning in the detail panel for a reasoning-only reply', () => {
    renderGraph({
      nodes: [
        {
          kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [], textPreview: '',
          reasoning: 'internal thought',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /模型回复/ }))
    expect(screen.getByText('思考过程')).toBeTruthy()
    expect(screen.getByText('internal thought')).toBeTruthy()
  })

  it('lists the triggered tool names when a reply has no visible text', () => {
    renderGraph({
      nodes: [
        {
          kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: ['call-a', 'call-b'],
          textPreview: '', toolNames: ['read', 'bash'],
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /模型回复/ }))
    expect(screen.getByText('工具调用')).toBeTruthy()
    expect(screen.getByText('read')).toBeTruthy()
    expect(screen.getByText('bash')).toBeTruthy()
  })

  it('shows a placeholder for a reply with no text, reasoning, or tool calls', () => {
    renderGraph({
      nodes: [
        { kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [], textPreview: '' },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /模型回复/ }))
    expect(screen.getByText('该回复没有可展示的文本')).toBeTruthy()
  })

  it('allows zooming further out and offers a scroll-to-top control above the zoom buttons', () => {
    renderGraph({
      nodes: [
        { kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    expect(screen.getByTestId('rf').getAttribute('data-min-zoom')).toBe('0.2')

    setCenterMock.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '回到顶部' }))
    expect(setCenterMock).toHaveBeenCalledTimes(1)
    expect(setCenterMock).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), {
      zoom: 1,
      duration: 300,
    })
  })

  it('renders assistant Markdown with the shared renderer and offers a raw-Markdown copy button', async () => {
    renderGraph({
      nodes: [
        {
          kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [],
          textPreview: '**bold** and `code`',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /模型回复/ }))
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')

    // Without a clipboard the control stays inert instead of throwing.
    const copy = screen.getByRole('button', { name: '复制 Markdown' })
    fireEvent.click(copy)
    expect(screen.queryByRole('alert')).toBeNull()

    // With a clipboard it confirms through the localized toast.
    stubClipboard()
    fireEvent.click(copy)
    expect((await screen.findByRole('alert')).textContent).toBe('Markdown 内容复制成功')
  })

  it('localizes the copy toast from the active language', async () => {
    renderGraph({
      nodes: [
        {
          kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [],
          textPreview: 'hello',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    }, enT)

    fireEvent.click(screen.getByRole('button', { name: /Assistant message/ }))
    stubClipboard()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Markdown copied to clipboard')
  })

  it('scrolls to the leftmost top-row node instead of averaging across columns', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}' },
        { kind: 'tool-call', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-b', name: 'grep', argsRaw: '{}' },
      ],
      edges: [],
      runningCallIds: new Set(),
    }
    renderGraph(snapshot)

    const first = layoutGraphSnapshot(snapshot).nodes.reduce((best, entry) =>
      entry.y < best.y || (entry.y === best.y && entry.x < best.x) ? entry : best)

    setCenterMock.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '回到顶部' }))
    expect(setCenterMock).toHaveBeenCalledWith(
      first.x + first.width / 2,
      first.y + first.height / 2,
      { zoom: 1, duration: 300 },
    )
  })

  it('renders a request-header node and a sequence edge to the next node in its turn', () => {
    const { container } = renderGraph({
      nodes: [
        { kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 },
        {
          kind: 'assistant-message', seq: 2, time: 2, turn: 1, step: 1, callIds: [], textPreview: '',
        },
      ],
      edges: [{
        kind: 'sequence',
        from: { kind: 'request-header', id: '1' },
        to: { kind: 'assistant-message', id: '2' },
      }],
      runningCallIds: new Set(),
    })

    expect(screen.getByText('请求')).toBeTruthy()
    expect(container.querySelector('[data-edge-id="sequence:request-header:1->assistant-message:2"]')).toBeTruthy()
  })

  it('opens the user prompt text in the detail panel when a request-header node is clicked', () => {
    renderGraph({
      nodes: [
        { kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1, promptPreview: 'what is the plan?' },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /请求/ }))
    expect(screen.getByText('what is the plan?')).toBeTruthy()
  })

  it('shows a no-prompt placeholder for a request-header node with no captured user message', () => {
    renderGraph({
      nodes: [
        { kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /请求/ }))
    expect(screen.getByText('该轮次暂无用户提问')).toBeTruthy()
  })

  it('renders a triggers edge from an assistant message to the tool call it produced', () => {
    const { container } = renderGraph({
      nodes: [
        {
          kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: ['call-a'], textPreview: '',
        },
        {
          kind: 'tool-call', seq: 2, time: 2, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}',
        },
      ],
      edges: [{
        kind: 'triggers',
        from: { kind: 'assistant-message', id: '1' },
        to: { kind: 'tool-call', id: 'call-a' },
      }],
      runningCallIds: new Set(['call-a']),
    })

    expect(screen.getByText('bash')).toBeTruthy()
    expect(container.querySelector('[data-edge-id="triggers:assistant-message:1->tool-call:call-a"]')).toBeTruthy()
  })

  it('shows no detail panel content for a settled tool result with no file-read range or text', () => {
    renderGraph({
      nodes: [
        {
          kind: 'tool-result', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', isError: false, durationMs: 0,
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    expect(screen.getAllByText('bash')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /bash/ }))
    expect(screen.getAllByText('bash')).toHaveLength(1)
    expect(screen.getByText('点击左侧节点查看详情')).toBeTruthy()
  })

  it('shows the joined result text and timing in the detail panel for a settled tool result', () => {
    renderGraph({
      nodes: [
        {
          kind: 'tool-result', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash',
          isError: false, durationMs: 0, resultText: 'total 0\ndrwxr-xr-x',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /bash/ }))
    expect(screen.getByText((_, element) => element?.textContent === 'total 0\ndrwxr-xr-x')).toBeTruthy()
  })

  it('falls back to the empty snapshot when the session has not registered a graph view', () => {
    const store = createSnapshotStore<GraphSnapshot | undefined>(undefined)
    const props = {
      sessionId: 's1',
      useGraph: bindSnapshotSelector(store),
      useSession: (selector: (snapshot: typeof sessionState) => unknown) => selector(sessionState),
      loadOlder,
      t,
    } as unknown as ComponentProps<typeof GraphView>
    render(<GraphView {...props} />)

    expect(screen.getByText('当前会话暂无活动')).toBeTruthy()
  })

  it('ignores a keydown on a node for a key other than Enter/Space', () => {
    renderGraph({
      nodes: [
        {
          kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [], textPreview: 'hello there',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.keyDown(screen.getByRole('button', { name: /模型回复/ }), { key: 'Tab' })
    expect(screen.getAllByText('hello there')).toHaveLength(1)
  })

  it('clears the selection when the canvas pane is clicked', () => {
    renderGraph({
      nodes: [
        {
          kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: [], textPreview: 'hello there',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: /模型回复/ }))
    expect(screen.getAllByText('hello there')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('rf-pane'))
    expect(screen.getAllByText('hello there')).toHaveLength(1)
  })

  it('shows the empty-detail placeholder in the sidebar before any node is selected', () => {
    renderGraph({
      nodes: [
        {
          kind: 'tool-call', seq: 1, time: 1, turn: 1, step: 1, callId: 'call-a', name: 'bash', argsRaw: '{}',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    expect(screen.getByText('点击左侧节点查看详情')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /bash/ }))
    expect(screen.queryByText('点击左侧节点查看详情')).toBeNull()
    // Selection is sticky: a second click keeps the detail (placeholder stays hidden).
    fireEvent.click(screen.getByRole('button', { name: /bash/ }))
    expect(screen.queryByText('点击左侧节点查看详情')).toBeNull()
  })

  it('offers one truncated-preview option per turn, defaulting to the last turn, and filters to the selected turn', () => {
    renderGraph({
      nodes: [
        { kind: 'request-header', seq: 1, time: 1, reason: 'initial', turn: 1 },
        {
          kind: 'assistant-message', seq: 2, time: 2, turn: 1, step: 1, callIds: [],
          textPreview: 'x'.repeat(80),
        },
        {
          kind: 'tool-call', seq: 3, time: 3, turn: 2, step: 1, callId: 'call-b', name: 'grep', argsRaw: '{}',
        },
      ],
      edges: [],
      runningCallIds: new Set(),
    })

    // The trigger is a Menu button (aria-label 选择轮次), not a native select.
    const trigger = screen.getByRole('button', { name: '选择轮次' })
    // Defaults to the last turn: turn 2's tool call is visible, turn 1's request header is not.
    expect(trigger.textContent).toContain('第 2 轮')
    expect(screen.getByText('grep')).toBeTruthy()
    expect(screen.queryByText('请求')).toBeNull()

    // Open the menu: one option per turn with a truncated preview.
    fireEvent.click(trigger)
    const items = screen.getAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual([
      '第 2 轮',
      `第 1 轮 · ${'x'.repeat(40)}…`,
    ])

    // Pick turn 1: turn 2's tool call disappears, turn 1's request header appears.
    fireEvent.click(screen.getByRole('menuitem', { name: /第 1 轮/ }))
    expect(screen.queryByText('grep')).toBeNull()
    expect(screen.getByText('请求')).toBeTruthy()
  })

  it('offers to load older session history when the loaded window holds fewer turns', () => {
    sessionState = { hasMore: true, loadingOlder: false }
    loadOlder = vi.fn(() => Promise.resolve())
    renderGraph({
      nodes: Array.from({ length: 4 }, (_unused, index) => ({
        kind: 'turn-group' as const,
        turn: 22 + index,
      })),
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: '选择轮次' }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      '第 25 轮',
      '第 24 轮',
      '第 23 轮',
      '第 22 轮',
      '加载更早轮次',
    ])

    fireEvent.click(screen.getByRole('menuitem', { name: '加载更早轮次' }))
    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it('disables the older-history row while a page is loading', () => {
    sessionState = { hasMore: true, loadingOlder: true }
    renderGraph({
      nodes: [{ kind: 'turn-group', turn: 1 }],
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: '选择轮次' }))
    const row = screen.getByRole('menuitem', { name: /正在加载更早轮次/ })
    expect((row as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(row)
    expect(loadOlder).not.toHaveBeenCalled()
  })

  it('shows at most ten turns per page and loads ten more from the pinned footer', () => {
    renderGraph({
      nodes: Array.from({ length: 25 }, (_unused, index) => ({
        kind: 'turn-group' as const,
        turn: index + 1,
      })),
      edges: [],
      runningCallIds: new Set(),
    })

    fireEvent.click(screen.getByRole('button', { name: '选择轮次' }))

    // Newest first: the selected last turn opens the list, ten rows per page.
    const pageOne = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(pageOne).toHaveLength(11) // ten turns + the load-more row
    expect(pageOne[0]).toBe('第 25 轮')
    expect(pageOne[9]).toBe('第 16 轮')
    expect(pageOne[10]).toBe('加载更多（还剩 15 轮）')

    fireEvent.click(screen.getByRole('menuitem', { name: /加载更多/ }))
    const pageTwo = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(pageTwo).toHaveLength(21) // twenty turns + the load-more row
    expect(pageTwo[19]).toBe('第 6 轮')
    expect(pageTwo[20]).toBe('加载更多（还剩 5 轮）')

    fireEvent.click(screen.getByRole('menuitem', { name: /加载更多/ }))
    const pageThree = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(pageThree).toHaveLength(25) // every turn, footer gone
    expect(pageThree[24]).toBe('第 1 轮')
  })

  it('offers a turn option for a turn represented only by its synthesized turn-group node', () => {
    renderGraph({
      nodes: [{ kind: 'turn-group', turn: 0 }],
      edges: [],
      runningCallIds: new Set(),
    })

    const trigger = screen.getByRole('button', { name: '选择轮次' })
    fireEvent.click(trigger)
    const items = screen.getAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual(['第 0 轮'])
  })
})
