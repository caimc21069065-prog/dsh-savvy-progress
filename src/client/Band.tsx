/**
 * The slim progress band above the chat composer: flow title / phase /
 * task counts, running-agent count, rough total cost, and elapsed time.
 * Rendered through the `conversation.input.dock` list slot; hidden when the
 * session has no subagent snapshot and no flow report.
 */

import { useEffect, useState } from 'react'
import type { ProgressBandProps } from './types.ts'
import { formatCost, formatDuration, interpolate, summarize } from './format.ts'

const BAND_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(128, 128, 128, 0.25)',
  background: 'rgba(128, 128, 128, 0.08)',
  fontSize: '12px',
  lineHeight: 1.4,
  cursor: 'pointer',
  textAlign: 'left',
  color: 'inherit',
}

const TITLE_STYLE: React.CSSProperties = {
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: '0 1 auto',
  minWidth: '0',
}

const META_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginLeft: 'auto',
  flex: '0 0 auto',
  whiteSpace: 'nowrap',
  opacity: 0.85,
}

const DOT_STYLE = (running: boolean): React.CSSProperties => ({
  flex: '0 0 auto',
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  background: running ? 'rgb(83, 164, 81)' : 'rgba(128,128,128,0.6)',
  boxShadow: running ? '0 0 0 3px rgba(83, 164, 81, 0.25)' : 'none',
})

/** One-second ticker so elapsed times advance without new data. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/** Progress band above the composer. */
export function ProgressBand({ useProjection, t, openPanel }: ProgressBandProps) {
  const snapshot = useProjection('savvy-agents')
  const flow = useProjection('savvy-flow')
  const agents = snapshot?.agents ?? []
  const hasFlow = flow !== undefined && flow !== null
  const anyRunning = agents.some((row) => row.status === 'running')
  const now = useNow(anyRunning)
  if (agents.length === 0 && !hasFlow) return null

  const summary = summarize(agents, now)
  const cost = formatCost(summary.showCost ? summary.cost : undefined)
  const taskText = hasFlow && flow.total !== undefined
    ? interpolate(t('band.tasks'), { done: flow.done ?? 0, total: flow.total })
    : undefined

  const phase = hasFlow && flow.phase ? `${t('flow.phase')}: ${flow.phase}` : undefined

  return (
    <button type="button" style={BAND_STYLE} onClick={openPanel} title={t('band.open')}>
      <span style={DOT_STYLE(anyRunning)} aria-hidden />
      <span style={TITLE_STYLE}>
        {hasFlow ? (flow.title || t('panel.title')) : interpolate(t('band.agents'), { count: agents.length })}
        {phase ? <span style={{ fontWeight: 400, opacity: 0.75 }}> · {phase}</span> : null}
      </span>
      <span style={META_STYLE}>
        {taskText ? <span>{taskText}</span> : null}
        {hasFlow && flow.finished ? <span>{t('flow.finished')}</span> : null}
        <span>{interpolate(t('band.running'), { count: summary.running })}</span>
        {cost ? <span>{t('band.est')} {cost}</span> : null}
        {summary.elapsed > 0 ? <span>{formatDuration(summary.elapsed)}</span> : null}
      </span>
    </button>
  )
}
