/** Graph view: renders one session turn's activity as a React Flow timeline. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import {
  IconChevronDownOutlineMedium, IconCloseOutlineMedium, IconDownloadOutlineMedium, JsonTree, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GraphCardNode, GraphSnapshot } from './graph-contract.ts'
import { filterSnapshotByTurn, listTurnPreviews } from './graph-contract.ts'
import { assistantFoldMembers, foldCapsuleView } from './graph-fold.ts'
import { layoutGraphSnapshot } from './graph-layout.ts'
import type { PositionedGraphEdge } from './graph-layout.ts'
import { downloadGraphPng } from './graph-export.ts'
import { EMPTY_GRAPH_SNAPSHOT } from './graph-snapshot-builder.ts'
import { formatDurationMs, formatNodeTime, GRAPH_FOLD_TYPE, GRAPH_JUNCTION_TYPE, GRAPH_NODE_TYPE, graphNodeTypes } from './graph-nodes.tsx'
import type { GraphFoldCapsuleData, GraphFoldState, GraphNodeData, GraphTranslate } from './graph-nodes.tsx'
import { extractCommand, parseToolArgs, splitCommandLines } from './tool-args.ts'
import { NS } from './locales.ts'
import { useResizableWidth } from './use-resizable-width.ts'
import css from './GraphView.module.css'

/** Pixel diameter of a merge-junction dot (matches the `.junction` CSS box). */
const JUNCTION_SIZE = 14

/** Fold-capsule pill dimensions (matches the `.foldCapsule` CSS box). */
const FOLD_CAPSULE_WIDTH = 160
const FOLD_CAPSULE_HEIGHT = 30
/** Vertical gap between a collapsed assistant card and its fold capsule. */
const FOLD_CAPSULE_GAP = 10

/** Download file name for a turn's exported PNG. */
function exportFileName(turn: number): string {
  return `execution-graph-turn-${turn}.png`
}

/** Stroke color CSS variable per edge kind; the arrowhead reuses the same var. */
function edgeStroke(edge: PositionedGraphEdge['edge']): string {
  switch (edge.kind) {
    case 'triggers': return 'var(--dsw-alias-state-business-primary)'
    case 'resolves': return 'var(--dsw-alias-state-success-secondary)'
    case 'sequence': return 'var(--dsw-alias-border-l2)'
  }
}

/**
 * Tool-call detail: the raw arguments as a `Payload` JSON tree (the trajectory
 * tab's inspector), plus, for a shell command, a formatted command block that
 * breaks the one-liner before each top-level `&&` and `echo` for readability.
 * Falls back to the raw string when the arguments are not parseable JSON.
 *
 * @param props - The tool-call node and this plugin's translate.
 */
function ToolCallDetail({ node, t }: { node: Extract<GraphCardNode, { kind: 'tool-call' }>; t: GraphTranslate }) {
  const parsed = parseToolArgs(node.argsRaw)
  const command = parsed === null ? undefined : extractCommand(parsed)
  return (
    <>
      <div className={css.detailTitle}>{node.name}</div>
      <div className={css.detailSectionLabel}>{t('detail.payload')}</div>
      {parsed === null
        ? <pre className={css.detailPre}>{node.argsRaw}</pre>
        : (
            <JsonTree
              data={parsed}
              label={t('detail.payload')}
              className={css.payloadTree}
              labels={{
                copyValue: t('json.copyValue'),
                copyJson: t('json.copyJson'),
                copyPath: t('json.copyPath'),
                copyPrettyJson: t('json.copyPrettyJson'),
                copyCompactJson: t('json.copyCompactJson'),
                copied: t('json.copied'),
                copyFailed: t('json.copyFailed'),
                collapseNode: t('json.collapseNode'),
                expandNode: t('json.expandNode'),
                copyButtonTitle: action => t('json.copyButtonTitle', { action }),
              }}
            />
          )}
      {command !== undefined && (
        <>
          <div className={css.detailSectionLabel}>{t('detail.command')}</div>
          <pre className={css.commandBlock}>
            {splitCommandLines(command).map((line, index) => (
              <div key={index} className={css.commandLine}>{line}</div>
            ))}
          </pre>
        </>
      )}
    </>
  )
}

function DetailPanel({
  node, t,
}: {
  node: GraphCardNode | null
  t: GraphTranslate
}) {
  if (node === null) {
    return <div className={css.detailEmpty}>{t('detail.empty')}</div>
  }
  switch (node.kind) {
    case 'user-message':
      return (
        <>
          <div className={css.detailTitle}>{t('node.userMessage')}</div>
          <pre className={css.detailPre}>{node.text}</pre>
        </>
      )
    case 'request-header':
      return (
        <>
          <div className={css.detailTitle}>{t('node.requestHeader')}</div>
          {node.promptPreview === undefined
            ? <div className={css.detailEmpty}>{t('detail.noPrompt')}</div>
            : <pre className={css.detailPre}>{node.promptPreview}</pre>}
        </>
      )
    case 'tool-call':
      return <ToolCallDetail node={node} t={t} />
    case 'tool-result':
      if (node.fileRead !== undefined) {
        const { fileRead } = node
        return (
          <>
            <div className={css.detailTitle}>{fileRead.path}</div>
            {fileRead.lines.map(line => (
              <div key={line.number} className={css.fileReadLine}>
                <span className={css.fileReadLineNumber}>{line.number}</span>
                <span>{line.text}</span>
              </div>
            ))}
          </>
        )
      }
      if (node.resultText !== undefined) {
        return (
          <>
            <div className={css.detailTitle}>{node.name}</div>
            <div className={css.detailMeta}>{formatNodeTime(node.time)} · {formatDurationMs(node.durationMs)}</div>
            <pre className={css.detailPre}>{node.resultText}</pre>
          </>
        )
      }
      return <div className={css.detailEmpty}>{t('detail.empty')}</div>
    case 'assistant-message':
      return (
        <>
          <div className={css.detailTitle}>{t('node.assistantMessage')}</div>
          <pre className={css.detailPre}>{node.textPreview}</pre>
        </>
      )
  }
}

function TurnSelect({
  snapshot, selectedTurn, onChange, t,
}: {
  snapshot: Parameters<typeof listTurnPreviews>[0]
  selectedTurn: number
  onChange: (turn: number) => void
  t: GraphTranslate
}) {
  const turns = useMemo(() => listTurnPreviews(snapshot), [snapshot])
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const labelOf = ({ turn, preview }: { turn: number; preview: string }): string =>
    preview === '' ? t('node.turnGroup', { turn }) : t('filter.turnOption', { turn, preview })
  const items = useMemo(
    () => turns.map(entry => ({ id: String(entry.turn), label: labelOf(entry) })),
    [turns, t],
  )
  const current = turns.find(entry => entry.turn === selectedTurn)
  return (
    <Menu
      open={open}
      side="bottom"
      align="start"
      portal
      selectedId={String(selectedTurn)}
      items={items}
      onSelect={(id) => { onChange(Number(id)); setOpen(false) }}
      onClose={() => { setOpen(false) }}
      anchorRef={triggerRef}
      anchor={(
        <button
          ref={triggerRef}
          type="button"
          className={css.turnSelect}
          aria-label={t('filter.ariaLabel')}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => { setOpen(current_ => !current_) }}
        >
          <span className={css.turnSelectLabel}>{current === undefined ? '' : labelOf(current)}</span>
          <IconChevronDownOutlineMedium size={14} className={css.turnSelectChevron} />
        </button>
      )}
    />
  )
}

/**
 * Reset the React Flow viewport to unit zoom, centering the laid-out content,
 * whenever `resetKey` changes (i.e. the selected turn switches). Must render
 * inside `ReactFlowProvider` so `useReactFlow` resolves the live instance.
 *
 * @param props - The reset trigger key and the content's extent (`width`/`height`).
 */
function ViewportController({ resetKey, width, height }: { resetKey: string | number; width: number; height: number }) {
  const flow = useReactFlow()
  useEffect(() => {
    // Center the content's midpoint in the viewport at scale 1 (no fit-zoom).
    flow.setCenter(width / 2, height / 2, { zoom: 1 })
  }, [flow, resetKey, width, height])
  return null
}

/** Business face injected by the browser plugin. */
export interface GraphViewInjected {
  /** Snapshot sources bound by InjectFace. */
  hooks: {
    /** This target's snapshot; InjectFace exposes it as `useGraph`. */
    graph: ObservableSnapshot<GraphSnapshot>
  }
}

/** Full props of the Execution graph conversation View. */
export type GraphViewProps =
  ConvViewProps & InjectFace<GraphViewInjected> & PropsLocale<typeof NS>

/**
 * Conversation-view tab rendering one turn's activity as a React Flow timeline.
 * Read-only: nodes are not draggable or connectable, and the graph is derived
 * from the injected `graph` target snapshot. The turn selector defaults to the
 * session's last turn and
 * lists every turn present; picking one narrows the graph before layout.
 * Selecting a node fills a persistent right-hand detail sidebar.
 *
 * @param props - Standard conversation-view props plus this plugin's locale binding.
 */
export function GraphView({ useGraph, t }: GraphViewProps) {
  const snapshot = useGraph(value => value) ?? EMPTY_GRAPH_SNAPSHOT
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sidebar = useResizableWidth()
  // `null` means "auto-follow the last turn"; a number means the user picked a turn explicitly.
  const [pickedTurn, setPickedTurn] = useState<number | null>(null)
  // Element ids of assistant-message nodes whose follower tool segments are hidden.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // When true, every timeline step renders in one vertical column (no column
  // wrapping at ROWS_PER_COLUMN and no merge junctions).
  const [singleColumn, setSingleColumn] = useState(false)
  const lastTurn = useMemo(
    () => snapshot.nodes.reduce((max, node) => Math.max(max, node.turn), 0),
    [snapshot],
  )
  const selectedTurn = pickedTurn ?? lastTurn
  const filtered = useMemo(() => filterSnapshotByTurn(snapshot, selectedTurn), [snapshot, selectedTurn])
  // The layout is always computed from the FULL turn snapshot. Folding is an
  // in-place view transform (hide follower nodes + insert a capsule), so column
  // assignment, node coordinates, and the viewport all stay stable across
  // fold/expand toggles.
  const layout = useMemo(() => layoutGraphSnapshot(filtered, { singleColumn }), [filtered, singleColumn])
  const foldMembers = useMemo(() => assistantFoldMembers(filtered), [filtered])
  const foldableAssistantIds = useMemo(
    () => new Set(
      [...foldMembers.entries()].filter(([, members]) => members.length > 0).map(([id]) => id),
    ),
    [foldMembers],
  )
  const effectiveCollapsed = useMemo(
    () => new Set([...collapsed].filter(id => foldableAssistantIds.has(id))),
    [collapsed, foldableAssistantIds],
  )
  const foldView = useMemo(
    () => foldCapsuleView(filtered, effectiveCollapsed),
    [filtered, effectiveCollapsed],
  )

  const toggleFold = useCallback((assistantId: string): void => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(assistantId)) next.delete(assistantId)
      else next.add(assistantId)
      return next
    })
  }, [])

  const flowNodes = useMemo<Node[]>(
    () => [
      ...layout.nodes
        .filter(positioned => !foldView.hiddenIds.has(positioned.id))
        .map((positioned): Node<GraphNodeData> => {
          const isAssistant = positioned.node.kind === 'assistant-message'
          const fold: GraphFoldState | undefined = isAssistant
            ? {
              collapsible: foldableAssistantIds.has(positioned.id),
              collapsed: effectiveCollapsed.has(positioned.id),
              count: foldMembers.get(positioned.id)?.length ?? 0,
              onToggle: () => { toggleFold(positioned.id) },
            }
            : undefined
          return {
            id: positioned.id,
            type: GRAPH_NODE_TYPE,
            position: { x: positioned.x, y: positioned.y },
            width: positioned.width,
            height: positioned.height,
            selectable: true,
            data: {
              node: positioned.node,
              running: positioned.node.kind === 'tool-call' && filtered.runningCallIds.has(positioned.node.callId),
              t,
              ...(fold === undefined ? {} : { fold }),
            },
          }
        }),
      ...(!singleColumn ? layout.junctions.map((junction): Node => ({
        id: junction.id,
        type: GRAPH_JUNCTION_TYPE,
        // React Flow positions by top-left; center the JUNCTION_SIZE dot on (x, y).
        position: { x: junction.x - JUNCTION_SIZE / 2, y: junction.y - JUNCTION_SIZE / 2 },
        width: JUNCTION_SIZE,
        height: JUNCTION_SIZE,
        selectable: false,
        draggable: false,
        data: {},
      })) : []),
      ...foldView.capsules.map((capsule): Node<GraphFoldCapsuleData> => {
        // Position the capsule directly below the collapsed assistant card,
        // centered on the assistant's column so the fold stays in place.
        const host = layout.nodes.find(entry => entry.id === capsule.assistantId)
        const x = host === undefined ? 0 : host.x + (host.width - FOLD_CAPSULE_WIDTH) / 2
        const y = host === undefined ? 0 : host.y + host.height + FOLD_CAPSULE_GAP
        return {
          id: capsule.id,
          type: GRAPH_FOLD_TYPE,
          position: { x, y },
          width: FOLD_CAPSULE_WIDTH,
          height: FOLD_CAPSULE_HEIGHT,
          selectable: false,
          draggable: false,
          data: {
            count: capsule.count,
            t,
            assistantId: capsule.assistantId,
            onExpand: () => { toggleFold(capsule.assistantId) },
          },
        }
      }),
    ],
    [layout, filtered, t, foldableAssistantIds, effectiveCollapsed, foldMembers, foldView, singleColumn],
  )
  const flowEdges = useMemo<Edge[]>(
    () => {
      const edges: Edge[] = layout.edges
        // Single-column: never draw a merge-junction right-angle connector, even
        // if the layout somehow emitted one — drop any edge touching a junction
        // endpoint or marked orthogonal outright.
        .filter(positioned =>
          !singleColumn
          || (!positioned.orthogonal
            && !positioned.source.startsWith('junction:')
            && !positioned.target.startsWith('junction:')))
        // Drop any edge whose endpoint is hidden inside a folded segment.
        .filter(positioned =>
          !foldView.hiddenIds.has(positioned.source) && !foldView.hiddenIds.has(positioned.target))
        .map((positioned): Edge => {
          const stroke = edgeStroke(positioned.edge)
          const toJunction = positioned.target.startsWith('junction:')
          return {
            id: `${positioned.edge.kind}:${positioned.source}->${positioned.target}`,
            source: positioned.source,
            target: positioned.target,
            style: { stroke, strokeWidth: 1.5 },
            // Merge-junction connectors (multi-column only) render as right-angle
            // step lines. Single-column never reaches this branch.
            ...(positioned.orthogonal === true
              ? { type: 'step', pathOptions: { borderRadius: 0 } }
              : {}),
            ...(toJunction ? {} : { markerEnd: { type: MarkerType.ArrowClosed, color: stroke } }),
          }
        })
      // Bridge each collapsed segment: assistant → capsule → next assistant.
      for (const capsule of foldView.capsules) {
        const stroke = 'var(--dsw-alias-border-l2)'
        edges.push({
          id: `folded:${capsule.assistantId}->${capsule.id}`,
          source: capsule.assistantId,
          target: capsule.id,
          style: { stroke, strokeWidth: 1.5, strokeDasharray: '5 4' },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        })
        if (capsule.nextAssistantId !== undefined) {
          edges.push({
            id: `folded:${capsule.id}->${capsule.nextAssistantId}`,
            source: capsule.id,
            target: capsule.nextAssistantId,
            style: { stroke, strokeWidth: 1.5, strokeDasharray: '5 4' },
            markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
          })
        }
      }
      return edges
    },
    [layout, foldView, singleColumn],
  )

  const selected = useMemo(
    () => layout.nodes.find(positioned => positioned.id === selectedId)?.node ?? null,
    [layout, selectedId],
  )

  if (snapshot.nodes.length === 0) {
    return (
      <div className={css.root}>
        <div className={css.empty}>{t('empty')}</div>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <TurnSelect
          snapshot={snapshot}
          selectedTurn={selectedTurn}
          onChange={(turn) => { setPickedTurn(turn); setSelectedId(null) }}
          t={t}
        />
        <button
          type="button"
          className={singleColumn ? `${css.layoutToggle} ${css.layoutToggleActive}` : css.layoutToggle}
          aria-pressed={singleColumn}
          onClick={() => { setSingleColumn(true) }}
        >
          {t('layout.singleColumn')}
        </button>
        <button
          type="button"
          className={css.layoutToggle}
          aria-pressed={!singleColumn}
          onClick={() => { setSingleColumn(false) }}
        >
          {t('layout.default')}
        </button>
      </div>
      <div className={css.body}>
        <div className={css.canvas} role="img" aria-label={t('legend.aria')} data-layout-mode={singleColumn ? 'single' : 'multi'}>
          <ReactFlowProvider key={`${singleColumn ? 'single' : 'multi'}`}>
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={graphNodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_event, node) => { setSelectedId(node.id); sidebar.expand() }}
              onPaneClick={() => { setSelectedId(null) }}
            >
              <ViewportController resetKey={`${selectedTurn}:${singleColumn ? 'single' : 'multi'}`} width={layout.width} height={layout.height} />
              <Background />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          </ReactFlowProvider>
          <button
            type="button"
            className={css.exportButton}
            aria-label={t('export.png')}
            title={t('export.png')}
            onClick={() => { void downloadGraphPng(layout, filtered.runningCallIds, t, exportFileName(selectedTurn)) }}
          >
            <IconDownloadOutlineMedium size={16} />
          </button>
        </div>
        {sidebar.width > 0 && (
          <>
            <div
              className={sidebar.isDragging ? `${css.resizeHandle} ${css.resizeHandleActive}` : css.resizeHandle}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('sidebar.resize')}
              {...sidebar.handleProps}
            >
              <span className={css.resizeGrip} aria-hidden="true" />
            </div>
            <div className={css.sidebar} style={{ width: sidebar.width }}>
              <button
                type="button"
                className={css.sidebarClose}
                aria-label={t('sidebar.close')}
                title={t('sidebar.close')}
                onClick={() => { sidebar.collapse(); setSelectedId(null) }}
              >
                <IconCloseOutlineMedium size={14} />
              </button>
              <DetailPanel node={selected} t={t} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
