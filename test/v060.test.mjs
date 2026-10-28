import test from 'node:test'
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  apply,
  clarityOf,
  DECAY_OPEN,
  DECAY_SOURCE_KIND,
  DEFAULTS,
  inspectDecay,
  mergeConfigLayers,
  normalizeConfig,
  redlineOf,
  renderDecayLine,
} from '../index.js'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

function decayConfig(extra = {}) {
  return {
    decay: {
      enabled: true,
      graceDays: 14,
      stepDays: 21,
      recoverDays: 30,
      maxRecover: 2,
      ...extra,
    },
  }
}

function makeCtx({ systemPrompt } = {}) {
  const handlers = new Map()
  const logs = []
  const sections = []
  const ctx = {
    get(name) {
      if (name === 'systemPrompt') return systemPrompt
      if (name === 'agents') return {}
      if (name === 'dshHomePath') return () => join(FIXTURES, 'no-home')
      return undefined
    },
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    effect(effect) {
      effect()
    },
    logger() {
      return { info: (message) => logs.push(message) }
    },
  }
  if (systemPrompt) {
    systemPrompt.section = (section) => {
      sections.push(section)
      return () => {}
    }
  }
  return { ctx, handlers, logs, sections }
}

function runPreStep(handler, agent, turn) {
  return handler(
    { agent, turn, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
}

test('D1 grace 内保持 vivid', () => {
  const result = clarityOf(
    { verifiedAt: NOW - 10 * DAY, importance: 50 },
    decayConfig(),
    [],
    NOW,
  )
  assert.equal(result.level, 0)
  assert.equal(result.clarity, 'vivid')
  assert.equal(result.reason, 'ok')
  assert.equal(result.importance, 50)
})

test('D2 过 grace 后逐档下降，封顶 trace', () => {
  const fact = (ageDays) => ({ verifiedAt: NOW - ageDays * DAY, importance: 40 })
  const justOver = clarityOf(fact(14 + 0.1), decayConfig(), [], NOW)
  const second = clarityOf(fact(14 + 21 + 0.1), decayConfig(), [], NOW)
  const third = clarityOf(fact(14 + 42 + 0.1), decayConfig(), [], NOW)
  const capped = clarityOf(fact(200), decayConfig(), [], NOW)

  assert.equal(justOver.level, 1)
  assert.equal(justOver.clarity, 'clear')
  assert.equal(second.level, 2)
  assert.equal(second.clarity, 'fuzzy')
  assert.equal(third.level, 3)
  assert.equal(third.clarity, 'trace')
  assert.equal(capped.level, 3)
})

test('D3 importance >= 80 最差停在 clear', () => {
  const result = clarityOf(
    { verifiedAt: NOW - 200 * DAY, importance: 85 },
    decayConfig(),
    [],
    NOW,
  )
  assert.equal(result.importance, 85)
  assert.equal(result.maxLevel, 1)
  assert.equal(result.level, 1)
  assert.equal(result.clarity, 'clear')
})

test('D4 低重要度且足够老会到 trace', () => {
  const result = clarityOf(
    { verifiedAt: NOW - 200 * DAY, scope: 'tool' },
    decayConfig(),
    [],
    NOW,
  )
  assert.equal(result.importance, 45)
  assert.equal(result.maxLevel, 3)
  assert.equal(result.level, 3)
  assert.equal(result.clarity, 'trace')
})

test('D5 recoverDays 内的命中回升，且不超过 maxRecover', () => {
  // 命中既会推进 lastSeen，也会计入 recover；要让“回升一档”可见，
  // recoverDays 必须覆盖到仍然足够老的命中。
  const config = decayConfig({ recoverDays: 90 })
  const fact = { verifiedAt: NOW - (14 + 42 + 1) * DAY, importance: 40 }
  const oneHit = clarityOf(fact, config, [NOW - 56 * DAY], NOW)
  assert.equal(oneHit.level, 2)
  assert.equal(oneHit.clarity, 'fuzzy')

  const manyHits = clarityOf(
    fact,
    config,
    [NOW - 56 * DAY, NOW - 57 * DAY, NOW - 58 * DAY, NOW - 59 * DAY, NOW - 60 * DAY],
    NOW,
  )
  assert.equal(manyHits.level, 1)
  assert.equal(manyHits.clarity, 'clear')

  const staleHit = clarityOf(fact, config, [NOW - 120 * DAY], NOW)
  assert.equal(staleHit.level, 3)
})

test('D6 verifiedAt 缺失不猜日期；pinned 恒定 vivid', () => {
  const missing = clarityOf({ importance: 90 }, decayConfig(), [], NOW)
  assert.equal(missing.level, 0)
  assert.equal(missing.clarity, 'vivid')
  assert.equal(missing.reason, 'no-date')

  const pinned = clarityOf(
    { verifiedAt: NOW - 200 * DAY, pinned: true, importance: 10 },
    decayConfig(),
    [],
    NOW,
  )
  assert.equal(pinned.level, 0)
  assert.equal(pinned.clarity, 'vivid')
  assert.equal(pinned.reason, 'pinned')
})

test('D7 红线 off / warn / over 三态', () => {
  // DEFAULTS.source 与 normalizeSource() 必须同步；面板模板里也展示这两个字段。
  assert.equal(DEFAULTS.source.maxBytes, 0)
  assert.equal(DEFAULTS.source.warnPct, 80)
  const normalized = normalizeConfig({
    sources: [{ id: 'defaults', kind: 'markdown', path: 'defaults.md' }],
  }).sources[0]
  assert.equal(normalized.maxBytes, 0)
  assert.equal(normalized.warnPct, 80)

  // CONFIG_KEYS / isBuiltInDefault 漏 decay 时，文件层会被 schema 默认值盖掉。
  const merged = mergeConfigLayers(
    { decay: { enabled: false, graceDays: 1 } },
    {
      decay: {
        enabled: true,
        graceDays: 14,
        stepDays: 21,
        recoverDays: 30,
        maxRecover: 2,
        importanceByScope: { self: 90, project: 70, machine: 55, tool: 45, default: 50 },
      },
    },
    false,
  )
  assert.equal(merged.decay.enabled, false)
  assert.equal(merged.decay.graceDays, 1)

  const config = {
    sources: [
      { id: 'off', kind: 'markdown', path: 'off.md', maxBytes: 0 },
      { id: 'warn', kind: 'markdown', path: 'warn.md', maxBytes: 1000, warnPct: 80 },
      { id: 'over', kind: 'markdown', path: 'over.md', maxBytes: 1000, warnPct: 80 },
    ],
  }
  const sizes = { off: 5000, warn: 850, over: 1200 }
  const result = redlineOf(config, (source) => ({ size: sizes[source.id] }))
  assert.deepEqual(result, [
    { id: 'off', bytes: 5000, pct: null, maxBytes: 0, state: 'off' },
    { id: 'warn', bytes: 850, pct: 85, maxBytes: 1000, state: 'warn' },
    { id: 'over', bytes: 1200, pct: 120, maxBytes: 1000, state: 'over' },
  ])
})

test('D8 renderDecayLine：空串 / 条数与百分比 / pre-step 注入与同日去重', async () => {
  assert.equal(renderDecayLine({
    dropped: [],
    redline: [{ label: 'now.md', bytes: 100, pct: 50, maxBytes: 200, state: 'ok' }],
  }), '')

  const line = renderDecayLine({
    dropped: [
      { clarity: 'fuzzy' },
      { clarity: 'fuzzy' },
      { clarity: 'trace' },
    ],
    redline: [{ label: 'now.md', bytes: 3182, pct: 78, maxBytes: 4096, state: 'warn' }],
  })
  assert.ok(line.startsWith(DECAY_OPEN))
  assert.ok(line.includes('3182 B'))
  assert.ok(line.includes('78%'))
  assert.ok(line.includes('3 条事实降档'))
  assert.ok(line.includes('2→模糊'))
  assert.ok(line.includes('1→印象'))

  // 跨档检测：把上一次观测到的档位整体调低一级，当前应全部算“降档”。
  const factsPath = join(FIXTURES, 'facts.json')
  const baseline = inspectDecay({ sources: [{ id: 'facts', kind: 'facts', path: factsPath }] })
  const previous = new Map(
    [...baseline.levels].map(([key, level]) => [key, Math.max(0, level - 1)]),
  )
  const changed = inspectDecay(
    { sources: [{ id: 'facts', kind: 'facts', path: factsPath }] },
    { previousLevels: previous },
  )
  assert.equal(changed.dropped.length, baseline.totalFacts)
  assert.ok(changed.dropped.every((item) => item.to > item.from))

  const markdownPath = join(FIXTURES, 'markdown', 'preferences.md')
  const size = statSync(markdownPath).size
  const maxBytes = Math.ceil(size / 0.85)
  const systemPrompt = {}
  const { ctx, handlers, logs } = makeCtx({ systemPrompt })
  apply(ctx, {
    sources: [{
      id: 'notes',
      kind: 'markdown',
      path: markdownPath,
      maxBytes,
      warnPct: 80,
    }],
    nudge: { enabled: false },
    tone: { enabled: false },
    wall: { enabled: false },
  })
  const handler = handlers.get('agent/pre-step')
  assert.equal(typeof handler, 'function')
  const events = []
  const agent = { id: 'decay-session', session: { meta: {}, snapshotEvents: () => events } }

  const first = await runPreStep(handler, agent, 1)
  assert.equal(first.messages.length, 1)
  assert.equal(first.messages[0].source.kind, DECAY_SOURCE_KIND)
  assert.equal(first.messages[0].source.form, 'decay')
  assert.ok(first.messages[0].content[0].text.startsWith(DECAY_OPEN))
  assert.ok(logs.some((message) => message.startsWith('decay：vivid 0 / clear 0 / fuzzy 0 / trace 0')))
  assert.ok(logs.some((message) => message.startsWith('redline：')))

  const second = await runPreStep(handler, agent, 2)
  assert.equal(second.messages.length, 0)
})
