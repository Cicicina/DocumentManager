<template>
  <view class="mm-viewer">
    <!-- md-editor-preview：直接复用 md-editor-v3 预览面板的排版规则，保证阅读视图与预览逐像素一致 -->
    <view
      ref="contentRef"
      class="mm-md mm-viewer__body md-editor-preview"
      v-html="renderedHtml"
      @click="handleClick"
    />
  </view>
</template>

<script setup>
/**
 * Markdown 阅读器：marked 渲染 + DOMPurify 消毒 + R3 对齐标注 + 批注锚点高亮。
 *
 * 关键点：
 * - 不使用编辑器内置的预览组件（架构 R2）：它走 markdown-it 渲染，对代码块/表格/图片 alt
 *   的处理与 stripMarkdown 规格不一致，会让批注 offset 漂移；
 * - DOMPurify 只在客户端渲染阶段调用（computed 内），不在模块顶层求值；
 * - 渲染挂载后调用 buildDomPlainMap 建立 DOM ↔ plainText 对齐，选区与高亮都基于该映射；
 * - 存储态 mm-image://<fileID> 在此正向替换为临时 URL（显示态），库中仍只存 fileID。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
// 复用 md-editor-v3 预览面板的样式表：阅读视图与预览必须同一套排版规则。
// 与 mm-md-editor.vue 的导入是同一模块，打包时自动去重。
import 'md-editor-v3/lib/style.css'
import { buildDomPlainMap, highlightRange, scrollToOffset as scrollPlainOffset } from '@/common/utils/selection.js'

const props = defineProps({
  mdSource: { type: String, default: '' },
  plainText: { type: String, default: '' },
  comments: { type: Array, default: () => [] },
  activeCommentId: { type: String, default: '' },
  imageUrlMap: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['select-comment'])

const contentRef = ref(null)

/**
 * 取真实 DOM 容器。
 * uni-app H5 中 <view> 是组件，ref 拿到的是组件实例，必须取 $el 才能用 DOM API；
 * 直接对实例调用 querySelectorAll 会抛 TypeError，onMounted 中断导致正文不显示。
 */
function resolveContentEl() {
  const target = contentRef.value
  if (!target) return null
  if (typeof target.querySelectorAll === 'function') return target
  if (target.$el && typeof target.$el.querySelectorAll === 'function') return target.$el
  return null
}

// marked 全局配置（幂等）
marked.use({ gfm: true, breaks: true })

/** 把存储态 mm-image://<fileID> 正向替换为临时 URL（显示态） */
function toDisplayState(mdSource, imageUrlMap) {
  const source = typeof mdSource === 'string' ? mdSource : ''
  const map = imageUrlMap || {}
  return source.replace(/mm-image:\/\/([^\s)'"]+)/g, (matched, fileId) => {
    return map[fileId] || matched
  })
}

const renderedHtml = computed(() => {
  const display = toDisplayState(props.mdSource, props.imageUrlMap)
  const raw = marked.parse(display)
  // 无 window 时 dompurify 的 default 是未绑定工厂函数，不能调用 sanitize
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
    return DOMPurify.sanitize(raw)
  }
  return raw
})

/** 移除已有高亮标记与批注气泡，恢复原始文本节点 */
function stripHighlights(el) {
  if (!el || typeof el.querySelectorAll !== 'function') return
  const chips = el.querySelectorAll('.mm-chip')
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i]
    if (chip.parentNode) chip.parentNode.removeChild(chip)
  }
  const marks = el.querySelectorAll('mark.mm-anchor')
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
}

/**
 * 给标题打序号锚点：大纲按「第几个标题」跳转，与 markdown 解析出的序号一一对应。
 * 只加属性不加节点，不影响 plainText ↔ DOM 的 offset 映射。
 */
function applyHeadingAnchors() {
  const el = resolveContentEl()
  if (!el || typeof el.querySelectorAll !== 'function') return
  const headings = el.querySelectorAll('h1,h2,h3,h4,h5,h6')
  for (let i = 0; i < headings.length; i++) headings[i].setAttribute('data-mm-h', String(i))
}

/** 重建映射并按 active 批注高亮（从后往前，避免 splitText 影响前面区间） */
function applyHighlights() {
  const el = resolveContentEl()
  if (!el) return
  applyHeadingAnchors()
  stripHighlights(el)
  // 强制重建映射，保证与当前 DOM 一致（高亮会拆分文本节点）
  buildDomPlainMap(el, props.plainText || '', true)

  const actives = (props.comments || [])
    .filter(item => item && item.status === 'active' && typeof item.start_offset === 'number')
    .sort((left, right) => (right.start_offset || 0) - (left.start_offset || 0))

  for (const comment of actives) {
    const before = el.querySelectorAll('mark.mm-anchor').length
    highlightRange(el, comment.start_offset, comment.end_offset)
    const marks = el.querySelectorAll('mark.mm-anchor')
    const created = []
    for (let i = before; i < marks.length; i++) {
      marks[i].setAttribute('data-comment-id', comment._id || '')
      created.push(marks[i])
    }
    // 气泡挂在锚点最后一个 mark 之后，用真实节点渲染，
    // 「查看全部」才不会像伪元素那样被 text-overflow 裁掉、也没法单独点。
    // 气泡整体带 data-mm-ignore，collectTextNodes 会跳过它，offset 映射不受影响。
    if (created.length) appendChip(created[created.length - 1], comment)
  }
}

/**
 * 在锚点文字后面插入批注气泡：截断内容 + 可点击的「查看全部」。
 * @param {HTMLElement} anchorMark 该批注最后一个高亮 mark
 * @param {object} comment 批注记录
 * @returns {void}
 */
function appendChip(anchorMark, comment) {
  if (!anchorMark || !anchorMark.parentNode) return
  const parent = anchorMark.parentNode
  const chip = document.createElement('span')
  chip.className = 'mm-chip'
  chip.setAttribute('data-mm-ignore', '')
  chip.setAttribute('data-comment-id', comment._id || '')

  const text = document.createElement('span')
  text.className = 'mm-chip__text'
  text.textContent = buildChipText(comment.comment)
  chip.appendChild(text)

  const more = document.createElement('span')
  more.className = 'mm-chip__more'
  more.textContent = '查看全部'
  chip.appendChild(more)

  parent.insertBefore(chip, anchorMark.nextSibling)
}

/**
 * 批注气泡文案：只放截断后的内容，「查看全部」由独立元素渲染。
 * @param {string} text 批注原文
 * @returns {string} 气泡文案；无内容时返回「批注」
 */
function buildChipText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return '批注'
  if (value.length <= 24) return value
  return `${value.slice(0, 24)}…`
}

async function refresh() {
  await nextTick()
  applyHighlights()
}

onMounted(() => {
  applyHighlights()
})

watch(() => [props.mdSource, props.plainText, props.imageUrlMap], () => {
  refresh()
}, { deep: true })

watch(() => [props.comments, props.activeCommentId], () => {
  applyHighlights()
  if (props.activeCommentId) {
    const target = (props.comments || []).find(item => item && item._id === props.activeCommentId)
    if (target && typeof target.start_offset === 'number') {
      const el = resolveContentEl()
      if (el) scrollPlainOffset(el, target.start_offset)
    }
  }
}, { deep: true })

function handleClick(event) {
  const target = event && event.target
  if (!target || typeof target.closest !== 'function') return
  // 气泡与高亮文字都能打开同一条批注详情
  const hit = target.closest('mark.mm-anchor') || target.closest('.mm-chip')
  if (!hit) return
  const commentId = hit.getAttribute('data-comment-id')
  const comment = (props.comments || []).find(item => item && item._id === commentId)
  if (!comment) return
  const rect = typeof hit.getBoundingClientRect === 'function' ? hit.getBoundingClientRect() : null
  emit('select-comment', {
    comment,
    rect: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null
  })
}

/** 滚动到 plainText 指定偏移（搜索回跳 / 批注定位） */
function scrollToOffset(offset) {
  const el = resolveContentEl()
  if (el) scrollPlainOffset(el, offset)
}

/**
 * 标题文本归一：只抹平空白差异。
 * 传进来的 text 已由调用方去掉行内标记，这里必须保持「轻量」，
 * 否则会二次删掉 `snake_case` 里的下划线，反而和 DOM 文本对不上。
 */
function normalizeHeadingText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/**
 * 滚动到第 index 个标题。
 *
 * 索引来自前端对 Markdown 源文的 ATX 解析，与 marked 渲染出的 h1~h6 顺序
 * 理论上一致；但 setext 标题（=== / --- 下划线）、HTML 块内标题等会让两边错位。
 * 所以带上标题文本做二次校验：索引对不上时按文本回查，仍然找不到才放弃。
 *
 * @param {number} index 标题序号
 * @param {string} [text] 标题文本，用于纠偏
 */
function scrollToHeading(index, text) {
  const el = resolveContentEl()
  if (!el || typeof el.querySelector !== 'function') return
  const label = normalizeHeadingText(text)
  let target = el.querySelector(`[data-mm-h="${Number(index)}"]`)
  if (label && (!target || normalizeHeadingText(target.textContent) !== label)) {
    const candidates = el.querySelectorAll('h1,h2,h3,h4,h5,h6')
    for (let i = 0; i < candidates.length; i++) {
      if (normalizeHeadingText(candidates[i].textContent) === label) {
        target = candidates[i]
        break
      }
    }
  }
  if (!target || typeof target.scrollIntoView !== 'function') return
  target.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

/** 高亮指定区间（供外部按需调用） */
function highlight(start, end) {
  const el = resolveContentEl()
  if (el) highlightRange(el, start, end)
}

defineExpose({ scrollToOffset, scrollToHeading, highlightRange: highlight, refresh })
</script>

<style scoped>
.mm-viewer {
  height: 100%;
  overflow: auto;
  background-color: var(--mm-bg);
}

/*
 * 正文排版**不再自定义**：容器带 md-editor-preview 类，直接由 md-editor-v3
 * 的预览样式表（style.css）驱动字号层级、行高、列表缩进、表格、链接、行内代码。
 * 这里只补三件事：把 --md-theme-* 映射到项目主题变量、裸 pre>code 的代码块外观、
 * 批注锚点与气泡。批注 plainText ↔ DOM 坐标映射不受影响。
 */
.mm-viewer__body {
  padding: 24px 20px 72px;
  color: var(--mm-text);
  /* uni-app H5 框架 base.css 给 html/body 设了 user-select:none，
     正文必须显式恢复才能拖选文字、进而建立批注锚点 */
  -webkit-user-select: text;
  user-select: text;

  /* 预览主题变量 → 项目主题变量，让预览规则跟随深浅色 */
  --md-theme-color: var(--mm-text);
  --md-theme-link-color: var(--mm-accent);
  --md-theme-link-hover-color: var(--mm-accent);
  --md-theme-border-color: var(--mm-border);
  --md-theme-heading-color: var(--mm-text);
  --md-theme-heading-border: none;
  --md-theme-heading-1-color: var(--mm-text);
  --md-theme-heading-2-color: var(--mm-text);
  --md-theme-heading-3-color: var(--mm-text);
  --md-theme-heading-4-color: var(--mm-text);
  --md-theme-heading-5-color: var(--mm-text);
  --md-theme-heading-6-color: var(--mm-text);
  --md-theme-heading-1-border: none;
  --md-theme-heading-2-border: none;
  --md-theme-heading-3-border: none;
  --md-theme-heading-4-border: none;
  --md-theme-heading-5-border: none;
  --md-theme-heading-6-border: none;
  --md-theme-quote-color: var(--mm-text);
  --md-theme-quote-border: none;
  --md-theme-quote-bg-color: var(--mm-surface-2);
  --md-theme-table-stripe-color: var(--mm-surface-2);
  --md-theme-table-tr-bg-color: var(--mm-surface);
  --md-theme-table-td-border-color: var(--mm-border);
  --md-theme-code-inline-color: var(--mm-code-inline-color);
  --md-theme-code-inline-bg-color: var(--mm-code-inline-bg);
  --md-theme-code-inline-radius: 2px;
  --md-theme-code-block-color: var(--mm-code-block-text);
  --md-theme-code-block-bg-color: var(--mm-code-block-bg);
  --md-theme-code-before-bg-color: var(--mm-code-block-bg);
}

/* marked 输出裸 pre>code（预览是 details.md-editor-code 结构），按预览外观补齐 */
.mm-viewer__body :deep(pre) {
  margin: 20px 0;
  overflow: auto;
  background-color: var(--mm-code-block-bg);
  border-radius: 5px;
}

.mm-viewer__body :deep(pre code) {
  display: block;
  padding: 1em;
  font-family: source-code-pro, Menlo, Monaco, Consolas, "Courier New", monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--mm-code-block-text);
  background-color: transparent;
}

.mm-viewer__body :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.mm-viewer__body :deep(img) {
  max-width: 100%;
}

.mm-viewer__body :deep(img) {
  max-width: 100%;
  border-radius: var(--mm-radius);
}

.mm-viewer__body :deep(mark.mm-anchor) {
  background-color: var(--mm-mark);
  color: var(--mm-text);
  border-radius: 3px;
  cursor: pointer;
}

/*
 * 批注气泡：贴在锚点文字右侧，随正文流动。
 * 用真实 DOM 节点而不是 ::after 伪元素 —— 伪元素的文本会被 text-overflow
 * 一起裁掉，「查看全部」既看不见也点不到。
 * 气泡带 data-mm-ignore，collectTextNodes 跳过它，offset 映射不受影响。
 */
.mm-viewer__body :deep(.mm-chip) {
  display: inline-flex;
  align-items: center;
  max-width: 16em;
  margin-left: 4px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: normal;
  line-height: 18px;
  vertical-align: middle;
  color: var(--mm-text-weak);
  background-color: var(--mm-surface-2);
  border: 1px solid var(--mm-border);
  border-radius: 9px;
  cursor: pointer;
}

.mm-viewer__body :deep(.mm-chip:hover) {
  border-color: var(--mm-accent);
}

/* 只有内容部分会被截断，「查看全部」永远完整可见 */
.mm-viewer__body :deep(.mm-chip__text) {
  min-width: 0;
  max-width: 10em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-viewer__body :deep(.mm-chip__more) {
  flex: none;
  margin-left: 4px;
  color: var(--mm-accent);
  white-space: nowrap;
}
</style>
