/** Custom React Flow node cards for the graph view, one per business-node kind. */

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GraphCardNode } from './graph-contract.ts'
import { truncatePreview } from './graph-contract.ts'
import type { NS } from './locales.ts'
import css from './GraphView.module.css'

/** Translate bound to this plugin's `graph` namespace. */
export type GraphTranslate = PropsLocale<typeof NS>['t']

/**
 * Folding affordance carried on an assistant-message card: whether its follower
 * segment (tool calls/results up to the next assistant message) can be hidden,
 * whether it currently is, how many follower nodes would hide, and the toggle
 * handler. Absent for every other node kind.
 */
export interface GraphFoldState {
  readonly collapsible: boolean
  readonly collapsed: boolean
  readonly count: number
  readonly onToggle: () => void
}

/** Payload React Flow carries on every graph node, consumed by {@link GraphNodeCard}. */
export interface GraphNodeData {
  readonly node: GraphCardNode
  /** True for a `tool-call` whose result has not settled yet (dashed, pulsing border). */
  readonly running: boolean
  readonly t: GraphTranslate
  /** Present on assistant-message cards; folding the follower tool segment. */
  readonly fold?: GraphFoldState
  [key: string]: unknown
}

/** Wall-clock time-of-day for a node's `time` epoch millisecond field. */
export function formatNodeTime(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Compact duration: `450ms` under a second, `45.2s` under a minute, `2m42s` from there on. */
export function formatDurationMs(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Kind-specific card class, layering running/error state onto the base node class. */
function cardClassName(node: GraphCardNode, running: boolean): string {
  switch (node.kind) {
    case 'user-message': return `${css.node} ${css.userMessage}`
    case 'request-header': return `${css.node} ${css.requestHeader}`
    case 'assistant-message': return `${css.node} ${css.assistantMessage}`
    case 'tool-call': return running ? `${css.node} ${css.toolCall} ${css.toolRunning}` : `${css.node} ${css.toolCall}`
    case 'tool-result': return node.isError ? `${css.node} ${css.toolResult} ${css.toolResultError}` : `${css.node} ${css.toolResult}`
  }
}

function CardBody({ node, t, fold }: { node: GraphCardNode; t: GraphTranslate; fold?: GraphFoldState }) {
  switch (node.kind) {
    case 'user-message':
      return (
        <>
          <span className={css.nodeHeadRow}>
            <span className={css.nodeTitle}>{t('node.userMessage')}</span>
            <span className={css.nodeTime}>{formatNodeTime(node.time)}</span>
          </span>
          <span className={css.nodeSubtitle}>{truncatePreview(node.text)}</span>
        </>
      )
    case 'request-header':
      return (
        <>
          <span className={css.nodeHeadRow}>
            <span className={css.nodeTitle}>{t('node.requestHeader')}</span>
            <span className={css.nodeTime}>{formatNodeTime(node.time)}</span>
          </span>
        </>
      )
    case 'assistant-message':
      return (
        <>
          <span className={css.nodeHeadRow}>
            <span className={css.nodeTitle}>{t('node.assistantMessage')}</span>
            <span className={css.nodeTime}>{formatNodeTime(node.time)}</span>
            {fold?.collapsible === true && (
              <button
                type="button"
                className={css.nodeFold}
                aria-label={t(fold.collapsed ? 'fold.expand' : 'fold.collapse')}
                title={t(fold.collapsed ? 'fold.expand' : 'fold.collapse')}
                onClick={(event) => {
                  event.stopPropagation()
                  fold.onToggle()
                }}
              >
                {fold.collapsed ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
              </button>
            )}
          </span>
          {fold?.collapsed === true
            ? <span className={css.nodeSubtitle}>{t('fold.collapsedCount', { count: fold.count })}</span>
            : node.textPreview !== '' && <span className={css.nodeSubtitle}>{node.textPreview}</span>}
        </>
      )
    case 'tool-call':
      return (
        <>
          <span className={css.nodeHeadRow}>
            <span className={css.nodeKind}>{t('node.tool')}</span>
            <span className={css.nodeTitle}>{node.name}</span>
            <span className={css.nodeTime}>{formatNodeTime(node.time)}</span>
          </span>
          <span className={css.nodeSubtitle}>{truncatePreview(node.argsRaw)}</span>
        </>
      )
    case 'tool-result':
      return (
        <>
          <span className={css.nodeHeadRow}>
            <span className={css.nodeTitle}>{node.name}</span>
            {node.fileRead !== undefined && <span className={css.nodeBadge}>{t('node.fileRead')}</span>}
            <span className={css.nodeTime}>{formatNodeTime(node.time)}</span>
          </span>
          <span className={css.nodeResultRow}>
            <span className={css.nodeSubtitle}>
              {node.isError ? t('node.toolError') : t('node.toolResult')}
            </span>
            <span className={css.nodeDuration}>{formatDurationMs(node.durationMs)}</span>
          </span>
        </>
      )
  }
}

/**
 * One graph node rendered inside React Flow. Every card carries a top target
 * Handle and a bottom source Handle so vertical `sequence`/`triggers`/`resolves`
 * edges attach at the card edges.
 *
 * @param props - React Flow node props whose `data` is a {@link GraphNodeData}.
 */
export function GraphNodeCard({ data }: NodeProps) {
  const { node, running, t, fold } = data as GraphNodeData
  return (
    <div className={cardClassName(node, running)}>
      <Handle type="target" position={Position.Top} className={css.handle} isConnectable={false} />
      <CardBody node={node} t={t} {...(fold === undefined ? {} : { fold })} />
      <Handle type="source" position={Position.Bottom} className={css.handle} isConnectable={false} />
    </div>
  )
}

/**
 * A merge junction: a small dot where several column-tail connectors converge
 * before bending into the next column's opening node. Carries top target and
 * bottom source Handles so the merge edges attach at its center.
 */
export function GraphJunctionNode() {
  return (
    <div className={css.junction}>
      <Handle type="target" position={Position.Top} className={css.junctionHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={css.junctionHandle} isConnectable={false} />
    </div>
  )
}

/** Payload for a fold capsule that replaces a collapsed assistant segment. */
export interface GraphFoldCapsuleData {
  /** Number of follower nodes hidden inside the segment. */
  readonly count: number
  /** Translate bound to this plugin's `graph` namespace. */
  readonly t: GraphTranslate
  /** Element id of the collapsed assistant-message node (its expand target). */
  readonly assistantId: string
  /** Expand the collapsed segment. */
  readonly onExpand: () => void
  [key: string]: unknown
}

/**
 * A fold capsule: a wide pill that stands in for a collapsed assistant segment
 * (the tool calls/results between one assistant message and the next). Rendered
 * at the segment's vertical extent so the surrounding cards stay in place;
 * clicking it expands the segment. Carries a top target Handle and a bottom
 * source Handle so the assistant → capsule → next-assistant edges attach.
 *
 * @param props - React Flow node props whose `data` is a {@link GraphFoldCapsuleData}.
 */
export function GraphFoldCapsuleNode({ data }: NodeProps) {
  const { count, t, onExpand } = data as GraphFoldCapsuleData
  return (
    <button
      type="button"
      className={css.foldCapsule}
      aria-label={t('fold.expand')}
      title={t('fold.expand')}
      onClick={(event) => {
        event.stopPropagation()
        onExpand()
      }}
    >
      <Handle type="target" position={Position.Top} className={css.junctionHandle} isConnectable={false} />
      <span className={css.foldCapsuleLabel}>{t('fold.collapsedCount', { count })}</span>
      <span className={css.foldCapsuleIcon} aria-hidden="true">+</span>
      <Handle type="source" position={Position.Bottom} className={css.junctionHandle} isConnectable={false} />
    </button>
  )
}

/** React Flow node-type registry: the shared card, merge-junction dot, and fold capsule. */
export const GRAPH_NODE_TYPE = 'graph'
export const GRAPH_JUNCTION_TYPE = 'graph-junction'
export const GRAPH_FOLD_TYPE = 'graph-fold'
export const graphNodeTypes = {
  [GRAPH_NODE_TYPE]: GraphNodeCard,
  [GRAPH_JUNCTION_TYPE]: GraphJunctionNode,
  [GRAPH_FOLD_TYPE]: GraphFoldCapsuleNode,
}
