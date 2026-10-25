/**
 * Read-only observation of the agent forest: registry lifecycle edges,
 * subagent seam terminal events, and per-session log events for route,
 * turn, tool-call, and token accounting.
 *
 * The observer never mutates observed sessions; publication of snapshots is
 * delegated to the store's throttled flusher.
 */

import type { Context } from '@deepseek-ai/cordis'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type { SavvyStore } from './store.ts'
import { SAVVY_AGENTS_RECORD, SAVVY_FLOW_RECORD, SAVVY_STEP_RECORD } from './types.ts'

/** Structural subset of the subagent seam's lifecycle payloads. */
interface SubagentRunInfoLike {
  readonly id: string
  readonly provider: string
  readonly local: boolean
}

interface SubagentRunEndInfoLike extends SubagentRunInfoLike {
  readonly stopReason: string
}

/** Structural subset of `request/context` session events. */
interface RequestContextLike {
  readonly provider: string
  readonly model: string
  readonly contextWindow?: number
}

/**
 * Wire every observation source into the store.
 * @param ctx - plugin context (root scope: receives every session's events).
 * @param store - the observation store.
 */
export function observe(ctx: Context, store: SavvyStore): void {
  ctx.on('agent/created', ({ agent, source }) => {
    store.trackAgent(agent)
    // A resumed root invalidates pre-restart "running" rows: reset and emit fresh.
    if (source === 'resume' && !agent.session.header.parentSession) {
      store.resetRoot(agent.session)
    }
    return undefined
  })

  ctx.on('agent/status', ({ agent, status }) => {
    store.setRunning(agent.id, status === 'running')
  })

  ctx.on('agent/disposed', ({ agent }) => {
    store.finishAgent(agent.id)
  })

  ctx.on('agent/error', ({ agent, error }) => {
    const message = error instanceof Error ? error.message : String(error)
    store.noteError(agent.id, message)
  })

  // Terminal edges from the subagent seam carry the stop reason.
  ctx.on('subagent/start', (info: SubagentRunInfoLike) => {
    store.setRunning(info.id, true)
  })
  ctx.on('subagent/end', (info: SubagentRunEndInfoLike) => {
    store.finishRun(info.id, info.stopReason)
  })

  ctx.on('session/disposed', (session) => {
    const rootId = session.header.parentSession ?? session.id
    if (rootId === session.id) store.dropRoot(session.id)
  })

  ctx.on('session/event', (session, event) => {
    // Skip our own durable records (live state is maintained directly) and
    // foreign plugin records.
    if (pluginRecordOf(event)) return
    switch (event.type) {
      case 'subagent/catalog':
        store.applyCatalog(session, event.data)
        break
      case 'subagent/descriptor':
        store.applyDescriptor(session, event.data)
        break
      case 'request/context':
        store.setRoute(session.id, event.data as RequestContextLike)
        break
      case 'turn/end':
        store.countCompletedTurn(session.id)
        break
      case 'tool/call':
        store.countToolCall(session.id)
        break
      case 'assistant/message': {
        const usage = (event.data as { usage?: Record<string, number | undefined> }).usage
        if (usage) {
          store.accumulateUsage(session.id, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
          })
        }
        break
      }
      default:
        break
    }
  })

  // Final best-effort flush is wired in `index.ts` through the store's
  // effect disposer; nothing to do here.

  // Re-export record names for tree-shaking clarity (no runtime effect).
  void SAVVY_AGENTS_RECORD
  void SAVVY_FLOW_RECORD
  void SAVVY_STEP_RECORD
}
