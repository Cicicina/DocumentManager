<template>
  <view class="mm-list">
    <!-- 排序 + 快捷操作：合并成一行，不再单占一整行 -->
    <view class="mm-list__sort">
      <text
        v-for="option in sortOptions"
        :key="option.key"
        class="mm-list__sort-item"
        :class="{ 'is-active': sortKey === option.key }"
        @click="changeSort(option.key)"
      >
        {{ option.label }}<text v-if="sortKey === option.key">{{ sortDir === 'asc' ? '↑' : '↓' }}</text>
      </text>
      <view class="mm-list__spacer" />
      <view class="mm-list__action" title="新建文档" @click="emit('create-file')">
        <uni-icons type="compose" size="13" color="var(--mm-text-weak)" />
        <text>新建</text>
      </view>
      <view class="mm-list__action" title="上传 md" @click="emit('upload')">
        <uni-icons type="upload" size="13" color="var(--mm-text-weak)" />
        <text>上传</text>
      </view>
      <view
        v-if="selection.length > 0"
        class="mm-list__action is-danger"
        title="删除所选"
        @click="emit('batch-delete', selection.slice())"
      >
        <uni-icons type="trash" size="13" color="var(--mm-accent)" />
        <text>删除 {{ selection.length }}</text>
      </view>
    </view>

    <!-- 列表：子文件夹在前，文件在后 -->
    <scroll-view class="mm-list__scroll" scroll-y>
      <view
        v-for="folder in childFolders"
        :key="'f-' + folder._id"
        class="mm-list__row mm-list__row--folder"
        @click="emit('open-folder', folder)"
      >
        <view class="mm-list__folder-icon">
          <image
            v-if="folder.icon && folder.icon.type === 'preset' && folder.icon.value"
            class="mm-list__folder-img"
            :src="`/static/icons/${folder.icon.value}.svg`"
            mode="aspectFit"
          />
          <wd-icon
            v-else-if="folder.icon && folder.icon.type === 'wot' && folder.icon.value"
            class="mm-list__folder-icon-wot"
            :name="folder.icon.value"
            size="15px"
            color="var(--mm-text-weak)"
          />
          <uni-icons v-else type="folder" size="15" color="var(--mm-text-weak)" />
        </view>
        <view class="mm-list__main">
          <text class="mm-list__name">{{ folder.name }}</text>
        </view>
        <text class="mm-list__meta mm-list__folder-label">文件夹</text>
        <uni-icons type="arrow-right" size="13" color="var(--mm-text-weak)" />
      </view>
      <view
        v-for="file in sortedFiles"
        :key="file._id"
        class="mm-list__row"
        @click="emit('open', file)"
      >
        <view
          class="mm-list__check"
          :class="{ 'is-checked': isSelected(file._id) }"
          @click.stop="toggleSelect(file._id)"
        >
          <uni-icons
            v-if="isSelected(file._id)"
            type="checkmarkempty"
            size="11"
            color="var(--mm-surface)"
          />
        </view>
        <view class="mm-list__main">
          <text class="mm-list__name">{{ file.name }}</text>
          <view v-if="file.tags && file.tags.length" class="mm-list__tags">
            <wd-tag
              v-for="tag in file.tags.slice(0, 3)"
              :key="tag"
              plain
              size="small"
            >{{ tag }}</wd-tag>
          </view>
        </view>
        <text class="mm-list__meta">{{ formatTime(file.updated_at) }}</text>
        <text class="mm-list__meta mm-list__size">{{ formatSize(file.size) }}</text>
        <view class="mm-list__more" @click.stop="openRowMenu(file)">
          <uni-icons type="more-filled" size="15" color="var(--mm-text-weak)" />
        </view>
      </view>

      <view v-if="!loading && sortedFiles.length === 0 && childFolders.length === 0" class="mm-list__empty">
        <text>还没有文档</text>
        <view class="mm-list__empty-action" @click="emit('create-file')">
          <uni-icons type="compose" size="14" color="var(--mm-accent)" />
          <text>新建文档</text>
        </view>
        <view class="mm-list__empty-action" @click="emit('upload')">
          <uni-icons type="upload" size="14" color="var(--mm-accent)" />
          <text>上传 md / 导入</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
/**
 * 文档清单：名称 / 标签 / 更新时间 / 大小；本地排序、多选与批量删除。
 * 组件不发请求，所有动作用 emits 上报给页面。
 */
import { computed, ref, watch } from 'vue'

const props = defineProps({
  files: { type: Array, default: () => [] },
  folders: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] }
})

const emit = defineEmits([
  'open',
  'open-folder',
  'select-change',
  'sort-change',
  'upload',
  'import',
  'create-file',
  'rename',
  'move',
  'export',
  'share',
  'batch-delete'
])

/** 排序字段与方向 */
const sortKey = ref('updated_at')
const sortDir = ref('desc')

/** 内部维护选中集合，并与外部 selectedIds 保持同步 */
const selection = ref(Array.isArray(props.selectedIds) ? props.selectedIds.slice() : [])

watch(() => props.selectedIds, (value) => {
  selection.value = Array.isArray(value) ? value.slice() : []
})

const sortOptions = [
  { key: 'updated_at', label: '时间' },
  { key: 'name', label: '名称' },
  { key: 'size', label: '大小' }
]

/** 当前目录下的子文件夹：按名称排序，插在文档列表前面 */
const childFolders = computed(() => {
  const list = Array.isArray(props.folders) ? props.folders.slice() : []
  return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
})

const sortedFiles = computed(() => {
  const list = Array.isArray(props.files) ? props.files.slice() : []
  const factor = sortDir.value === 'asc' ? 1 : -1
  list.sort((left, right) => {
    if (sortKey.value === 'name') {
      return String(left.name || '').localeCompare(String(right.name || '')) * factor
    }
    if (sortKey.value === 'size') {
      return ((Number(left.size) || 0) - (Number(right.size) || 0)) * factor
    }
    const leftTime = new Date(left.updated_at || 0).getTime()
    const rightTime = new Date(right.updated_at || 0).getTime()
    return (leftTime - rightTime) * factor
  })
  return list
})

function isSelected(fileId) {
  return selection.value.indexOf(fileId) !== -1
}

function toggleSelect(fileId) {
  const next = selection.value.slice()
  const index = next.indexOf(fileId)
  if (index === -1) next.push(fileId)
  else next.splice(index, 1)
  selection.value = next
  emit('select-change', next.slice())
}

function clearSelection() {
  selection.value = []
  emit('select-change', [])
}

/**
 * 单文件操作菜单：重命名 / 移动到 / 分享 / 导出 / 删除。
 * 组件只上报意图，具体请求由页面完成。
 * @param {object} file 目标文档
 */
function openRowMenu(file) {
  if (!file) return
  uni.showActionSheet({
    itemList: ['重命名', '移动到…', '分享…', '导出 md', '删除'],
    success: (res) => {
      if (res.tapIndex === 0) emit('rename', file)
      else if (res.tapIndex === 1) emit('move', file)
      else if (res.tapIndex === 2) emit('share', file)
      else if (res.tapIndex === 3) emit('export', file)
      else if (res.tapIndex === 4) emit('batch-delete', [file._id])
    }
  })
}

function changeSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'name' ? 'asc' : 'desc'
  }
  emit('sort-change', { key: sortKey.value, dir: sortDir.value })
}

/** 时间格式化：只展示到分钟 */
function formatTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = num => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 字节数格式化 */
function formatSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

defineExpose({ clearSelection })
</script>

<style scoped>
.mm-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.mm-list__sort {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: calc(10px * var(--mm-ui-scale, 1));
  padding: calc(6px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
}

.mm-list__sort-item {
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  cursor: pointer;
}

.mm-list__sort-item.is-active {
  color: var(--mm-accent);
}

.mm-list__spacer {
  flex: 1;
}

/* 排序行右侧的文字 + icon 快捷操作；删除仅在选中文件后出现 */
.mm-list__action {
  display: inline-flex;
  align-items: center;
  gap: calc(3px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  cursor: pointer;
  white-space: nowrap;
}

.mm-list__action:hover {
  color: var(--mm-accent);
}

.mm-list__action.is-danger {
  color: var(--mm-accent);
}

.mm-list__scroll {
  flex: 1;
  min-height: 0;
  height: 100%;
}

.mm-list__row {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--mm-ui-scale, 1));
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
  cursor: pointer;
}

.mm-list__row:hover {
  background-color: var(--mm-surface-2);
}

.mm-list__row--folder {
  background-color: var(--mm-surface-2);
}

.mm-list__folder-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: calc(17px * var(--mm-ui-scale, 1));
}

.mm-list__folder-img {
  width: 15px;
  height: calc(15px * var(--mm-ui-scale, 1));
}

.mm-list__folder-icon-wot {
  width: 15px;
  height: calc(15px * var(--mm-ui-scale, 1));
}

.mm-list__folder-label {
  font-size: calc(11px * var(--mm-ui-scale, 1));
}

.mm-list__check {
  width: 15px;
  height: calc(15px * var(--mm-ui-scale, 1));
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--mm-border);
  border-radius: 4px;
  background-color: var(--mm-surface);
}

.mm-list__check.is-checked {
  background-color: var(--mm-accent);
  border-color: var(--mm-accent);
}

.mm-list__main {
  flex: 1;
  min-width: 0;
}

.mm-list__name {
  display: block;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-list__tags {
  display: flex;
  flex-wrap: wrap;
  gap: calc(4px * var(--mm-ui-scale, 1));
  margin-top: 4px;
}

.mm-list__meta {
  flex: none;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-list__size {
  width: 62px;
  text-align: right;
}

.mm-list__more {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: calc(22px * var(--mm-ui-scale, 1));
  border-radius: 4px;
  cursor: pointer;
}

.mm-list__more:hover {
  background-color: var(--mm-surface-2);
}

.mm-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(10px * var(--mm-ui-scale, 1));
  padding: calc(48px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1));
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-list__empty-action {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--mm-ui-scale, 1));
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-accent);
  cursor: pointer;
}
</style>
