#!/usr/bin/env node
/**
 * 只读断言：源码里不允许出现对账本路径的写 API。
 *
 * 这里不判断“写的是哪条路径”——只要出现这些 API 就红。测试里删临时 fixture
 * 用的是 unlinkSync，不在名单内。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.dsh-market'])
const CODE_EXT = /\.(?:js|mjs|cjs)$/

// 拼起来，避免检查脚本自身命中自己的字面量。
const NAMES = [
  'write' + 'File',
  'append' + 'File',
  'createWrite' + 'Stream',
  'mk' + 'dir',
  'r' + 'm',
]
const FORBIDDEN = new RegExp('\\b(?:' + NAMES.join('|') + ')(?:Sync)?\\b')

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
for (const file of walk(ROOT, [])) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (FORBIDDEN.test(lines[index])) hits.push({ rel, line: index + 1 })
  }
}

if (hits.length > 0) {
  for (const hit of hits) console.error(`FAIL ${hit.rel}:${hit.line} read-only violation`)
  console.error(`check:readonly: ${hits.length} 处命中`)
  process.exit(1)
}
console.log('check:readonly: 0 处命中')
