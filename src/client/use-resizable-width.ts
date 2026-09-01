/** Pointer-drag width control for the detail sidebar: collapsible, clamped range. */

import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** Minimum non-collapsed detail-sidebar width in pixels. */
export const MIN_SIDEBAR_WIDTH = 320
/** Maximum detail-sidebar width in pixels. */
export const MAX_SIDEBAR_WIDTH = 600
/** Width restored when the panel is re-opened from a collapsed state. */
export const DEFAULT_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH
/** Dragging narrower than this snaps the panel shut (width 0). */
export const COLLAPSE_THRESHOLD = MIN_SIDEBAR_WIDTH / 2

/**
 * Snap a candidate sidebar width to a valid state: `0` (collapsed) when dragged
 * below {@link COLLAPSE_THRESHOLD}, otherwise clamped to
 * `[MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH]`.
 *
 * @param width - Candidate width in pixels.
 * @returns `0` when collapsed, else the width clamped into the open range.
 */
export function clampSidebarWidth(width: number): number {
  if (width < COLLAPSE_THRESHOLD) return 0
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
}

/** State and pointer handlers a resizable sidebar binds to its drag handle. */
export interface ResizableWidth {
  /** Current width in pixels; `0` means collapsed (the panel is hidden). */
  readonly width: number
  readonly isDragging: boolean
  /** Re-open the panel to the default width when it is currently collapsed; a no-op otherwise. */
  readonly expand: () => void
  /** Collapse the panel to width `0` (hidden). */
  readonly collapse: () => void
  readonly handleProps: {
    readonly onPointerDown: (event: ReactPointerEvent) => void
    readonly onPointerMove: (event: ReactPointerEvent) => void
    readonly onPointerUp: (event: ReactPointerEvent) => void
  }
}

/**
 * Track a sidebar width the user drags from a divider on the sidebar's left
 * edge: dragging left widens it, right narrows it, clamped to the allowed range,
 * and dragging below the collapse threshold snaps it shut (width `0`). The handle
 * captures the pointer on press, so move/up events keep firing on the handle even
 * when the pointer leaves it, and capture is released on pointer-up. `expand`
 * restores the default width from a collapsed state.
 *
 * @param initialWidth - Starting width in pixels (snapped on first render).
 * @returns The current width, a drag-active flag, an `expand` action, and the handle's pointer props.
 */
export function useResizableWidth(initialWidth: number = DEFAULT_SIDEBAR_WIDTH): ResizableWidth {
  const [width, setWidth] = useState(() => clampSidebarWidth(initialWidth))
  const [isDragging, setIsDragging] = useState(false)
  // Pointer x and sidebar width captured at drag start, so the move handler is delta-based.
  const origin = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    origin.current = { x: event.clientX, width }
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [width])

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    const start = origin.current
    if (start === null) return
    // The sidebar is right-anchored: moving the divider left (smaller clientX) widens it.
    setWidth(clampSidebarWidth(start.width + (start.x - event.clientX)))
  }, [])

  const onPointerUp = useCallback((event: ReactPointerEvent) => {
    if (origin.current === null) return
    origin.current = null
    setIsDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  // Only re-open from a collapsed state; leave a user-chosen open width untouched.
  const expand = useCallback(() => {
    setWidth(current => (current === 0 ? DEFAULT_SIDEBAR_WIDTH : current))
  }, [])

  const collapse = useCallback(() => { setWidth(0) }, [])

  return { width, isDragging, expand, collapse, handleProps: { onPointerDown, onPointerMove, onPointerUp } }
}
