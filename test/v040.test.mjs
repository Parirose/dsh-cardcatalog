import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  apply,
  buildTone,
  DEFAULT_TONE_HEADER,
  TONE_OPEN,
  TONE_SOURCE_KIND,
} from '../index.js'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))

function userEvent(text, seq) {
  return {
    type: 'user/message',
    seq,
    data: {
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    },
  }
}

function assistantEvent(text, seq) {
  return {
    type: 'assistant/message',
    seq,
    data: {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    },
  }
}

function checkpointEvent(seq) {
  return {
    type: 'user/message',
    seq,
    data: {
      source: { kind: 'compact-checkpoint' },
      content: [{ type: 'text', text: '摘要' }],
    },
  }
}

function injectedEvent(kind, seq) {
  return {
    type: 'user/message',
    seq,
    data: {
      source: { kind },
      content: [{ type: 'text', text: '注入物' }],
    },
  }
}

function toneConfig(extra = {}) {
  return {
    tone: {
      enabled: true,
      turns: 1,
      maxChars: 300,
      header: DEFAULT_TONE_HEADER,
      ...extra,
    },
  }
}

function makeCtx() {
  const handlers = new Map()
  const logs = []
  const ctx = {
    get(name) {
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
  return { ctx, handlers, logs }
}

function makeAgent(events, id = 'tone-session') {
  return { id, session: { meta: {}, snapshotEvents: () => events } }
}

function runPreStep(handler, agent, turn) {
  return handler(
    { agent, turn, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
}

test('T1 有压缩点且前有 1 轮原话：ok，含用户/助手且不含目录标记', () => {
  const events = [
    { ...userEvent('你好\n这是原话', 1), data: { source: { kind: 'user' }, content: '你好\n这是原话' } },
    assistantEvent('收到\n我会照这个语气', 2),
    checkpointEvent(3),
  ]
  const result = buildTone(toneConfig(), events)
  assert.equal(result.status, 'ok')
  assert.ok(result.block.startsWith(TONE_OPEN))
  assert.ok(result.block.includes('【用户】'))
  assert.ok(result.block.includes('【助手】'))
  assert.ok(!result.block.includes('<memory-catalog'))
  assert.equal(result.turns, 1)
})

test('T2 没有压缩点：no-checkpoint，不注入', () => {
  const result = buildTone(toneConfig(), [
    userEvent('原话', 1),
    assistantEvent('助手正文', 2),
  ])
  assert.deepEqual(result, { status: 'no-checkpoint' })
})

test('T3 压缩点之前只有注入物、没有真人消息：no-quotes，不注入', () => {
  const result = buildTone(toneConfig(), [
    injectedEvent('skill-catalog', 1),
    injectedEvent('runtime-context', 2),
    injectedEvent('agent-instructions', 3),
    checkpointEvent(4),
  ])
  assert.deepEqual(result, { status: 'no-quotes' })
})

test('T4 同一次压缩只注入一次，新压缩点再注入一次', async () => {
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, {
    sources: [],
    tone: { enabled: true, turns: 1, maxChars: 300 },
    wall: { enabled: false },
  })
  const handler = handlers.get('agent/pre-step')
  assert.equal(typeof handler, 'function')
  const events = [
    userEvent('原话', 1),
    assistantEvent('助手正文', 2),
    checkpointEvent(3),
  ]
  const agent = makeAgent(events, 'tone-once')

  const first = await runPreStep(handler, agent, 1)
  assert.equal(first.messages.length, 1)
  assert.equal(first.messages[0].source.kind, TONE_SOURCE_KIND)
  assert.equal(logs.filter((line) => line.startsWith('tone：会话 ')).length, 1)
  assert.ok(logs.some((line) => line.startsWith('tone：会话 3 条，压缩点 1 个，取到 1 轮原话')))
  assert.ok(logs.some((line) => line.startsWith('tone：注入了 1 轮原话')))
  const second = await runPreStep(handler, agent, 2)
  assert.equal(second.messages.length, 0)

  events.push(
    userEvent('第二次原话', 4),
    assistantEvent('第二次助手正文', 5),
    checkpointEvent(6),
  )
  const third = await runPreStep(handler, agent, 3)
  assert.equal(third.messages.length, 1)
  assert.equal(third.messages[0].source.kind, TONE_SOURCE_KIND)
  assert.ok(third.messages[0].content[0].text.includes('第二次原话'))
  assert.equal(logs.filter((line) => line.startsWith('tone：注入了')).length, 2)
})

test('T5 清洗：路径变 [path]，原话换行保留', () => {
  const backslash = String.fromCharCode(92)
  const fakePath = `C:${backslash}work${backslash}x.md`
  const text = `${fakePath}\n第二行\n\n\n第四行`
  const result = buildTone(toneConfig(), [
    { ...userEvent('', 1), data: { source: { kind: 'user' }, content: text } },
    checkpointEvent(2),
  ])
  assert.equal(result.status, 'ok')
  assert.ok(result.block.includes('[path]'))
  assert.ok(!result.block.includes(fakePath))
  assert.ok(result.block.includes('[path]\n第二行'))
  assert.ok(result.block.includes('第二行\n\n第四行'))
})

test('T6 超长原话：截断到 maxChars，并带 …（共 N 字）', () => {
  const text = '甲'.repeat(120)
  const result = buildTone(toneConfig({ maxChars: 20 }), [
    { ...userEvent('', 1), data: { source: { kind: 'user' }, content: text } },
    checkpointEvent(2),
  ])
  assert.equal(result.status, 'ok')
  const line = result.block.split('\n').find((value) => value.startsWith('【用户】'))
  assert.ok(line)
  const body = line.slice('【用户】'.length)
  assert.ok([...body].length <= 20)
  assert.ok(body.includes('…（共 120 字）'))
})
