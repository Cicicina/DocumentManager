/**
 * Markdown 提纯与 offset 双向映射（同构纯函数，不依赖任何运行时 API）。
 *
 * 本文件存在前端与云侧两份同构副本，两份源码逐字一致，修改必须同步。
 * 前端副本：common/utils/mm-text.js
 * 云侧副本：uniCloud-alipay/cloudfunctions/common/mm-common/lib/mm-text.js
 *
 * 为同时满足「前端 uni-app Vue3 / Vite 的 ES Module」与「云函数 / Node 单测
 * 的 CommonJS require」，本文件不写任何静态 import / export 语句，采用同构双挂载：
 *   - 云侧 / Node：require('./mm-text.js') 得到 { stripMarkdown, buildOffsetMap }；
 *   - 前端 H5：先副作用导入 `import '@/common/utils/mm-text.js'`，
 *     再从 globalThis.MmText 取到同一组函数（selection.js 即为该用法示范）。
 * 两份副本均可被 Node 直接 require，便于 QA 用同一段 md 断言输出完全一致。
 *
 * 提纯规则（架构 1.5）：依次剔除标题标记、强调标记、引用符、列表符、
 * 链接与图片的 URL 部分（保留文字）、行内代码反引号、代码块围栏与语言标识
 * （代码正文保留）、表格分隔行、HTML 标签、行首行尾多余空白；
 * 连续空白归一为单个空格，段落间保留单个换行。
 * 被剔除的每个标记字符都在 srcToPlain 中映射到「下一个保留字符」的下标。
 */

'use strict'

/** 判断是否为表格分隔行或水平分隔线 */
function isTableSeparatorLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.indexOf('-') === -1) return false
  return /^\|?[\s:\-|]+\|?$/.test(trimmed)
}

/** 去掉行首的标题 / 引用 / 列表标记，返回正文起点 */
function inlineStart(rawLine) {
  const heading = /^(\s*)(#{1,6})(\s+)/.exec(rawLine)
  if (heading) return heading[0].length
  let start = 0
  const quote = /^(\s*)(>\s?)+/.exec(rawLine)
  if (quote) start = quote[0].length
  const rest = rawLine.slice(start)
  const bullet = /^(\s*)([-*+]|\d+[.)])\s+/.exec(rest)
  if (bullet) start += bullet[0].length
  return start
}

/**
 * 扫描一行正文：剔除链接/图片 URL、HTML 标签、强调与反引号标记，
 * 其余字符连同其在 md 源码中的下标一起推入 emitted。
 */
function scanInline(rawLine, start, lineStart, emitted) {
  let k = start
  while (k < rawLine.length) {
    const ch = rawLine[k]

    // 图片 ![alt](url)：仅保留 alt 文字
    if (ch === '!' && rawLine[k + 1] === '[') {
      const image = /^!\[([^\]]*)\]\([^)]*\)/.exec(rawLine.slice(k))
      if (image) {
        const alt = image[1]
        for (let j = 0; j < alt.length; j++) {
          emitted.push({ ch: alt[j], src: lineStart + k + 2 + j })
        }
        k += image[0].length
        continue
      }
    }

    // 链接 [text](url)：仅保留 text
    if (ch === '[') {
      const link = /^\[([^\]]*)\]\([^)]*\)/.exec(rawLine.slice(k))
      if (link) {
        const label = link[1]
        for (let j = 0; j < label.length; j++) {
          emitted.push({ ch: label[j], src: lineStart + k + 1 + j })
        }
        k += link[0].length
        continue
      }
    }

    // HTML 标签整段剔除
    if (ch === '<') {
      const tag = /^<[^>]+>/.exec(rawLine.slice(k))
      if (tag) {
        k += tag[0].length
        continue
      }
    }

    // 双字符强调标记
    if ((ch === '*' && rawLine[k + 1] === '*') || (ch === '~' && rawLine[k + 1] === '~')) {
      k += 2
      continue
    }

    // 单字符强调 / 行内代码反引号
    if (ch === '*' || ch === '_' || ch === '`') {
      k += 1
      continue
    }

    emitted.push({ ch, src: lineStart + k })
    k += 1
  }
}

/**
 * 构造提纯纯文本与 md 源码之间的双向映射。
 * @param {string} src md 源码
 * @returns {{plainText: string, srcToPlain: Int32Array, plainToSrc: Int32Array}}
 */
function buildOffsetMap(src) {
  const source = typeof src === 'string' ? src : ''
  /** 保留字符及其源码下标 */
  const emitted = []
  const lines = source.split('\n')
  let lineStart = 0
  let inCodeBlock = false

  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li]
    const lineEnd = lineStart + rawLine.length

    if (/^\s*(`{3,}|~{3,})/.test(rawLine)) {
      // 代码块围栏行整行剔除（含语言标识），并切换代码块状态
      inCodeBlock = !inCodeBlock
    } else if (inCodeBlock) {
      // 代码正文保留，不应用任何 markdown 剔除规则
      for (let j = 0; j < rawLine.length; j++) {
        emitted.push({ ch: rawLine[j], src: lineStart + j })
      }
    } else if (isTableSeparatorLine(rawLine)) {
      // 表格分隔行整行剔除
    } else {
      scanInline(rawLine, inlineStart(rawLine), lineStart, emitted)
    }

    // 行间换行：源码中 '\n' 的下标就是 lineEnd
    if (li < lines.length - 1) {
      emitted.push({ ch: '\n', src: lineEnd })
    }
    lineStart = lineEnd + 1
  }

  // 空白归一：连续空格折叠为单个空格，连续换行折叠为单个换行，去掉行尾空格
  const normalized = []
  for (let i = 0; i < emitted.length; i++) {
    const item = emitted[i]
    if (item.ch === '\n') {
      if (normalized.length === 0) continue
      if (normalized[normalized.length - 1].ch === '\n') continue
      if (normalized[normalized.length - 1].ch === ' ') normalized.pop()
      normalized.push(item)
      continue
    }
    if (item.ch === ' ' || item.ch === '\t' || item.ch === '\r') {
      if (normalized.length === 0) continue
      const last = normalized[normalized.length - 1]
      if (last.ch === ' ' || last.ch === '\n') continue
      normalized.push({ ch: ' ', src: item.src })
      continue
    }
    normalized.push(item)
  }
  while (normalized.length > 0) {
    const last = normalized[normalized.length - 1]
    if (last.ch === ' ' || last.ch === '\n') normalized.pop()
    else break
  }

  const plainText = normalized.map(item => item.ch).join('')

  // plainToSrc[j]：plainText 第 j 个字符回溯到 md 源码的下标；末尾哨兵为源码长度
  const plainToSrc = new Int32Array(plainText.length + 1)
  for (let j = 0; j < normalized.length; j++) {
    plainToSrc[j] = normalized[j].src
  }
  plainToSrc[plainText.length] = source.length

  // srcToPlain[i]：源码第 i 个字符对应 plainText 的下标；被剔除的标记字符
  // 映射到「下一个保留字符」的下标，末尾哨兵为 plainText 长度。
  const srcToPlain = new Int32Array(source.length + 1)
  let j = 0
  for (let i = 0; i <= source.length; i++) {
    while (j < plainText.length && plainToSrc[j] < i) j++
    srcToPlain[i] = j
  }

  return { plainText, srcToPlain, plainToSrc }
}

/**
 * 把 md 源码提纯为纯文本（唯一的 offset 坐标系）。
 * @param {string} src md 源码
 * @returns {string} plainText
 */
function stripMarkdown(src) {
  return buildOffsetMap(src).plainText
}

const MmText = { stripMarkdown, buildOffsetMap, isTableSeparatorLine, inlineStart, scanInline }

// CommonJS：云函数 require('mm-common/lib/mm-text.js') 与 Node 本地单测
if (typeof module !== 'undefined' && module && typeof module.exports !== 'undefined') {
  module.exports = MmText
}

// 前端 H5：副作用导入后从全局单例取同一组纯函数
if (typeof globalThis !== 'undefined') {
  globalThis.MmText = MmText
}
