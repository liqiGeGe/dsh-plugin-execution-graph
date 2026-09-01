/** Render a laid-out execution graph to a PNG via an offscreen Canvas 2D. */

import type { GraphCardNode } from './graph-contract.ts'
import { truncatePreview } from './graph-contract.ts'
import type { GraphLayout, PositionedGraphNode } from './graph-layout.ts'
import { formatDurationMs, formatNodeTime } from './graph-nodes.tsx'
import type { GraphTranslate } from './graph-nodes.tsx'

/** Padding around the graph content in the exported image, in pixels. */
const EXPORT_PADDING = 48
/** Device-pixel scale for a crisp raster on high-DPI displays. */
const EXPORT_SCALE = 2

/** Resolved colors for one exported node (border, fill, and text tones). */
interface NodePalette {
  readonly border: string
  readonly fill: string
}

/** Static token-free palette per node kind, matched to the on-canvas card styles. */
function nodePalette(node: GraphCardNode, running: boolean): NodePalette {
  switch (node.kind) {
    case 'user-message': return { border: '#c9ccd1', fill: '#f5f6f7' }
    case 'request-header': return { border: '#b9c6f2', fill: '#eef2fe' }
    case 'assistant-message': return { border: '#8fa6f0', fill: '#e4ecfd' }
    case 'tool-call': return running
      ? { border: '#e0a13a', fill: '#fdf3e2' }
      : { border: '#e0a13a', fill: '#fdf6ea' }
    case 'tool-result': return node.isError
      ? { border: '#e05a5a', fill: '#fdeaea' }
      : { border: '#57b06a', fill: '#eaf7ee' }
  }
}

/** Title text shown on a node card. */
export function nodeTitle(node: GraphCardNode, t: GraphTranslate): string {
  switch (node.kind) {
    case 'user-message': return t('node.userMessage')
    case 'request-header': return t('node.requestHeader')
    case 'assistant-message': return t('node.assistantMessage')
    case 'tool-call': return node.name
    case 'tool-result': return node.name
  }
}

/** Secondary line shown on a node card (may be empty). */
export function nodeSubtitle(node: GraphCardNode, t: GraphTranslate): string {
  switch (node.kind) {
    case 'user-message': return truncatePreview(node.text)
    case 'request-header': return ''
    case 'assistant-message': return node.textPreview === '' ? '' : truncatePreview(node.textPreview)
    case 'tool-call': return truncatePreview(node.argsRaw)
    case 'tool-result': return node.isError ? t('node.toolError') : t('node.toolResult')
  }
}

/** Right-aligned meta text on a node card (time / duration), may be empty. */
function nodeMeta(node: GraphCardNode): string {
  switch (node.kind) {
    case 'user-message':
    case 'assistant-message':
    case 'request-header': return formatNodeTime(node.time)
    case 'tool-call': return formatNodeTime(node.time)
    case 'tool-result': return `${formatNodeTime(node.time)} · ${formatDurationMs(node.durationMs)}`
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Half-width of the exported edge arrowhead, in pixels. */
const ARROW_HALF_WIDTH = 4
/** Length of the exported edge arrowhead along the edge, in pixels. */
const ARROW_LENGTH = 7

/**
 * Draw a downward-pointing filled arrowhead whose tip sits at `(tipX, tipY)`,
 * matching the on-screen closed edge marker (edges enter a card from the top).
 *
 * @param ctx - Destination context.
 * @param tipX - Arrowhead tip x (the target's top-center).
 * @param tipY - Arrowhead tip y.
 * @param color - Fill color (the edge's stroke color).
 */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tipX: number, tipY: number, color: string,
): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(tipX - ARROW_HALF_WIDTH, tipY - ARROW_LENGTH)
  ctx.lineTo(tipX + ARROW_HALF_WIDTH, tipY - ARROW_LENGTH)
  ctx.closePath()
  ctx.fill()
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  positioned: PositionedGraphNode,
  running: boolean,
  t: GraphTranslate,
): void {
  const { x, y, width, height, node } = positioned
  const palette = nodePalette(node, running)
  ctx.fillStyle = palette.fill
  ctx.strokeStyle = palette.border
  ctx.lineWidth = 1.5
  roundedRect(ctx, x, y, width, height, 8)
  ctx.fill()
  ctx.stroke()

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#1c1d1f'
  ctx.font = '600 13px sans-serif'
  ctx.fillText(nodeTitle(node, t), x + 12, y + 22, width - 80)

  const meta = nodeMeta(node)
  if (meta !== '') {
    ctx.fillStyle = '#8b8f96'
    ctx.font = '10px sans-serif'
    const metaWidth = ctx.measureText(meta).width
    ctx.fillText(meta, x + width - 12 - metaWidth, y + 20)
  }

  const subtitle = nodeSubtitle(node, t)
  if (subtitle !== '') {
    ctx.fillStyle = '#63666b'
    ctx.font = '12px sans-serif'
    ctx.fillText(subtitle, x + 12, y + 42, width - 24)
  }
}

function edgeColor(kind: 'sequence' | 'triggers' | 'resolves'): string {
  switch (kind) {
    case 'triggers': return '#5570e6'
    case 'resolves': return '#57b06a'
    case 'sequence': return '#c9ccd1'
  }
}

/** Off-handle lead length before a step edge turns, matching React Flow's default. */
const STEP_OFFSET = 20

/**
 * Orthogonal point list for a step edge between a source's bottom handle and a
 * target's top handle, mirroring React Flow's routing: the line leads downward
 * out of the source and arrives downward into the target's top. When the target
 * sits below the source it is a simple Z through the mid-Y; when the target sits
 * above (a merge junction feeding the next column's top row), it detours down
 * out of the source, across a vertical corridor at the mid-X, then up and into
 * the target — the shape shown on screen.
 *
 * @param sx - Source bottom-handle x.
 * @param sy - Source bottom-handle y.
 * @param tx - Target top-handle x.
 * @param ty - Target top-handle y.
 * @returns Ordered `[x, y]` points from source to target.
 */
export function stepEdgePoints(
  sx: number, sy: number, tx: number, ty: number,
): readonly (readonly [number, number])[] {
  if (ty >= sy) {
    const midY = (sy + ty) / 2
    return [[sx, sy], [sx, midY], [tx, midY], [tx, ty]]
  }
  const midX = (sx + tx) / 2
  const lead = sy + STEP_OFFSET
  const tail = ty - STEP_OFFSET
  return [
    [sx, sy],
    [sx, lead],
    [midX, lead],
    [midX, tail],
    [tx, tail],
    [tx, ty],
  ]
}

/**
 * Draw a full execution-graph layout onto a 2D canvas context, filling the
 * background and rendering every edge, junction, and node at absolute layout
 * coordinates. The caller sizes/scales the canvas; this routine assumes the
 * context is already translated so content at layout origin lands at
 * {@link EXPORT_PADDING}.
 *
 * @param ctx - Destination 2D context (already scaled/translated by the caller).
 * @param layout - The positioned graph to draw.
 * @param running - `callId`s of tool calls with no settled result (dashed emphasis).
 * @param t - Translate for node labels.
 */
export function drawGraphLayout(
  ctx: CanvasRenderingContext2D,
  layout: GraphLayout,
  running: ReadonlySet<string>,
  t: GraphTranslate,
): void {
  // Exit point of an edge's source: bottom-center of a node, or the junction center.
  const exitOf = (id: string): { x: number; y: number } | null => {
    if (id.startsWith('junction:')) {
      const junction = layout.junctions.find(entry => entry.id === id)
      return junction === undefined ? null : { x: junction.x, y: junction.y }
    }
    const node = layout.nodes.find(entry => entry.id === id)
    return node === undefined ? null : { x: node.x + node.width / 2, y: node.y + node.height }
  }
  // Entry point of an edge's target: top-center of a node, or the junction center.
  const entryOf = (id: string): { x: number; y: number } | null => {
    if (id.startsWith('junction:')) {
      const junction = layout.junctions.find(entry => entry.id === id)
      return junction === undefined ? null : { x: junction.x, y: junction.y }
    }
    const node = layout.nodes.find(entry => entry.id === id)
    return node === undefined ? null : { x: node.x + node.width / 2, y: node.y }
  }

  // Edges first, so node cards paint over the connector ends.
  for (const positioned of layout.edges) {
    const from = exitOf(positioned.source)
    const to = entryOf(positioned.target)
    if (from === null || to === null) continue
    const color = edgeColor(positioned.edge.kind)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    if (positioned.orthogonal === true) {
      const points = stepEdgePoints(from.x, from.y, to.x, to.y)
      const [firstX, firstY] = points[0] as readonly [number, number]
      ctx.moveTo(firstX, firstY)
      for (const [px, py] of points.slice(1)) ctx.lineTo(px, py)
    } else {
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
    }
    ctx.stroke()
    // Arrowhead at the target entry, matching the on-screen closed marker.
    // Junction targets carry no arrowhead (they are merge dots, not endpoints).
    if (!positioned.target.startsWith('junction:')) {
      drawArrowhead(ctx, to.x, to.y, color)
    }
  }

  for (const junction of layout.junctions) {
    ctx.fillStyle = '#c9ccd1'
    ctx.beginPath()
    ctx.arc(junction.x, junction.y, 5, 0, Math.PI * 2)
    ctx.fill()
  }

  for (const positioned of layout.nodes) {
    const isRunning = positioned.node.kind === 'tool-call' && running.has(positioned.node.callId)
    drawNode(ctx, positioned, isRunning, t)
  }
}

/**
 * Render `layout` to an offscreen canvas and return it as a PNG blob, or `null`
 * when the graph is empty or the environment has no usable 2D canvas.
 *
 * @param layout - The positioned graph to rasterize.
 * @param running - `callId`s of unsettled tool calls.
 * @param t - Translate for node labels.
 * @returns A PNG blob, or `null` when there is nothing to export.
 */
export async function graphLayoutToPngBlob(
  layout: GraphLayout,
  running: ReadonlySet<string>,
  t: GraphTranslate,
): Promise<Blob | null> {
  if (layout.nodes.length === 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((layout.width + EXPORT_PADDING * 2) * EXPORT_SCALE)
  canvas.height = Math.ceil((layout.height + EXPORT_PADDING * 2) * EXPORT_SCALE)
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, layout.width + EXPORT_PADDING * 2, layout.height + EXPORT_PADDING * 2)
  ctx.translate(EXPORT_PADDING, EXPORT_PADDING)
  drawGraphLayout(ctx, layout, running, t)
  return new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/png') })
}

/**
 * Export `layout` as a PNG and trigger a browser download named `filename`.
 * No-op when the graph is empty or PNG encoding is unavailable.
 *
 * @param layout - The positioned graph to export.
 * @param running - `callId`s of unsettled tool calls.
 * @param t - Translate for node labels.
 * @param filename - Download file name (should end in `.png`).
 */
export async function downloadGraphPng(
  layout: GraphLayout,
  running: ReadonlySet<string>,
  t: GraphTranslate,
  filename: string,
): Promise<void> {
  const blob = await graphLayoutToPngBlob(layout, running, t)
  if (blob === null) return
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
