/** Graph view: renders one session turn's activity as a React Flow timeline. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import { IconChevronDownOutline14, IconCloseOutline16, IconDownloadOutline16, JsonTree, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GraphCardNode } from './graph-contract.ts'
import { filterSnapshotByTurn, listTurnPreviews } from './graph-contract.ts'
import { layoutGraphSnapshot } from './graph-layout.ts'
import type { PositionedGraphEdge } from './graph-layout.ts'
import { downloadGraphPng } from './graph-export.ts'
import { EMPTY_GRAPH_SNAPSHOT } from './graph-snapshot-builder.ts'
import { formatDurationMs, formatNodeTime, GRAPH_JUNCTION_TYPE, GRAPH_NODE_TYPE, graphNodeTypes } from './graph-nodes.tsx'
import type { GraphNodeData, GraphTranslate } from './graph-nodes.tsx'
import { extractCommand, parseToolArgs, splitCommandLines } from './tool-args.ts'
import { NS } from './locales.ts'
import { useResizableWidth } from './use-resizable-width.ts'
import css from './GraphView.module.css'

/** Pixel diameter of a merge-junction dot (matches the `.junction` CSS box). */
const JUNCTION_SIZE = 14

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
        : <JsonTree data={parsed} label={t('detail.payload')} className={css.payloadTree} />}
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
      getAnchorRect={() => triggerRef.current?.getBoundingClientRect() ?? null}
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
          <IconChevronDownOutline14 className={css.turnSelectChevron} />
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
function ViewportController({ resetKey, width, height }: { resetKey: number; width: number; height: number }) {
  const flow = useReactFlow()
  useEffect(() => {
    // Center the content's midpoint in the viewport at scale 1 (no fit-zoom).
    flow.setCenter(width / 2, height / 2, { zoom: 1 })
  }, [flow, resetKey, width, height])
  return null
}

/**
 * Conversation-view tab rendering one turn's activity as a React Flow timeline.
 * Read-only: nodes are not draggable or connectable, and the graph is derived
 * from `useSession`. The turn selector defaults to the session's last turn and
 * lists every turn present; picking one narrows the graph before layout.
 * Selecting a node fills a persistent right-hand detail sidebar.
 *
 * @param props - Standard conversation-view props plus this plugin's locale binding.
 */
export function GraphView({ useSession, t }: ConvViewProps & PropsLocale<typeof NS>) {
  const snapshot = useSession(session => session.views.get('graph') ?? EMPTY_GRAPH_SNAPSHOT)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sidebar = useResizableWidth()
  // `null` means "auto-follow the last turn"; a number means the user picked a turn explicitly.
  const [pickedTurn, setPickedTurn] = useState<number | null>(null)
  const lastTurn = useMemo(
    () => snapshot.nodes.reduce((max, node) => Math.max(max, node.turn), 0),
    [snapshot],
  )
  const selectedTurn = pickedTurn ?? lastTurn
  const filtered = useMemo(() => filterSnapshotByTurn(snapshot, selectedTurn), [snapshot, selectedTurn])
  const layout = useMemo(() => layoutGraphSnapshot(filtered), [filtered])

  const flowNodes = useMemo<Node[]>(
    () => [
      ...layout.nodes.map((positioned): Node<GraphNodeData> => ({
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
        },
      })),
      ...layout.junctions.map((junction): Node => ({
        id: junction.id,
        type: GRAPH_JUNCTION_TYPE,
        // React Flow positions by top-left; center the JUNCTION_SIZE dot on (x, y).
        position: { x: junction.x - JUNCTION_SIZE / 2, y: junction.y - JUNCTION_SIZE / 2 },
        width: JUNCTION_SIZE,
        height: JUNCTION_SIZE,
        selectable: false,
        draggable: false,
        data: {},
      })),
    ],
    [layout, filtered, t],
  )
  const flowEdges = useMemo<Edge[]>(
    () => layout.edges.map((positioned): Edge => {
      const stroke = edgeStroke(positioned.edge)
      const toJunction = positioned.target.startsWith('junction:')
      return {
        id: `${positioned.edge.kind}:${positioned.source}->${positioned.target}`,
        source: positioned.source,
        target: positioned.target,
        style: { stroke, strokeWidth: 1.5 },
        ...(positioned.orthogonal === true ? { type: 'step', pathOptions: { borderRadius: 0 } } : {}),
        ...(toJunction ? {} : { markerEnd: { type: MarkerType.ArrowClosed, color: stroke } }),
      }
    }),
    [layout],
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
      </div>
      <div className={css.body}>
        <div className={css.canvas} role="img" aria-label={t('legend.aria')}>
          <ReactFlowProvider>
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
              <ViewportController resetKey={selectedTurn} width={layout.width} height={layout.height} />
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
            <IconDownloadOutline16 size={16} />
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
                <IconCloseOutline16 size={14} />
              </button>
              <DetailPanel node={selected} t={t} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
