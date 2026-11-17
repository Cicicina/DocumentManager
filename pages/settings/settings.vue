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
        <view class="mm-settings-page__row" @click="trashVisible = true">
          <text class="mm-settings-page__label">回收站</text>
          <uni-icons type="right" size="14" color="var(--mm-text-weak)" />
        </view>
        <view class="mm-settings-page__row" @click="openImageSpace">
          <text class="mm-settings-page__label">图片空间</text>
          <uni-icons type="right" size="14" color="var(--mm-text-weak)" />
        </view>
        <view class="mm-settings-page__row">
          <text class="mm-settings-page__label">读取剪贴板并询问是否追加到文档</text>
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

    <!-- 回收站 -->
    <mm-trash v-model:visible="trashVisible" @changed="noop" />

    <!-- 图片空间：列表 / 预览 / 单独清理 -->
    <wd-popup v-model="imageSpaceVisible" position="bottom" custom-style="height:72vh;border-radius:12px 12px 0 0;">
      <view class="mm-image-space">
        <view class="mm-image-space__head">
          <text class="mm-image-space__title">图片空间</text>
          <view class="mm-image-space__close" @click="imageSpaceVisible = false">
            <uni-icons type="closeempty" size="18" color="var(--mm-text-weak)" />
          </view>
        </view>
        <scroll-view class="mm-image-space__body" scroll-y>
          <view v-if="imageLoading" class="mm-image-space__status"><wd-loading size="20px" /></view>
          <view v-else-if="imageList.length === 0" class="mm-image-space__status"><text>还没有图片</text></view>
          <view v-else class="mm-image-space__grid">
            <view
              v-for="item in imageList"
              :key="item._id"
              class="mm-image-space__item"
              :title="imageTitle(item)"
            >
              <image
                v-if="imageUrls[item.file_id]"
                class="mm-image-space__img"
                :src="imageUrls[item.file_id]"
                mode="aspectFill"
              />
              <view v-else class="mm-image-space__placeholder">
                <uni-icons type="image" size="18" color="var(--mm-text-weak)" />
              </view>
              <text v-if="item.ref_count > 0" class="mm-image-space__refs">{{ item.ref_count }} 引用</text>
              <view class="mm-image-space__remove" @click="removeImage(item)">
                <uni-icons type="trash" size="12" color="var(--mm-text)" />
              </view>
              <text class="mm-image-space__size">{{ formatSize(item.size) }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </wd-popup>

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
import { formatSize } from '@/common/utils/format.js'
import { getConfig, updateConfig, listUsers, setUserPermission } from '@/common/api/mm-settings.js'
import { list as listImages, getTempUrls, remove as removeImages, removeSilent } from '@/common/api/mm-image.js'

const store = useAppStore()

const users = ref([])
const usersLoading = ref(false)
const trashVisible = ref(false)
const imageSpaceVisible = ref(false)
const imageList = ref([])
const imageUrls = ref({})
const imageLoading = ref(false)

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

async function openImageSpace() {
  imageSpaceVisible.value = true
  await loadImages()
}

async function loadImages() {
  imageLoading.value = true
  const res = await listImages({ page: 1, pageSize: 60 })
  if (res.code === 0 && res.data) {
    imageList.value = res.data.list || []
    const ids = imageList.value.map(item => item.file_id).filter(Boolean)
    if (ids.length > 0) {
      const urlRes = await getTempUrls({ file_ids: ids })
      if (urlRes.code === 0 && urlRes.data) imageUrls.value = urlRes.data
    }
  }
  imageLoading.value = false
}

/** 图片卡片的悬浮提示：上传者 + 上传日期 */
function imageTitle(item) {
  if (!item) return ''
  const uploader = item.uploader_nickname || '未知'
  const created = item.created_at ? new Date(item.created_at) : null
  const valid = created && !Number.isNaN(created.getTime())
  const time = valid
    ? `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`
    : ''
  return time ? `上传者：${uploader} · 上传于 ${time}` : `上传者：${uploader}`
}

/**
 * 清理图片：未被文档引用时直接删除，不打扰用户；
 * 只有被引用（4011）才弹确认框并列出引用文档，确认后带 force 级联清理。
 */
async function removeImage(item) {
  const first = await removeSilent({ image_ids: [item._id] })
  if (first.code === 0) {
    uni.showToast({ title: '已清理', icon: 'none' })
    await loadImages()
    return
  }
  if (first.code !== 4011) return

  const info = (first.data && first.data.refs && first.data.refs[0]) || {}
  const names = (info.docs || []).map(doc => doc && doc.name).filter(Boolean)
  const count = Number(info.ref_count) || names.length
  const quoted = names.length > 0 ? `《${names.join('、')}》` : ''
  const suffix = count > names.length ? ` 等 ${count} 篇` : ''

  uni.showModal({
    title: '图片被文档引用',
    content: `该图片被${quoted}${suffix}引用，删除会导致文档中的图片无法显示。是否仍要删除？`,
    confirmText: '仍要删除',
    confirmColor: '#e54d42',
    success: async (res) => {
      if (!res.confirm) return
      const second = await removeImages({ image_ids: [item._id], force: true })
      if (second.code === 0) {
        uni.showToast({ title: '已清理', icon: 'none' })
        await loadImages()
      }
    }
  })
}

function pickTheme(key) {
  store.setTheme(key)
  setStoredTheme(key)
}

function noop() {
  // mm-trash 的 changed 事件在设置页仅用于占位，列表刷新由组件内部完成
}
</script>

<style scoped>
.mm-settings-page {
  min-height: 100vh;
  background-color: var(--mm-bg);
  color: var(--mm-text);
}

.mm-settings-page__inner {
  max-width: 720px;
  margin: 0 auto;
  padding: 8px 0 32px;
}

.mm-settings-page__section {
  margin-top: 12px;
  border-top: 1px solid var(--mm-border);
}

.mm-settings-page__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--mm-border);
  cursor: pointer;
}

.mm-settings-page__label {
  font-size: 13px;
  color: var(--mm-text);
}

.mm-settings-page__themes {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-settings-page__theme {
  padding: 3px 10px;
  font-size: 12px;
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

/* 图片空间 */
.mm-image-space {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--mm-surface);
}

.mm-image-space__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--mm-border);
}

.mm-image-space__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--mm-text);
}

.mm-image-space__close {
  padding: 4px;
  cursor: pointer;
}

.mm-image-space__body {
  flex: 1;
  min-height: 0;
}

.mm-image-space__status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  font-size: 13px;
  color: var(--mm-text-weak);
}

.mm-image-space__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
  padding: 12px 16px 24px;
}

.mm-image-space__item {
  position: relative;
  height: 96px;
  border: 1px solid var(--mm-border);
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--mm-surface-2);
}

/* 引用次数角标：放左上角，避开右上角的删除按钮 */
.mm-image-space__refs {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 1px 6px;
  font-size: 10px;
  line-height: 14px;
  color: var(--mm-bg);
  background-color: var(--mm-accent);
  border-radius: 7px;
}

/* 文件大小：压在卡片底部，半透明底保证在图片上可读 */
.mm-image-space__size {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 2px 6px;
  font-size: 10px;
  line-height: 14px;
  color: var(--mm-text);
  background-color: var(--mm-surface);
  opacity: .9;
  text-align: center;
}

.mm-image-space__img {
  width: 100%;
  height: 100%;
}

.mm-image-space__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.mm-image-space__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background-color: var(--mm-surface);
  border: 1px solid var(--mm-border);
  cursor: pointer;
}
</style>
