/**
 * 阅读态 DOM 选区 ↔ plainText 坐标（仅 H5，带运行时守卫）。
 *
 * R3 架构修复（本文件相对 T01 版本为增量改造）：
 * 初版假设「DOM 文本节点按文档顺序拼接即等于 plainText」，已用 marked 18 实测证伪：
 * ① 图片 ![alt](url) 渲染成 <img alt> 后没有文本节点，而 stripMarkdown 保留 alt 文字；
 * ② 表格内容行 DOM 只有单元格文字，plainText 保留 `|` 竖线；
 * ③ 块级标签间空白与段落换行数量、位置不同。
 * 因此改为「一次性对齐标注」：
 * 1) buildDomPlainMap 用顺序贪心双指针把 DOM 文本节点序列与 plainText 对齐，
 *    节点内记字符级 charMap；DOM 缺失的字符作为 plainText 侧间隙跳过；
 * 2) getSelectionOffsets / highlightRange / scrollToOffset 内部读映射，不再累加 DOM 长度；
 * 3) selectedText / prefix / suffix 一律取 plainText.slice()，禁止使用 Range.toString()。
 *
 * 纯逻辑 alignTexts / resolveOffset 不依赖 DOM，可被 Node 直接单测（tests/ui/selection.test.js）。
 */
import { ANCHOR_CONTEXT_LEN } from '../constants.js'

// 副作用导入：加载同构纯函数副本，使 globalThis.MmText 就绪
import './mm-text.js'

/** 逐字对齐时允许跳过的最大间隙，超过即视为不可映射，避免远距离误绑 */
export const MAX_ALIGN_GAP = 400

/** 容器 → 对齐映射缓存（WeakMap，避免给 DOM 元素写大量 data-* 属性） */
const mapCache = new WeakMap()

/**
 * 取得同构纯函数单例（供需要 stripMarkdown / buildOffsetMap 的组件复用）。
 * @returns {{stripMarkdown: Function, buildOffsetMap: Function}|null}
 */
export function getMmText() {
  if (typeof globalThis !== 'undefined' && globalThis.MmText) {
    return globalThis.MmText
  }
  return null
}

/** 判断当前是否具备浏览器 DOM 环境 */
function hasDom() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/** 判断是否为空白字符 */
function isSpace(ch) {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r'
}

/**
 * 顺序贪心双指针对齐（纯函数）。
 * 以 DOM 文本节点为主序，每个节点从「上一个对齐位置之后」在 plainText 中定位，
 * 保证结果单调、唯一、可复现（不使用通用 LCS，避免重复文本出现多解）。
 *
 * @param {string[]} domTexts 各文本节点内容，按文档顺序
 * @param {string} plainText 提纯纯文本
 * @returns {{nodes: Array<{start:number,end:number,mapped:boolean,charMap:Array<number>|null}>, mappedCount:number}}
 *   start：节点首个可映射字符在 plainText 中的下标（-1 表示整节点不可映射）
 *   end：节点最后一个可映射字符之后的下标
 *   charMap[i]：节点内第 i 个字符对应的 plainText 下标（-1 表示该字符不可映射）
 */
export function alignTexts(domTexts, plainText) {
  const source = typeof plainText === 'string' ? plainText : ''
  const texts = Array.isArray(domTexts) ? domTexts : []
  const nodes = []
  let cursor = 0
  let mappedCount = 0

  for (let index = 0; index < texts.length; index++) {
    const raw = texts[index]
    const text = typeof raw === 'string' ? raw : ''

    // 纯空白节点（marked 输出的格式化换行）：不推进 cursor，也不参与映射
    if (text.trim() === '') {
      nodes.push({ start: -1, end: -1, mapped: false, charMap: null })
      continue
    }

    // ① 整节点精确匹配：最常见路径，直接记录起点，局部偏移可直接相加
    const exact = source.indexOf(text, cursor)
    if (exact !== -1) {
      nodes.push({ start: exact, end: exact + text.length, mapped: true, charMap: null })
      cursor = exact + text.length
      mappedCount += 1
      continue
    }

    // ② 逐字映射：处理空白归一、图片 alt / 表格竖线等 DOM 与 plainText 的间隙差异
    const charMap = new Array(text.length).fill(-1)
    let searchFrom = cursor
    let first = -1
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (isSpace(ch)) continue
      const found = source.indexOf(ch, searchFrom)
      if (found === -1) continue
      if (found - searchFrom > MAX_ALIGN_GAP) continue
      charMap[i] = found
      if (first === -1) first = found
      searchFrom = found + 1
    }

    if (first === -1) {
      // 整节点在 plainText 中找不到对应位置：标记不可映射，不推进 cursor
      nodes.push({ start: -1, end: -1, mapped: false, charMap: null })
      continue
    }
    nodes.push({ start: first, end: searchFrom, mapped: true, charMap })
    cursor = searchFrom
    mappedCount += 1
  }

  return { nodes, mappedCount }
}

/**
 * 由节点映射 + 节点内局部偏移换算 plainText 偏移（纯函数）。
 * 映射不到时返回 -1，由调用方决定提示而不是退化成 DOM 长度累加。
 *
 * @param {{start:number,end:number,mapped:boolean,charMap:Array<number>|null}} nodeMap 节点映射
 * @param {number} localOffset 节点内字符偏移
 * @returns {number} plainText 偏移，-1 表示不可映射
 */
export function resolveOffset(nodeMap, localOffset) {
  if (!nodeMap || nodeMap.mapped !== true) return -1
  const offset = Math.max(0, Number(localOffset) || 0)

  // 整节点精确匹配：起点 + 局部偏移
  if (!nodeMap.charMap) {
    const length = Math.max(0, nodeMap.end - nodeMap.start)
    return nodeMap.start + Math.min(offset, length)
  }

  // 逐字映射：取 offset 处或之后第一个可映射字符
  for (let i = offset; i < nodeMap.charMap.length; i++) {
    if (nodeMap.charMap[i] >= 0) return nodeMap.charMap[i]
  }
  // 之后没有可映射字符：回退到最后一个可映射字符之后
  for (let i = nodeMap.charMap.length - 1; i >= 0; i--) {
    if (nodeMap.charMap[i] >= 0) return nodeMap.charMap[i] + 1
  }
  return -1
}

/**
 * 由 plainText 偏移反查节点内局部偏移（用于高亮）。
 * @param {{start:number,end:number,mapped:boolean,charMap:Array<number>|null}} nodeMap 节点映射
 * @param {number} plainOffset plainText 偏移
 * @param {'start'|'end'} edge 取区间的起点还是终点
 * @returns {number} 节点内局部偏移，-1 表示不落在该节点
 */
function localFromPlain(nodeMap, plainOffset, edge) {
  if (!nodeMap || nodeMap.mapped !== true) return -1
  if (!nodeMap.charMap) {
    const length = Math.max(0, nodeMap.end - nodeMap.start)
    const local = plainOffset - nodeMap.start
    if (edge === 'start') return local < 0 ? -1 : Math.min(local, length)
    return local < 0 ? -1 : Math.min(local, length)
  }
  const map = nodeMap.charMap
  if (edge === 'start') {
    for (let i = 0; i < map.length; i++) {
      if (map[i] >= 0 && map[i] >= plainOffset) return i
    }
    return -1
  }
  for (let i = map.length - 1; i >= 0; i--) {
    if (map[i] >= 0 && map[i] < plainOffset) return i + 1
  }
  return -1
}

/** 收集容器内全部文本节点（按文档顺序） */
function collectTextNodes(containerEl) {
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, null, false)
  const nodes = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node)
    node = walker.nextNode()
  }
  return nodes
}

/**
 * 构建（并缓存）DOM 文本节点 → plainText 的对齐映射。
 * 阅读器在渲染挂载后调用一次即可；getSelectionOffsets 内部也会惰性构建。
 *
 * @param {HTMLElement} containerEl 阅读态预览容器
 * @param {string} plainText 提纯纯文本
 * @returns {{plainText:string, nodes:Text[], entries:Map<Text,object>, mappedCount:number}|null}
 */
export function buildDomPlainMap(containerEl, plainText, force) {
  if (!hasDom() || !containerEl) return null
  const text = typeof plainText === 'string' ? plainText : ''

  const cached = mapCache.get(containerEl)
  if (!force && cached && cached.plainText === text) return cached

  const nodes = collectTextNodes(containerEl)
  const domTexts = nodes.map(node => node.nodeValue || '')
  const aligned = alignTexts(domTexts, text)

  const entries = new Map()
  for (let i = 0; i < nodes.length; i++) {
    const entry = aligned.nodes[i]
    if (entry) entries.set(nodes[i], entry)
  }

  const map = { plainText: text, nodes, entries, mappedCount: aligned.mappedCount }
  mapCache.set(containerEl, map)
  return map
}

/** 取已有映射；不存在或要求强制时构建 */
function ensureMap(containerEl, plainText, force) {
  const text = typeof plainText === 'string' ? plainText : ''
  if (force) return buildDomPlainMap(containerEl, text, true)
  const cached = mapCache.get(containerEl)
  if (cached && cached.plainText === text) return cached
  return buildDomPlainMap(containerEl, text)
}

/**
 * 把 Range 端点换算成 plainText 偏移。
 * @returns {number} plainText 偏移，-1 表示该端点不可映射
 */
function offsetAtPoint(map, node, offset) {
  let textNode = node
  let localOffset = offset

  if (node && node.nodeType === 1) {
    // 元素节点：offset 是子节点索引，取相邻文本节点的边界
    const child = node.childNodes[offset] || null
    if (child && child.nodeType === 3) {
      textNode = child
      localOffset = 0
    } else {
      const prev = offset > 0 ? node.childNodes[offset - 1] : null
      if (prev && prev.nodeType === 3) {
        textNode = prev
        localOffset = (prev.nodeValue || '').length
      } else {
        return -1
      }
    }
  }

  if (!textNode || textNode.nodeType !== 3) return -1
  const entry = map.entries.get(textNode)
  if (!entry) return -1
  return resolveOffset(entry, localOffset)
}

/**
 * 读取当前选区，产出批注锚点信息。
 * 映射不到（落在图片 alt / 表格竖线等间隙上）时返回 null，由调用方提示「该位置不支持批注」。
 *
 * @param {HTMLElement} containerEl 阅读态预览容器
 * @param {string} plainText 唯一坐标系
 * @returns {{start:number,end:number,selectedText:string,prefix:string,suffix:string}|null}
 */
export function getSelectionOffsets(containerEl, plainText) {
  if (!hasDom() || !containerEl) return null
  // 高亮会拆分文本节点，每次取选区都强制重建映射，保证坐标与当前 DOM 一致
  const map = ensureMap(containerEl, plainText, true)
  if (!map) return null

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!containerEl.contains(range.commonAncestorContainer)) return null

  const start = offsetAtPoint(map, range.startContainer, range.startOffset)
  const end = offsetAtPoint(map, range.endContainer, range.endOffset)
  if (start === -1 || end === -1 || end <= start) return null

  const text = typeof plainText === 'string' ? plainText : ''
  // R3 强制：选中文本一律从 plainText 取，禁止使用 Range.toString()
  const selectedText = text.slice(start, end)
  if (!selectedText) return null

  const prefixStart = Math.max(0, start - ANCHOR_CONTEXT_LEN)
  const suffixEnd = Math.min(text.length, end + ANCHOR_CONTEXT_LEN)
  return {
    start,
    end,
    selectedText,
    prefix: text.slice(prefixStart, start),
    suffix: text.slice(end, suffixEnd)
  }
}

/**
 * 按 plainText 坐标在阅读态高亮区间（包裹 <mark class="mm-anchor-mark">）。
 * 只高亮已映射的连续区间；落在间隙上的字符跳过，不改批注 status。
 *
 * @param {HTMLElement} containerEl 阅读态预览容器
 * @param {number} start 起始偏移（含）
 * @param {number} end 结束偏移（不含）
 * @returns {void}
 */
export function highlightRange(containerEl, start, end) {
  if (!hasDom() || !containerEl) return
  if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return

  const map = mapCache.get(containerEl)
  if (!map) return

  const targets = []
  for (const [node, entry] of map.entries.entries()) {
    if (!entry || entry.mapped !== true) continue
    const from = localFromPlain(entry, start, 'start')
    const to = localFromPlain(entry, end, 'end')
    if (from === -1 || to === -1 || to <= from) continue
    const length = (node.nodeValue || '').length
    targets.push({ node, from: Math.min(from, length), to: Math.min(to, length) })
  }

  // 从后往前包裹，避免切分点被重复处理
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i]
    if (target.to <= target.from) continue
    try {
      const range = document.createRange()
      range.setStart(target.node, target.from)
      range.setEnd(target.node, target.to)
      const mark = document.createElement('mark')
      mark.className = 'mm-anchor-mark mm-anchor'
      range.surroundContents(mark)
    } catch (error) {
      // 单节点包裹失败时跳过该段，不影响其余高亮
    }
  }
}

/**
 * 滚动到 plainText 指定偏移所在节点（搜索命中回跳 / 批注锚点跳转）。
 * 只滚到最近的已映射节点；不修改 DOM。
 *
 * @param {HTMLElement} containerEl 阅读态预览容器
 * @param {number} offset plainText 偏移
 * @returns {void}
 */
export function scrollToOffset(containerEl, offset) {
  if (!hasDom() || !containerEl || typeof offset !== 'number') return
  // 只读已有映射，绝不在此用空 plainText 重建缓存
  const cached = mapCache.get(containerEl)
  if (!cached) {
    if (typeof containerEl.scrollIntoView === 'function') {
      containerEl.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    return
  }
  // 高亮可能已拆分文本节点，用缓存中的 plainText 重建一份最新映射
  const map = buildDomPlainMap(containerEl, cached.plainText, true)
  if (!map) return

  const target = Math.max(0, offset)
  let nearest = null
  let nearestDistance = Infinity

  for (const [node, entry] of map.entries.entries()) {
    if (!entry || entry.mapped !== true) continue
    if (target >= entry.start && target <= entry.end) {
      nearest = node
      break
    }
    const distance = Math.min(Math.abs(target - entry.start), Math.abs(target - entry.end))
    if (distance < nearestDistance) {
      nearest = node
      nearestDistance = distance
    }
  }

  if (!nearest) {
    if (typeof containerEl.scrollIntoView === 'function') {
      containerEl.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    return
  }
  const parent = nearest.parentElement || containerEl
  if (parent && typeof parent.scrollIntoView === 'function') {
    parent.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

export default {
  getSelectionOffsets,
  highlightRange,
  scrollToOffset,
  buildDomPlainMap,
  alignTexts,
  resolveOffset,
  getMmText
}
