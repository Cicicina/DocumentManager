<template>
  <view class="mm-shares">
    <text class="mm-shares__hint">作废后链接立即失效，无法恢复。无限期分享也可在此提前作废。</text>

    <view class="mm-shares__body">
      <view v-if="loading && list.length === 0" class="mm-shares__status">
        <wd-loading size="20px" />
        <text>正在加载分享列表…</text>
      </view>
      <view v-else-if="loadFailed" class="mm-shares__status">
        <text>{{ loadError || '分享列表加载失败' }}</text>
        <wd-button size="small" plain @click="refresh">重试</wd-button>
      </view>
      <view v-else-if="list.length === 0" class="mm-shares__status">
        <text>还没有创建过分享链接</text>
        <text class="mm-shares__status-tip">打开任意文档，点工具栏的「分享」即可创建</text>
      </view>
      <view v-for="item in list" :key="item._id" class="mm-shares__row">
        <view class="mm-shares__row-head">
          <text class="mm-shares__name" :title="item.doc_name">{{ item.doc_name || '（文档已删除）' }}</text>
          <text class="mm-shares__badge" :class="'is-' + item.status">{{ statusText(item) }}</text>
        </view>
        <text class="mm-shares__meta">
          {{ formatTime(item.created_at) }} 创建 · {{ expireText(item) }} · 打开 {{ item.access_count }} 次
        </text>
        <view v-if="item.status === 'active'" class="mm-shares__row-actions">
          <wd-button size="small" plain @click="copyLink(item)">复制链接</wd-button>
          <wd-button size="small" type="error" plain @click="revokeItem(item)">作废</wd-button>
        </view>
      </view>
    </view>
    <wd-message-box selector="mm-shares" />
  </view>
</template>

<script setup>
/**
 * 分享列表：在「分享管理」独立页中使用，列出当前账号创建过的分享。
 * 展示状态与有效期，支持复制链接与提前作废（作废后立即失效，不可恢复）。
 *
 * 状态由服务端计算（active / expired / revoked），前端不重复判定时间，
 * 避免客户端时钟不准导致「显示有效但打不开」。
 *
 * 加载失败必须显式展示原因与重试按钮，不能静默显示成「还没有分享」——
 * 否则用户会误以为功能没做，实际上只是请求失败。
 */
import { onMounted, ref } from 'vue'
import { listShares, revokeShare } from '@/common/api/mm-share.js'
import { writeShareUrl } from '@/common/utils/clipboard.js'
import { useConfirm } from '@/common/utils/confirm.js'

const { confirm } = useConfirm('mm-shares')

const emit = defineEmits(['changed'])

const list = ref([])
const loading = ref(false)
const loadFailed = ref(false)
const loadError = ref('')

onMounted(refresh)

async function refresh() {
  loading.value = true
  loadFailed.value = false
  loadError.value = ''
  try {
    const res = await listShares({ page: 1, page_size: 100 })
    if (res.code === 0 && res.data) {
      list.value = res.data.items || []
    } else {
      loadFailed.value = true
      loadError.value = res.message || '分享列表加载失败'
    }
  } catch (error) {
    loadFailed.value = true
    loadError.value = (error && error.message) || '分享列表加载失败'
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
  if (item.doc_deleted) return '文档已删除'
  if (item.infinite) return '永久有效'
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
  const confirmed = await confirm({
    title: '作废分享',
    content: `作废后「${item.doc_name || '该文档'}」的这条分享链接会立即失效，且无法恢复。`,
    confirmText: '仍要作废',
    danger: true
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
  background-color: var(--mm-surface);
}

.mm-shares__hint {
  display: block;
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1)) calc(8px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  line-height: 1.5;
  color: var(--mm-text-weak);
}

.mm-shares__body {
  padding: 0 calc(16px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1));
}

.mm-shares__status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(8px * var(--mm-ui-scale, 1));
  padding: calc(24px * var(--mm-ui-scale, 1)) 0;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  text-align: center;
}

.mm-shares__status-tip {
  font-size: calc(11px * var(--mm-ui-scale, 1));
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
