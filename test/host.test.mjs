import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { cpSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, CATALOG_OPEN, Config, DEFAULT_HEADER, mergeConfigLayers } from '../index.js'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const FACTS = join(FIXTURES, 'facts.json')

function makeCtx({ systemPrompt, agents = true, webServer, settings, home = join(FIXTURES, 'no-home') } = {}) {
  const handlers = new Map()
  const logs = []
  const sections = []
  const ctx = {
    get(name) {
      if (name === 'systemPrompt') return systemPrompt
      if (name === 'agents') return agents ? {} : undefined
      if (name === 'webServer') return webServer
      if (name === 'settings') return settings
      if (name === 'dshHomePath') return () => home
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

function config(extra = {}) {
  return {
    sources: [{ id: 'env-facts', kind: 'facts', path: FACTS }],
    ...extra,
  }
}

function makeAgent(id = 'session-1', events = [], meta = {}) {
  return { id, session: { meta, snapshotEvents: () => events } }
}

async function runPreStep(handler, agent, turn = 1, step = 1) {
  return handler(
    { agent, turn, step, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
}

test('宿主注入：没有 systemPrompt 时退回会话消息，并且只注入一次', async () => {
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, config())
  assert.equal(typeof handlers.get('agent/pre-step'), 'function')
  const events = []
  const agent = makeAgent('session-1', events)

  const first = await runPreStep(handlers.get('agent/pre-step'), agent)
  assert.equal(first.messages.length, 1)
  assert.ok(first.messages[0].content[0].text.startsWith(CATALOG_OPEN))
  assert.equal(first.messages[0].source.kind, 'cardcatalog')

  events.push({
    type: 'user/message',
    data: { source: { kind: 'cardcatalog' }, content: first.messages[0].content },
  })
  const second = await runPreStep(handlers.get('agent/pre-step'), agent)
  assert.equal(second.messages.length, 0)
  assert.ok(logs.some((line) => line.includes('注入了 3 行')))
})

test('宿主注入：有 systemPrompt 时优先贡献 section', () => {
  const systemPrompt = {}
  const { ctx, handlers, sections } = makeCtx({ systemPrompt })
  apply(ctx, config())
  assert.equal(handlers.size, 0)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'cardcatalog')
  assert.equal(sections[0].interpolate, false)
  const text = sections[0].text()
  assert.ok(text.startsWith(CATALOG_OPEN))
  assert.ok(text.includes('[env-facts] node-not-on-path'))
})

test('宿主注入：没有 systemPrompt 也没有 agents 时明说没有接缝', () => {
  const { ctx, logs } = makeCtx({ agents: false })
  apply(ctx, config())
  assert.ok(logs.includes('cardcatalog：当前宿主没有可用的注入接缝，未注入任何记忆'))
})

test('宿主注入：没配 sources 时一行都不注入，日志是固定那句', () => {
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, { sources: [] })
  assert.equal(handlers.size, 0)
  assert.ok(logs.includes('cardcatalog：没配 sources，未注入任何记忆'))
})

test('宿主注入：子会话不注入', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, config())
  const agent = makeAgent('child', [], { parentSession: 'parent' })
  const decision = await runPreStep(handlers.get('agent/pre-step'), agent)
  assert.equal(decision.messages.length, 0)
})

test('config.json 是默认层：宿主显式值覆盖，schema 默认值不覆盖', () => {
  const fileConfig = {
    sources: [{ id: 'from-file' }],
    maxLines: 3,
    header: '文件标题',
  }
  const explicit = mergeConfigLayers(fileConfig, { sources: [{ id: 'from-host' }], maxLines: 5 }, true)
  assert.equal(explicit.sources[0].id, 'from-host')
  assert.equal(explicit.maxLines, 5)
  assert.equal(explicit.header, '文件标题')

  const validatedDefaults = mergeConfigLayers(fileConfig, {
    sources: [],
    maxLines: 7,
    header: DEFAULT_HEADER,
    everyNTurns: 0,
  }, false)
  assert.equal(validatedDefaults.sources[0].id, 'from-file')
  assert.equal(validatedDefaults.maxLines, 3)
  assert.equal(validatedDefaults.header, '文件标题')
})

test('没有 schemastery 时从家目录 config.json 读配置', { skip: Boolean(Config) }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'cardcatalog-home-'))
  const previous = process.env.CARDCATALOG_TEST_FACTS
  process.env.CARDCATALOG_TEST_FACTS = FACTS
  try {
    cpSync(join(FIXTURES, 'home'), home, { recursive: true })
    const { ctx, handlers } = makeCtx({ home })
    apply(ctx, {})
    const agent = makeAgent('session-file-config', [])
    const decision = await runPreStep(handlers.get('agent/pre-step'), agent)
    assert.equal(decision.messages.length, 1)
    assert.ok(decision.messages[0].content[0].text.includes('[env-facts] node-not-on-path'))
  } finally {
    if (previous === undefined) delete process.env.CARDCATALOG_TEST_FACTS
    else process.env.CARDCATALOG_TEST_FACTS = previous
    removeDir(home)
  }
})

function removeDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) removeDir(target)
    else unlinkSync(target)
  }
  rmdirSync(dir)
}

test('设置页接口：没配 sources 也能读状态；保存只走 settings.update', async () => {
  const routes = []
  const updates = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  const settings = {
    writable: true,
    async update(ns, patch) {
      updates.push({ ns, patch })
    },
  }
  const { ctx } = makeCtx({ webServer, settings })
  apply(ctx, { sources: [] })
  assert.equal(routes.length, 1)

  function makeRes() {
    return {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(name, value) { this.headers[name] = value },
      end(body) { this.body = body },
    }
  }

  const stateRes = makeRes()
  await routes[0].handler({ method: 'GET', url: '/api/cardcatalog/state' }, stateRes)
  const statePayload = JSON.parse(stateRes.body)
  assert.equal(statePayload.ok, true)
  assert.equal(statePayload.settingsAvailable, true)
  assert.equal(statePayload.config.sources.length, 0)

  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/api/cardcatalog/config'
  const configRes = makeRes()
  const pending = routes[0].handler(req, configRes)
  req.emit('data', Buffer.from(JSON.stringify({ config: config({ maxLines: 3 }) })))
  req.emit('end')
  await pending
  const saved = JSON.parse(configRes.body)
  assert.equal(saved.ok, true)
  assert.equal(saved.config.sources.length, 1)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].ns, 'cardcatalog')
  assert.equal(updates[0].patch.sources.length, 1)
})

test('宿主注入：every-n-turns 按间隔重复', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, config({ injectAt: 'every-n-turns', everyNTurns: 2 }))
  const events = []
  const agent = makeAgent('session-n', events)
  const handler = handlers.get('agent/pre-step')

  const turn1 = await runPreStep(handler, agent, 1)
  assert.equal(turn1.messages.length, 1)
  events.push({
    type: 'user/message',
    data: { source: { kind: 'cardcatalog' }, content: turn1.messages[0].content },
  })

  const turn2 = await runPreStep(handler, agent, 2)
  assert.equal(turn2.messages.length, 0)

  const turn3 = await runPreStep(handler, agent, 3)
  assert.equal(turn3.messages.length, 1)
})
