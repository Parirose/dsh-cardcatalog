/**
 * 受控归档改写：唯一允许写用户文件的模块。
 *
 * 五步：快照 → 写归档 → 逐行核对 → 原子替换 → 留指针。
 * 任何一步失败都返回 {status:'error'}，绝不抛到调用方；源文件在核对通过前不动。
 */

import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'

const POINTER_RE = /^> 更早的 \d+ 条已归档到/

function pad(value) {
  return String(value).padStart(2, '0')
}

function localParts(now) {
  const date = new Date(now)
  const year = String(date.getFullYear())
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  return {
    year,
    month,
    day,
    monthKey: `${year}-${month}`,
    dateKey: `${year}-${month}-${day}`,
    stamp: `${year}${month}${day}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  }
}

function sourceLabel(source) {
  const file = typeof source?.path === 'string' ? source.path : ''
  return file ? basename(file) : 'source'
}

function safeLog(log, message) {
  if (typeof log !== 'function') return
  try {
    log(message)
  } catch {
    // 日志失败不影响归档流程。
  }
}

function splitLines(text) {
  const eol = text.includes('\r\n') ? '\r\n' : (text.includes('\r') ? '\r' : '\n')
  const endsWithEol = text.length > 0 && text.endsWith(eol)
  let lines = text.split(eol)
  if (endsWithEol) lines = lines.slice(0, -1)
  return { lines, eol, endsWithEol }
}

function joinLines(lines, eol, endsWithEol) {
  if (lines.length === 0) return ''
  return lines.join(eol) + (endsWithEol ? eol : '')
}

function pointerLine(count, archivePath, now) {
  const parts = localParts(now)
  return `> 更早的 ${count} 条已归档到 \`${archivePath}\`（${parts.dateKey} 自动搬）`
}

export function backupDir(home) {
  return join(home, 'cardcatalog', 'backups')
}

/** 把 {YYYY-MM} 换成本地月份；不做别的路径猜测。 */
export function expandArchivePath(template, now = Date.now()) {
  if (typeof template !== 'string' || template === '') return ''
  return template.replaceAll('{YYYY-MM}', localParts(now).monthKey)
}

/** 默认的归档追加器；测试可以注入一个少写一行的版本。 */
export function appendArchive(file, text) {
  appendFileSync(file, text, 'utf8')
}

function snapshotPath(sourcePath, now, home) {
  const parts = localParts(now)
  const base = basename(sourcePath, extname(sourcePath)) || 'source'
  const dir = backupDir(home)
  let candidate = join(dir, `${base}-${parts.stamp}.md`)
  let index = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}-${parts.stamp}-${index}.md`)
    index += 1
  }
  return candidate
}

function writeAndSync(file, text) {
  const fd = openSync(file, 'w')
  try {
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function rollbackArchive(archivePath, before, existed) {
  try {
    if (existed) {
      truncateSync(archivePath, Buffer.byteLength(before, 'utf8'))
    } else if (existsSync(archivePath)) {
      unlinkSync(archivePath)
    }
  } catch {
    // 回滚失败也不能影响“源文件不动”的主承诺。
  }
}

/**
 * 对一个 markdown 源执行归档。调用方负责 check upkeep.enabled / allowRewrite。
 *
 * @param {object} source
 * @param {{home?: string, keepPct?: number, now?: number,
 *   log?: (message: string) => void, archiveWriter?: (file: string, text: string) => void}} [options]
 * @returns {{status: 'skipped'|'archived'|'error', reason?: string, moved?: number,
 *   sizeBefore?: number, sizeAfter?: number, snapshot?: string, archivePath?: string, at?: number}}
 */
export function runUpkeep(source, options = {}) {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  const label = sourceLabel(source)
  const log = options.log
  const skip = (reason, extra = {}) => ({ status: 'skipped', reason, at: now, ...extra })
  const fail = (reason, extra = {}) => {
    safeLog(log, `upkeep：${label} 归档失败（${reason}）`)
    return { status: 'error', reason, at: now, ...extra }
  }

  try {
    if (!source || source.kind !== 'markdown') return skip('not-markdown')
    if (source.allowRewrite !== true) return skip('not-allowed')
    if (!source.archivePath) {
      safeLog(log, `upkeep：${label} 缺 archivePath，跳过`)
      return skip('missing-archive-path')
    }

    const maxBytes = Number(source.maxBytes)
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) return skip('no-limit')
    let beforeStat
    try {
      beforeStat = statSync(source.path)
    } catch {
      return fail('source-missing')
    }
    if (beforeStat.size <= maxBytes) return skip('below-limit')

    const archivePath = expandArchivePath(source.archivePath, now)
    if (!archivePath) {
      safeLog(log, `upkeep：${label} 缺 archivePath，跳过`)
      return skip('missing-archive-path')
    }
    if (resolve(archivePath) === resolve(source.path)) {
      return fail('archive-same-as-source')
    }

    let text
    try {
      text = readFileSync(source.path, 'utf8')
    } catch {
      return fail('read-failed')
    }
    const { lines, eol, endsWithEol } = splitLines(text)
    const headEnd = lines.findIndex((line) => line.startsWith('- '))
    if (headEnd < 0) return skip('no-entries')
    const head = lines.slice(0, headEnd).filter((line) => !POINTER_RE.test(line))
    const entries = lines.slice(headEnd)
    if (entries.length === 0) return skip('no-entries')

    const keepPct = Math.min(90, Math.max(10, Number.isFinite(Number(options.keepPct))
      ? Number(options.keepPct)
      : 60))
    const targetBytes = (maxBytes * keepPct) / 100
    let moveCount = 0
    for (let index = 1; index <= entries.length; index += 1) {
      const candidate = joinLines(
        [...head, pointerLine(index, archivePath, now), ...entries.slice(index)],
        eol,
        endsWithEol,
      )
      if (Buffer.byteLength(candidate, 'utf8') <= targetBytes) {
        moveCount = index
        break
      }
    }
    if (moveCount === 0) {
      // 文件头 + 指针本身就超过 keepPct，搬空了也回不到目标；不要越搬越大。
      return skip('cannot-reach-target')
    }
    const movedLines = entries.slice(0, moveCount)
    const remainingEntries = entries.slice(moveCount)

    // 第 1 步：快照。失败就中止，源文件不动。
    const home = typeof options.home === 'string' && options.home ? options.home : process.env.DSH_HOME
    if (!home) return fail('missing-home')
    const snapshot = snapshotPath(source.path, now, home)
    try {
      mkdirSync(dirname(snapshot), { recursive: true })
      copyFileSync(source.path, snapshot)
    } catch {
      return fail('snapshot-failed')
    }
    safeLog(log, `upkeep：${label} 快照 ${snapshot}`)

    // 第 3 步：只 append。已有归档绝不覆盖、不重排。
    let beforeArchive = ''
    let archiveExisted = false
    try {
      archiveExisted = existsSync(archivePath)
      if (archiveExisted) beforeArchive = readFileSync(archivePath, 'utf8')
    } catch {
      return fail('archive-read-failed')
    }
    const separator = beforeArchive && !beforeArchive.endsWith(eol) ? eol : ''
    const appendText = `${separator}${movedLines.join(eol)}${eol}`
    try {
      mkdirSync(dirname(archivePath), { recursive: true })
      const writer = typeof options.archiveWriter === 'function'
        ? options.archiveWriter
        : appendArchive
      writer(archivePath, appendText)
    } catch {
      rollbackArchive(archivePath, beforeArchive, archiveExisted)
      return fail('archive-write-failed')
    }

    // 第 4 步：核对 A / B / C。任一失败就回滚归档，源文件一个字节不动。
    let afterArchive
    try {
      afterArchive = readFileSync(archivePath, 'utf8')
    } catch {
      rollbackArchive(archivePath, beforeArchive, archiveExisted)
      return fail('verify-a')
    }
    const tail = afterArchive.slice(Math.max(0, afterArchive.length - appendText.length))
    const added = splitLines(appendText).lines
    if (added[0] === '') added.shift()
    if (!afterArchive.startsWith(beforeArchive)
      || tail !== appendText
      || added.length !== movedLines.length
      || added.some((line, index) => line !== movedLines[index])) {
      rollbackArchive(archivePath, beforeArchive, archiveExisted)
      return fail('verify-a')
    }
    if (remainingEntries.length !== entries.length - movedLines.length
      || remainingEntries.some((line, index) => line !== entries[movedLines.length + index])) {
      rollbackArchive(archivePath, beforeArchive, archiveExisted)
      return fail('verify-b')
    }
    let afterStat
    try {
      afterStat = statSync(source.path)
    } catch {
      rollbackArchive(archivePath, beforeArchive, archiveExisted)
      return fail('verify-c')
    }
    if (afterStat.size !== beforeStat.size || afterStat.mtimeMs !== beforeStat.mtimeMs) {
      rollbackArchive(archivePath, beforeArchive, archiveExisted)
      return fail('verify-c')
    }

    // 第 5 步：文件头 + 指针 + 剩余条目；先写 tmp，fsync，再 rename。
    const pointer = pointerLine(movedLines.length, archivePath, now)
    const nextText = joinLines([...head, pointer, ...remainingEntries], eol, endsWithEol)
    const tmp = `${source.path}.upkeep-tmp`
    try {
      writeAndSync(tmp, nextText)
      renameSync(tmp, source.path)
    } catch {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        // 临时文件清理失败不影响源文件。
      }
      rollbackArchive(archivePath, beforeArchive, archiveExisted)
      return fail('replace-failed')
    }

    let sizeAfter
    try {
      sizeAfter = statSync(source.path).size
    } catch {
      sizeAfter = 0
    }
    safeLog(
      log,
      `upkeep：${label} ${beforeStat.size} → ${sizeAfter} B，搬了 ${movedLines.length} 行到 ${archivePath}`,
    )
    return {
      status: 'archived',
      moved: movedLines.length,
      sizeBefore: beforeStat.size,
      sizeAfter,
      snapshot,
      archivePath,
      at: now,
    }
  } catch {
    return fail('unexpected')
  }
}
