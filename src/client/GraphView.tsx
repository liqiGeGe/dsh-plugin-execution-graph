/** Graph view: renders one session turn's activity as a React Flow timeline. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import {
  IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconChevronUpOutlineMedium, IconCloseOutlineMedium,
  IconCopyOutlineMedium, IconDownloadOutlineMedium, JsonTree, MarkdownText, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GraphCardNode, GraphSnapshot } from './graph-contract.ts'
import { filterSnapshotByTurn, listTurnPreviews } from './graph-contract.ts'
import { assistantFoldMembers, foldCapsuleView } from './graph-fold.ts'
import { layoutGraphSnapshot } from './graph-layout.ts'
import type { GraphLayout, PositionedGraphEdge } from './graph-layout.ts'
import { downloadGraphPng } from './graph-export.ts'
import { EMPTY_GRAPH_SNAPSHOT } from './graph-snapshot-builder.ts'
import { formatDurationMs, formatNodeTime, GRAPH_FOLD_TYPE, GRAPH_NODE_TYPE, graphNodeTypes } from './graph-nodes.tsx'
import type { GraphFoldCapsuleData, GraphFoldState, GraphNodeData, GraphTranslate } from './graph-nodes.tsx'
import { extractCommand, parseToolArgs, splitCommandLines } from './tool-args.ts'
import { NS } from './locales.ts'
import { useResizableWidth } from './use-resizable-width.ts'
import css from './GraphView.module.css'

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

/** Localized chrome MarkdownText requires for code blocks and footnotes. */
function markdownLabels(t: GraphTranslate): MarkdownLabels {
  return {
    code: { copyLabel: t('markdown.copyCode'), copiedLabel: t('markdown.copiedCode') },
    footnotes: t('markdown.footnotes'),
  }
}

/** Render one node's Markdown source with the framework's shared renderer. */
function MarkdownBody({ text, t }: { text: string; t: GraphTranslate }) {
  const labels = useMemo(() => markdownLabels(t), [t])
  return (
    <div className={css.detailMarkdown}>
      <MarkdownText text={text} labels={labels} />
    </div>
  )
}

/** Copy the selected node's raw Markdown to the clipboard, confirming briefly. */
function CopyMarkdownButton({ text, t }: { text: string; t: GraphTranslate }) {
  const [copied, setCopied] = useState(false)
  // Monotonic show counter: keying the toast by it restarts the banner when the
  // user copies again while the previous one is still fading.
  const [toastShow, setToastShow] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
  }, [])
  const copy = useCallback((): void => {
    const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(text).then(() => {
      setCopied(true)
      setToastShow(show => show + 1)
      if (timer.current !== undefined) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { setCopied(false) }, 1500)
    }).catch(() => {})
  }, [text])
  const label = copied ? t('detail.copied') : t('detail.copyMarkdown')
  return (
    <>
      <button
        type="button"
        className={css.detailCopy}
        aria-label={label}
        title={label}
        onClick={copy}
      >
        {copied ? <IconCheckOutlineMedium size={14} /> : <IconCopyOutlineMedium size={14} />}
      </button>
      {toastShow > 0 && (
        <Toast
          key={toastShow}
          tone="success"
          text={t('detail.copyMarkdownDone')}
          onDone={() => { setToastShow(0) }}
        />
      )}
    </>
  )
}

/** Detail panel header: title plus the raw-Markdown copy affordance. */
function DetailHeader({ title, markdown, t }: { title: string; markdown?: string; t: GraphTranslate }) {
  return (
    <div className={css.detailHeader}>
      <div className={css.detailTitle}>{title}</div>
      {markdown !== undefined && markdown !== '' && <CopyMarkdownButton text={markdown} t={t} />}
    </div>
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
          <DetailHeader title={t('node.userMessage')} markdown={node.text} t={t} />
          <MarkdownBody text={node.text} t={t} />
        </>
      )
    case 'request-header':
      return (
        <>
          <DetailHeader
            title={t('node.requestHeader')}
            {...(node.promptPreview === undefined ? {} : { markdown: node.promptPreview })}
            t={t}
          />
          {node.promptPreview === undefined
            ? <div className={css.detailEmpty}>{t('detail.noPrompt')}</div>
            : <MarkdownBody text={node.promptPreview} t={t} />}
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
    case 'assistant-message': {
      const hasText = node.textPreview !== ''
      const reasoning = node.reasoning ?? ''
      const hasReasoning = reasoning !== ''
      const toolNames = node.toolNames ?? []
      return (
        <>
          <DetailHeader
            title={t('node.assistantMessage')}
            {...(hasText || hasReasoning ? { markdown: hasText ? node.textPreview : reasoning } : {})}
            t={t}
          />
          <div className={css.detailMeta}>{formatNodeTime(node.time)}</div>
          {hasText && <MarkdownBody text={node.textPreview} t={t} />}
          {hasReasoning && (
            <>
              <div className={css.detailSectionLabel}>{t('detail.reasoning')}</div>
              <MarkdownBody text={reasoning} t={t} />
            </>
          )}
          {toolNames.length > 0 && (
            <>
              <div className={css.detailSectionLabel}>{t('detail.toolCalls')}</div>
              {toolNames.map((name, index) => (
                <div key={`${name}:${index}`} className={css.detailToolName}>{name}</div>
              ))}
            </>
          )}
          {!hasText && !hasReasoning && toolNames.length === 0 && (
            <div className={css.detailEmpty}>{t('detail.assistantEmpty')}</div>
          )}
        </>
      )
    }
  }
}

/** Turns rendered per menu page; the pinned footer appends the next page. */
const TURN_PAGE_SIZE = 10
/** Footer row id that requests the next {@link TURN_PAGE_SIZE} loaded turns. */
const LOAD_MORE_ID = '__load_more__'
/** Footer row id that asks the session for one older history page. */
const LOAD_EARLIER_ID = '__load_earlier__'

function TurnSelect({
  snapshot, selectedTurn, hasMore, loadingOlder, loadOlder, onChange, t,
}: {
  snapshot: Parameters<typeof listTurnPreviews>[0]
  selectedTurn: number
  /** The session window has older events that are not loaded yet. */
  hasMore: boolean
  /** One older-history request is in flight. */
  loadingOlder: boolean
  loadOlder: () => Promise<void>
  onChange: (turn: number) => void
  t: GraphTranslate
}) {
  // Newest first: the default selection is the last turn, so it stays at the
  // top while older pages load below.
  const turns = useMemo(() => [...listTurnPreviews(snapshot)].reverse(), [snapshot])
  const [open, setOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(TURN_PAGE_SIZE)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const labelOf = ({ turn, preview }: { turn: number; preview: string }): string =>
    preview === '' ? t('node.turnGroup', { turn }) : t('filter.turnOption', { turn, preview })
  const selectedIndex = turns.findIndex(entry => entry.turn === selectedTurn)
  const visible = turns.slice(0, visibleCount)
  const remaining = turns.length - visible.length
  const items = useMemo(
    () => visible.map(entry => ({ id: String(entry.turn), label: labelOf(entry) })),
    [visible, t],
  )
  // Paging within the loaded window first; once that is exhausted, offer the
  // older history page the session window has not fetched yet.
  const footer = remaining > 0
    ? [{ id: LOAD_MORE_ID, label: t('filter.loadMore', { count: remaining }) }]
    : hasMore
      ? [{
        id: LOAD_EARLIER_ID,
        label: loadingOlder ? t('filter.loadingEarlier') : t('filter.loadEarlier'),
        disabled: loadingOlder,
      }]
      : undefined
  const current = turns.find(entry => entry.turn === selectedTurn)
  const toggleOpen = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    // Make sure the selected turn is inside the first page however old it is.
    setVisibleCount(Math.max(TURN_PAGE_SIZE, selectedIndex + 1))
    setOpen(true)
  }
  return (
    <Menu
      open={open}
      side="bottom"
      align="start"
      portal
      listClassName={css.turnMenuList ?? ''}
      selectedId={String(selectedTurn)}
      items={items}
      {...(footer === undefined ? {} : { footer })}
      onSelect={(id) => {
        if (id === LOAD_MORE_ID) {
          setVisibleCount(count => count + TURN_PAGE_SIZE)
          return
        }
        if (id === LOAD_EARLIER_ID) {
          if (loadingOlder) return
          // Reserve the next page so the turns the fetch adds become visible
          // immediately instead of landing behind the current slice.
          setVisibleCount(count => count + TURN_PAGE_SIZE)
          void loadOlder().catch(() => {})
          return
        }
        onChange(Number(id))
        setOpen(false)
      }}
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
          onClick={toggleOpen}
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
  /** Pull one older history page into the session window. */
  loadOlder: () => Promise<void>
}

/** Full props of the Execution graph conversation View. */
export type GraphViewProps =
  ConvViewProps & InjectFace<GraphViewInjected> & PropsLocale<typeof NS>

/** Circle-arrow control that recenters the viewport on the timeline's first node. */
function ScrollTopButton({ layout, t }: { layout: GraphLayout; t: GraphTranslate }) {
  const flow = useReactFlow()
  const scrollToTop = useCallback((): void => {
    if (layout.nodes.length === 0) return
    // Reading order, not the whole top row: wrapped columns share y = 0, so
    // averaging every top-row node lands the viewport between column blocks
    // instead of on the first card. Topmost row, then leftmost card.
    const first = layout.nodes.reduce((best, entry) =>
      entry.y < best.y || (entry.y === best.y && entry.x < best.x) ? entry : best)
    void flow.setCenter(
      first.x + first.width / 2,
      first.y + first.height / 2,
      { zoom: flow.getZoom(), duration: 300 },
    )
  }, [flow, layout])
  return (
    <button
      type="button"
      className="react-flow__controls-button"
      aria-label={t('controls.scrollTop')}
      title={t('controls.scrollTop')}
      onClick={scrollToTop}
    >
      <IconChevronUpOutlineMedium size={14} />
    </button>
  )
}

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
export function GraphView({ useGraph, useSession, loadOlder, t }: GraphViewProps) {
  const snapshot = useGraph(value => value) ?? EMPTY_GRAPH_SNAPSHOT
  const hasMore = useSession(session => session.hasMore)
  const loadingOlder = useSession(session => session.loadingOlder)
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
    [layout, filtered, t, foldableAssistantIds, effectiveCollapsed, foldMembers, foldView],
  )
  const flowEdges = useMemo<Edge[]>(
    () => {
      const edges: Edge[] = layout.edges
        // Drop any edge whose endpoint is hidden inside a folded segment.
        .filter(positioned =>
          !foldView.hiddenIds.has(positioned.source) && !foldView.hiddenIds.has(positioned.target))
        .map((positioned): Edge => {
          const stroke = edgeStroke(positioned.edge)
          return {
            id: `${positioned.edge.kind}:${positioned.source}->${positioned.target}`,
            source: positioned.source,
            target: positioned.target,
            style: { stroke, strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
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
    [layout, foldView],
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
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          loadOlder={loadOlder}
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
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_event, node) => { setSelectedId(node.id); sidebar.expand() }}
              onPaneClick={() => { setSelectedId(null) }}
            >
              <ViewportController resetKey={`${selectedTurn}:${singleColumn ? 'single' : 'multi'}`} width={layout.width} height={layout.height} />
              <Background />
              <Controls showInteractive={false} position="bottom-right" className={css.flowControls ?? ''}>
                <ScrollTopButton layout={layout} t={t} />
              </Controls>
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
