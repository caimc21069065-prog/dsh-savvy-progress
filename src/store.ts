/**
 * In-memory observation state, one bucket per root session, plus the
 * throttled publisher that folds each bucket into a whole `savvy-agents`
 * plugin record appended to the root Session log.
 *
 * The store never mutates sessions other than appending its own ignorable
 * records; a failed or missing append degrades to a lost UI tick, never a
 * broken conversation. Appends run on a timer so they can never reenter
 * another append's publication window on the same session.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { SavvyAgentRow, SavvyAgentsView, SavvyAgentStatus, SavvyAgentMode } from './types.ts'
import { SAVVY_AGENTS_RECORD } from './types.ts'
import { estimateCost, type CostOptions } from './cost.ts'

/** Structural subset of the subagent seam's parent catalog event. */
export interface CatalogEventLike {
  readonly childId: string
  readonly childCreatedAt: number
  readonly mode: 'one-shot' | 'continuable' | 'external' | 'unknown'
  readonly label?: string
}

/** Structural subset of the subagent seam's child descriptor. */
export interface DescriptorLike {
  readonly mode: 'one-shot' | 'continuable'
  readonly label?: string
  readonly agentProvider?: string
  readonly agentModel?: string
}

/** Structural subset of `TokenUsage` from dsh-llm. */
export interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface SavvyStoreConfig extends CostOptions {
  snapshotIntervalMs: number
  maxFinishedAgents: number
}

/** Host-internal tracking row; the wire row is derived at flush time. */
interface Track {
  id: string
  parentId?: string
  depth: number
  rootId: string
  root: boolean
  label?: string
  mode?: SavvyAgentMode
  status: SavvyAgentStatus
  running: boolean
  model?: string
  provider?: string
  contextWindow?: number
  startedAt?: number
  finishedAt?: number
  lastActiveAt?: number
  turns: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  lastError?: string
}

interface RootBucket {
  rootId: string
  session: Session
  tracks: Map<string, Track>
  dirty: boolean
  lastKey: string
  lastFlushAt: number
}

/** Drop explicit `undefined` members: durable records demand lossless JSON. */
function pruneUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, member] of Object.entries(value)) {
    if (member !== undefined) out[key] = member
  }
  return out as T
}

function statusFromStopReason(reason: string): SavvyAgentStatus {
  if (reason === 'completed' || reason === 'refusal' || reason === 'aborted') return 'finished'
  return 'failed'
}

/**
 * Observation store. Constructed once per plugin; all mutation arrives from
 * observer event handlers, all publication happens on the internal timer.
 */
export class SavvyStore {
  private readonly buckets = new Map<string, RootBucket>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: SavvyStoreConfig,
  ) {}

  /** Resolve the root bucket for a session id, if one is tracked. */
  bucketOf(rootId: string): RootBucket | undefined {
    return this.buckets.get(rootId)
  }

  /** Ensure a bucket exists for a live root session. */
  ensureRoot(session: Session): RootBucket {
    let bucket = this.buckets.get(session.id)
    if (!bucket) {
      bucket = { rootId: session.id, session, tracks: new Map(), dirty: false, lastKey: '', lastFlushAt: 0 }
      this.buckets.set(session.id, bucket)
    } else {
      bucket.session = session
    }
    return bucket
  }

  /** Drop a disposed root session's bucket (final flush is impossible then). */
  dropRoot(rootId: string): void {
    this.buckets.delete(rootId)
  }

  /** A root-session resume invalidates pre-restart rows: start a fresh view. */
  resetRoot(session: Session): void {
    const bucket = this.ensureRoot(session)
    bucket.tracks.clear()
    bucket.lastKey = ''
    this.scheduleFlush(bucket)
  }

  /**
   * Register one agent. Roots (no durable parent) seed their bucket; children
   * resolve lineage through the parent track when it is already known and
   * fall back to the session header chain otherwise.
   */
  trackAgent(agent: Agent): void {
    const header = agent.session.header
    const parentId = header.parentSession
    const bucket = parentId ? this.lineageBucket(agent, parentId) : this.ensureRoot(agent.session)
    const existing = bucket.tracks.get(agent.id)
    const track: Track = existing ?? {
      id: agent.id,
      rootId: bucket.rootId,
      depth: parentId ? Math.max(1, this.depthOf(parentId) + 1) : 0,
      root: !parentId,
      status: 'running',
      running: false,
      turns: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      startedAt: Date.now(),
    }
    if (existing) {
      // Re-created agent on the same session (cold resume): revive the row.
      existing.status = 'running'
      existing.finishedAt = undefined
      existing.lastError = undefined
      existing.startedAt ??= Date.now()
    } else {
      track.parentId = parentId
      bucket.tracks.set(agent.id, track)
    }
    const options = agent.options as { provider?: string; model?: string }
    track.provider = options?.provider
    track.model = options?.model
    if (!track.root) this.scheduleFlush(bucket)
  }

  /** Resolve the bucket a child of `parentId` belongs to, creating a synthetic root at worst. */
  private lineageBucket(child: Agent, parentId: string): RootBucket {
    const parentTrack = this.lookup(parentId)
    if (parentTrack) return this.buckets.get(parentTrack.track.rootId)!
    // Parent not tracked (external or already disposed): check its own header.
    const bucket = this.buckets.get(parentId)
    if (bucket) return bucket
    // Unknown lineage — treat the child's own session as the bucket root so
    // its descendants still render; the child itself renders as a row.
    return this.ensureRoot(child.session)
  }

  private depthOf(agentId: string): number {
    return this.lookup(agentId)?.track.depth ?? 0
  }

  /** Global track index across buckets. */
  private lookup(agentId: string): { track: Track; bucket: RootBucket } | undefined {
    for (const bucket of this.buckets.values()) {
      const track = bucket.tracks.get(agentId)
      if (track) return { track, bucket }
    }
    return undefined
  }

  /** Mirror `agent/status` flips onto the row's live-activity bit. */
  setRunning(agentId: string, running: boolean): void {
    const found = this.lookup(agentId)
    if (!found || found.track.root) return
    if (found.track.running !== running) {
      found.track.running = running
      if (running) found.track.lastActiveAt = Date.now()
      this.scheduleFlush(found.bucket)
    }
  }

  /** Terminal edge from the subagent seam. */
  finishRun(childId: string, stopReason: string): void {
    const found = this.lookup(childId)
    if (!found || found.track.root) return
    const next = statusFromStopReason(stopReason)
    if (found.track.status === 'running') {
      found.track.status = next
      found.track.running = false
      found.track.finishedAt = Date.now()
      this.scheduleFlush(found.bucket)
    }
  }

  /** Agent left the registry without a subagent terminal edge (e.g. disposal). */
  finishAgent(agentId: string): void {
    const found = this.lookup(agentId)
    if (!found || found.track.root) return
    if (found.track.status === 'running') {
      found.track.status = 'finished'
      found.track.running = false
      found.track.finishedAt = Date.now()
      this.scheduleFlush(found.bucket)
    }
  }

  noteError(agentId: string, message: string): void {
    const found = this.lookup(agentId)
    if (!found) return
    found.track.lastError = message.slice(0, 300)
    if (!found.track.root) this.scheduleFlush(found.bucket)
  }

  /** Parent-owned catalog discovery (also covers external executions). */
  applyCatalog(parentSession: Session, entry: CatalogEventLike): void {
    const bucket = this.buckets.get(parentSession.id) ?? this.ensureRoot(parentSession)
    const existing = bucket.tracks.get(entry.childId)
    if (existing) {
      existing.mode = entry.mode === 'unknown' ? 'unknown' : entry.mode
      existing.label ??= entry.label
    } else {
      bucket.tracks.set(entry.childId, {
        id: entry.childId,
        parentId: parentSession.id,
        rootId: bucket.rootId,
        depth: this.depthOf(parentSession.id) + 1,
        root: false,
        label: entry.label,
        mode: entry.mode,
        status: 'running',
        running: false,
        startedAt: entry.childCreatedAt,
        turns: 0,
        toolCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    }
    this.scheduleFlush(bucket)
  }

  /** Child-owned descriptor: label plus resolved model for continuable children. */
  applyDescriptor(childSession: Session, descriptor: DescriptorLike): void {
    const found = this.lookup(childSession.id)
    if (!found) return
    found.track.label ??= descriptor.label
    if (descriptor.mode === 'continuable') {
      found.track.mode = 'continuable'
      found.track.provider ??= descriptor.agentProvider
      found.track.model ??= descriptor.agentModel
    } else {
      found.track.mode ??= 'one-shot'
    }
    if (!found.track.root) this.scheduleFlush(found.bucket)
  }

  setRoute(sessionId: string, route: { provider: string; model: string; contextWindow?: number }): void {
    const found = this.lookup(sessionId)
    if (!found) return
    found.track.provider = route.provider
    found.track.model = route.model
    found.track.contextWindow = route.contextWindow
    found.track.lastActiveAt = Date.now()
    if (!found.track.root) this.scheduleFlush(found.bucket)
  }

  countCompletedTurn(sessionId: string): void {
    const found = this.lookup(sessionId)
    if (!found) return
    found.track.turns += 1
    found.track.lastActiveAt = Date.now()
    if (!found.track.root) this.scheduleFlush(found.bucket)
  }

  countToolCall(sessionId: string): void {
    const found = this.lookup(sessionId)
    if (!found) return
    found.track.toolCalls += 1
    found.track.lastActiveAt = Date.now()
    if (!found.track.root) this.scheduleFlush(found.bucket)
  }

  accumulateUsage(sessionId: string, usage: UsageLike): void {
    const found = this.lookup(sessionId)
    if (!found) return
    found.track.inputTokens += usage.inputTokens ?? 0
    found.track.outputTokens += usage.outputTokens ?? 0
    found.track.cacheReadTokens += usage.cacheReadTokens ?? 0
    found.track.cacheWriteTokens += usage.cacheWriteTokens ?? 0
    found.track.lastActiveAt = Date.now()
    if (!found.track.root) this.scheduleFlush(found.bucket)
  }

  /** `savvy_step` tool report for the calling agent's own row. */
  applyStep(sessionId: string, step: { done: number; total?: number; note?: string }): void {
    const found = this.lookup(sessionId)
    if (!found) return
    found.track.stepDone = step.done
    if (step.total !== undefined) found.track.stepTotal = step.total
    if (step.note !== undefined) found.track.stepNote = step.note
    found.track.lastActiveAt = Date.now()
    if (!found.track.root) this.scheduleFlush(found.bucket)
  }

  /** Schedule a throttled flush for one bucket. */
  scheduleFlush(bucket: RootBucket): void {
    bucket.dirty = true
    if (this.timer !== undefined) return
    const now = Date.now()
    const wait = Math.max(0, bucket.lastFlushAt + this.config.snapshotIntervalMs - now)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flushAll()
    }, wait)
    // The timer must not keep the host process alive by itself.
    ;(this.timer as unknown as { unref?: () => void }).unref?.()
  }

  /** Build the wire view of one bucket (rows exclude the root agent). */
  private viewOf(bucket: RootBucket): SavvyAgentsView {
    const rows: SavvyAgentRow[] = []
    for (const track of bucket.tracks.values()) {
      if (track.root) continue
      rows.push(pruneUndefined({
        id: track.id,
        label: track.label,
        parentId: track.parentId,
        depth: track.depth,
        mode: track.mode,
        status: track.status,
        running: track.running,
        model: track.model,
        provider: track.provider,
        contextWindow: track.contextWindow,
        startedAt: track.startedAt,
        finishedAt: track.finishedAt,
        lastActiveAt: track.lastActiveAt,
        turns: track.turns,
        toolCalls: track.toolCalls,
        inputTokens: track.inputTokens,
        outputTokens: track.outputTokens,
        cacheReadTokens: track.cacheReadTokens,
        cacheWriteTokens: track.cacheWriteTokens,
        stepDone: track.stepDone,
        stepTotal: track.stepTotal,
        stepNote: track.stepNote,
        estimatedCost: estimateCost(track, this.config),
        lastError: track.lastError,
      }))
    }
    // Live first, failures next, then most recently active; cap finished rows.
    const order = { running: 0, failed: 1, finished: 2 } as const
    rows.sort((a, b) =>
      order[a.status] - order[b.status] ||
      (b.lastActiveAt ?? b.startedAt ?? 0) - (a.lastActiveAt ?? a.startedAt ?? 0))
    const finished = rows.filter((row) => row.status === 'finished')
    if (finished.length > this.config.maxFinishedAgents) {
      const drop = new Set(finished.slice(this.config.maxFinishedAgents).map((row) => row.id))
      for (const id of drop) bucket.tracks.delete(id)
      return { v: 1, rootId: bucket.rootId, emittedAt: Date.now(), agents: rows.filter((row) => !drop.has(row.id)) }
    }
    return { v: 1, rootId: bucket.rootId, emittedAt: Date.now(), agents: rows }
  }

  /** Content key for change detection (excludes the emission timestamp). */
  private keyOf(view: SavvyAgentsView): string {
    return JSON.stringify({ rootId: view.rootId, agents: view.agents })
  }

  /** Flush every dirty bucket whose content changed since its last append. */
  flushAll(): void {
    for (const bucket of [...this.buckets.values()]) {
      if (!bucket.dirty) continue
      bucket.dirty = false
      bucket.lastFlushAt = Date.now()
      try {
        const view = this.viewOf(bucket)
        if (view.agents.length === 0) continue
        const key = this.keyOf(view)
        if (key === bucket.lastKey) continue
        appendPluginRecord(bucket.session, SAVVY_AGENTS_RECORD, view)
        bucket.lastKey = key
      } catch {
        // A disposed or re-entrant session: skip this tick rather than fail.
      }
    }
  }

  /** Final synchronous flush on plugin teardown (best effort). */
  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.flushAll()
  }
}
