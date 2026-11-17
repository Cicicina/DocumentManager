<template>
  <wd-popup
    v-model="modelVisible"
    position="bottom"
    custom-style="height:82vh;width:100%;left:0;right:0;border-radius:12px 12px 0 0;"
  >
    <view class="mm-search">
      <view class="mm-search__head">
        <wd-input
          ref="inputRef"
          v-model="keyword"
          placeholder="搜索文件名、标签、批注、正文"
          clearable
          @input="onInput"
          @confirm="runSearch"
        />
        <view class="mm-search__close" @click="close">
          <uni-icons type="closeempty" size="18" color="var(--mm-text-weak)" />
        </view>
      </view>

      <view class="mm-search__scopes">
        <view
          v-for="item in scopeOptions"
          :key="item.key"
          class="mm-search__scope"
          :class="{ 'is-active': scope === item.key }"
          @click="changeScope(item.key)"
        >{{ item.label }}</view>
      </view>

      <scroll-view class="mm-search__body" scroll-y>
        <view v-if="loading" class="mm-search__status">
          <wd-loading size="20px" />
        </view>

        <template v-else>
          <view v-if="result.groups.name.length" class="mm-search__group">
            <text class="mm-search__group-title">文件名</text>
            <view
              v-for="item in result.groups.name"
              :key="'n-' + item._id"
              class="mm-search__item"
              @click="pickFile(item._id)"
            >
              <text class="mm-search__item-name">{{ item.name }}</text>
            </view>
          </view>

          <view v-if="result.groups.tag.length" class="mm-search__group">
            <text class="mm-search__group-title">标签</text>
            <view
              v-for="item in result.groups.tag"
              :key="'t-' + item._id"
              class="mm-search__item"
              @click="pickFile(item._id)"
            >
              <text class="mm-search__item-name">{{ item.name }}</text>
              <view class="mm-search__tags">
                <wd-tag v-for="tag in item.tags || []" :key="tag" plain size="small">{{ tag }}</wd-tag>
              </view>
            </view>
          </view>

          <view v-if="result.groups.comment.length" class="mm-search__group">
            <text class="mm-search__group-title">批注</text>
            <view
              v-for="item in result.groups.comment"
              :key="'c-' + item.comment_id"
              class="mm-search__item"
              @click="pickFile(item.file_id)"
            >
              <text class="mm-search__item-name">{{ item.file_name }}</text>
              <text class="mm-search__item-text">{{ item.comment }}</text>
            </view>
          </view>

          <view v-if="result.groups.content.length" class="mm-search__group">
            <text class="mm-search__group-title">正文</text>
            <view
              v-for="hit in result.groups.content"
              :key="'k-' + hit.chunk_id"
              class="mm-search__item"
              @click="pickContent(hit)"
            >
              <text class="mm-search__item-name">
                {{ hit.file_name }}<text v-if="hit.heading"> · {{ hit.heading }}</text>
              </text>
              <text class="mm-search__item-text">{{ hit.snippet }}</text>
            </view>
          </view>

          <view v-if="keyword && result.total === 0" class="mm-search__status">
            <text>没有找到匹配内容</text>
          </view>
        </template>
      </scroll-view>
    </view>
  </wd-popup>
</template>

<script setup>
/**
 * 搜索浮层：关键词 + scope 切换，结果按文件名 / 标签 / 批注 / 正文分组。
 * 正文命中携带 start_offset，点击后抛 select 事件由主壳完成回跳。
 */
import { computed, ref, watch } from 'vue'
import { search } from '@/common/api/mm-search.js'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['update:visible', 'select'])

const inputRef = ref(null)
const keyword = ref('')
const scope = ref('all')
const loading = ref(false)
const result = ref({
  total: 0,
  groups: { tag: [], name: [], comment: [], content: [] }
})

const scopeOptions = [
  { key: 'all', label: '全部' },
  { key: 'name', label: '文件名' },
  { key: 'tag', label: '标签' },
  { key: 'comment', label: '批注' },
  { key: 'content', label: '正文' }
]

const modelVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

let debounceTimer = null

watch(() => props.visible, (value) => {
  if (value) {
    // 打开时聚焦输入框
    setTimeout(() => {
      if (inputRef.value && typeof inputRef.value.focus === 'function') inputRef.value.focus()
    }, 50)
  } else {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }
})

function onInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    runSearch()
  }, 300)
}

function changeScope(key) {
  scope.value = key
  runSearch()
}

async function runSearch() {
  const text = String(keyword.value || '').trim()
  if (!text) {
    result.value = { total: 0, groups: { tag: [], name: [], comment: [], content: [] } }
    return
  }
  loading.value = true
  const res = await search({ keyword: text, scope: scope.value })
  loading.value = false
  if (res.code === 0 && res.data) {
    result.value = {
      total: res.data.total || 0,
      groups: {
        tag: (res.data.groups && res.data.groups.tag) || [],
        name: (res.data.groups && res.data.groups.name) || [],
        comment: (res.data.groups && res.data.groups.comment) || [],
        content: (res.data.groups && res.data.groups.content) || []
      }
    }
  }
}

function pickFile(fileId) {
  emit('select', { file_id: fileId, start_offset: 0 })
  emit('update:visible', false)
}

function pickContent(hit) {
  emit('select', { file_id: hit.file_id, start_offset: hit.start_offset || 0 })
  emit('update:visible', false)
}

function close() {
  emit('update:visible', false)
}

function focus() {
  if (inputRef.value && typeof inputRef.value.focus === 'function') inputRef.value.focus()
}

defineExpose({ focus })
</script>

<style scoped>
.mm-search {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--mm-surface);
}

.mm-search__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mm-border);
}

.mm-search__close {
  flex: none;
  padding: 4px;
  cursor: pointer;
}

.mm-search__scopes {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--mm-border);
  overflow-x: auto;
}

.mm-search__scope {
  flex: none;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--mm-text-weak);
  border: 1px solid var(--mm-border);
  border-radius: 12px;
  cursor: pointer;
}

.mm-search__scope.is-active {
  color: var(--mm-accent);
  border-color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

.mm-search__body {
  flex: 1;
  min-height: 0;
}

.mm-search__status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  font-size: 13px;
  color: var(--mm-text-weak);
}

.mm-search__group {
  padding: 8px 0;
}

.mm-search__group-title {
  display: block;
  padding: 4px 16px;
  font-size: 12px;
  color: var(--mm-text-weak);
}

.mm-search__item {
  padding: 10px 16px;
  cursor: pointer;
}

.mm-search__item:hover {
  background-color: var(--mm-surface-2);
}

.mm-search__item-name {
  display: block;
  font-size: 13px;
  color: var(--mm-text);
}

.mm-search__item-text {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--mm-text-weak);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-search__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
</style>
