// @vitest-environment jsdom
/** Unit coverage for the node-card formatters, fold controls, and style installer. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

const {
  formatDurationMs, formatNodeTime, GraphFoldCapsuleNode, GraphNodeCard,
} = await import('../src/client/graph-nodes.tsx')
const { installGraphStyles } = await import('../src/client/graph-styles.ts')
const { zh } = await import('../src/client/locales.ts')

/** Minimal translate bound to the zh dictionary, mirroring the GraphView test helper. */
const t = (key: string, params?: Record<string, unknown>) => {
  const template = zh[key as keyof typeof zh] ?? key
  return params === undefined
    ? template
    : template.replaceAll(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? ''))
}

afterEach(cleanup)

describe('formatDurationMs', () => {
  it('renders sub-second durations in milliseconds, flooring at zero', () => {
    expect(formatDurationMs(450)).toBe('450ms')
    expect(formatDurationMs(-5)).toBe('0ms')
  })

  it('renders sub-minute durations in tenths of a second', () => {
    expect(formatDurationMs(45_200)).toBe('45.2s')
  })

  it('renders longer durations as whole minutes and seconds', () => {
    expect(formatDurationMs(162_000)).toBe('2m42s')
  })
})

describe('formatNodeTime', () => {
  it('renders a time-of-day string for an epoch millisecond', () => {
    expect(formatNodeTime(0)).toMatch(/\d/)
  })
})

describe('installGraphStyles', () => {
  it('is a no-op when document is unavailable (no ctx.effect call)', () => {
    const original = globalThis.document
    // Simulate a non-DOM host (SSR/worker): the installer must return before touching ctx.
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })
    try {
      const effect = vi.fn()
      installGraphStyles({ effect } as never)
      expect(effect).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(globalThis, 'document', { value: original, configurable: true })
    }
  })

  it('registers a lifecycle effect that mounts and removes a style tag', () => {
    let dispose: (() => void) | undefined
    const effect = vi.fn((factory: () => () => void) => { dispose = factory() })
    installGraphStyles({ effect } as never)

    expect(effect).toHaveBeenCalledTimes(1)
    // The vendored sheet's text is inlined at bundle time, not under vitest; assert the tag is mounted.
    const tag = document.head.querySelector('style[data-plugin="dsh-plugin-execution-graph"]')
    expect(tag).not.toBeNull()
    expect(tag?.getAttribute('data-plugin-css')).toBe('dsh-plugin-execution-graph/reactflow-base.css')

    dispose?.()
    expect(document.head.querySelector('style[data-plugin="dsh-plugin-execution-graph"]')).toBeNull()
  })
})

describe('assistant fold control', () => {
  const assistantNode = {
    kind: 'assistant-message', seq: 1, time: 1, turn: 1, step: 1, callIds: ['call-a'], textPreview: 'hello',
  } as const

  it('renders no fold button when the segment is not collapsible', () => {
    render(
      <GraphNodeCard data={{ node: assistantNode, running: false, t }} />,
    )
    expect(screen.queryByRole('button', { name: t('fold.collapse') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('fold.expand') })).toBeNull()
  })

  it('shows the collapse affordance when collapsible and not yet collapsed, and toggles on click', () => {
    const onToggle = vi.fn()
    render(
      <GraphNodeCard data={{
        node: assistantNode,
        running: false,
        t,
        fold: { collapsible: true, collapsed: false, count: 2, onToggle },
      }} />,
    )
    const button = screen.getByRole('button', { name: t('fold.collapse') })
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
    // The message preview stays visible while expanded.
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('switches to the expand affordance and a collapsed-count subtitle once folded', () => {
    const onToggle = vi.fn()
    render(
      <GraphNodeCard data={{
        node: assistantNode,
        running: false,
        t,
        fold: { collapsible: true, collapsed: true, count: 2, onToggle },
      }} />,
    )
    expect(screen.getByRole('button', { name: t('fold.expand') })).toBeTruthy()
    expect(screen.getByText(t('fold.collapsedCount', { count: 2 }))).toBeTruthy()
    // The assistant's own preview is hidden while folded.
    expect(screen.queryByText('hello')).toBeNull()
  })
})

describe('fold capsule', () => {
  it('shows the collapsed count and expands on click', () => {
    const onExpand = vi.fn()
    render(
      <GraphFoldCapsuleNode data={{
        count: 3,
        t,
        assistantId: 'assistant-message:1',
        onExpand,
      }} />,
    )
    expect(screen.getByText(t('fold.collapsedCount', { count: 3 }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('fold.expand') }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})
