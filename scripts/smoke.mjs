/**
 * Host-side integration smoke test: a real cordis app loads the built plugin,
 * fake agents publish through real Sessions, and the pipeline must land a
 * `plugin:savvy-progress/agents` record on the root session's log.
 *
 * Run: node scripts/smoke.mjs
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, pluginRecordOf } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { apply, name } from '../lib/index.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- minimal real-world fixtures -------------------------------------------

const ctx = new Context()
new SessionProjectionRegistry(ctx)
const store = new SessionStore(ctx)
const rootSession = store.prepare('sess-root', { meta: { cwd: 'D:\\tmp' } })
store.enter(rootSession)
store.announce(rootSession)
const childSession = store.prepare('sess-child', { meta: { cwd: 'D:\\tmp', parentSession: 'sess-root', origin: 'subagent' } })
store.enter(childSession)
store.announce(childSession)

const fakeAgent = (session, options = {}) => ({
  id: session.id,
  session,
  options,
  status: 'idle',
})

// --- boot the plugin on the context -----------------------------------------

const fiber = await ctx.plugin({ apply, name }, {
  tools: false, // no tools registry in this fixture
  showCost: true,
  snapshotIntervalMs: 30,
  maxFinishedAgents: 50,
  costRates: {},
})

// Root agent appears, then a child with a model route.
ctx.emit('agent/created', { agent: fakeAgent(rootSession), source: 'startup' })
ctx.emit('agent/created', { agent: fakeAgent(childSession, { provider: 'deepseek', model: 'deepseek-chat' }), source: 'startup' })

// Discovery facts (catalog on the parent, descriptor on the child).
rootSession.append('subagent/catalog', { childId: 'sess-child', childCreatedAt: Date.now() - 5_000, version: 0, mode: 'one-shot', label: 'worker-auth' })
childSession.append('subagent/descriptor', { version: 1, mode: 'one-shot', provider: 'spawn', label: 'worker-auth' })
childSession.append('request/context', { provider: 'deepseek', model: 'deepseek-chat', contextWindow: 131072 })

// One completed turn with usage, one tool call.
childSession.append('turn/start', { turn: 1 })
childSession.append('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'read_file', arguments: '{}' })
childSession.append('assistant/message', {
  turn: 1,
  step: 1,
  message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  usage: { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 8000 },
}, { surfaceOp: 'append' })
childSession.append('turn/end', { turn: 1, reason: 'completed' })

// Terminal edge from the subagent seam.
ctx.emit('subagent/end', { runId: 'run-1', provider: 'spawn', id: 'sess-child', local: true, stopReason: 'completed' })

await sleep(150)

const events = rootSession.snapshotEvents()
const records = events.map(pluginRecordOf).filter(Boolean)
const agentsRecord = records.find((record) => record.type === 'plugin:savvy-progress/agents')

assert.ok(agentsRecord, 'agents record landed on the root session log')
const view = agentsRecord.data
assert.equal(view.rootId, 'sess-root')
assert.equal(view.agents.length, 1, 'exactly one child row (root excluded)')
const row = view.agents[0]
assert.equal(row.id, 'sess-child')
assert.equal(row.label, 'worker-auth')
assert.equal(row.status, 'finished')
assert.equal(row.model, 'deepseek-chat')
assert.equal(row.turns, 1)
assert.equal(row.toolCalls, 1)
assert.equal(row.inputTokens, 1200)
assert.equal(row.cacheReadTokens, 8000)
assert.equal(row.parentId, 'sess-root')
assert.ok(row.estimatedCost > 0, `cost estimated (${row.estimatedCost})`)
assert.ok(row.startedAt > 0 && row.finishedAt >= row.startedAt)

// Change detection: an identical state must not append a second record.
const before = events.length
await sleep(120)
assert.equal(rootSession.snapshotEvents().length, before, 'no duplicate snapshot while idle')

// A late usage event changes content and publishes again.
childSession.append('assistant/message', {
  turn: 2,
  step: 1,
  message: { role: 'assistant', content: [{ type: 'text', text: 'more' }] },
  usage: { inputTokens: 500, outputTokens: 60 },
}, { surfaceOp: 'append' })
await sleep(120)
const updated = rootSession.snapshotEvents().map(pluginRecordOf).filter(Boolean)
  .filter((record) => record.type === 'plugin:savvy-progress/agents').pop()
assert.equal(updated.data.agents[0].inputTokens, 1700, 'usage accumulates')

await fiber.dispose()

console.log('smoke OK — snapshots, lineage, usage, cost, change detection, and teardown all passed')
