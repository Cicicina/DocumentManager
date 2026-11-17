'use strict'

/**
 * 批注段落定位：从提纯纯文本中按选中 offset 取出批注所在的完整段落，
 * 并把选中片段拆成 before / selected / after 三段，供弹出层高亮显示。
 *
 * plainText 里段落之间以单个 '\n' 分隔，段落内部不含 '\n'（见 mm-text.js）。
 * 本文件与前端、Node 单测共用：不写静态 import/export，采用同构双挂载，
 * 前端副作用导入后从 globalThis.CommentParagraph 取用（与 mm-text.js 一致）。
 */

/**
 * 取批注所在段落并拆分高亮片段。
 * @param {string} text 提纯纯文本
 * @param {number} start 选中起点（plainText 坐标，含）
 * @param {number} end 选中终点（plainText 坐标，不含）
 * @returns {{paragraph:string, before:string, selected:string, after:string, selectedStart:number, selectedEnd:number}|null}
 */
function extractAnnotatedParagraph(text, start, end) {
  const value = typeof text === 'string' ? text : ''
  if (!value || typeof start !== 'number' || typeof end !== 'number') return null
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end <= start || start >= value.length) return null

  const clampedEnd = Math.min(end, value.length)
  // 段落起点：start 之前最近的换行之后；段落终点：end 之后最近的换行之前
  const paraStart = value.lastIndexOf('\n', start - 1) + 1
  const nextBreak = value.indexOf('\n', clampedEnd)
  const paraEnd = nextBreak === -1 ? value.length : nextBreak
  if (paraStart > paraEnd) return null

  return {
    paragraph: value.slice(paraStart, paraEnd),
    before: value.slice(paraStart, start),
    selected: value.slice(start, clampedEnd),
    after: value.slice(clampedEnd, paraEnd),
    selectedStart: start - paraStart,
    selectedEnd: clampedEnd - paraStart
  }
}

const CommentParagraph = { extractAnnotatedParagraph }

/** 前端取用入口：避免模块顶层直接读 globalThis（SSR / 单测下可能未挂载） */
function getCommentParagraph() {
  if (typeof globalThis !== 'undefined' && globalThis.CommentParagraph) {
    return globalThis.CommentParagraph
  }
  return CommentParagraph
}

// CommonJS：Node 单测直接 require
if (typeof module !== 'undefined' && module && typeof module.exports !== 'undefined') {
  module.exports = { extractAnnotatedParagraph, getCommentParagraph }
}

// 前端 H5：副作用导入后从全局单例取同一组纯函数
if (typeof globalThis !== 'undefined') {
  globalThis.CommentParagraph = CommentParagraph
}
