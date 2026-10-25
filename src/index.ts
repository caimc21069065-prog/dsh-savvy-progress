/**
 * dsh-savvy-progress host half: read-only observation of the agent forest,
 * optional orchestrator/worker reporting tools, and session-projection units
 * that publish the aggregated snapshots to the Web client.
 *
 * @module dsh-savvy-progress
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SavvyStore } from './store.ts'
import { observe } from './observer.ts'
import { registerProjections } from './projection.ts'
import { registerTools } from './tools.ts'
import type { CostRate } from './cost.ts'

export const name = 'dsh-savvy-progress'
export const inject: string[] = []
export * from './types.ts'

/** Plugin configuration (schemastery schema, consumed by the dsh loader). */
export const Config = z.object({
  tools: z.boolean().default(true).description('Register the savvy_progress / savvy_step reporting tools.'),
  showCost: z.boolean().default(true).description('Estimate and display per-agent USD cost from token counts.'),
  snapshotIntervalMs: z.number().default(1000).min(200).max(10_000).description('Throttle for agents-snapshot publication (ms).'),
  maxFinishedAgents: z.number().default(50).min(5).max(500).description('Finished rows retained per root session.'),
  costRates: z.dict(z.object({
    input: z.number().min(0).description('USD per 1M prompt tokens.'),
    output: z.number().min(0).description('USD per 1M completion tokens.'),
  })).default({}).description('Per-model rate overrides keyed by model-id prefix (USD / 1M tokens).'),
})

/** Typed view of {@link Config}. */
export interface Config {
  tools: boolean
  showCost: boolean
  snapshotIntervalMs: number
  maxFinishedAgents: number
  costRates: Record<string, CostRate>
}

/**
 * Host plugin body.
 * @param ctx - plugin context.
 * @param config - resolved configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new SavvyStore(ctx, {
    showCost: config.showCost,
    costRates: config.costRates,
    snapshotIntervalMs: config.snapshotIntervalMs,
    maxFinishedAgents: config.maxFinishedAgents,
  })
  ctx.effect(() => () => store.dispose(), 'savvy-progress: store')
  observe(ctx, store)
  registerProjections(ctx)
  if (config.tools) registerTools(ctx, store)
}
