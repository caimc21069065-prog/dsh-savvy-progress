/**
 * The right-sidebar agents panel body: every subagent of the current root
 * session grouped by status, with model, duration, step progress, token
 * counts, rough cost, and a per-row expander for the full detail line.
 *
 * Registered under the keyed `sidebar.right.pane.tab` seat (kind
 * `savvy-agents`); the data arrives through the session-standard
 * `useProjection` seat, so the host does all computation.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AgentsPanelProps } from './types.ts'
import type { SavvyAgentRow } from '../types.ts'
import { formatCost, formatDuration, formatTokens, interpolate, rowElapsed, summarize } from './format.ts'

const PANEL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  fontSize: '12.5px',
  lineHeight: 1.45,
  overflow: 'hidden',
}

const LIST_STYLE: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '4px 8px 8px',
}

const GROUP_TITLE_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 4px 4px',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  opacity: 0.7,
}

const ROW_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  margin: '0 0 4px',
  padding: '6px 8px',
  borderRadius: '8px',
  border: '1px solid rgba(128,128,128,0.2)',
  background: 'rgba(128,128,128,0.05)',
  textAlign: 'left',
  color: 'inherit',
  cursor: 'pointer',
}

const ROW_HEAD_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
}

const ROW_NAME_STYLE: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontWeight: 600,
}

const ROW_META_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 10px',
  marginTop: '3px',
  opacity: 0.8,
}

const DETAIL_STYLE: React.CSSProperties = {
  marginTop: '6px',
  paddingTop: '6px',
  borderTop: '1px dashed rgba(128,128,128,0.3)',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  opacity: 0.85,
  wordBreak: 'break-word',
}

const SUMMARY_STYLE: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 12px',
  padding: '8px 12px',
  borderTop: '1px solid rgba(128,128,128,0.25)',
  opacity: 0.9,
}

const EMPTY_STYLE: React.CSSProperties = {
  padding: '24px 16px',
  opacity: 0.7,
  textAlign: 'center',
}

const FILTER_STYLE = (active: boolean): React.CSSProperties => ({
  flex: '0 0 auto',
  marginLeft: 'auto',
  fontSize: '11px',
  padding: '2px 8px',
  borderRadius: '999px',
  border: '1px solid rgba(128,128,128,0.35)',
  background: active ? 'rgba(83,164,81,0.18)' : 'transparent',
  color: 'inherit',
  cursor: 'pointer',
})

function statusDot(row: SavvyAgentRow): React.CSSProperties {
  const base: React.CSSProperties = { flex: '0 0 auto', width: '8px', height: '8px', borderRadius: '50%' }
  if (row.status === 'running') return { ...base, background: 'rgb(83, 164, 81)', boxShadow: '0 0 0 3px rgba(83, 164, 81, 0.2)' }
  if (row.status === 'failed') return { ...base, background: 'rgb(205, 74, 69)' }
  return { ...base, background: 'rgba(128,128,128,0.55)' }
}

function modeLabel(row: SavvyAgentRow, t: AgentsPanelProps['t']): string | undefined {
  if (!row.mode) return undefined
  switch (row.mode) {
    case 'one-shot': return t('panel.mode.one-shot')
    case 'continuable': return t('panel.mode.continuable')
    case 'external': return t('panel.mode.external')
    default: return t('panel.mode.unknown')
  }
}

function labelOf(row: SavvyAgentRow): string {
  if (row.label && row.label.trim()) return row.label
  return row.id.length > 10 ? `${row.id.slice(0, 8)}…` : row.id
}

/** One expandable agent row. */
function AgentRow({ row, now, t, openChild, canOpen }: {
  row: SavvyAgentRow
  now: number
  t: AgentsPanelProps['t']
  openChild: (row: SavvyAgentRow) => void
  canOpen: boolean
}) {
  const [open, setOpen] = useState(false)
  const cost = formatCost(row.estimatedCost)
  const step = row.stepDone !== undefined
    ? interpolate(t('row.step'), { done: row.stepDone, total: row.stepTotal ?? '?' })
    : undefined
  const mode = modeLabel(row, t)

  return (
    <div style={ROW_STYLE} onClick={() => setOpen((value) => !value)} role="button" tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setOpen((value) => !value) }}>
      <div style={ROW_HEAD_STYLE}>
        <span style={statusDot(row)} aria-hidden />
        <span style={ROW_NAME_STYLE} title={`${labelOf(row)} · ${row.id}`}>{labelOf(row)}</span>
        {row.running ? <span aria-hidden>⟳</span> : null}
        {canOpen ? (
          <button type="button" style={{ flex: '0 0 auto', fontSize: '11px', padding: '1px 6px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
            title={t('panel.openChild.title')}
            onClick={(event) => { event.stopPropagation(); openChild(row) }}>
            {t('panel.openChild')}
          </button>
        ) : null}
      </div>
      <div style={ROW_META_STYLE}>
        <span>{row.model ?? '?'}</span>
        <span>{formatDuration(rowElapsed(row, now))}</span>
        {step ? <span>{step}</span> : null}
        {cost ? <span>{t('row.cost', { cost })}</span> : null}
      </div>
      {open ? (
        <div style={DETAIL_STYLE}>
          <span>{interpolate(t('row.turns'), { count: row.turns })} · {interpolate(t('row.tools'), { count: row.toolCalls })}</span>
          <span>{interpolate(t('row.tokens'), { in: formatTokens(row.inputTokens + row.cacheWriteTokens), out: formatTokens(row.outputTokens) })}</span>
          {row.cacheReadTokens + row.cacheWriteTokens > 0 ? (
            <span>{interpolate(t('row.cache'), { read: formatTokens(row.cacheReadTokens), write: formatTokens(row.cacheWriteTokens) })}</span>
          ) : null}
          {row.stepNote ? <span>💬 {row.stepNote}</span> : null}
          {row.lastError ? <span style={{ color: 'rgb(205, 74, 69)' }}>⚠ {row.lastError}</span> : null}
          {mode ? <span>{mode} · {row.id}</span> : <span>{row.id}</span>}
        </div>
      ) : null}
    </div>
  )
}

/** Right-sidebar agents panel body. */
export function AgentsPanel({ useProjection, t, openChild }: AgentsPanelProps) {
  const snapshot = useProjection('savvy-agents')
  const flow = useProjection('savvy-flow')
  const agents = useMemo(() => snapshot?.agents ?? [], [snapshot])
  const [runningOnly, setRunningOnly] = useState(false)
  const [collapsedDone, setCollapsedDone] = useState(false)
  const anyRunning = agents.some((row) => row.status === 'running')
  const now = useTicker(anyRunning)

  const groups = useMemo(() => {
    const running: SavvyAgentRow[] = []
    const failed: SavvyAgentRow[] = []
    const finished: SavvyAgentRow[] = []
    for (const row of agents) {
      if (row.status === 'running') running.push(row)
      else if (row.status === 'failed') failed.push(row)
      else finished.push(row)
    }
    return { running, failed, finished }
  }, [agents])

  const summary = summarize(agents, now)
  const cost = formatCost(summary.showCost ? summary.cost : undefined)
  const hasFlow = flow !== undefined && flow !== null

  return (
    <div style={PANEL_STYLE}>
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px 0' }}>
        <span style={{ fontWeight: 600 }}>{t('panel.title')}</span>
        {hasFlow && flow.title ? <span style={{ opacity: 0.7, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{flow.title}</span> : null}
        <button type="button" style={FILTER_STYLE(runningOnly)} onClick={() => setRunningOnly((value) => !value)}>
          {t('panel.showRunning')}
        </button>
      </div>
      <div style={LIST_STYLE}>
        {agents.length === 0 ? (
          <div style={EMPTY_STYLE}>{t('panel.empty')}</div>
        ) : (
          <>
            {groups.running.length > 0 ? (
              <div style={GROUP_TITLE_STYLE}>
                {t('panel.group.running')} ({groups.running.length})
              </div>
            ) : null}
            {groups.running.map((row) => (
              <AgentRow key={row.id} row={row} now={now} t={t} openChild={openChild} canOpen={row.mode === 'continuable' && row.status !== 'running'} />
            ))}
            {!runningOnly && groups.failed.length > 0 ? (
              <>
                <div style={GROUP_TITLE_STYLE}>{t('panel.group.failed')} ({groups.failed.length})</div>
                {groups.failed.map((row) => (
                  <AgentRow key={row.id} row={row} now={now} t={t} openChild={openChild} canOpen={row.mode === 'continuable' && row.status !== 'running'} />
                ))}
              </>
            ) : null}
            {!runningOnly && groups.finished.length > 0 ? (
              <>
                <div style={GROUP_TITLE_STYLE} onClick={() => setCollapsedDone((value) => !value)} role="button" tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setCollapsedDone((value) => !value) }}>
                  {t('panel.group.finished')} ({groups.finished.length}) {collapsedDone ? '▸' : '▾'}
                </div>
                {collapsedDone ? null : groups.finished.map((row) => (
                  <AgentRow key={row.id} row={row} now={now} t={t} openChild={openChild} canOpen={row.mode === 'continuable' && row.status !== 'running'} />
                ))}
              </>
            ) : null}
            {runningOnly && groups.running.length === 0 ? <div style={EMPTY_STYLE}>{t('panel.empty')}</div> : null}
          </>
        )}
      </div>
      {agents.length > 0 ? (
        <div style={SUMMARY_STYLE}>
          <span>{interpolate(t('panel.summary.agents'), { done: summary.finished + summary.failed, total: agents.length })}</span>
          {hasFlow && flow.total !== undefined ? (
            <span>{interpolate(t('flow.tasks'), { done: flow.done ?? 0, total: flow.total })}</span>
          ) : null}
          {cost ? <span>{interpolate(t('panel.summary.cost'), { cost })}</span> : null}
          <span>{interpolate(t('panel.summary.elapsed'), { elapsed: formatDuration(summary.elapsed) })}</span>
        </div>
      ) : null}
    </div>
  )
}

/** One-second ticker (hook-order-stable: always called, pauses when idle). */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
