#!/usr/bin/env node
/**
 * 仓库零个人数据检查。
 *
 * 扫三类：
 *   1. 盘符绝对路径（含 JSON 里双反斜杠的写法）
 *   2. >=32 位连续十六进制串（token 形状）
 *   3. ci/privacy-deny.txt 里的自定义词表
 *
 * README Credits 允许的 URL 记在 ci/privacy-allowlist.txt；命中白名单的整行跳过。
 * 输出只报位置和类别，不回显命中的内容。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.dsh-market'])
const SKIP_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'SHA256SUMS.txt',
  'ci/check-privacy.mjs',
  'ci/privacy-deny.txt',
  'ci/privacy-allowlist.txt',
])

const DRIVE = new RegExp('[A-Za-z]:' + '\\\\' + '{1,2}')
const TOKEN = /[0-9a-fA-F]{32,}/

function readLines(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

const ALLOWLIST = readLines(join(ROOT, 'ci', 'privacy-allowlist.txt'))
const DENY = readLines(join(ROOT, 'ci', 'privacy-deny.txt')).map((word) => word.toLowerCase())

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesDeny(line, word) {
  // 英文词按词边界匹配，避免 LICENSE 里的普通英文单词误命中；中文词仍按子串。
  if (/^[a-z0-9_-]+$/.test(word)) {
    return new RegExp('(^|[^a-z0-9_])' + escapeRegExp(word) + '([^a-z0-9_]|$)', 'i').test(line)
  }
  return line.toLowerCase().includes(word)
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), out)
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  for (const byte of sample) if (byte === 0) return true
  return false
}

const hits = []
for (const file of walk(ROOT, [])) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  if (SKIP_FILES.has(rel)) continue
  let buffer
  try {
    buffer = readFileSync(file)
  } catch {
    continue
  }
  if (isBinary(buffer)) continue
  const lines = buffer.toString('utf8').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (ALLOWLIST.some((allowed) => line.includes(allowed))) continue
    if (DRIVE.test(line)) hits.push({ rel, line: index + 1, kind: 'drive-absolute-path' })
    if (TOKEN.test(line)) hits.push({ rel, line: index + 1, kind: 'token-shaped-hex' })
    for (const word of DENY) {
      if (matchesDeny(line, word)) hits.push({ rel, line: index + 1, kind: `deny-word:${word}` })
    }
  }
}

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
if (!readme.includes('## 设计启发（Credits）')) {
  hits.push({ rel: 'README.md', line: 0, kind: 'missing-credits-heading' })
}
if (!readme.includes('本插件不含下列项目的任何代码或数据')) {
  hits.push({ rel: 'README.md', line: 0, kind: 'missing-credits-disclaimer' })
}

if (hits.length > 0) {
  for (const hit of hits) {
    console.error(`FAIL ${hit.rel}:${hit.line} ${hit.kind}`)
  }
  console.error(`check:privacy: ${hits.length} 处命中`)
  process.exit(1)
}
console.log('check:privacy: 0 处命中')
