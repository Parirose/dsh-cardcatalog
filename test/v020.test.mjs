import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync, existsSync, mkdtempSync, readdirSync, rmdirSync, statSync, unlinkSync, utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildNudge,
  collectCatalog,
  countCatalogLines,
  inspectNudge,
  inspectSources,
  NUDGE_OPEN,
  renderCatalog,
} from '../index.js'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const MARKDOWN = join(FIXTURES, 'markdown')
const NUDGE = join(FIXTURES, 'nudge')
const HOUR = 60 * 60 * 1000

function markdownSource(extra = {}) {
  return {
    id: 'notes',
    kind: 'markdown',
    path: join(MARKDOWN, 'preferences.md'),
    ...extra,
  }
}

function factSource() {
  return { id: 'env-facts', kind: 'facts', path: join(FIXTURES, 'facts.json') }
}

function removeDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) removeDir(target)
    else unlinkSync(target)
  }
  rmdirSync(dir)
}

function fixtureStats(dir = FIXTURES) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...fixtureStats(target))
    } else {
      const stat = statSync(target)
      out.push({ path: target, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  return out
}

test('T7 markdown + sections：只出现指定小节，不出现其他小节', () => {
  const rows = collectCatalog({
    sources: [markdownSource({ sections: ['称呼与偏好'] })],
  })
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 5000 })
  assert.ok(text.includes('· notes / 称呼与偏好'))
  assert.ok(text.includes('示例偏好 A'))
  assert.ok(text.includes('示例偏好 B'))
  assert.ok(!text.includes('SECRET_OTHER_SECTION_MARKER'))
  assert.ok(!text.includes('示例状态 A'))
  assert.equal(countCatalogLines(text), 1)
})

test('T8 markdown + tailLines：只出现末尾 N 行', () => {
  const rows = collectCatalog({
    sources: [markdownSource({ path: join(MARKDOWN, 'tail.md'), tailLines: 2 })],
  })
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 5000 })
  assert.ok(text.includes('第四行'))
  assert.ok(text.includes('第五行'))
  assert.ok(!text.includes('第一行'))
  assert.ok(!text.includes('第二行'))
})

test('T9 markdown 截断：单源正文不超过 maxChars，并以 … 结尾', () => {
  const rows = collectCatalog({
    sources: [markdownSource({ path: join(MARKDOWN, 'long.md'), sections: ['长小节'], maxChars: 300 })],
  })
  assert.equal(rows.length, 1)
  assert.ok([...rows[0].body].length <= 300)
  assert.ok(rows[0].body.endsWith('…'))

  const text = renderCatalog(rows, { maxLines: 7, maxChars: 300 })
  assert.ok([...text].length <= 300)
  assert.ok(text.includes('…'))
})

test('T10 小节一个都没命中：跳过该源，其他源正常，日志有说明', () => {
  const messages = []
  const rows = collectCatalog({
    sources: [
      markdownSource({ sections: ['不存在的小节'] }),
      factSource(),
    ],
  }, { log: (message) => messages.push(message) })
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => row.source === 'env-facts'))
  assert.ok(messages.some((message) => message.includes('没命中任何小节：不存在的小节')))
})

test('T11 引用块与 HTML 注释不进入输出', () => {
  const rows = collectCatalog({
    sources: [markdownSource({ sections: ['称呼与偏好'] })],
  })
  const text = renderCatalog(rows, { maxLines: 7, maxChars: 5000 })
  assert.ok(!text.includes('SECRET_QUOTE_MARKER'))
  assert.ok(!text.includes('SECRET_COMMENT_MARKER'))
  assert.ok(!text.includes('不会进入提示词'))
})

test('T12 nudge：未过期不注入；10 小时前注入且小时/最后一行正确', () => {
  const temp = mkdtempSync(join(tmpdir(), 'cardcatalog-nudge-'))
  cpSync(NUDGE, temp, { recursive: true })
  const file = join(temp, 'now.md')
  const now = Date.now()
  const template = '「{file}」最后更新在 {hours} 小时前（{lastLine}）。如果这一轮有新进展，结尾补一行。'
  const config = {
    nudge: {
      enabled: true,
      file,
      staleAfterHours: 6,
      text: template,
      maxChars: 200,
      alsoEveryNTurns: 0,
    },
  }
  try {
    const fresh = buildNudge(config, { now })
    assert.equal(fresh, null)

    const tenHoursAgo = new Date(now - 10 * HOUR)
    utimesSync(file, tenHoursAgo, tenHoursAgo)
    const built = buildNudge(config, { now })
    assert.ok(built)
    assert.equal(built.hours, 10)
    assert.ok(built.text.includes('10 小时前'))
    assert.ok(built.text.includes('示例条目：下一步验证占位方案'))
    assert.ok(built.block.startsWith(NUDGE_OPEN))
    assert.equal(built.block.split('\n').length, 3)
  } finally {
    removeDir(temp)
  }
})

test('T13 nudge 文件不存在：不注入、不建文件、日志一行', () => {
  const file = join(NUDGE, 'not-there.md')
  if (existsSync(file)) unlinkSync(file)
  const messages = []
  const built = buildNudge({
    nudge: {
      enabled: true,
      file,
      staleAfterHours: 0,
      text: '「{file}」最后更新在 {hours} 小时前。',
    },
  }, { log: (message) => messages.push(message) })
  assert.equal(built, null)
  assert.equal(existsSync(file), false)
  assert.ok(messages.some((message) => message.includes('nudge 文件不存在')))
  assert.equal(inspectNudge({ nudge: { enabled: true, file } }).status, 'missing')
})

test('T14 没配 sources：目录为空，状态卡仍能返回', () => {
  const rows = collectCatalog({ sources: [] })
  assert.deepEqual(rows, [])
  assert.equal(renderCatalog(rows), '')
  assert.deepEqual(inspectSources({ sources: [] }), [])
  assert.equal(inspectSources({ sources: [] }).length, 0)
})

test('T15 只读断言：fixture 的大小与 mtime 在读取前后不变', () => {
  const before = fixtureStats(FIXTURES)
  const config = {
    sources: [
      markdownSource({ sections: ['称呼与偏好'] }),
      markdownSource({ id: 'tail', path: join(MARKDOWN, 'tail.md'), tailLines: 2 }),
      factSource(),
    ],
    nudge: {
      enabled: true,
      file: join(NUDGE, 'now.md'),
      staleAfterHours: 0,
      text: '「{file}」最后更新在 {hours} 小时前。',
    },
  }
  const rows = collectCatalog(config)
  renderCatalog(rows, { maxLines: 20, maxChars: 5000 })
  inspectSources(config)
  buildNudge(config, { now: Date.now() + 10 * HOUR })
  const after = fixtureStats(FIXTURES)
  assert.deepEqual(after, before)
})
