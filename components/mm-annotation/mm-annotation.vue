<template>
  <view class="mm-annotation">
    <view class="mm-annotation__head">
      <text class="mm-annotation__title">批注 {{ comments.length }}</text>
    </view>

    <scroll-view class="mm-annotation__body" scroll-y>
      <view
        v-for="item in sortedComments"
        :key="item._id"
        class="mm-annotation__item"
        :class="{ 'is-active': item._id === activeCommentId, 'is-orphaned': item.status === 'orphaned' }"
        @click="emit('locate', item)"
      >
        <view class="mm-annotation__quote-row">
          <text class="mm-annotation__quote">{{ truncate(item.selected_text) }}</text>
          <text v-if="item.status === 'orphaned'" class="mm-annotation__badge">原文已改动</text>
        </view>
        <text class="mm-annotation__text">{{ item.comment }}</text>
        <view class="mm-annotation__foot">
          <text class="mm-annotation__time">{{ formatTime(item.created_at) }}</text>
          <view class="mm-annotation__actions">
            <text class="mm-annotation__action" @click.stop="startEdit(item)">编辑</text>
            <text class="mm-annotation__action" @click.stop="confirmRemove(item)">删除</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 添加 / 编辑批注弹层 -->
    <wd-popup v-model="dialogVisible" position="center" custom-style="width:min(420px,88vw);border-radius:12px;">
      <view class="mm-annotation__dialog">
        <text class="mm-annotation__dialog-title">{{ editingId ? '编辑批注' : '添加批注' }}</text>
        <text v-if="pendingQuote" class="mm-annotation__dialog-quote">{{ pendingQuote }}</text>
        <wd-input v-model="dialogText" placeholder="写下你的批注" />
        <view class="mm-annotation__dialog-actions">
          <wd-button size="small" plain @click="dialogVisible = false">取消</wd-button>
          <wd-button size="small" type="primary" @click="submitDialog">确定</wd-button>
        </view>
      </view>
    </wd-popup>
    <wd-message-box selector="mm-annotation" />
  </view>
</template>

<script setup>
/**
 * 批注侧栏：列表 / 新建（阅读态选区）/ 编辑 / 删除 / orphaned 独立态 / 锚点跳转。
 *
 * R3 约定：选中原文、prefix、suffix 一律由 getSelectionOffsets 从 plainText.slice() 产出，
 * 映射不到（落在图片 alt、表格竖线等间隙）时提示「该位置不支持批注」，
 * 绝不退化成 DOM 文本长度累加。status 只由云侧 relocateComments 决定，本组件只展示。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getSelectionOffsets } from '@/common/utils/selection.js'
import { useConfirm } from '@/common/utils/confirm.js'

const { confirm } = useConfirm('mm-annotation')

const props = defineProps({
  comments: { type: Array, default: () => [] },
  plainText: { type: String, default: '' },
  activeCommentId: { type: String, default: '' }
})

const emit = defineEmits(['add', 'update', 'remove', 'locate'])

const dialogVisible = ref(false)
const dialogText = ref('')
const pendingQuote = ref('')
const pendingOffsets = ref(null)
const editingId = ref('')

/**
 * 最近一次在正文里选中的锚点。
 * 点击「添加」按钮时浏览器会折叠选区，再读 window.getSelection() 已经为空，
 * 因此必须在 selectionchange 阶段提前捕获，按钮点击只把缓存当兜底。
 */
const cachedOffsets = ref(null)
/** 正文当前是否有活动选区：只驱动主壳「添加批注」浮动按钮显隐，与缓存锚点解耦 */
const hasActiveSelection = ref(false)
let selectionTimer = null

/** 选区状态：主壳自行监听 selectionchange，本组件只保留内部态，不新增 emit */
function setActiveSelection(value) {
  hasActiveSelection.value = value
}

function captureSelection() {
  // 同步判定选区折叠状态：取消选择时按钮立即淡出，但不动 cachedOffsets，
  // 避免点按钮导致浏览器折叠选区后把刚刚缓存的锚点误清掉。
  const liveSelection = typeof window !== 'undefined' ? window.getSelection() : null
  setActiveSelection(!!(
    liveSelection && liveSelection.rangeCount > 0 && !liveSelection.isCollapsed
  ))

  // 锚点换算较重，沿用 120ms 防抖；只有选到有效区间才覆盖缓存
  if (selectionTimer) clearTimeout(selectionTimer)
  selectionTimer = setTimeout(() => {
    selectionTimer = null
    // #ifdef H5
    const container = document.querySelector('.mm-viewer__body')
    if (!container) return
    const offsets = getSelectionOffsets(container, props.plainText)
    // 只在选到有效区间时覆盖：折叠、越界、落在图片 alt/表格间隙都不清空上次的有效选区
    // 只在选到有效区间时覆盖：折叠、越界、落在图片 alt/表格间隙都不清空上次的有效选区
    if (offsets) cachedOffsets.value = offsets
    // #endif
  }, 120)
}

onMounted(() => {
  // #ifdef H5
  document.addEventListener('selectionchange', captureSelection)
  // #endif
})

onUnmounted(() => {
  // #ifdef H5
  document.removeEventListener('selectionchange', captureSelection)
  // #endif
  if (selectionTimer) {
    clearTimeout(selectionTimer)
    selectionTimer = null
  }
})

// 切换文档后旧锚点坐标失效，必须丢弃；按钮同步淡出
watch(() => props.plainText, () => {
  cachedOffsets.value = null
  setActiveSelection(false)
})

const sortedComments = computed(() => {
  return (props.comments || []).slice().sort((left, right) => {
    return new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime()
  })
})

function truncate(text) {
  const value = typeof text === 'string' ? text : ''
  return value.length > 60 ? `${value.slice(0, 60)}…` : value
}

function formatTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = num => String(num).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 新建批注：取阅读态选区并换算为 plainText 坐标 */
function startAdd() {
  // #ifdef H5
  const container = document.querySelector('.mm-viewer__body')
  if (!container) {
    uni.showToast({ title: '请先打开文档', icon: 'none' })
    return
  }
  // 现场选区优先；按钮点击已把选区折叠时，回退到 selectionchange 缓存的锚点
  const offsets = getSelectionOffsets(container, props.plainText) || cachedOffsets.value
  if (!offsets) {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null
    const hasLiveSelection = !!(selection && selection.rangeCount > 0 && !selection.isCollapsed)
    uni.showToast({
      title: hasLiveSelection ? '该位置不支持批注' : '请先在正文中选中文字',
      icon: 'none'
    })
    return
  }
  pendingOffsets.value = offsets
  pendingQuote.value = offsets.selectedText
  editingId.value = ''
  dialogText.value = ''
  dialogVisible.value = true
  // #endif
}

function startEdit(item) {
  if (!item) return
  editingId.value = item._id
  pendingQuote.value = truncate(item.selected_text)
  pendingOffsets.value = null
  dialogText.value = item.comment || ''
  dialogVisible.value = true
}

function confirmRemove(item) {
  if (!item) return
  confirm({ title: '删除批注', content: '这条批注将被删除', danger: true }).then(ok => {
    if (ok) emit('remove', { comment_id: item._id })
  })
}

function submitDialog() {
  const text = String(dialogText.value || '').trim()
  if (!text) {
    uni.showToast({ title: '批注内容不能为空', icon: 'none' })
    return
  }
  if (editingId.value) {
    emit('update', { comment_id: editingId.value, comment: text })
  } else if (pendingOffsets.value) {
    emit('add', {
      start: pendingOffsets.value.start,
      end: pendingOffsets.value.end,
      selectedText: pendingOffsets.value.selectedText,
      prefix: pendingOffsets.value.prefix,
      suffix: pendingOffsets.value.suffix,
      comment: text
    })
    // 锚点已消费，避免再次点「添加批注」复用同一段
    cachedOffsets.value = null
    setActiveSelection(false)
  }
  dialogVisible.value = false
}
</script>

<style scoped>
.mm-annotation {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: var(--mm-surface);
  border-left: 1px solid var(--mm-border);
}

.mm-annotation__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(14px * var(--mm-ui-scale, 1));
  flex: none;
  border-bottom: 1px solid var(--mm-border);
}

.mm-annotation__title {
  font-size: calc(13px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-annotation__body {
  flex: 1;
  min-height: 0;
}

.mm-annotation__item {
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(14px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
  cursor: pointer;
}

.mm-annotation__item.is-active {
  background-color: var(--mm-accent-weak);
}

.mm-annotation__item.is-orphaned {
  opacity: 0.66;
}

.mm-annotation__quote-row {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--mm-ui-scale, 1));
}

.mm-annotation__quote {
  flex: 1;
  min-width: 0;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-annotation__badge {
  flex: none;
  padding: calc(1px * var(--mm-ui-scale, 1)) calc(6px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  border: 1px solid var(--mm-border);
  border-radius: 4px;
}

.mm-annotation__text {
  display: block;
  margin-top: 6px;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  line-height: 1.6;
  color: var(--mm-text);
}

.mm-annotation__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}

.mm-annotation__time {
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-annotation__actions {
  display: flex;
  gap: calc(10px * var(--mm-ui-scale, 1));
}

.mm-annotation__action {
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-accent);
  cursor: pointer;
}


.mm-annotation__dialog {
  padding: calc(18px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
}

.mm-annotation__dialog-title {
  display: block;
  margin-bottom: 10px;
  font-size: calc(14px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-annotation__dialog-quote {
  display: block;
  margin-bottom: 10px;
  padding: calc(6px * var(--mm-ui-scale, 1)) calc(8px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  background-color: var(--mm-surface-2);
  border-radius: 6px;
}

.mm-annotation__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: calc(10px * var(--mm-ui-scale, 1));
  margin-top: 16px;
}
</style>
