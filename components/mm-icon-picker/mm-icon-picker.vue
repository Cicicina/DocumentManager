<template>
  <wd-popup v-model="modelVisible" position="bottom" custom-style="border-radius:12px 12px 0 0;">
    <view class="mm-icon-picker">
      <view class="mm-icon-picker__title">文件夹图标</view>

      <!-- 8 个预制图标 + 无图标 -->
      <view class="mm-icon-picker__grid">
        <view
          v-for="item in presetKeys"
          :key="item"
          class="mm-icon-picker__item"
          :class="{ 'is-active': isPresetActive(item) }"
          @click="selectPreset(item)"
        >
          <image class="mm-icon-picker__img" :src="`/static/icons/${item}.svg`" mode="aspectFit" />
        </view>
        <view
          class="mm-icon-picker__item"
          :class="{ 'is-active': !draft }"
          @click="selectNone"
        >
          <uni-icons type="closeempty" size="16" color="var(--mm-text-weak)" />
        </view>
      </view>

      <!-- 自定义图标上传 -->
      <view class="mm-icon-picker__custom">
        <image v-if="customPreview" class="mm-icon-picker__preview" :src="customPreview" mode="aspectFit" />
        <wd-button size="small" plain @click="chooseCustom">上传自定义图标</wd-button>
      </view>

      <view class="mm-icon-picker__actions">
        <wd-button size="small" plain @click="close">取消</wd-button>
        <wd-button size="small" type="primary" @click="confirm">确定</wd-button>
      </view>
    </view>
  </wd-popup>
</template>

<script setup>
/**
 * 文件夹图标选择：8 个预制图标 + 自定义上传。
 * 自定义图标先直传云存储拿到 fileID，确认后由父级调 mm-file.updateIcon 落库。
 */
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/common/store/index.js'
import { CLOUD_PATH } from '@/common/constants.js'
import { genUuid } from '@/common/utils/uuid.js'
import { uploadCloudFile } from '@/common/utils/upload.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  current: { type: Object, default: null }
})

const emit = defineEmits(['update:visible', 'confirm'])

const store = useAppStore()

/** 8 个预制图标 key，与 static/icons 下文件名一致 */
const presetKeys = [
  'folder-default',
  'folder-blue',
  'folder-green',
  'folder-warm',
  'folder-purple',
  'folder-red',
  'folder-star',
  'folder-doc'
]

/** 本次选择的草稿，确认后才上报 */
const draft = ref(null)
/** 自定义图标的本地预览地址 */
const customPreview = ref('')

const modelVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

watch(() => props.visible, (value) => {
  if (value) {
    draft.value = props.current ? { ...props.current } : null
    customPreview.value = props.current && props.current.type === 'custom' ? (props.current.url || '') : ''
  }
})

function isPresetActive(key) {
  return !!(draft.value && draft.value.type === 'preset' && draft.value.value === key)
}

function selectPreset(key) {
  draft.value = { type: 'preset', value: key }
}

function selectNone() {
  draft.value = null
}

function guessExtension(filePath) {
  const matched = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(String(filePath || ''))
  return matched ? matched[1].toLowerCase() : 'png'
}

function chooseCustom() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: async (res) => {
      const filePath = res && res.tempFilePaths ? res.tempFilePaths[0] : ''
      if (!filePath) return
      const uid = (store.state.user && store.state.user.uid) || 'anonymous'
      const cloudPath = CLOUD_PATH.icon(uid, guessExtension(filePath)).replace('{uuid}', genUuid())
      try {
        const uploaded = await uploadCloudFile({ cloudPath, filePath })
        const fileID = uploaded && uploaded.fileID
        if (!fileID) throw new Error('未返回 fileID')
        draft.value = { type: 'custom', value: fileID, url: filePath }
        customPreview.value = filePath
      } catch (error) {
        uni.showToast({ title: '上传失败，请重试', icon: 'none' })
      }
    }
  })
}

function close() {
  emit('update:visible', false)
}

function confirm() {
  emit('confirm', draft.value ? { ...draft.value } : null)
  emit('update:visible', false)
}
</script>

<style scoped>
.mm-icon-picker {
  padding: 16px 16px 20px;
}

.mm-icon-picker__title {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--mm-text);
}

.mm-icon-picker__grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.mm-icon-picker__item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  border: 1px solid var(--mm-border);
  border-radius: 8px;
  background-color: var(--mm-surface);
  cursor: pointer;
}

.mm-icon-picker__item.is-active {
  border-color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

.mm-icon-picker__img {
  width: 22px;
  height: 22px;
}

.mm-icon-picker__custom {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.mm-icon-picker__preview {
  width: 32px;
  height: 32px;
  border: 1px solid var(--mm-border);
  border-radius: 6px;
}

.mm-icon-picker__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
</style>
