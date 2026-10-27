#!/usr/bin/env node
/**
 * Schema 放置检查：构造一次 Config，让 schemastery 自己跑 volatile 校验。
 *
 * 这条检查专门防 v0.4.0 那类错误：对象级已标 volatile，子字段又标一次。
 * 普通单测在 Config === undefined 时根本不会构造 schema，所以必须单独跑。
 *
 * 解析不到 schemastery 时明确输出 skipped，不能静默通过。
 */
import { Config, createConfigSchema, loadSchemastery } from '../index.js'

const schema = Config ? undefined : await loadSchemastery()
if (!Config && !schema) {
  console.log('check:schema: skipped (schemastery not resolvable)')
  process.exit(0)
}

let target
try {
  target = Config ?? createConfigSchema(schema)
  // 触发 Schema.resolve -> validateVolatileSchema。空配置即可。
  target({})
} catch (error) {
  const path = Array.isArray(error?.path) ? error.path.join('.') : ''
  const at = path ? ` at ${path}` : ''
  console.error(`check:schema: FAIL ${error?.name || 'Error'}: ${error?.message || String(error)}${at}`)
  process.exit(1)
}
console.log('check:schema: 0 errors')
