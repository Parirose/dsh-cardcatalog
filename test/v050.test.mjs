import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  apply,
  buildWall,
  DEFAULTS,
  DEFAULT_WALL,
  DEFAULT_WALL_HEADER,
  mergeConfigLayers,
  TONE_SOURCE_KIND,
  WALL_OPEN,
  WALL_SOURCE_KIND,
} from '../index.js'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const NOW = 1_700_000_000_000

function userEvent(text, seq, time) {
  const event = {
    type: 'user/message',
    seq,
    data: {
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    },
  }
  if (time !== undefined) event.time = time
  return event
}

function assistantEvent(text, seq, time) {
  const event = {
    type: 'assistant/message',
    seq,
    data: {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    },
  }
  if (time !== undefined) event.time = time
  return event
}

function checkpointEvent(seq, time) {
  const event = {
    type: 'user/message',
    seq,
    data: {
      source: { kind: 'compact-checkpoint' },
      content: [{ type: 'text', text: '摘要' }],
    },
  }
  if (time !== undefined) event.time = time
  return event
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

function wallConfig(extra = {}) {
  return {
    wall: {
      enabled: true,
      turns: 2,
      header: DEFAULT_WALL_HEADER,
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

function makeAgent(events, id = 'wall-session') {
  return { id, session: { meta: {}, snapshotEvents: () => events } }
}

function runPreStep(handler, agent, turn) {
  return handler(
    { agent, turn, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
}

test('W1 没有压缩点：no-checkpoint，不注入', async () => {
  const result = buildWall(wallConfig(), [
    userEvent('原话', 1),
    assistantEvent('助手正文', 2),
  ])
  assert.deepEqual(result, { status: 'no-checkpoint' })

  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, { sources: [], wall: { enabled: true }, tone: { enabled: false } })
  const handler = handlers.get('agent/pre-step')
  assert.equal(typeof handler, 'function')
  const decision = await runPreStep(handler, makeAgent([userEvent('原话', 1)]), 1)
  assert.equal(decision.messages.length, 0)
  assert.ok(logs.includes('wall：没有压缩点，跳过'))
})

test('W2 有压缩点：ok，含条数、tone.cmd 与「不要说出去」', async () => {
  const events = [
    userEvent('原话', 1),
    assistantEvent('助手正文', 2),
    checkpointEvent(3, NOW - 5 * 60 * 1000),
  ]
  const result = buildWall(wallConfig(), events, { now: NOW })
  assert.equal(result.status, 'ok')
  assert.ok(result.block.startsWith(WALL_OPEN))
  assert.ok(result.block.includes('压缩点之前：2 条事件 / 1 条真人消息'))
  assert.ok(result.block.includes('tone.cmd'))
  assert.ok(result.block.includes('--turns 2'))
  assert.ok(result.block.includes('不要说出去'))
  assert.ok(!result.block.includes('摘要'))

  const { ctx, handlers } = makeCtx()
  apply(ctx, { sources: [], wall: { enabled: true, turns: 2 }, tone: { enabled: false } })
  const decision = await runPreStep(handlers.get('agent/pre-step'), makeAgent(events), 1)
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].source.kind, WALL_SOURCE_KIND)
  assert.equal(decision.messages[0].source.form, 'wall')
})

test('W3 eventsBefore / userBefore 用下标和真人消息计数', () => {
  const events = [
    userEvent('第一条', 1),
    assistantEvent('助手正文', 2),
    injectedEvent('skill-catalog', 3),
    userEvent('第二条', 4),
    checkpointEvent(5, NOW - 42 * 60 * 1000),
  ]
  const result = buildWall(wallConfig(), events, { now: NOW })
  assert.equal(result.status, 'ok')
  assert.equal(result.checkpoints, 1)
  assert.equal(result.eventsBefore, 4)
  assert.equal(result.userBefore, 2)
  assert.equal(result.minutesAgo, 42)
  assert.equal(result.turns, 2)
  assert.ok(result.block.includes('压缩点之前：4 条事件 / 2 条真人消息'))
  assert.ok(result.block.includes('最后一次在 42 分钟前'))
})

test('W4 同一个压缩点只注入一次', async () => {
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, { sources: [], wall: { enabled: true }, tone: { enabled: false } })
  const handler = handlers.get('agent/pre-step')
  const events = [userEvent('原话', 1), checkpointEvent(2, Date.now())]
  const agent = makeAgent(events, 'wall-once')

  const first = await runPreStep(handler, agent, 1)
  assert.equal(first.messages.length, 1)
  assert.equal(first.messages[0].source.kind, WALL_SOURCE_KIND)
  assert.equal(logs.filter((line) => line.startsWith('wall：压缩 ')).length, 1)

  // 进程内先靠 wallCheckpoints 去重。
  const second = await runPreStep(handler, agent, 2)
  assert.equal(second.messages.length, 0)

  // 模拟宿主把注入物写回事件流；重启后靠 hasWallAfterCheckpoint 去重。
  events.push({
    type: 'user/message',
    seq: 3,
    data: { source: first.messages[0].source, content: first.messages[0].content },
  })
  const third = await runPreStep(handler, agent, 3)
  assert.equal(third.messages.length, 0)
  assert.equal(logs.filter((line) => line.startsWith('wall：压缩 ')).length, 1)
})

test('W5 出现新压缩点：再注入一次', async () => {
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, { sources: [], wall: { enabled: true }, tone: { enabled: false } })
  const handler = handlers.get('agent/pre-step')
  const events = [userEvent('原话', 1), checkpointEvent(2, Date.now())]
  const agent = makeAgent(events, 'wall-new-checkpoint')

  const first = await runPreStep(handler, agent, 1)
  assert.equal(first.messages.length, 1)
  events.push({
    type: 'user/message',
    seq: 3,
    data: { source: first.messages[0].source, content: first.messages[0].content },
  })
  events.push(
    userEvent('第二次原话', 4, Date.now()),
    checkpointEvent(5, Date.now()),
  )

  const second = await runPreStep(handler, agent, 2)
  assert.equal(second.messages.length, 1)
  assert.equal(second.messages[0].source.kind, WALL_SOURCE_KIND)
  assert.ok(second.messages[0].content[0].text.includes('本会话已压缩 2 次'))
  assert.equal(logs.filter((line) => line.startsWith('wall：压缩 ')).length, 2)
})

test('W6 缺少 time：不写「分钟前」，其余照写且仍是 ok', async () => {
  const events = [
    userEvent('原话', 1),
    checkpointEvent(2),
  ]
  const result = buildWall(wallConfig(), events)
  assert.equal(result.status, 'ok')
  assert.equal(result.minutesAgo, null)
  assert.ok(!result.block.includes('分钟前'))
  assert.ok(result.block.includes('本会话已压缩 1 次。'))
  assert.ok(result.block.includes('压缩点之前：1 条事件 / 1 条真人消息'))

  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, { sources: [], wall: { enabled: true }, tone: { enabled: false } })
  const decision = await runPreStep(handlers.get('agent/pre-step'), makeAgent(events), 1)
  assert.equal(decision.messages.length, 1)
  assert.ok(logs.includes('wall：压缩 1 次，注入一次'))
})

test('W7 wall 在 tone 之前', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, {
    sources: [],
    wall: { enabled: true, turns: 1 },
    tone: { enabled: true, turns: 1 },
  })
  const events = [
    userEvent('原话', 1),
    assistantEvent('助手正文', 2),
    checkpointEvent(3, Date.now()),
  ]
  const decision = await runPreStep(handlers.get('agent/pre-step'), makeAgent(events), 1)
  assert.equal(decision.messages.length, 2)
  assert.equal(decision.messages[0].source.kind, WALL_SOURCE_KIND)
  assert.equal(decision.messages[1].source.kind, TONE_SOURCE_KIND)
  assert.ok(decision.messages[0].content[0].text.startsWith(WALL_OPEN))
  assert.ok(decision.messages[1].content[0].text.includes('【用户】'))
})

test('W8 wall 三处同步：默认层、保存键、内置默认判断', () => {
  assert.equal(DEFAULTS.wall.enabled, DEFAULT_WALL.enabled)
  assert.equal(DEFAULTS.wall.turns, DEFAULT_WALL.turns)
  assert.equal(DEFAULTS.wall.header, DEFAULT_WALL_HEADER)

  // CONFIG_KEYS 漏 wall -> 文件层的 wall 会被 schema 默认值盖掉；
  // isBuiltInDefault 漏 wall -> 同样不会回退到文件层。
  const fileConfig = {
    wall: { enabled: false, turns: 1, header: '自定义痕迹' },
  }
  const schemaDefaults = {
    wall: { enabled: true, turns: 2, header: DEFAULT_WALL_HEADER },
  }
  const merged = mergeConfigLayers(fileConfig, schemaDefaults, false)
  assert.equal(merged.wall.enabled, false)
  assert.equal(merged.wall.turns, 1)
  assert.equal(merged.wall.header, '自定义痕迹')
})
