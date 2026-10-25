/**
 * Optional model-facing reporting tools, mirroring the Claude savvy-progress
 * pair: `savvy_progress` (orchestrator-only flow reports) and `savvy_step`
 * (per-worker step reports). Both write durable whole-value records to the
 * caller's own session; the client reads them back through the projections.
 *
 * A `savvy_progress` call from a subagent is acknowledged and ignored, never
 * an error — matching the original plugin's behaviour.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { SAVVY_FLOW_RECORD, SAVVY_STEP_RECORD } from './types.ts'
import type { SavvyFlowTask, SavvyFlowView } from './types.ts'
import type { SavvyStore } from './store.ts'

const PROGRESS_DESCRIPTION = [
  'Report the current orchestration plan and its progress to the user interface.',
  'Call this from the main session when coordinating subagents: it updates the progress band above the chat input (flow title, phase, task counts).',
  'Send the full task list every call — each call replaces the previous report.',
  'Calls from a subagent are ignored.',
].join(' ')

const STEP_DESCRIPTION = [
  'Report your own step progress to the user interface (done count, total, and a short note).',
  'Include `total` on the first call; later calls may send only `done` and `note`.',
].join(' ')

interface ProgressArgs {
  title?: string
  phase?: string
  total?: number
  done?: number
  finished?: boolean
  tasks?: Array<{ title: string; tier?: string }>
}

interface StepArgs {
  done: number
  total?: number
  note?: string
}

function buildFlow(args: ProgressArgs, previous: SavvyFlowView | undefined): SavvyFlowView {
  const input = previous ?? { v: 1 as const, title: '', tasks: [], updatedAt: 0 }
  const tasks: SavvyFlowTask[] = (args.tasks ?? []).map((task, index) => {
    const id = `t${index + 1}`
    const before = input.tasks?.find((candidate) => candidate.id === id)
    return { id, title: task.title, tier: task.tier, status: before?.status ?? 'planned' }
  })
  const done = args.done ?? tasks.filter((task) => task.status === 'finished').length
  const total = args.total ?? tasks.length
  return {
    v: 1,
    title: args.title ?? input.title,
    phase: args.phase ?? input.phase,
    total,
    done,
    tasks: tasks.length > 0 ? tasks : input.tasks,
    finished: args.finished ?? input.finished,
    updatedAt: Date.now(),
  }
}

/**
 * Register the reporting tools on `ctx.tools` when that service is available.
 * @param ctx - plugin context.
 * @param store - the observation store (step reports refresh its rows).
 */
export function registerTools(ctx: Context, store: SavvyStore): void {
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(defineTool({
      name: 'savvy_progress',
      description: PROGRESS_DESCRIPTION,
      parameters: {
        title: { type: 'string', description: 'Flow title shown in the progress band.' },
        phase: { type: 'string', description: 'Current phase, e.g. plan / delegate / review.' },
        total: { type: 'integer', description: 'Total task count, when not implied by `tasks`.' },
        done: { type: 'integer', description: 'Completed task count.' },
        finished: { type: 'boolean', description: 'True once the whole flow is complete.' },
        tasks: {
          type: 'array',
          description: 'The COMPLETE ordered task list, replacing any previous list.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', required: true, description: 'Short imperative task title.' },
              tier: { type: 'string', description: 'Optional tier/layer label.' },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            updated: { type: 'boolean', required: true },
            done: { type: 'integer' },
            total: { type: 'integer' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.updated
            ? `Progress reported: ${value.done ?? 0}/${value.total ?? 0} tasks done.`
            : `Progress report ignored (${value.reason ?? 'not the main session'}).`,
        }],
      },
      async execute(args: ProgressArgs, exec) {
        if (!exec.agent) throw new Error('savvy_progress requires an owning agent session')
        if (exec.agent.session.header.parentSession) {
          return { updated: false, reason: 'subagent' }
        }
        const session = exec.agent.session
        const previous = latestFlow(session.snapshotEvents())
        const flow = buildFlow(args, previous)
        appendPluginRecord(session, SAVVY_FLOW_RECORD, flow)
        return { updated: true, done: flow.done ?? 0, total: flow.total ?? 0 }
      },
      presentCall: (args: ProgressArgs) => ({
        card: 'generic',
        title: 'Report progress',
        kind: 'other',
        rawInput: { title: args.title, phase: args.phase, done: args.done, total: args.total },
      }),
    }))

    toolCtx.tools.register(defineTool({
      name: 'savvy_step',
      description: STEP_DESCRIPTION,
      parameters: {
        done: { type: 'integer', required: true, description: 'Completed step count for your own work.' },
        total: { type: 'integer', description: 'Total step count; include on the first call.' },
        note: { type: 'string', description: 'One short line about the current step.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            updated: { type: 'boolean', required: true },
            done: { type: 'integer', required: true },
            total: { type: 'integer' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.updated
            ? `Step reported: ${value.done}${value.total !== undefined ? `/${value.total}` : ''}.`
            : 'Step report ignored.',
        }],
      },
      async execute(args: StepArgs, exec) {
        if (!exec.agent) throw new Error('savvy_step requires an owning agent session')
        const session = exec.agent.session
        const previous = latestStep(session.snapshotEvents())
        const total = args.total ?? previous?.total
        const view = { v: 1 as const, done: args.done, total, note: args.note ?? previous?.note, updatedAt: Date.now() }
        appendPluginRecord(session, SAVVY_STEP_RECORD, view)
        store.applyStep(session.id, { done: args.done, total, note: args.note })
        return { updated: true, done: args.done, total }
      },
      presentCall: (args: StepArgs) => ({
        card: 'generic',
        title: 'Report step',
        kind: 'other',
        rawInput: args as unknown as Record<string, never>,
      }),
    }))
  })
}

/** Fold the latest flow record out of a session's live log (for state carry-over). */
function latestFlow(events: Iterable<{ type: string }>): SavvyFlowView | undefined {
  let latest: SavvyFlowView | undefined
  for (const event of events) {
    if (event.type === SAVVY_FLOW_RECORD) latest = (event as unknown as { data: SavvyFlowView }).data
  }
  return latest
}

function latestStep(events: Iterable<{ type: string }>): { done: number; total?: number; note?: string } | undefined {
  let latest: { done: number; total?: number; note?: string } | undefined
  for (const event of events) {
    if (event.type === SAVVY_STEP_RECORD) latest = (event as unknown as { data: { done: number; total?: number; note?: string } }).data
  }
  return latest
}
