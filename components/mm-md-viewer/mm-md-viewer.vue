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
    const created = []
    for (let i = before; i < marks.length; i++) {
      marks[i].setAttribute('data-comment-id', comment._id || '')
      created.push(marks[i])
    }
    // 气泡：把批注内容截断后挂到该段最后一个 mark 上，由 CSS ::after 渲染，
    // 不向 v-html 里插入真实节点，避免打乱 plainText ↔ DOM 的 offset 映射。
    const chip = buildChipText(comment.comment)
    if (chip && created.length) created[created.length - 1].setAttribute('data-chip', chip)
  }
}

/**
 * 批注气泡文案：内容过长时截断并追加「查看全部」提示。
 * @param {string} text 批注原文
 * @returns {string} 气泡文案；无内容时返回空串
 */
function buildChipText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return ''
  if (value.length <= 40) return `批注：${value}`
  return `批注：${value.slice(0, 40)}… 查看全部`
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
 * 用 ::after + attr(data-chip) 渲染，不向 v-html 插入真实节点，
 * 否则 DOM 文本会多出气泡内容，plainText 的 offset 映射整体错位。
 */
.mm-viewer__body :deep(mark.mm-anchor[data-chip])::after {
  content: attr(data-chip);
  display: inline-block;
  max-width: 12em;
  margin-left: 4px;
  padding: 0 6px;
  overflow: hidden;
  font-size: 11px;
  font-weight: normal;
  line-height: 18px;
  color: var(--mm-text-weak);
  white-space: nowrap;
  text-overflow: ellipsis;
  vertical-align: middle;
  background-color: var(--mm-surface-2);
  border: 1px solid var(--mm-border);
  border-radius: 9px;
}
</style>
