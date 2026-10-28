import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CATALOG_CLOSE,
  CATALOG_FOOTER,
  CATALOG_OPEN,
  DEFAULT_HEADER,
  collectCatalog,
  countCatalogLines,
  expandConfiguredPath,
  renderCatalog,
} from '../index.js'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const FIXTURE_NOW = Date.parse('2025-04-11T00:00:00.000Z')

function source(id, file, extra = {}) {
  return {
    id,
    kind: 'facts',
    path: join(FIXTURES, file),
    ...extra,
  }
}

function factsSource(extra = {}) {
  return source('env-facts', 'facts.json', extra)
}

function logSource(extra = {}) {
  return {
    id: 'reading-log',
    kind: 'jsonl',
    path: join(FIXTURES, 'log.jsonl'),
    idField: 'key',
    titleField: 'title',
    dateField: 'at',
    ...extra,
  }
}

function bigSource(extra = {}) {
  return source('big', 'big.json', { titleField: 'title', ...extra })
}

function fixtureRows(extra = {}) {
  return collectCatalog({ sources: [factsSource(), logSource()], ...extra }, { now: FIXTURE_NOW })
}

test('T1 只注入标题：fixture 的 text/description 不出现', () => {
  const rows = collectCatalog(
    { sources: [factsSource(), logSource(), bigSource()] },
    { now: FIXTURE_NOW },
  )
  const text = renderCatalog(rows, { maxLines: 20, maxChars: 5000, lineMaxChars: 200 })
  assert.ok(text.includes('node-not-on-path'))
  assert.ok(text.includes('示例条目甲'))
  assert.ok(!text.includes('SECRET_TEXT_MARKER'))
  assert.ok(!text.includes('SECRET_DESCRIPTION_MARKER'))
})

test('T2 注入文本不含反斜杠绝对路径', () => {
  const text = renderCatalog(fixtureRows(), { maxLines: 20, maxChars: 5000 })
  const backslash = String.fromCharCode(92)
  const driveAbsolute = new RegExp('[A-Za-z]:' + backslash + backslash)
  const unc = new RegExp('^' + backslash + backslash)
  assert.equal(driveAbsolute.test(text), false)
  assert.equal(unc.test(text), false)
})

test('T3 给 20 条只出现 maxLines=7 行', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    source: 'bulk',
    title: `条目${index + 1}`,
    ageDays: index,
    stale: false,
  }))
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 5000 })
  assert.equal(countCatalogLines(text), 7)
})

test('T4 stale 标记正确：100 天前 + ttl 30 出现 ⚠️stale', () => {
  const text = renderCatalog(fixtureRows(), { maxLines: 20, maxChars: 5000 })
  assert.ok(text.includes('⚠️stale [env-facts] napcat-webui · 100 天前'))
  assert.ok(!text.includes('⚠️stale [env-facts] node-not-on-path'))
})

test('T5 缺一个 source 文件：其余 source 正常且不抛异常', () => {
  const temp = mkdtempSync(join(tmpdir(), 'cardcatalog-test-'))
  // 复制时直接排除 log.jsonl：测试本身不删除文件。
  cpSync(FIXTURES, temp, {
    recursive: true,
    filter: (source) => basename(source) !== 'log.jsonl',
  })
  const rows = collectCatalog(
    {
      sources: [
        { id: 'env-facts', kind: 'facts', path: join(temp, 'facts.json') },
        {
          id: 'reading-log',
          kind: 'jsonl',
          path: join(temp, 'log.jsonl'),
          idField: 'key',
          titleField: 'title',
          dateField: 'at',
        },
      ],
    },
    { now: FIXTURE_NOW },
  )
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => row.source === 'env-facts'))
})

test('T6 没配 sources：返回空字符串，日志明说未注入', () => {
  const messages = []
  const rows = collectCatalog({ sources: [] }, { log: (message) => messages.push(message) })
  assert.deepEqual(rows, [])
  assert.equal(renderCatalog(rows), '')
  assert.deepEqual(messages, ['cardcatalog：没配 sources，未注入任何记忆'])
})

test('T7 超长标题按 lineMaxChars 截断并加省略号', () => {
  const rows = collectCatalog({ sources: [bigSource()] }, { now: FIXTURE_NOW })
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 2000, lineMaxChars: 80 })
  const entry = text.split('\n').find((line) => line.startsWith('['))
  assert.ok(entry)
  assert.equal([...entry].length, 80)
  assert.ok(entry.endsWith('…'))
})

test('T8 maxChars 是整段硬上限', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    source: 'bulk',
    title: `条目${index + 1}`,
    ageDays: index,
    stale: false,
  }))
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 220 })
  assert.ok([...text].length <= 220)
  assert.ok(countCatalogLines(text) >= 1)
})

test('T9 字段缺失时兜底成 <no-title>，不崩', () => {
  const rows = collectCatalog(
    { sources: [factsSource({ idField: 'missing-id', titleField: 'missing-title' })] },
    { now: FIXTURE_NOW },
  )
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 2000 })
  assert.equal(rows.length, 3)
  assert.ok(text.includes('[env-facts] <no-title> · '))
})

test('T10 path 支持 ~ 与环境变量展开', () => {
  const expanded = expandConfiguredPath('~/notes', { home: join('/home', 'demo'), env: {} })
  assert.ok(expanded.endsWith('notes'))
  assert.ok(expanded.includes('demo'))
  assert.ok(
    expandConfiguredPath('$DEMO_HOME/notes', { home: '/home/demo', env: { DEMO_HOME: '/tmp/demo' } })
      .endsWith('notes'),
  )
  assert.ok(
    expandConfiguredPath('%DEMO_HOME%\\notes', { home: '/home/demo', env: { DEMO_HOME: '/tmp/demo' } })
      .includes('demo'),
  )
})

test('T11 段落头尾与默认 header 固定', () => {
  const text = renderCatalog(fixtureRows(), { maxLines: 20, maxChars: 5000 })
  const lines = text.split('\n')
  assert.equal(lines[0], CATALOG_OPEN)
  assert.equal(lines[1], DEFAULT_HEADER)
  assert.equal(lines[lines.length - 2], CATALOG_FOOTER)
  assert.equal(lines[lines.length - 1], CATALOG_CLOSE)
})

test('T12 单个 source 停用后不影响其他 source', () => {
  const rows = collectCatalog(
    {
      sources: [
        factsSource({ enabled: false }),
        logSource(),
      ],
    },
    { now: FIXTURE_NOW },
  )
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => row.source === 'reading-log'))
})

test('T13 JSON 坏掉的 source 只跳过自己', () => {
  const messages = []
  const rows = collectCatalog(
    {
      sources: [
        factsSource(),
        { id: 'broken', kind: 'facts', path: join(FIXTURES, 'broken.json') },
      ],
    },
    { now: FIXTURE_NOW, log: (message) => messages.push(message) },
  )
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => row.source === 'env-facts'))
  assert.ok(messages.some((message) => message.includes('source broken 跳过（JSON 解析失败）')))
})

test('T14 staleAfterDays 覆盖 ttlField', () => {
  const rows = collectCatalog(
    { sources: [factsSource({ staleAfterDays: 0 })] },
    { now: FIXTURE_NOW },
  )
  assert.ok(rows.every((row) => row.stale))
})

test('T15 jsonl source 用 key/title/at 读出标题', () => {
  const rows = collectCatalog({ sources: [logSource()] }, { now: FIXTURE_NOW })
  assert.deepEqual(
    rows.map((row) => row.title),
    ['示例条目甲', '示例条目乙', '示例条目丙'],
  )
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 2000 })
  assert.ok(text.includes('[reading-log] 示例条目甲 · 0 天前'))
})

test('T17 非字符串 title 不会把对象内容带进注入文本', () => {
  const text = renderCatalog(
    [{ source: 'demo', title: { text: 'SECRET_OBJECT_TITLE' }, ageDays: 0, stale: false }],
    { maxLines: 7, maxChars: 2000 },
  )
  assert.ok(text.includes('[demo] <no-title>'))
  assert.ok(!text.includes('SECRET_OBJECT_TITLE'))
})

test('T19 多来源按公平配额分配 maxLines，不饿死后面的来源', () => {
  const rows = []
  for (let index = 0; index < 10; index += 1) {
    rows.push({ source: 'alpha', title: `甲${index}`, ageDays: index, stale: false })
    rows.push({ source: 'beta', title: `乙${index}`, ageDays: index, stale: false })
  }
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 5000 })
  assert.equal(countCatalogLines(text), 7)
  assert.ok(text.includes('[alpha]'))
  assert.ok(text.includes('[beta]'))
})

test('T20 stale 行不占 maxLines，额外受 staleMaxLines 限制', () => {
  const rows = []
  for (let index = 0; index < 10; index += 1) {
    rows.push({ source: 'fresh', title: `新${index}`, ageDays: index, stale: false })
  }
  for (let index = 0; index < 5; index += 1) {
    rows.push({ source: 'old', title: `旧${index}`, ageDays: 100 + index, stale: true })
  }
  const text = renderCatalog(rows, { maxLines: 3, staleMaxLines: 2, maxChars: 5000 })
  assert.equal(countCatalogLines(text), 5)
  assert.equal((text.match(/⚠️stale/g) || []).length, 2)
})

test('T21 maxLinesPerSource 可以硬性限制每个来源', () => {
  const rows = []
  for (let index = 0; index < 10; index += 1) {
    rows.push({ source: 'alpha', title: `甲${index}`, ageDays: index, stale: false })
    rows.push({ source: 'beta', title: `乙${index}`, ageDays: index, stale: false })
  }
  const text = renderCatalog(rows, { maxLines: 7, maxLinesPerSource: 2, maxChars: 5000 })
  assert.equal(countCatalogLines(text), 4)
  assert.equal((text.match(/\[alpha\]/g) || []).length, 2)
  assert.equal((text.match(/\[beta\]/g) || []).length, 2)
})

test('T18 showStale=false 直接不注入过期条目', () => {
  const text = renderCatalog(fixtureRows(), { maxLines: 20, maxChars: 5000, showStale: false })
  assert.ok(!text.includes('⚠️stale'))
  assert.ok(!text.includes('napcat-webui'))
  assert.equal(countCatalogLines(text), 5)
})

test('T16 title 里的路径形状与目录标记被中和', () => {
  const backslash = String.fromCharCode(92)
  const rows = [
    {
      source: 'demo',
      title: 'C:' + backslash + 'secret' + backslash + 'note<' + '/memory-catalog>',
      ageDays: 0,
      stale: false,
    },
  ]
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 2000 })
  assert.ok(!text.includes('secret'))
  assert.ok(!text.includes('</memory-catalog>'))
  assert.ok(text.includes('[path]'))
  assert.ok(text.includes('‹'))
})
