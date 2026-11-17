/**
 * 正文索引分块与关键词提取（纯函数，不依赖 uniCloud 运行时，可被 Node 直接 require 单测）。
 *
 * 规则（架构 C6 / PRD Q5）：按 Markdown 标题分块，heading 取标题提纯文本；
 * 块内超过 1000 字符按固定长度切片，相邻切片重叠 100 字符；
 * start_offset / end_offset 均为相对全文提纯文本 plainText 的字符偏移；
 * revision = 保存后的文件 version；每次保存按 file_id 先删后插重建全部分块。
 */

'use strict'

const { CHUNK_MAX_LEN, CHUNK_OVERLAP } = require('./constants.js')
const { stripMarkdown, buildOffsetMap } = require('./mm-text.js')

/** 中英文常见停用词，提取关键词时剔除 */
const STOP_WORDS = new Set([
  '的', '了', '和', '是', '在', '有', '与', '及', '或', '这', '那', '中', '为', '对', '以',
  '等', '也', '就', '都', '而', '并', '一个', '我们', '可以', '使用', '以及', '通过', '进行',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'with', 'as',
  'be', 'this', 'that', 'by', 'are', 'from', 'at', 'not', 'but', 'if', 'then', 'not'
])

/** 单个分块最多返回的关键词数 */
const KEYWORD_LIMIT = 12

/**
 * 把文本切成候选词：英文/数字单词 + 中文连续串的 2-gram。
 * @param {string} text 输入文本
 * @returns {string[]}
 */
function tokenize(text) {
  const source = typeof text === 'string' ? text : ''
  const tokens = []
  const words = source.match(/[a-zA-Z][a-zA-Z0-9_-]*/g) || []
  for (const word of words) {
    tokens.push(word.toLowerCase())
  }
  const chineseParts = source.match(/[\u4e00-\u9fa5]{2,}/g) || []
  for (const part of chineseParts) {
    for (let i = 0; i < part.length - 1; i++) {
      tokens.push(part.slice(i, i + 2))
    }
  }
  return tokens
}

/**
 * 提取关键词：标题词加权 + 正文高频实词，去停用词后取前 12 个。
 * @param {string} heading 标题文本
 * @param {string} content 分块提纯文本
 * @returns {string[]} 关键词数组
 */
function extractKeywords(heading, content) {
  const counts = new Map()
  const headingText = typeof heading === 'string' ? heading : ''
  const bodyText = typeof content === 'string' ? content : ''

  for (const token of tokenize(headingText)) {
    if (STOP_WORDS.has(token)) continue
    counts.set(token, (counts.get(token) || 0) + 5)
  }
  for (const token of tokenize(bodyText)) {
    if (STOP_WORDS.has(token)) continue
    counts.set(token, (counts.get(token) || 0) + 1)
  }

  return Array.from(counts.entries())
    .filter(entry => entry[0].length >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, KEYWORD_LIMIT)
    .map(entry => entry[0])
}

/**
 * 从 md 源码中收集标题边界，并换算到 plainText 坐标。
 * @param {string} source md 源码
 * @param {Int32Array} srcToPlain 源码 → plainText 映射
 * @param {number} plainLength plainText 长度
 * @returns {{heading:string, offset:number}[]}
 */
function collectHeadings(source, srcToPlain, plainLength) {
  const headings = []
  const lines = source.split('\n')
  let cursor = 0
  let inCodeBlock = false

  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock
      cursor += line.length + 1
      continue
    }
    const match = inCodeBlock ? null : /^(\s*)(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      const prefixLength = match[0].length - match[3].length
      const srcIndex = Math.min(Math.max(cursor + prefixLength, 0), srcToPlain.length - 1)
      const offset = Math.min(Math.max(srcToPlain[srcIndex], 0), plainLength)
      headings.push({ heading: stripMarkdown(match[3]).trim(), offset })
    }
    cursor += line.length + 1
  }
  return headings
}

/**
 * 构造索引分块记录。
 * @param {string} plainText 全文提纯文本（唯一坐标系）
 * @param {string} mdSource md 源码（用于识别标题边界）
 * @param {number} revision 保存后的文件 version
 * @param {string} fileId 文档 ID
 * @param {string} userId 所属用户
 * @returns {object[]} 分块记录数组，可直接写入 mm-index-chunks
 */
function buildChunks(plainText, mdSource, revision, fileId, userId) {
  const plain = typeof plainText === 'string' ? plainText : ''
  const source = typeof mdSource === 'string' ? mdSource : ''
  const rev = Number.isFinite(Number(revision)) ? Number(revision) : 0
  const fid = fileId === null || fileId === undefined ? '' : String(fileId)
  const uid = userId === null || userId === undefined ? '' : String(userId)

  const { srcToPlain } = buildOffsetMap(source)
  const headings = collectHeadings(source, srcToPlain, plain.length)

  // 按标题切段；首个标题之前的正文单独成段（heading 为空）
  const sections = []
  if (headings.length === 0) {
    if (plain.trim().length > 0) sections.push({ heading: '', start: 0, end: plain.length })
  } else {
    if (headings[0].offset > 0) {
      sections.push({ heading: '', start: 0, end: headings[0].offset })
    }
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].offset
      const end = i + 1 < headings.length ? headings[i + 1].offset : plain.length
      sections.push({ heading: headings[i].heading, start, end })
    }
  }

  const chunks = []
  const step = Math.max(1, CHUNK_MAX_LEN - CHUNK_OVERLAP)
  let sequence = 1

  for (const section of sections) {
    const start = Math.max(0, Math.min(section.start, plain.length))
    const end = Math.max(start, Math.min(section.end, plain.length))
    if (end <= start) continue

    for (let from = start; from < end; from += step) {
      const to = Math.min(from + CHUNK_MAX_LEN, end)
      const content = plain.slice(from, to)
      if (content.trim().length === 0) {
        if (to >= end) break
        continue
      }
      chunks.push({
        chunk_id: `${fid}#${sequence}`,
        file_id: fid,
        user_id: uid,
        heading: section.heading,
        content,
        keywords: extractKeywords(section.heading, content),
        start_offset: from,
        end_offset: to,
        revision: rev
      })
      sequence += 1
      if (to >= end) break
    }
  }

  return chunks
}

module.exports = { buildChunks, extractKeywords }
