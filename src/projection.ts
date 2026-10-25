/**
 * Session-projection units: fold this package's durable plugin records into
 * whole wire values so the Web client reads them through `useProjection`
 * with zero client-side domain code, live and after resume alike.
 *
 * Registration is guarded on the optional `sessionProjections` service so a
 * minimal host composition without the seam simply loses the projections,
 * never the plugin.
 */

import type { Context } from '@deepseek-ai/cordis'
import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { SAVVY_AGENTS_RECORD, SAVVY_FLOW_RECORD, SAVVY_STEP_RECORD } from './types.ts'
import type { SavvyAgentsView, SavvyFlowView, SavvyStepView } from './types.ts'

/**
 * The fold state IS the latest whole record value, so `view` returns the
 * state reference unchanged and the drive's `Object.is` comparison
 * suppresses duplicate publication.
 */
function lastValueUnit<T>(type: string, schema: z.ZodType<T | null>) {
  return {
    stateSchema: schema,
    init: () => null,
    apply: (state: T | null, event: SessionEvent): T | null => {
      const record = pluginRecordOf(event)
      return record !== undefined && record.type === type ? record.data as T : state
    },
    wire: {
      viewSchema: schema,
      view: (state: T | null): T | null => state,
    },
    stateVersion: 1,
  }
}

const agentsSchema = z.custom<SavvyAgentsView | null>((value) => value === null || typeof value === 'object')
const flowSchema = z.custom<SavvyFlowView | null>((value) => value === null || typeof value === 'object')
const stepSchema = z.custom<SavvyStepView | null>((value) => value === null || typeof value === 'object')

/**
 * Register the `savvy-agents`, `savvy-flow`, and `savvy-step` projection units.
 * @param ctx - plugin context.
 */
export function registerProjections(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'savvy-agents',
      ...lastValueUnit<SavvyAgentsView>(SAVVY_AGENTS_RECORD, agentsSchema),
    })
    projectionCtx.sessionProjections.register({
      key: 'savvy-flow',
      ...lastValueUnit<SavvyFlowView>(SAVVY_FLOW_RECORD, flowSchema),
    })
    projectionCtx.sessionProjections.register({
      key: 'savvy-step',
      ...lastValueUnit<SavvyStepView>(SAVVY_STEP_RECORD, stepSchema),
    })
  })
}
