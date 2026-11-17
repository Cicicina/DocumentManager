<template>
  <view class="mm-trash">
    <view class="mm-trash__head">
      <text class="mm-trash__title">回收站</text>
      <view class="mm-trash__icon-btn" title="刷新" aria-label="刷新" @click="refresh">
        <uni-icons type="refresh" size="16" color="var(--mm-text-weak)" />
      </view>
    </view>

    <text class="mm-trash__hint">还原会放回原位置；彻底删除不可恢复，会同时清理云端文件与关联批注。</text>

    <view class="mm-trash__body">
      <view v-if="loading && list.length === 0" class="mm-trash__status">
        <wd-loading size="20px" />
        <text>正在加载回收站…</text>
      </view>
      <view v-else-if="loadFailed" class="mm-trash__status">
        <text>{{ loadError || '回收站加载失败' }}</text>
        <wd-button size="small" plain @click="refresh">重试</wd-button>
      </view>
      <view v-else-if="list.length === 0" class="mm-trash__status">
        <text>回收站是空的</text>
      </view>
      <view v-for="item in list" :key="item._id" class="mm-trash__row">
        <view
          class="mm-trash__check"
          :class="{ 'is-checked': isSelected(item._id) }"
          @click="toggle(item._id)"
        >
          <uni-icons
            v-if="isSelected(item._id)"
            type="checkmarkempty"
            size="11"
            color="var(--mm-surface)"
          />
        </view>
        <view class="mm-trash__main">
          <text class="mm-trash__name">{{ item.name }}</text>
          <text class="mm-trash__meta">{{ item.type === 'folder' ? '文件夹' : formatSize(item.size) }}</text>
        </view>
      </view>
    </view>

    <view class="mm-trash__foot">
      <wd-button size="small" plain :disabled="selection.length === 0" @click="restoreSelected">还原</wd-button>
      <wd-button
        size="small"
        type="error"
        plain
        :disabled="selection.length === 0"
        @click="purgeSelected"
      >彻底删除</wd-button>
    </view>
  </view>
</template>

<script setup>
/**
 * 回收站：独立页面内容区，列表、批量还原、批量彻底删除（二次确认）。
 * 彻底删除会同时删除云存储源文件与关联批注 / 索引，过程不可恢复。
 * 操作成功后 emit changed，由页面通知文档库刷新目录树与文件列表。
 */
import { onMounted, ref } from 'vue'
import { listTrash, restore, purgeDelete } from '@/common/api/mm-file.js'

const emit = defineEmits(['changed'])

const list = ref([])
const loading = ref(false)
const loadFailed = ref(false)
const loadError = ref('')
const selection = ref([])

onMounted(refresh)

async function refresh() {
  loading.value = true
  loadFailed.value = false
  loadError.value = ''
  let res
  try {
    res = await listTrash({ page: 1, pageSize: 100 })
  } catch (error) {
    res = null
    loadError.value = (error && error.message) || ''
  }
  loading.value = false
  if (res && res.code === 0 && res.data) {
    list.value = res.data.list || []
    selection.value = selection.value.filter(id => list.value.some(item => item._id === id))
  } else {
    loadFailed.value = true
    if (!loadError.value) loadError.value = (res && res.message) || '回收站加载失败'
  }
}

function isSelected(id) {
  return selection.value.indexOf(id) !== -1
}

function toggle(id) {
  const next = selection.value.slice()
  const index = next.indexOf(id)
  if (index === -1) next.push(id)
  else next.splice(index, 1)
  selection.value = next
}

async function restoreSelected() {
  if (selection.value.length === 0) return
  const res = await restore({ file_ids: selection.value.slice() })
  if (res.code === 0) {
    uni.showToast({ title: '已还原', icon: 'none' })
    selection.value = []
    await refresh()
    emit('changed')
  }
}

function purgeSelected() {
  if (selection.value.length === 0) return
  uni.showModal({
    title: '彻底删除',
    content: '文件将从云端永久删除，不可恢复',
    confirmText: '彻底删除',
    success: async (modalRes) => {
      if (!modalRes.confirm) return
      const res = await purgeDelete({ file_ids: selection.value.slice() })
      if (res.code === 0) {
        uni.showToast({ title: '已彻底删除', icon: 'none' })
        selection.value = []
        await refresh()
        emit('changed')
      }
    }
  })
}

function formatSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

defineExpose({ refresh })
</script>

<style scoped>
.mm-trash {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--mm-surface);
}

.mm-trash__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: calc(40px * var(--mm-ui-scale, 1));
  padding: 0 calc(16px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
}

.mm-trash__title {
  font-size: calc(14px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-trash__icon-btn {
  display: flex;
  align-items: center;
  padding: calc(4px * var(--mm-ui-scale, 1));
  border-radius: 6px;
  cursor: pointer;
}

.mm-trash__icon-btn:hover {
  background-color: var(--mm-surface-2);
}

.mm-trash__hint {
  display: block;
  padding: calc(8px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  line-height: 1.5;
  color: var(--mm-text-weak);
}

.mm-trash__body {
  flex: 1;
  padding-bottom: calc(12px * var(--mm-ui-scale, 1));
}

.mm-trash__status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(8px * var(--mm-ui-scale, 1));
  padding: calc(48px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  text-align: center;
}

.mm-trash__row {
  display: flex;
  align-items: center;
  gap: calc(10px * var(--mm-ui-scale, 1));
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
}

.mm-trash__check {
  width: 15px;
  height: calc(15px * var(--mm-ui-scale, 1));
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--mm-border);
  border-radius: 4px;
  background-color: var(--mm-surface);
  cursor: pointer;
}

.mm-trash__check.is-checked {
  background-color: var(--mm-accent);
  border-color: var(--mm-accent);
}

.mm-trash__main {
  flex: 1;
  min-width: 0;
}

.mm-trash__name {
  display: block;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-trash__meta {
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-trash__foot {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: calc(10px * var(--mm-ui-scale, 1));
  padding: calc(12px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  border-top: 1px solid var(--mm-border);
  background-color: var(--mm-surface);
}
</style>
