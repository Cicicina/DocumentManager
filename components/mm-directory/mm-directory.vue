<template>
  <view class="mm-dir">
    <!-- 排序 + 快捷操作：合并目录只有这一个工具栏 -->
    <view class="mm-dir__toolbar">
      <text
        v-for="option in sortOptions"
        :key="option.key"
        class="mm-dir__sort"
        :class="{ 'is-active': sortKey === option.key }"
        @click="changeSort(option.key)"
      >{{ option.label }}<text v-if="sortKey === option.key">{{ sortDir === 'asc' ? '↑' : '↓' }}</text></text>
      <view class="mm-dir__spacer" />
      <view class="mm-dir__action" title="新建文档" @click="emit('create-file')">
        <uni-icons type="compose" size="13" color="var(--mm-text-weak)" />
        <text>新建</text>
      </view>
      <view class="mm-dir__action" title="上传 md" @click="emit('upload')">
        <uni-icons type="upload" size="13" color="var(--mm-text-weak)" />
        <text>上传</text>
      </view>
      <view
        v-if="selection.length > 0"
        class="mm-dir__action is-danger"
        title="删除所选"
        @click="deleteSelected"
      >
        <uni-icons type="trash" size="13" color="var(--mm-accent)" />
        <text>删除 {{ selection.length }}</text>
      </view>
    </view>

    <scroll-view class="mm-dir__scroll" scroll-y>
      <!-- 根节点：全部文档，不是真实文件夹记录 -->
      <view
        class="mm-dir__row mm-dir__row--folder"
        :class="{ 'is-active': currentId === '' }"
        @click="selectRoot"
      >
        <view class="mm-dir__arrow is-placeholder" />
        <image v-if="rootIconSrc" class="mm-dir__folder-img" :src="rootIconSrc" mode="aspectFit" />
        <wd-icon
          v-else-if="isWot(rootIcon)"
          class="mm-dir__folder-wot"
          :name="rootIcon.value"
          size="15px"
          color="var(--mm-text-weak)"
        />
        <uni-icons v-else class="mm-dir__icon" type="home" size="15" color="var(--mm-text-weak)" />
        <text class="mm-dir__name">{{ rootName || '全部文档' }}</text>
        <view class="mm-dir__more" @click.stop="openRootMenu">
          <uni-icons type="more-filled" size="15" color="var(--mm-text-weak)" />
        </view>
      </view>

      <!-- 文件夹与文件在同一列按层级展开，统一参与当前排序 -->
      <template v-for="node in visibleNodes" :key="node.key">
        <view
          v-if="node.kind === 'folder'"
          class="mm-dir__row mm-dir__row--folder"
          :class="{ 'is-active': currentId === node.data._id }"
          :style="rowStyle(node.depth)"
          @click="selectFolder(node.data)"
        >
          <!-- 文件夹一律显示展开箭头：末级文件夹里的文件是展开后才按需加载的，
               若按“当前是否已有子项”隐藏箭头，用户就点不到展开，形成死锁。 -->
          <view class="mm-dir__arrow" @click.stop="toggleFolder(node.data._id)">
            <uni-icons
              class="mm-dir__chevron"
              :class="{ 'is-expanded': isExpanded(node.data._id) }"
              type="arrowright"
              size="12"
              color="var(--mm-text-weak)"
            />
          </view>
          <image
            v-if="iconSrc(node.data)"
            class="mm-dir__folder-img"
            :src="iconSrc(node.data)"
            mode="aspectFit"
          />
          <wd-icon
            v-else-if="isWot(node.data.icon)"
            class="mm-dir__folder-wot"
            :name="node.data.icon.value"
            size="15px"
            color="var(--mm-text-weak)"
          />
          <image
            v-else
            class="mm-dir__folder-img"
            src="/static/icons/folder-default.svg"
            mode="aspectFit"
          />
          <text class="mm-dir__name">{{ node.data.name }}</text>
          <text class="mm-dir__meta mm-dir__folder-label">文件夹</text>
          <view class="mm-dir__more" @click.stop="openFolderMenu(node.data)">
            <uni-icons type="more-filled" size="15" color="var(--mm-text-weak)" />
          </view>
        </view>

        <view
          v-else
          class="mm-dir__row mm-dir__row--file"
          :style="rowStyle(node.depth)"
          @click="emit('open', node.data)"
        >
          <!-- 首行：名字 / 修改时间 / 文件大小排在同一行 -->
          <view class="mm-dir__file-line">
            <view class="mm-dir__arrow is-placeholder" />
            <view
              class="mm-dir__check"
              :class="{ 'is-checked': isSelected(node.data._id) }"
              @click.stop="toggleSelect(node.data._id)"
            >
              <uni-icons
                v-if="isSelected(node.data._id)"
                type="checkmarkempty"
                size="11"
                color="var(--mm-surface)"
              />
            </view>
            <text class="mm-dir__name">{{ node.data.name }}</text>
            <text class="mm-dir__meta">{{ formatTime(node.data.updated_at) }}</text>
            <text class="mm-dir__meta mm-dir__size">{{ formatSize(node.data.size) }}</text>
            <view class="mm-dir__more" @click.stop="openFileMenu(node.data)">
              <uni-icons type="more-filled" size="15" color="var(--mm-text-weak)" />
            </view>
          </view>
          <!-- 标签另起一行：无标签时整行不渲染，不留空白 -->
          <view v-if="node.data.tags && node.data.tags.length" class="mm-dir__tags">
            <wd-tag v-for="tag in node.data.tags.slice(0, 3)" :key="tag" plain size="small">{{ tag }}</wd-tag>
          </view>
        </view>
      </template>

      <view v-if="!loading && visibleNodes.length === 0" class="mm-dir__empty">
        <text>还没有文档</text>
        <view class="mm-dir__empty-action" @click="emit('create-file')">
          <uni-icons type="compose" size="14" color="var(--mm-accent)" />
          <text>新建文档</text>
        </view>
        <view class="mm-dir__empty-action" @click="emit('upload')">
          <uni-icons type="upload" size="14" color="var(--mm-accent)" />
          <text>上传 md / 导入</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
/**
 * 移动端合并目录：把原「目录树视口 + 当前目录文件视口」合成一棵可展开的层级列表。
 * 文件夹显示图标与名称，文件显示复选框 / 时间 / 大小；两者按同一排序规则参与展示。
 * 组件不发请求、不写缓存，展开态、文件索引与排序均由页面持有。
 */
import { computed, ref, watch } from 'vue'

const props = defineProps({
  folders: { type: Array, default: () => [] },
  /** { [parentId]: file[] }：只含元数据，不含正文 */
  filesByFolder: { type: Object, default: () => ({}) },
  /** { [folderId]: true } */
  expanded: { type: Object, default: () => ({}) },
  /** { key: 'updated_at'|'name'|'size', dir: 'asc'|'desc' } */
  sort: { type: Object, default: () => ({ key: 'updated_at', dir: 'desc' }) },
  currentId: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  rootName: { type: String, default: '' },
  rootIcon: { type: Object, default: null },
  selectedIds: { type: Array, default: () => [] }
})

const emit = defineEmits([
  'select',
  'open',
  'toggle-folder',
  'select-change',
  'sort-change',
  'upload',
  'import',
  'create-file',
  'create',
  'folder-rename',
  'folder-move',
  'folder-remove',
  'rename',
  'move',
  'change-icon',
  'rename-root',
  'change-icon-root',
  'export',
  'share',
  'batch-delete'
])

const sortOptions = [
  { key: 'updated_at', label: '时间' },
  { key: 'name', label: '名称' },
  { key: 'size', label: '大小' }
]

const sortKey = computed(() => props.sort && props.sort.key)
const sortDir = computed(() => props.sort && props.sort.dir)

const selection = ref(Array.isArray(props.selectedIds) ? props.selectedIds.slice() : [])
watch(() => props.selectedIds, (value) => {
  selection.value = Array.isArray(value) ? value.slice() : []
})

const foldersByParent = computed(() => {
  const map = {}
  for (const folder of props.folders || []) {
    if (!folder || !folder._id) continue
    const parentId = folder.parent_id || ''
    if (!map[parentId]) map[parentId] = []
    map[parentId].push(folder)
  }
  return map
})

function filesOf(parentId) {
  const value = props.filesByFolder && props.filesByFolder[parentId || '']
  return Array.isArray(value) ? value : []
}

function isExpanded(folderId) {
  return !!(props.expanded && props.expanded[folderId])
}

/** 同一父级下文件夹与文件一起排序；未展开的目录沿用同一比较器 */
function sortedEntries(parentId) {
  const entries = []
  for (const folder of foldersByParent.value[parentId] || []) {
    entries.push({ kind: 'folder', data: folder, name: String(folder.name || '') })
  }
  for (const file of filesOf(parentId)) {
    entries.push({ kind: 'file', data: file, name: String(file.name || '') })
  }
  const key = sortKey.value || 'updated_at'
  const factor = sortDir.value === 'asc' ? 1 : -1
  entries.sort((left, right) => {
    let result = 0
    if (key === 'name') {
      result = left.name.localeCompare(right.name) * factor
    } else if (key === 'size') {
      result = ((Number(left.data.size) || 0) - (Number(right.data.size) || 0)) * factor
    } else {
      const leftTime = new Date(left.data.updated_at || 0).getTime()
      const rightTime = new Date(right.data.updated_at || 0).getTime()
      result = (leftTime - rightTime) * factor
    }
    if (result !== 0) return result
    // 同值时文件夹在前，再按名称稳定排序
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  return entries
}

const visibleNodes = computed(() => {
  const result = []
  const seen = new Set()
  const walk = (parentId, depth) => {
    for (const entry of sortedEntries(parentId)) {
      const id = entry.data && entry.data._id
      if (!id || seen.has(id)) continue
      seen.add(id)
      result.push({ ...entry, id, depth, key: entry.kind + '-' + id })
      if (entry.kind === 'folder' && isExpanded(id)) walk(id, depth + 1)
    }
  }
  walk('', 0)
  return result
})

const rootIconSrc = computed(() => iconSrc({ icon: props.rootIcon }))

function rowStyle(depth) {
  return { paddingLeft: 'calc(' + (depth * 12 + 6) + 'px * var(--mm-ui-scale, 1))' }
}

function isWot(icon) {
  return !!(icon && icon.type === 'wot' && icon.value)
}

function iconSrc(node) {
  const icon = node && node.icon
  if (!icon || !icon.value) return ''
  if (icon.type === 'preset') return `/static/icons/${icon.value}.svg`
  if (icon.type === 'wot') return ''
  return icon.url || ''
}

function selectRoot() {
  emit('select', null)
}

function selectFolder(folder) {
  emit('select', folder || null)
}

function toggleFolder(folderId) {
  if (!folderId) return
  emit('toggle-folder', folderId)
}

function changeSort(key) {
  const nextKey = key
  const nextDir = key === sortKey.value
    ? (sortDir.value === 'asc' ? 'desc' : 'asc')
    : (key === 'name' ? 'asc' : 'desc')
  emit('sort-change', { key: nextKey, dir: nextDir })
}

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

function deleteSelected() {
  const ids = selection.value.slice()
  if (!ids.length) return
  selection.value = []
  emit('select-change', [])
  emit('batch-delete', ids)
}

function openRootMenu() {
  uni.showActionSheet({
    itemList: ['新建子文件夹', '重命名', '更换图标'],
    success: (res) => {
      if (res.tapIndex === 0) emit('create', { parent_id: '' })
      else if (res.tapIndex === 1) emit('rename-root')
      else if (res.tapIndex === 2) emit('change-icon-root')
    }
  })
}

function openFolderMenu(folder) {
  if (!folder) return
  // 文件夹与文件用不同事件名，页面直接路由到各自的处理器，避免类型判定歧义
  uni.showActionSheet({
    itemList: ['新建子文件夹', '重命名', '移动到…', '更换图标', '删除'],
    success: (res) => {
      if (res.tapIndex === 0) emit('create', { parent_id: folder._id })
      else if (res.tapIndex === 1) emit('folder-rename', folder)
      else if (res.tapIndex === 2) emit('folder-move', folder)
      else if (res.tapIndex === 3) emit('change-icon', folder)
      else if (res.tapIndex === 4) emit('folder-remove', folder)
    }
  })
}

function openFileMenu(file) {
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

function formatTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = num => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

defineExpose({ clearSelection: () => { selection.value = [] } })
</script>

<style scoped>
.mm-dir {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.mm-dir__toolbar {
  display: flex;
  align-items: center;
  flex: none;
  gap: calc(10px * var(--mm-ui-scale, 1));
  padding: calc(6px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
}

.mm-dir__sort,
.mm-dir__action {
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  cursor: pointer;
  white-space: nowrap;
}

.mm-dir__sort.is-active {
  color: var(--mm-accent);
}

.mm-dir__spacer {
  flex: 1;
}

.mm-dir__action {
  display: inline-flex;
  align-items: center;
  gap: calc(3px * var(--mm-ui-scale, 1));
}

.mm-dir__action.is-danger {
  color: var(--mm-accent);
}

.mm-dir__scroll {
  flex: 1;
  min-height: 0;
}

.mm-dir__row {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--mm-ui-scale, 1));
  min-height: calc(40px * var(--mm-ui-scale, 1));
  padding-right: calc(8px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
  background-color: var(--mm-surface);
  color: var(--mm-text);
  cursor: pointer;
}

.mm-dir__row.is-active {
  background-color: var(--mm-accent-weak);
  color: var(--mm-accent);
}

/* 文件行改为纵向：首行放名字/时间/大小，标签按需另起一行。
   基础高度从通用行的 40px 降到 32px，无标签时整行更紧凑。 */
.mm-dir__row--file {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  min-height: 0;
  padding: calc(3px * var(--mm-ui-scale, 1)) calc(8px * var(--mm-ui-scale, 1));
}

.mm-dir__file-line {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--mm-ui-scale, 1));
  min-height: calc(32px * var(--mm-ui-scale, 1));
}

/* 文件行的箭头只是占位，不需要 34px 命中区高度，跟随首行即可 */
.mm-dir__row--file .mm-dir__arrow {
  height: calc(32px * var(--mm-ui-scale, 1));
}

.mm-dir__arrow {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: calc(34px * var(--mm-ui-scale, 1));
}

.mm-dir__arrow::after {
  content: '';
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  left: -6px;
}

.mm-dir__arrow.is-placeholder {
  visibility: hidden;
}

.mm-dir__chevron {
  transition: transform 0.18s ease;
  transform-origin: center;
}

.mm-dir__chevron.is-expanded {
  transform: rotate(90deg);
}

.mm-dir__folder-img {
  width: calc(15px * var(--mm-ui-scale, 1));
  height: calc(15px * var(--mm-ui-scale, 1));
  flex: none;
}

.mm-dir__folder-wot,
.mm-dir__icon {
  flex: none;
  transform: scale(var(--mm-ui-scale, 1));
  transform-origin: left center;
}

.mm-dir__check {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: calc(15px * var(--mm-ui-scale, 1));
  border: 1px solid var(--mm-border);
  border-radius: 4px;
  background-color: var(--mm-surface);
}

.mm-dir__check.is-checked {
  background-color: var(--mm-accent);
  border-color: var(--mm-accent);
}

.mm-dir__name {
  flex: 1;
  min-width: 0;
  display: block;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 标签独立成行，缩进到与首行文件名对齐：
   占位箭头 14px + gap 6px + 复选框 15px + gap 6px（均乘 scale） */
.mm-dir__tags {
  display: flex;
  flex-wrap: wrap;
  gap: calc(4px * var(--mm-ui-scale, 1));
  padding-left: calc(41px * var(--mm-ui-scale, 1));
  margin-top: calc(2px * var(--mm-ui-scale, 1));
  padding-bottom: calc(4px * var(--mm-ui-scale, 1));
}

.mm-dir__meta {
  flex: none;
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-dir__size {
  width: 56px;
  text-align: right;
}

.mm-dir__folder-label {
  margin-left: auto;
}

.mm-dir__more {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: calc(22px * var(--mm-ui-scale, 1));
  border-radius: 4px;
}

.mm-dir__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(10px * var(--mm-ui-scale, 1));
  padding: calc(48px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1));
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-dir__empty-action {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--mm-ui-scale, 1));
  color: var(--mm-accent);
  cursor: pointer;
}
</style>
