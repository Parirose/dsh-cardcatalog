import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const NUDGE = join(FIXTURES, 'nudge')
const HOUR = 60 * 60 * 1000

function makeCtx(webServer) {
  const handlers = new Map()
  const logs = []
  const ctx = {
    get(name) {
      if (name === 'agents') return {}
      if (name === 'webServer') return webServer
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
  return { ctx, handlers, logs }
}

function makeAgent(id) {
  return { id, session: { meta: {}, snapshotEvents: () => [] } }
}

function runPreStep(handler, agent, turn) {
  return handler(
    { agent, turn, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
}

/** 把近况文件 mtime 拨到 4 小时前，模拟 9 轮 pre-step，返回真正注入 nudge 的轮次。 */
async function triggerRounds(nudgeConfig) {
  const temp = mkdtempSync(join(tmpdir(), 'cardcatalog-v030-'))
  cpSync(NUDGE, temp, { recursive: true })
  const file = join(temp, 'now.md')
  const old = new Date(Date.now() - 4 * HOUR)
  utimesSync(file, old, old)
  const { ctx, handlers } = makeCtx()
  apply(ctx, {
    sources: [],
    nudge: {
      enabled: true,
      file,
      text: '提醒',
      ...nudgeConfig,
    },
  })
  const handler = handlers.get('agent/pre-step')
  assert.equal(typeof handler, 'function')
  const agent = makeAgent(`v030-${file}`)
  const rounds = []
  for (let turn = 1; turn <= 9; turn += 1) {
    const decision = await runPreStep(handler, agent, turn)
    const messages = Array.isArray(decision.messages) ? decision.messages : []
    if (messages.some((message) => message?.source?.kind === 'cardcatalog-nudge')) {
      rounds.push(String(turn))
    }
  }
  return rounds
}

test('v0.3 情形 A：staleAfterHours=3 + alsoEveryNTurns=3 → 1、4、7', async () => {
  const rounds = await triggerRounds({ staleAfterHours: 3, alsoEveryNTurns: 3 })
  assert.deepEqual(rounds, ['1', '4', '7'])
})

test('v0.3 情形 B：staleAfterHours=6 + alsoEveryNTurns=3 → 无', async () => {
  const rounds = await triggerRounds({ staleAfterHours: 6, alsoEveryNTurns: 3 })
  assert.deepEqual(rounds, [])
})

test('v0.3 情形 C：staleAfterHours=3，不写 alsoEveryNTurns → 1', async () => {
  const rounds = await triggerRounds({ staleAfterHours: 3 })
  assert.deepEqual(rounds, ['1'])
})
