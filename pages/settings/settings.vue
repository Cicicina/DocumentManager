<template>
  <view class="mm-settings-page">
    <view class="mm-settings-page__inner">
      <!-- 账号 / 权限开关与用户授权 -->
      <mm-settings-panel
        :config="store.state.config"
        :users="users"
        :loading="usersLoading"
        @update-config="handleUpdateConfig"
        @update-permission="handleUpdatePermission"
        @refresh-users="loadUsers"
      />

      <!-- 其他入口 -->
      <view class="mm-settings-page__section">
        <view class="mm-settings-page__row" @click="goTrash">
          <text class="mm-settings-page__label">回收站</text>
          <uni-icons type="right" size="14" color="var(--mm-text-weak)" />
        </view>
        <view class="mm-settings-page__row" @click="openShareList">
          <text class="mm-settings-page__label">分享管理</text>
          <uni-icons type="right" size="14" color="var(--mm-text-weak)" />
        </view>
        <view class="mm-settings-page__row" @click="goImageSpace">
          <text class="mm-settings-page__label">图片空间</text>
          <uni-icons type="right" size="14" color="var(--mm-text-weak)" />
        </view>
        <view class="mm-settings-page__row">
          <text class="mm-settings-page__label">读取剪贴板功能</text>
          <wd-switch v-model="clipboardAppendEnabled" />
        </view>
        <view class="mm-settings-page__row">
          <text class="mm-settings-page__label">主题</text>
          <view class="mm-settings-page__themes">
            <text
              v-for="item in themeOptions"
              :key="item.key"
              class="mm-settings-page__theme"
              :class="{ 'is-active': store.state.theme === item.key }"
              @click="pickTheme(item.key)"
            >{{ item.label }}</text>
          </view>
        </view>
        <view class="mm-settings-page__row">
          <text class="mm-settings-page__label">字号</text>
          <view class="mm-settings-page__themes">
            <text
              v-for="item in fontOptions"
              :key="item.value"
              class="mm-settings-page__theme"
              :class="{ 'is-active': fontScale === item.value }"
              @click="pickFont(item.value)"
            >{{ item.label }}</text>
          </view>
        </view>
      </view>

    </view>

    <!-- 轻提示挂载点（必需） -->
    <wd-toast />
  </view>
</template>

<script setup>
/**
 * 设置页：复用 mm-settings-panel 完成账号 / 权限开关与授权，
 * 并提供回收站、图片空间入口与主题三态切换。
 * 4001（多用户拒绝关闭账号）等错误由 api 层按后端原始 message 提示，
 * 本页不覆盖文案，失败时开关按受控状态自动回滚。
 */
import { ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAppStore } from '@/common/store/index.js'
import { ANONYMOUS_USER_ID } from '@/common/constants.js'
import { setStoredTheme } from '@/common/utils/theme.js'
import { FONT_OPTIONS, getStoredFont, setStoredFont } from '@/common/utils/font.js'
import { getConfig, updateConfig, listUsers, setUserPermission } from '@/common/api/mm-settings.js'

const store = useAppStore()

const users = ref([])
const usersLoading = ref(false)

/** 本地交互偏好：允许读取剪贴板并询问是否追加到当前文档（默认开启） */
const clipboardAppendEnabled = ref(uni.getStorageSync('mm_clipboard_append_enabled') !== false)
watch(clipboardAppendEnabled, value => {
  try {
    uni.setStorageSync('mm_clipboard_append_enabled', value)
  } catch (error) {
    // 存储不可用时仅影响本次会话
  }
})

const themeOptions = [
  { key: 'auto', label: '自动' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' }
]

/** 字号五档：极大 / 大 / 中（默认） / 小 / 极小 */
const fontOptions = FONT_OPTIONS
const fontScale = ref(getStoredFont())

function pickFont(value) {
  fontScale.value = setStoredFont(value)
}

onLoad(async () => {
  await refreshConfig()
  await loadUsers()
})

async function refreshConfig() {
  const res = await getConfig()
  if (res.code === 0 && res.data) store.setConfig(res.data)
}

async function loadUsers() {
  if (store.state.config.permission_enabled !== true) {
    users.value = []
    return
  }
  usersLoading.value = true
  const res = await listUsers({ page: 1, pageSize: 100 })
  usersLoading.value = false
  if (res.code === 0 && res.data) users.value = res.data.list || []
}

async function handleUpdateConfig(patch) {
  const res = await updateConfig(patch)
  if (res.code === 0 && res.data) {
    store.setConfig(res.data)
    if (res.data.account_enabled === false) {
      store.setUser({ anonymous: true, uid: ANONYMOUS_USER_ID })
    }
    await loadUsers()
  }
  // 失败时不动 store.config，受控开关自动回到原状态
}

async function handleUpdatePermission(payload) {
  const res = await setUserPermission(payload)
  if (res.code === 0) await loadUsers()
}

function goTrash() {
  uni.navigateTo({ url: '/pages/trash/trash' })
}

function openShareList() {
  uni.navigateTo({ url: '/pages/share-list/share-list' })
}

function goImageSpace() {
  uni.navigateTo({ url: '/pages/image-space/image-space' })
}

function pickTheme(key) {
  store.setTheme(key)
  setStoredTheme(key)
}

</script>

<style scoped>
.mm-settings-page {
  min-height: 100vh;
  background-color: var(--mm-bg);
  color: var(--mm-text);
  /* 跟随字号档位：在设置页改档位能立刻看到变化，不用回文档页验证 */
  font-size: calc(13px * var(--mm-font-scale, 1));
}

.mm-settings-page__inner {
  max-width: 720px;
  margin: 0 auto;
  padding: calc(8px * var(--mm-ui-scale, 1)) 0 calc(32px * var(--mm-ui-scale, 1));
}

.mm-settings-page__section {
  margin-top: 12px;
  border-top: 1px solid var(--mm-border);
}

.mm-settings-page__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: calc(48px * var(--mm-ui-scale, 1));
  padding: calc(8px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
  cursor: pointer;
}

.mm-settings-page__label {
  font-size: 1em;
  color: var(--mm-text);
}

.mm-settings-page__themes {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--mm-ui-scale, 1));
}

.mm-settings-page__theme {
  padding: calc(3px * var(--mm-ui-scale, 1)) calc(10px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  border: 1px solid var(--mm-border);
  border-radius: 10px;
  cursor: pointer;
}

.mm-settings-page__theme.is-active {
  color: var(--mm-accent);
  border-color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

</style>
