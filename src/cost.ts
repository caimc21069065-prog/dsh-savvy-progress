/**
 * Rough per-model cost estimation (USD per 1M tokens).
 *
 * Rates are heuristics for display only: cache hits, provider discounts and
 * DeepSeek-side pricing changes are not modeled. Longest matching model
 * prefix wins; the fallback keeps the totals non-zero but clearly marked
 * approximate in the UI.
 */

import type { SavvyAgentRow } from './types.ts'

export interface CostRate {
  /** USD per 1M prompt tokens (cache misses and writes). */
  input: number
  /** USD per 1M completion tokens. */
  output: number
}

/** Display defaults, overridable through the plugin config's `costRates`. */
export const DEFAULT_COST_RATES: Record<string, CostRate> = {
  'deepseek-chat': { input: 0.28, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'deepseek-v3': { input: 0.28, output: 1.1 },
  'deepseek-v3.2': { input: 0.28, output: 1.1 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
}

/** Used when no configured or default prefix matches. */
export const FALLBACK_COST_RATE: CostRate = { input: 0.5, output: 2 }

export interface CostOptions {
  showCost: boolean
  costRates: Record<string, CostRate>
}

/** Resolve the rate for one model id: longest prefix match, else fallback. */
export function rateFor(model: string | undefined, rates: Record<string, CostRate>): CostRate {
  if (model) {
    let best: { prefix: string; rate: CostRate } | undefined
    for (const [prefix, rate] of Object.entries(rates)) {
      if (model.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
        best = { prefix, rate }
      }
    }
    if (best) return best.rate
  }
  return FALLBACK_COST_RATE
}

/** Estimate one row's cost in USD; `undefined` when cost display is off. */
export function estimateCost(row: Pick<SavvyAgentRow,
  'model' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
>, options: CostOptions): number | undefined {
  if (!options.showCost) return undefined
  const rate = rateFor(row.model, options.costRates)
  const inTokens = (row.inputTokens ?? 0) + (row.cacheWriteTokens ?? 0)
  const outTokens = row.outputTokens ?? 0
  return (inTokens * rate.input + outTokens * rate.output) / 1_000_000
}
