/**
 * Client-safe wire vocabulary for dsh-savvy-progress.
 *
 * All values are plain JSON. Durable writes use `plugin:` records on the
 * Session log (marked ignorable, so an older harness skips them safely on
 * resume); live reads go through the session-projection units registered by
 * this package's host half.
 *
 * @module dsh-savvy-progress/types
 */

/** Durable plugin-record type carrying one whole agents snapshot. */
export const SAVVY_AGENTS_RECORD = 'plugin:savvy-progress/agents'
/** Durable plugin-record type carrying one orchestrator flow report. */
export const SAVVY_FLOW_RECORD = 'plugin:savvy-progress/flow'
/** Durable plugin-record type carrying one worker step report. */
export const SAVVY_STEP_RECORD = 'plugin:savvy-progress/step'

/** Coarse lifecycle of one observed agent row. */
export type SavvyAgentStatus = 'running' | 'finished' | 'failed'

/** Durable creation mode of the child, when discovered from the subagent seam. */
export type SavvyAgentMode = 'one-shot' | 'continuable' | 'external' | 'unknown'

/** One subagent row inside a {@link SavvyAgentsView}. */
export interface SavvyAgentRow {
  /** The child session id. */
  id: string
  /** Durable creation label (the delegation's short description), when known. */
  label?: string
  /** Direct parent session id; the orchestrator for first-level children. */
  parentId?: string
  /** Root-relative delegation depth (1 = direct child of the root session). */
  depth: number
  mode?: SavvyAgentMode
  status: SavvyAgentStatus
  /** Whether the live driver is currently mid-turn (between `agent/status` flips). */
  running: boolean
  /** Model id from `request/context`, when observed. */
  model?: string
  /** Provider route from `request/context`, when observed. */
  provider?: string
  /** Advertised context window of the current route, in tokens. */
  contextWindow?: number
  startedAt?: number
  finishedAt?: number
  /** Time of the last folded activity (token/turn/tool/step) for this row. */
  lastActiveAt?: number
  /** Completed turns observed in this process. */
  turns: number
  /** Tool calls observed in this process. */
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Orchestrator-independent step progress (from `savvy_step`). */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  /** Rough USD estimate; absent when cost display is disabled. */
  estimatedCost?: number
  /** Last observed agent error message, when any. */
  lastError?: string
}

/** Whole snapshot of one root session's subagent forest. */
export interface SavvyAgentsView {
  v: 1
  /** The root session the snapshot belongs to. */
  rootId: string
  /** Wall-clock ms of emission. */
  emittedAt: number
  /** Rows ordered: running first, then by recency. Root agent excluded. */
  agents: SavvyAgentRow[]
}

/** One planned task inside a {@link SavvyFlowView}. */
export interface SavvyFlowTask {
  /** Stable task id (`t1`, `t2`, … — position-derived). */
  id: string
  title: string
  status: 'planned' | 'running' | 'finished' | 'failed'
  /** Optional tier label supplied by the orchestrator. */
  tier?: string
}

/** One orchestrator flow report (whole value, last write wins). */
export interface SavvyFlowView {
  v: 1
  title: string
  phase?: string
  total?: number
  done?: number
  tasks?: SavvyFlowTask[]
  finished?: boolean
  updatedAt: number
}

/** One worker step report (whole value, last write wins). */
export interface SavvyStepView {
  v: 1
  done: number
  total?: number
  note?: string
  updatedAt: number
}

/** Fold state + wire values this package registers on the projection tables. */
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest whole agents record (the state is the view). */
    'savvy-agents': SavvyAgentsView | null
    /** Latest whole flow record. */
    'savvy-flow': SavvyFlowView | null
    /** Latest whole step record. */
    'savvy-step': SavvyStepView | null
  }
  interface SessionProjectionMap {
    /** Latest agents snapshot of this session (root sessions carry it). */
    'savvy-agents': SavvyAgentsView | null
    /** Latest flow report of this session (root sessions carry it). */
    'savvy-flow': SavvyFlowView | null
    /** Latest step report of this session (worker sessions carry it). */
    'savvy-step': SavvyStepView | null
  }
}

/** Durable plugin-record payloads this package appends to session logs. */
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    [SAVVY_AGENTS_RECORD]: SavvyAgentsView
    [SAVVY_FLOW_RECORD]: SavvyFlowView
    [SAVVY_STEP_RECORD]: SavvyStepView
  }
}
