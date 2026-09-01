// @vitest-environment jsdom
/** Unit coverage for the node-card formatters and the plugin style installer. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

const { formatDurationMs, formatNodeTime } = await import('../src/client/graph-nodes.tsx')
const { installGraphStyles } = await import('../src/client/graph-styles.ts')

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
