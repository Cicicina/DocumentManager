<template>
  <wd-popup v-model="modelVisible" position="right" custom-style="width:min(420px,92vw);height:100%;">
    <view class="mm-trash">
      <view class="mm-trash__head">
        <text class="mm-trash__title">回收站</text>
        <view class="mm-trash__close" @click="close">
          <uni-icons type="closeempty" size="18" color="var(--mm-text-weak)" />
        </view>
      </view>

      <scroll-view class="mm-trash__body" scroll-y>
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
        <view v-if="!loading && list.length === 0" class="mm-trash__empty">
          <text>回收站是空的</text>
        </view>
      </scroll-view>

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
  </wd-popup>
</template>

<script setup>
/**
 * 回收站面板：列表、批量还原、批量彻底删除（二次确认）。
 * 彻底删除会同时删除云存储源文件与关联批注 / 索引，过程不可恢复。
 */
import { computed, ref, watch } from 'vue'
import { listTrash, restore, purgeDelete } from '@/common/api/mm-file.js'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['update:visible', 'changed'])

const list = ref([])
const loading = ref(false)
const selection = ref([])

const modelVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

watch(() => props.visible, (value) => {
  if (value) refresh()
})

async function refresh() {
  loading.value = true
  const res = await listTrash({ page: 1, pageSize: 100 })
  loading.value = false
  if (res.code === 0 && res.data) {
    list.value = res.data.list || []
    selection.value = selection.value.filter(id => list.value.some(item => item._id === id))
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

function close() {
  emit('update:visible', false)
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
  height: 100%;
  background-color: var(--mm-surface);
}

.mm-trash__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--mm-border);
}

.mm-trash__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--mm-text);
}

.mm-trash__close {
  padding: 4px;
  cursor: pointer;
}

.mm-trash__body {
  flex: 1;
  min-height: 0;
}

.mm-trash__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--mm-border);
}

.mm-trash__check {
  width: 15px;
  height: 15px;
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
  font-size: 13px;
  color: var(--mm-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-trash__meta {
  font-size: 12px;
  color: var(--mm-text-weak);
}

.mm-trash__empty {
  padding: 48px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--mm-text-weak);
}

.mm-trash__foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--mm-border);
}
</style>
