<template>
  <view class="mm-viewer">
    <view ref="contentRef" class="mm-md mm-viewer__body" v-html="renderedHtml" @click="handleClick" />
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

/** 移除已有高亮标记，恢复原始文本节点 */
function stripHighlights(el) {
  if (!el || typeof el.querySelectorAll !== 'function') return
  const marks = el.querySelectorAll('mark.mm-anchor')
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
}

/** 重建映射并按 active 批注高亮（从后往前，避免 splitText 影响前面区间） */
function applyHighlights() {
  const el = resolveContentEl()
  if (!el) return
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
    for (let i = before; i < marks.length; i++) {
      marks[i].setAttribute('data-comment-id', comment._id || '')
    }
  }
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
  const mark = target.closest('mark.mm-anchor')
  if (!mark) return
  const commentId = mark.getAttribute('data-comment-id')
  const comment = (props.comments || []).find(item => item && item._id === commentId)
  if (!comment) return
  // 气泡要渲染到阅读器外层，避免被 .mm-viewer 的 overflow:auto 裁切；
  // 这里把被点中的 mark 视口矩形一并抛出，由主壳定位气泡。
  const rect = typeof mark.getBoundingClientRect === 'function' ? mark.getBoundingClientRect() : null
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

/** 高亮指定区间（供外部按需调用） */
function highlight(start, end) {
  const el = resolveContentEl()
  if (el) highlightRange(el, start, end)
}

defineExpose({ scrollToOffset, highlightRange: highlight, refresh })
</script>

<style scoped>
.mm-viewer {
  height: 100%;
  overflow: auto;
  background-color: var(--mm-bg);
}

.mm-viewer__body {
  padding: 24px 20px 72px;
  /* 与 md-editor-v3 预览分栏一致的尺度：字号/行高走继承，不再写死，
     配色仍走项目变量以跟随明暗主题。只改视觉，不换 marked 渲染引擎，
     批注 plainText 坐标映射保持不变。 */
  color: var(--mm-text);
  /* uni-app H5 框架 base.css 给 html/body 设了 user-select:none，
     正文必须显式恢复才能拖选文字、进而建立批注锚点 */
  -webkit-user-select: text;
  user-select: text;
}

.mm-viewer__body :deep(p) {
  margin: 0 0 1em;
}

.mm-viewer__body :deep(p:empty) {
  display: none;
}

.mm-viewer__body :deep(a),
.mm-viewer__body :deep(a:hover) {
  color: var(--mm-accent);
  text-decoration: none;
  transition: color 0.3s;
}

.mm-viewer__body :deep(a:empty::before) {
  content: attr(href);
}

.mm-viewer__body :deep(h1),
.mm-viewer__body :deep(h2),
.mm-viewer__body :deep(h3),
.mm-viewer__body :deep(h4),
.mm-viewer__body :deep(h5),
.mm-viewer__body :deep(h6) {
  position: relative;
  word-break: break-all;
  margin: 1.4em 0 0.8em;
  font-weight: bold;
  line-height: 1.4;
  color: var(--mm-text);
  border-bottom: 1px solid var(--mm-border);
  padding-bottom: 0.3em;
}

.mm-viewer__body :deep(h1) { font-size: 2em; }
.mm-viewer__body :deep(h2) { font-size: 1.5em; }
.mm-viewer__body :deep(h3) { font-size: 1.25em; }
.mm-viewer__body :deep(h4) { font-size: 1.1em; }
.mm-viewer__body :deep(h5) { font-size: 1em; }
.mm-viewer__body :deep(h6) { font-size: 0.875em; }

.mm-viewer__body :deep(ul),
.mm-viewer__body :deep(ol) {
  margin: 0 0 1em;
  padding-left: 2.35em;
}

.mm-viewer__body :deep(li) {
  margin: 0.25em 0;
}

.mm-viewer__body :deep(blockquote) {
  margin: 1em 0;
  padding: 0 1em;
  color: var(--mm-text-weak);
  background-color: var(--mm-surface-2);
  border-left: 3px solid var(--mm-accent);
}

.mm-viewer__body :deep(blockquote p) {
  margin: 0;
}

/* 行内代码：对齐 md-editor-v3 预览的 accent 配色、浅底与行高 */
.mm-viewer__body :deep(code) {
  padding: 0 4px;
  color: var(--mm-accent);
  background-color: var(--mm-surface-2);
  border-radius: 3px;
  line-height: 22px;
}

/* 代码块：去掉行内 code 的浅底，改用块级底色与等宽字体族 */
.mm-viewer__body :deep(pre) {
  margin: 1em 0;
  overflow: auto;
  background-color: var(--mm-surface-2);
  border: 1px solid var(--mm-border);
  border-radius: var(--mm-radius);
}

.mm-viewer__body :deep(pre code) {
  display: block;
  padding: 1em;
  color: var(--mm-text);
  background-color: transparent;
  font-family: 'source-code-pro', Menlo, Monaco, Consolas, 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
}

.mm-viewer__body :deep(table) {
  width: 100%;
  margin: 1em 0;
  border-collapse: collapse;
}

.mm-viewer__body :deep(table tr) {
  background-color: var(--mm-surface);
}

.mm-viewer__body :deep(table tr:nth-child(2n)) {
  background-color: var(--mm-surface-2);
}

.mm-viewer__body :deep(th),
.mm-viewer__body :deep(td) {
  padding: 8px 10px;
  border: 1px solid var(--mm-border);
  text-align: left;
}

.mm-viewer__body :deep(th) {
  color: var(--mm-text);
  background-color: var(--mm-surface-2);
  font-weight: 600;
}

.mm-viewer__body :deep(hr) {
  height: 1px;
  margin: 10px 0;
  border: none;
  border-top: 1px solid var(--mm-border);
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
</style>
