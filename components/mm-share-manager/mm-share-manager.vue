<template>
  <wd-popup v-model="modelVisible" position="right" custom-style="width:min(460px,92vw);height:100%;">
    <view class="mm-shares">
      <view class="mm-shares__head">
        <text class="mm-shares__title">分享管理</text>
        <view class="mm-shares__head-actions">
          <view class="mm-shares__icon-btn" title="刷新" aria-label="刷新" @click="refresh">
            <uni-icons type="refresh" size="16" color="var(--mm-text-weak)" />
          </view>
          <view class="mm-shares__icon-btn" title="关闭" aria-label="关闭" @click="close">
            <uni-icons type="closeempty" size="18" color="var(--mm-text-weak)" />
          </view>
        </view>
      </view>

      <text class="mm-shares__hint">作废后链接立即失效，无法恢复。</text>

      <scroll-view class="mm-shares__body" scroll-y>
        <view v-if="loading && list.length === 0" class="mm-shares__status">
          <wd-loading size="20px" />
        </view>
        <view v-else-if="list.length === 0" class="mm-shares__status">
          <text>还没有创建过分享链接</text>
        </view>
        <view v-for="item in list" :key="item._id" class="mm-shares__row">
          <view class="mm-shares__row-head">
            <text class="mm-shares__name" :title="item.doc_name">{{ item.doc_name || '（文档已删除）' }}</text>
            <text class="mm-shares__badge" :class="'is-' + item.status">{{ statusText(item) }}</text>
          </view>
          <text class="mm-shares__meta">
            {{ formatTime(item.created_at) }} 创建 · {{ expireText(item) }} · 打开 {{ item.access_count }} 次
          </text>
          <view class="mm-shares__row-actions">
            <wd-button size="small" plain :disabled="item.status !== 'active'" @click="copyLink(item)">复制链接</wd-button>
            <wd-button
              size="small"
              type="error"
              plain
              :disabled="item.status === 'revoked'"
              @click="revokeItem(item)"
            >作废</wd-button>
          </view>
        </view>
      </scroll-view>
    </view>
  </wd-popup>
</template>

<script setup>
/**
 * 分享管理面板：列出当前账号创建过的分享链接，展示状态与有效期，
 * 支持复制链接与提前作废（作废后立即失效，不可恢复）。
 *
 * 状态由服务端计算（active / expired / revoked），前端不重复判定时间，
 * 避免客户端时钟不准导致「显示有效但打不开」。
 */
import { computed, ref, watch } from 'vue'
import { listShares, revokeShare } from '@/common/api/mm-share.js'
import { writeShareUrl } from '@/common/utils/clipboard.js'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['update:visible', 'changed'])

const list = ref([])
const loading = ref(false)

const modelVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

watch(() => props.visible, (value) => {
  if (value) refresh()
})

function close() {
  modelVisible.value = false
}

async function refresh() {
  loading.value = true
  try {
    const res = await listShares({ page: 1, page_size: 100 })
    if (res.code === 0 && res.data) {
      list.value = res.data.items || []
    } else {
      toastError(res.message || '分享列表加载失败')
    }
  } finally {
    loading.value = false
  }
}

function toastError(message) {
  uni.showToast({ title: message || '操作失败', icon: 'none' })
}

/** 状态文案 */
function statusText(item) {
  if (item.status === 'revoked') return '已作废'
  if (item.status === 'expired') return '已过期'
  return '有效'
}

/** 有效期文案：无限期 / 具体到期时间 */
function expireText(item) {
  if (item.infinite) return '永久有效'
  if (item.doc_deleted) return '文档已删除'
  return formatTime(item.expire_at) + ' 到期'
}

function formatTime(value) {
  if (!value) return '--'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const pad = num => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function copyLink(item) {
  const copied = await writeShareUrl(item.token)
  uni.showToast({ title: copied ? '链接已复制' : '复制失败，请重试', icon: 'none' })
}

async function revokeItem(item) {
  const confirmed = await new Promise(resolve => {
    uni.showModal({
      title: '作废分享',
      content: `作废后「${item.doc_name || '该文档'}」的这条分享链接会立即失效，且无法恢复。`,
      success: res => resolve(!!res.confirm),
      fail: () => resolve(false)
    })
  })
  if (!confirmed) return
  const res = await revokeShare({ share_id: item._id })
  if (res.code === 0) {
    item.status = 'revoked'
    item.revoked = true
    uni.showToast({ title: '已作废', icon: 'none' })
    emit('changed')
  } else {
    toastError(res.message || '作废失败，请重试')
  }
}
</script>

<style scoped>
.mm-shares {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--mm-surface);
}

.mm-shares__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  height: calc(48px * var(--mm-ui-scale, 1));
  padding: 0 calc(14px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
}

.mm-shares__title {
  font-size: calc(14px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-shares__head-actions {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--mm-ui-scale, 1));
}

.mm-shares__icon-btn {
  display: flex;
  align-items: center;
  padding: calc(4px * var(--mm-ui-scale, 1));
  border-radius: 6px;
  cursor: pointer;
}

.mm-shares__icon-btn:hover {
  background-color: var(--mm-surface-2);
}

.mm-shares__hint {
  flex: none;
  padding: calc(8px * var(--mm-ui-scale, 1)) calc(14px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-shares__body {
  flex: 1;
  min-height: 0;
  padding: 0 calc(14px * var(--mm-ui-scale, 1)) calc(14px * var(--mm-ui-scale, 1));
}

.mm-shares__status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(40px * var(--mm-ui-scale, 1)) 0;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-shares__row {
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1));
  margin-bottom: calc(8px * var(--mm-ui-scale, 1));
  border: 1px solid var(--mm-border);
  border-radius: 8px;
  background-color: var(--mm-surface-2);
}

.mm-shares__row-head {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--mm-ui-scale, 1));
}

.mm-shares__name {
  flex: 1;
  min-width: 0;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  font-weight: 500;
  color: var(--mm-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-shares__badge {
  flex: none;
  padding: 0 calc(6px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  line-height: calc(18px * var(--mm-ui-scale, 1));
  border-radius: 9px;
  border: 1px solid var(--mm-border);
  color: var(--mm-text-weak);
}

.mm-shares__badge.is-active {
  color: var(--mm-accent);
  border-color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

.mm-shares__badge.is-expired {
  color: var(--mm-warning);
  border-color: var(--mm-warning);
}

.mm-shares__meta {
  display: block;
  margin-top: calc(4px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  line-height: 1.6;
  color: var(--mm-text-weak);
}

.mm-shares__row-actions {
  display: flex;
  justify-content: flex-end;
  gap: calc(8px * var(--mm-ui-scale, 1));
  margin-top: calc(8px * var(--mm-ui-scale, 1));
}
</style>
