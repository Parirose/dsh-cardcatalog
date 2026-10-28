#!/usr/bin/env node
/**
 * 可审计的白名单：
 *   1. 写 API 只允许出现在 upkeep.mjs；其他任何 .js/.mjs（含测试）出现即红。
 *   2. upkeep.mjs 必须同时包含 snapshot / verify / 原子替换，防止五步流程被简化。
 *   3. 结果必须打印白名单说明。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWED = 'upkeep.mjs'
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.dsh-market'])
const CODE_EXT = /\.(?:js|mjs|cjs)$/

// 拼起来，避免检查脚本自身命中自己的字面量。
const NAMES = [
  'write' + 'File',
  'append' + 'File',
  'createWrite' + 'Stream',
  'ren' + 'ame',
  'copy' + 'File',
  'un' + 'link',
  'mk' + 'dir',
  'trun' + 'cate',
]
const FORBIDDEN = new RegExp('\\b(?:' + NAMES.join('|') + ')(?:Sync)?\\b')
const REQUIRED = ['snap' + 'shot', 'ver' + 'ify', 'rena' + 'meSync']

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), out)
    } else if (entry.isFile() && CODE_EXT.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

const hits = []
const allowedFile = join(ROOT, ALLOWED)
for (const file of walk(ROOT, [])) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  if (file === allowedFile) continue
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (FORBIDDEN.test(lines[index])) hits.push({ rel, line: index + 1 })
  }
}

let allowedText = ''
try {
  allowedText = readFileSync(allowedFile, 'utf8')
} catch {
  // 下面统一报错。
}
const missing = REQUIRED.filter((word) => !allowedText.includes(word))

if (hits.length > 0 || missing.length > 0) {
  for (const hit of hits) console.error(`FAIL ${hit.rel}:${hit.line} read-only violation`)
  if (missing.length > 0) {
    console.error(`FAIL ${ALLOWED} 缺必要步骤：${missing.join(', ')}`)
  }
  const count = hits.length + (missing.length > 0 ? 1 : 0)
  console.error(`check:readonly: ${count} 处越界（白名单：${ALLOWED}）`)
  process.exit(1)
}
console.log(`check:readonly: 0 处越界（白名单：${ALLOWED}）`)
