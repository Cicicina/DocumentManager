<template>
  <wd-popup v-model="modelVisible" position="bottom" custom-style="height:72vh;border-radius:12px 12px 0 0;">
    <view class="mm-image-picker">
      <view class="mm-image-picker__head">
        <text class="mm-image-picker__title">插入图片</text>
        <view class="mm-image-picker__close" @click="close">
          <uni-icons type="closeempty" size="18" color="var(--mm-text-weak)" />
        </view>
      </view>

      <view class="mm-image-picker__toolbar">
        <wd-button size="small" type="primary" plain @click="chooseNew">上传新图片</wd-button>
      </view>

      <scroll-view class="mm-image-picker__body" scroll-y>
        <view v-if="loading" class="mm-image-picker__status">
          <wd-loading size="20px" />
        </view>
        <view v-else-if="images.length === 0" class="mm-image-picker__status">
          <text>图片空间还是空的</text>
        </view>
        <view v-else class="mm-image-picker__grid">
          <view
            v-for="item in images"
            :key="item._id"
            class="mm-image-picker__item"
            :title="imageTitle(item)"
            @click="pick(item)"
          >
            <image
              v-if="tempUrls[item.file_id]"
              class="mm-image-picker__img"
              :src="tempUrls[item.file_id]"
              mode="aspectFill"
            />
            <view v-else class="mm-image-picker__placeholder">
              <uni-icons type="image" size="18" color="var(--mm-text-weak)" />
            </view>
            <text v-if="item.ref_count > 0" class="mm-image-picker__refs">{{ item.ref_count }}</text>
            <!-- 大小 + 上传者：手机上也能看到，不依赖悬浮 title -->
            <text class="mm-image-picker__size">{{ formatSize(item.size) }} · {{ item.uploader_nickname || '访客' }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
  </wd-popup>
</template>

<script setup>
/**
 * 图片选择器：① 上传新图片（uni.chooseImage → uniCloud.uploadFile → mm-image.register）
 * ② 从已有图片空间复用（不重复上传，C7）。
 * 选中后只 emit select({fileId, name, tempUrl})，不直接改正文；插入位置由编辑器决定。
 */
import { computed, ref, watch } from 'vue'
import { list as listImages, getTempUrls, register as registerImage } from '@/common/api/mm-image.js'
import { CLOUD_PATH } from '@/common/constants.js'
import { genUuid } from '@/common/utils/uuid.js'
import { uploadCloudFile } from '@/common/utils/upload.js'
import { formatSize } from '@/common/utils/format.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  uid: { type: String, default: '' }
})

const emit = defineEmits(['update:visible', 'select'])

const images = ref([])
const tempUrls = ref({})
const loading = ref(false)

const modelVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

watch(() => props.visible, (value) => {
  if (value) loadImages()
})

async function loadImages() {
  loading.value = true
  const res = await listImages({ page: 1, pageSize: 60 })
  if (res.code === 0 && res.data) {
    images.value = res.data.list || []
    const ids = images.value.map(item => item.file_id).filter(Boolean)
    if (ids.length > 0) {
      const urlRes = await getTempUrls({ file_ids: ids })
      if (urlRes.code === 0 && urlRes.data) tempUrls.value = urlRes.data
    }
  }
  loading.value = false
}

function guessExtension(fileName) {
  const matched = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(String(fileName || ''))
  return matched ? matched[1].toLowerCase() : 'png'
}

function chooseNew() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: async (res) => {
      const filePath = res && res.tempFilePaths ? res.tempFilePaths[0] : ''
      const file = res && res.tempFiles ? res.tempFiles[0] : null
      if (!filePath && !file) return
      const name = (file && file.name) || `image.${guessExtension(filePath)}`
      const extension = guessExtension(name)
      const uid = props.uid || 'anonymous'
      const cloudPath = CLOUD_PATH.image(uid, extension).replace('{uuid}', genUuid())
      try {
        const uploaded = await uploadCloudFile({ cloudPath, filePath, file })
        const fileID = uploaded && uploaded.fileID
        if (!fileID) throw new Error('未返回 fileID')
        await registerImage({
          file_id: fileID,
          name,
          extension,
          size: (file && file.size) || 0,
          cloud_path: cloudPath
        })
        const urlRes = await getTempUrls({ file_ids: [fileID] })
        const tempUrl = urlRes.code === 0 && urlRes.data ? urlRes.data[fileID] : filePath
        emit('select', { fileId: fileID, name, tempUrl })
        emit('update:visible', false)
      } catch (error) {
        uni.showToast({ title: '上传失败，请重试', icon: 'none' })
      }
    }
  })
}

/** 网格项的悬浮提示：上传者 + 引用次数（引用为 0 时不显示角标） */
function imageTitle(item) {
  if (!item) return ''
  const uploader = item.uploader_nickname || '未知'
  const refs = Number(item.ref_count) || 0
  return refs > 0 ? `上传者：${uploader} · 被 ${refs} 篇文档引用` : `上传者：${uploader}`
}

function pick(item) {
  if (!item || !item.file_id) return
  emit('select', {
    fileId: item.file_id,
    name: item.name || '图片',
    tempUrl: tempUrls.value[item.file_id] || ''
  })
  emit('update:visible', false)
}

function close() {
  emit('update:visible', false)
}
</script>

<style scoped>
.mm-image-picker {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--mm-surface);
}

.mm-image-picker__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--mm-border);
}

.mm-image-picker__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--mm-text);
}

.mm-image-picker__close {
  padding: 4px;
  cursor: pointer;
}

.mm-image-picker__toolbar {
  padding: 10px 16px;
  border-bottom: 1px solid var(--mm-border);
}

.mm-image-picker__body {
  flex: 1;
  min-height: 0;
}

.mm-image-picker__status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  font-size: 13px;
  color: var(--mm-text-weak);
}

.mm-image-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
  padding: 12px 16px 24px;
}

.mm-image-picker__item {
  position: relative;
  height: 96px;
  border: 1px solid var(--mm-border);
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--mm-surface-2);
  cursor: pointer;
}

.mm-image-picker__item:hover {
  border-color: var(--mm-accent);
}

.mm-image-picker__img {
  width: 100%;
  height: 100%;
}

.mm-image-picker__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* 引用次数角标（0 时不渲染） */
.mm-image-picker__refs {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  color: var(--mm-bg);
  background-color: var(--mm-accent);
  border-radius: 7px;
}

/* 文件大小：压在卡片底部，半透明底保证可读 */
.mm-image-picker__size {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 1px 4px;
  font-size: 10px;
  line-height: 13px;
  text-align: center;
  color: var(--mm-text);
  background-color: var(--mm-surface);
  opacity: .9;
}
</style>
