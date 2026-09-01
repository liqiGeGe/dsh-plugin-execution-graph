/** Custom React Flow node cards for the graph view, one per business-node kind. */

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GraphCardNode } from './graph-contract.ts'
import { truncatePreview } from './graph-contract.ts'
import type { NS } from './locales.ts'
import css from './GraphView.module.css'

/** Translate bound to this plugin's `graph` namespace. */
export type GraphTranslate = PropsLocale<typeof NS>['t']

/** Payload React Flow carries on every graph node, consumed by {@link GraphNodeCard}. */
export interface GraphNodeData {
  readonly node: GraphCardNode
  /** True for a `tool-call` whose result has not settled yet (dashed, pulsing border). */
  readonly running: boolean
  readonly t: GraphTranslate
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

function CardBody({ node, t }: { node: GraphCardNode; t: GraphTranslate }) {
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
          </span>
          {node.textPreview !== '' && <span className={css.nodeSubtitle}>{node.textPreview}</span>}
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
  const { node, running, t } = data as GraphNodeData
  return (
    <div className={cardClassName(node, running)}>
      <Handle type="target" position={Position.Top} className={css.handle} isConnectable={false} />
      <CardBody node={node} t={t} />
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

/** React Flow node-type registry: the shared card plus the merge-junction dot. */
export const GRAPH_NODE_TYPE = 'graph'
export const GRAPH_JUNCTION_TYPE = 'graph-junction'
export const graphNodeTypes = {
  [GRAPH_NODE_TYPE]: GraphNodeCard,
  [GRAPH_JUNCTION_TYPE]: GraphJunctionNode,
}
