<template>
  <view class="mm-tree">
    <!-- 根节点：全部文档（parent_id = ''） -->
    <view
      class="mm-tree__row"
      :class="{ 'is-active': currentId === '' }"
      @click="handleSelect(null)"
    >
      <view class="mm-tree__arrow is-placeholder" />
      <uni-icons class="mm-tree__icon" type="home" size="15" color="var(--mm-text-weak)" />
      <text class="mm-tree__name">全部文档</text>
    </view>

    <!-- 扁平渲染 + 层级缩进，支持不限层嵌套 -->
    <view
      v-for="node in visibleNodes"
      :key="node._id"
      class="mm-tree__row"
      :class="{ 'is-active': currentId === node._id }"
      :style="{ paddingLeft: (node.depth * 14 + 6) + 'px' }"
      @click="handleSelect(node)"
    >
      <view class="mm-tree__arrow" @click.stop="toggle(node._id)">
        <uni-icons
          v-if="hasChildren(node._id)"
          :type="isExpanded(node._id) ? 'arrowdown' : 'arrowright'"
          size="12"
          color="var(--mm-text-weak)"
        />
      </view>
      <image
        v-if="iconSrc(node)"
        class="mm-tree__folder-img"
        :src="iconSrc(node)"
        mode="aspectFit"
      />
      <uni-icons v-else class="mm-tree__icon" type="folder-add" size="15" color="var(--mm-text-weak)" />
      <text class="mm-tree__name">{{ node.name }}</text>
      <view class="mm-tree__more" @click.stop="openMenu(node)">
        <uni-icons type="more-filled" size="15" color="var(--mm-text-weak)" />
      </view>
    </view>

    <!-- 空态：只给一个可操作入口，不写说明性小字 -->
    <view v-if="!loading && visibleNodes.length === 0" class="mm-tree__empty" @click="emitCreate('')">
      <uni-icons type="plus" size="14" color="var(--mm-text-weak)" />
      <text>新建文件夹</text>
    </view>
  </view>
</template>

<script setup>
/**
 * 嵌套目录树：props 接收扁平 folder 节点（含 icon），内部按 parent_id 组树并扁平渲染。
 * 自定义图标的临时 URL 由父级回填到 icon.url（组件自身不发请求）。
 */
import { computed, ref } from 'vue'

const props = defineProps({
  folders: { type: Array, default: () => [] },
  currentId: { type: String, default: '' },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['select', 'create', 'rename', 'move', 'remove', 'change-icon'])

/** 展开状态：{ [folderId]: true } */
const expanded = ref({})

/** 按 parent_id 分组并按名称排序 */
const childrenMap = computed(() => {
  const map = {}
  for (const item of props.folders || []) {
    if (!item || !item._id) continue
    const parentId = item.parent_id || ''
    if (!map[parentId]) map[parentId] = []
    map[parentId].push(item)
  }
  for (const key of Object.keys(map)) {
    map[key].sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
  }
  return map
})

/** 深度优先展开成扁平数组，每项附带 depth */
const visibleNodes = computed(() => {
  const result = []
  const walk = (parentId, depth) => {
    const list = childrenMap.value[parentId] || []
    for (const item of list) {
      result.push({ ...item, depth })
      if (isExpanded(item._id)) walk(item._id, depth + 1)
    }
  }
  walk('', 0)
  return result
})

function hasChildren(folderId) {
  return (childrenMap.value[folderId] || []).length > 0
}

function isExpanded(folderId) {
  return expanded.value[folderId] === true
}

function toggle(folderId) {
  if (!hasChildren(folderId)) return
  expanded.value = { ...expanded.value, [folderId]: !isExpanded(folderId) }
}

/** 图标地址：preset 用 static 资源，custom 用父级回填的临时 URL */
function iconSrc(node) {
  const icon = node && node.icon
  if (!icon || !icon.value) return ''
  if (icon.type === 'preset') return `/static/icons/${icon.value}.svg`
  return icon.url || ''
}

function handleSelect(node) {
  emit('select', node || null)
}

function emitCreate(parentId) {
  emit('create', { parent_id: parentId || '' })
}

function openMenu(node) {
  uni.showActionSheet({
    itemList: ['新建子文件夹', '重命名', '移动到…', '更换图标', '删除'],
    success: (res) => {
      if (res.tapIndex === 0) emit('create', { parent_id: node._id })
      else if (res.tapIndex === 1) emit('rename', node)
      else if (res.tapIndex === 2) emit('move', node)
      else if (res.tapIndex === 3) emit('change-icon', node)
      else if (res.tapIndex === 4) emit('remove', node)
    }
  })
}

function expandAll() {
  const next = { ...expanded.value }
  for (const item of props.folders || []) {
    if (item && item._id && hasChildren(item._id)) next[item._id] = true
  }
  expanded.value = next
}

function collapseAll() {
  expanded.value = {}
}

defineExpose({ expandAll, collapseAll })
</script>

<style scoped>
.mm-tree {
  padding: 4px 0;
}

.mm-tree__row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding-right: 6px;
  color: var(--mm-text);
  cursor: pointer;
}

.mm-tree__row:hover {
  background-color: var(--mm-surface-2);
}

.mm-tree__row.is-active {
  background-color: var(--mm-accent-weak);
  color: var(--mm-accent);
}

.mm-tree__arrow {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.mm-tree__arrow.is-placeholder {
  visibility: hidden;
}

.mm-tree__folder-img {
  width: 15px;
  height: 15px;
  flex: none;
}

.mm-tree__icon {
  flex: none;
}

.mm-tree__name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 固定展示：hover 才显示会让触屏设备永远点不到菜单 */
.mm-tree__more {
  display: flex;
  flex: none;
  padding: 2px;
  border-radius: 4px;
}

.mm-tree__more:hover {
  background-color: var(--mm-surface);
}

.mm-tree__empty {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--mm-text-weak);
  cursor: pointer;
}
</style>
