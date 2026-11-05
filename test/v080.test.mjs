import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { renderMemoryCard, collectViewEntries, DEFAULT_VIEW } from '../index.js'
import { writeDerivedView } from '../upkeep.mjs'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'cardcatalog-view-'))
}

test('renderMemoryCard：头部写死派生物与重建命令', () => {
  const text = renderMemoryCard(
    [
      { chapter: '环境', title: 'a', body: '甲', meta: '验证于 2026-01-01' },
      { chapter: '工具', title: 'b', body: '乙', meta: '' },
    ],
    { title: '视图', rebuild: 'node tools/export-view.mjs', stamp: '2026-01-02 03:04', fingerprint: 'abc123' },
  )
  assert.match(text, /^# 视图\n/)
  assert.match(text, /这是派生物，不要手改/)
  assert.match(text, /重建：`node tools\/export-view\.mjs`/)
  assert.match(text, /生成时间 2026-01-02 03:04 · 源头指纹 abc123/)
  assert.ok(text.includes('## 环境'))
  assert.ok(text.includes('## 工具'))
  assert.ok(text.includes('### a'))
  assert.ok(text.includes('验证于 2026-01-01'))
})

test('renderMemoryCard：章内保持传入顺序，空输入不炸', () => {
  const text = renderMemoryCard([
    { chapter: 'A', title: 'first', body: '', meta: '' },
    { chapter: 'A', title: 'second', body: '', meta: '' },
  ])
  assert.ok(text.indexOf('### first') < text.indexOf('### second'))
  assert.equal(renderMemoryCard([]).startsWith('# '), true)
})

test('collectViewEntries：默认关时返回空数组', () => {
  assert.deepEqual(collectViewEntries({}), [])
  assert.deepEqual(collectViewEntries({ view: { enabled: false } }), [])
  assert.equal(DEFAULT_VIEW.enabled, false)
})

test('writeDerivedView：写两个文件，内容原样', () => {
  const dir = tempDir()
  try {
    const result = writeDerivedView(dir, { '记忆卡.md': '# 一\n', '日记/2026-01-01.md': '# 二\n' })
    assert.equal(result.status, 'written')
    assert.equal(result.written.length, 2)
    assert.equal(readFileSync(join(dir, '记忆卡.md'), 'utf8'), '# 一\n')
    assert.equal(readFileSync(join(dir, '日记', '2026-01-01.md'), 'utf8'), '# 二\n')
    assert.equal(existsSync(join(dir, '记忆卡.md.tmp')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeDerivedView：拒绝绝对路径与 ..', () => {
  const dir = tempDir()
  try {
    assert.equal(writeDerivedView(dir, { '/etc/passwd': 'x' }).status, 'error')
    assert.equal(writeDerivedView(dir, { '../escape.md': 'x' }).status, 'error')
    assert.equal(writeDerivedView(dir, { 'C:/windows/x.md': 'x' }).status, 'error')
    assert.equal(writeDerivedView('', { 'a.md': 'x' }).status, 'skipped')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeDerivedView：不碰目录里已有的其它文件', () => {
  const dir = tempDir()
  try {
    writeDerivedView(dir, { 'a.md': 'one\n' })
    writeDerivedView(dir, { 'b.md': 'two\n' })
    assert.equal(readFileSync(join(dir, 'a.md'), 'utf8'), 'one\n')
    assert.equal(readFileSync(join(dir, 'b.md'), 'utf8'), 'two\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
