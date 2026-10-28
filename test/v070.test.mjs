import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  apply,
  collectCatalog,
  DEFAULTS,
  mergeConfigLayers,
  normalizeConfig,
  renderCatalog,
} from '../index.js'
import { appendArchive, expandArchivePath, runUpkeep } from '../upkeep.mjs'

const FIXTURES = fileURLToPath(new URL('../fixtures/upkeep/', import.meta.url))
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0)

function tempDir(prefix = 'cardcatalog-v070-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

function copyFixture(name, dir, target = 'now.md') {
  const file = join(dir, target)
  cpSync(join(FIXTURES, name), file)
  return file
}

function read(file) {
  return readFileSync(file, 'utf8')
}

function entryLines(text) {
  return text.split(/\r?\n/).filter((line) => line.startsWith('- '))
}

function sourceFor(file, dir, extra = {}) {
  return {
    id: 'now',
    kind: 'markdown',
    path: file,
    maxBytes: 700,
    allowRewrite: true,
    archivePath: join(dir, 'archive', 'now.md'),
    ...extra,
  }
}

function run(file, dir, extra = {}, options = {}) {
  return runUpkeep(sourceFor(file, dir, extra), {
    home: dir,
    keepPct: 50,
    now: NOW,
    ...options,
  })
}

function makeCtx({ systemPrompt, home }) {
  const handlers = new Map()
  const logs = []
  const sections = []
  const ctx = {
    get(name) {
      if (name === 'systemPrompt') return systemPrompt
      if (name === 'agents') return {}
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

function runPreStep(handler, agent, turn) {
  return handler(
    { agent, turn, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
}

test('U1 未超线：skipped，内容与 mtime 都不变', () => {
  // 默认对象、normalizeSource() 与面板模板三处同步的回归断言。
  assert.equal(DEFAULTS.source.allowRewrite, false)
  assert.equal(DEFAULTS.source.archivePath, '')
  assert.equal(DEFAULTS.upkeep.enabled, false)
  assert.equal(DEFAULTS.upkeep.keepPct, 60)
  const normalized = normalizeConfig({
    sources: [{ id: 'defaults', kind: 'markdown', path: 'defaults.md' }],
  }).sources[0]
  assert.equal(normalized.allowRewrite, false)
  assert.equal(normalized.archivePath, '')
  const merged = mergeConfigLayers(
    { upkeep: { enabled: true, keepPct: 50 } },
    { upkeep: { enabled: false, keepPct: 60 } },
    false,
  )
  assert.equal(merged.upkeep.enabled, true)
  assert.equal(merged.upkeep.keepPct, 50)

  const dir = tempDir()
  const file = copyFixture('small.md', dir)
  const beforeText = read(file)
  const beforeStat = statSync(file)
  const result = run(file, dir, { maxBytes: 5000 })
  const afterStat = statSync(file)

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'below-limit')
  assert.equal(read(file), beforeText)
  assert.equal(afterStat.size, beforeStat.size)
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs)
  assert.equal(existsSync(result.archivePath || join(dir, 'archive', 'now.md')), false)
})

test('U2 超线：归档新增行 + 源剩余条目行 == 原条目行', () => {
  const dir = tempDir()
  const file = copyFixture('over.md', dir)
  const originalText = read(file)
  const originalEntries = entryLines(originalText)
  const result = run(file, dir)

  assert.equal(result.status, 'archived')
  assert.ok(result.moved > 0)
  assert.ok(result.snapshot && existsSync(result.snapshot))
  assert.equal(read(result.snapshot), originalText)
  const archivedEntries = entryLines(read(result.archivePath))
  const remainingEntries = entryLines(read(file))
  assert.deepEqual([...archivedEntries, ...remainingEntries], originalEntries)
  assert.equal(archivedEntries.length, result.moved)
})

test('U3 文件头不被搬走，位置仍在最前', () => {
  const dir = tempDir()
  const file = copyFixture('over.md', dir)
  const result = run(file, dir)
  assert.equal(result.status, 'archived')

  const sourceLines = read(file).split(/\r?\n/)
  const archive = read(result.archivePath)
  const noteIndex = sourceLines.indexOf('> 这是一份用于归档测试的流水账。')
  const pointerIndex = sourceLines.findIndex((line) => line.startsWith('> 更早的 '))
  assert.equal(sourceLines[0], '# 近况')
  assert.ok(noteIndex > 0)
  assert.ok(pointerIndex > noteIndex)
  assert.ok(!archive.includes('# 近况'))
  assert.ok(!archive.includes('> 这是一份用于归档测试的流水账。'))
})

test('U4 指针对重：两次归档后只剩 1 行', () => {
  const dir = tempDir()
  const file = copyFixture('over.md', dir)
  const first = run(file, dir)
  assert.equal(first.status, 'archived')

  cpSync(join(FIXTURES, 'over-2.md'), file)
  const second = run(file, dir)
  assert.equal(second.status, 'archived')

  const pointers = read(file)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('> 更早的 '))
  assert.equal(pointers.length, 1)
})

test('U5 allowRewrite=false：即使超线也零写入', () => {
  const dir = tempDir()
  const file = copyFixture('over.md', dir)
  const before = read(file)
  const result = run(file, dir, { allowRewrite: false })

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'not-allowed')
  assert.equal(read(file), before)
  assert.equal(existsSync(join(dir, 'archive', 'now.md')), false)
})

test('U6 allowRewrite=true 但 archivePath 为空：skipped + 日志', () => {
  const dir = tempDir()
  const file = copyFixture('over.md', dir)
  const before = read(file)
  const logs = []
  const result = run(file, dir, { archivePath: '' }, { log: (message) => logs.push(message) })

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'missing-archive-path')
  assert.equal(read(file), before)
  assert.ok(logs.some((message) => message.includes('缺 archivePath')))
})

test('U7 核对失败注入：status=error，源文件一字节未变', () => {
  const dir = tempDir()
  const file = copyFixture('over.md', dir)
  const before = read(file)
  const result = runUpkeep(sourceFor(file, dir), {
    home: dir,
    keepPct: 50,
    now: NOW,
    archiveWriter(archive, text) {
      const parts = text.split('\n')
      parts.splice(parts.length - 2, 1)
      appendArchive(archive, parts.join('\n'))
    },
  })

  assert.equal(result.status, 'error')
  assert.equal(result.reason, 'verify-a')
  assert.equal(read(file), before)
})

test('U8 {YYYY-MM} 按当前本地月份展开', () => {
  const dir = tempDir()
  const file = copyFixture('over.md', dir)
  const template = join(dir, 'archive', 'now-{YYYY-MM}.md')
  const expected = expandArchivePath(template, NOW)
  const result = runUpkeep(sourceFor(file, dir, { archivePath: template }), {
    home: dir,
    keepPct: 50,
    now: NOW,
  })

  assert.equal(result.status, 'archived')
  assert.equal(result.archivePath, expected)
  assert.ok(existsSync(expected))
})

test('U9 pre-step 触发一次；归档后 recent 仍能读到最新 3 行', async () => {
  const dir = tempDir()
  const file = copyFixture('over.md', dir)
  const systemPrompt = {}
  const { ctx, handlers, logs } = makeCtx({ systemPrompt, home: dir })
  apply(ctx, {
    sources: [{
      id: 'notes',
      kind: 'markdown',
      path: file,
      maxBytes: 700,
      allowRewrite: true,
      archivePath: join(dir, 'archive', 'now.md'),
    }],
    upkeep: { enabled: true, keepPct: 50 },
    nudge: { enabled: false },
    tone: { enabled: false },
    wall: { enabled: false },
    decay: { enabled: false },
  })
  const handler = handlers.get('agent/pre-step')
  assert.equal(typeof handler, 'function')
  const agent = { id: 'upkeep-session', session: { meta: {}, snapshotEvents: () => [] } }
  const decision = await runPreStep(handler, agent, 1)
  assert.equal(decision.messages.length, 0)
  assert.ok(logs.some((message) => message.startsWith('upkeep：now.md ') && message.includes('搬了')))

  const rows = collectCatalog({
    sources: [{ id: 'recent', kind: 'markdown', path: file, tailLines: 3 }],
  })
  const text = renderCatalog(rows, { maxLines: 1, maxChars: 5000 })
  assert.ok(text.includes('示例条目 18'))
  assert.ok(text.includes('示例条目 19'))
  assert.ok(text.includes('示例条目 20'))
})
