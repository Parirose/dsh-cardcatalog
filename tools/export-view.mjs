#!/usr/bin/env node
/**
 * 把目录投成派生档案（视图导出）。
 *
 * 用法：
 *   node tools/export-view.mjs                 # 读 ~/.dsh/cardcatalog/config.json
 *   node tools/export-view.mjs --config <路径>
 *   node tools/export-view.mjs --dry-run       # 只打印，不写盘
 *
 * 纪律：
 *   · 只读源文件；写盘一律交给 upkeep.writeDerivedView（唯一写盘出口）
 *   · 全量重写派生文件，不做增量
 *   · 头部写死「派生物 / 勿手改 / 重建命令 / 指纹」
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { collectViewEntries, renderMemoryCard } from '../index.js'
import { writeDerivedView } from '../upkeep.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const configPath = resolve(value('config', join(home, 'cardcatalog', 'config.json')))

if (!existsSync(configPath)) {
  console.error(`没找到配置：${configPath}`)
  process.exit(2)
}

let raw
try {
  raw = JSON.parse(readFileSync(configPath, 'utf8'))
} catch (error) {
  console.error(`配置不是合法 JSON：${configPath}`)
  process.exit(2)
}

const view = raw && typeof raw === 'object' ? raw.view : undefined
if (!view || view.enabled !== true) {
  console.error('view 未启用：在配置里设 "view": { "enabled": true, "dir": "<目录>" }')
  process.exit(3)
}
if (typeof view.dir !== 'string' || view.dir.trim() === '') {
  console.error('view.dir 为空：派生档案要写到哪里？')
  process.exit(3)
}

// 源头指纹：把每个 source 文件的 sha256 前 12 位拼起来
function fingerprintOf(config) {
  const sources = Array.isArray(config?.sources) ? config.sources : []
  const parts = []
  for (const source of sources) {
    const file = typeof source?.path === 'string' ? source.path.replace(/^~/, homedir()) : ''
    if (!file) continue
    try {
      const digest = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)
      parts.push(`${source.id || 'src'}:${digest}`)
    } catch {
      parts.push(`${source.id || 'src'}:missing`)
    }
  }
  return parts.join(' ')
}

const entries = collectViewEntries(raw, { log: (m) => console.log(m) })
if (entries.length === 0) {
  console.error('没有任何条目可导出（检查 sources 是否启用、字段名对不对）')
  process.exit(4)
}

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

const text = renderMemoryCard(entries, {
  title: typeof view.title === 'string' && view.title ? view.title : undefined,
  rebuild: typeof view.rebuild === 'string' && view.rebuild
    ? view.rebuild
    : 'node tools/export-view.mjs',
  stamp,
  fingerprint: fingerprintOf(raw),
})

if (flag('dry-run')) {
  process.stdout.write(text)
  console.error(`\n（dry-run：${entries.length} 条，未写盘）`)
  process.exit(0)
}

const result = writeDerivedView(view.dir, { '记忆卡.md': text })
if (result.status !== 'written') {
  console.error(`写派生档案失败：${result.reason || result.status}`)
  process.exit(5)
}
console.log(`导出完成：${entries.length} 条 → ${join(resolve(view.dir), '记忆卡.md')}`)
console.log(`指纹：${fingerprintOf(raw)}`)
