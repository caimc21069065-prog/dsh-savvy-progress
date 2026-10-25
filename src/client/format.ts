/** Pure formatting helpers shared by the band and the panel. */

import type { SavvyAgentRow } from '../types.ts'

/** Compact duration: `2m 18s`, `48s`, `1h 03m`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** `3.1k` / `2.4M` style compact token counts. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

/** `$0.42` / `$0.0031` style cost. */
export function formatCost(cost: number | undefined): string | undefined {
  if (cost === undefined) return undefined
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(4)}`
}

/** Elapsed wall-clock for one row: finished rows stop at their finish time. */
export function rowElapsed(row: SavvyAgentRow, now: number): number {
  const from = row.startedAt ?? row.lastActiveAt
  if (from === undefined) return 0
  const to = row.status === 'running' ? Math.max(now, from) : row.finishedAt ?? row.lastActiveAt ?? now
  return Math.max(0, to - from)
}

/** Totals across rows: cost and spanned wall-clock. */
export function summarize(agents: readonly SavvyAgentRow[], now: number): {
  running: number
  finished: number
  failed: number
  cost: number
  showCost: boolean
  elapsed: number
} {
  let running = 0
  let finished = 0
  let failed = 0
  let cost = 0
  let showCost = false
  let first: number | undefined
  let last: number | undefined
  for (const row of agents) {
    if (row.status === 'running') running += 1
    else if (row.status === 'failed') failed += 1
    else finished += 1
    if (row.estimatedCost !== undefined) {
      cost += row.estimatedCost
      showCost = true
    }
    const from = row.startedAt ?? row.lastActiveAt
    if (from !== undefined) first = first === undefined ? from : Math.min(first, from)
    const to = row.status === 'running' ? now : row.finishedAt ?? row.lastActiveAt ?? now
    last = last === undefined ? to : Math.max(last, to)
  }
  return {
    running,
    finished,
    failed,
    cost,
    showCost,
    elapsed: first === undefined || last === undefined ? 0 : Math.max(0, last - first),
  }
}

/** Fill `{param}` templates from the locale dictionaries. */
export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match)
}
