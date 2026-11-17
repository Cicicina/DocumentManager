<template>
  <view class="mm-image-space">
    <text class="mm-image-space__tip">按住图片拖动可调整顺序，越靠前越优先插入文档</text>

    <view class="mm-image-space__body">
      <view v-if="imageLoading && imageList.length === 0" class="mm-image-space__status"><wd-loading size="20px" /></view>
      <view v-else-if="imageList.length === 0" class="mm-image-space__status"><text>还没有图片</text></view>
      <view v-else class="mm-image-space__grid">
        <view
          v-for="(item, index) in imageList"
          :key="item._id"
          class="mm-image-space__item"
          :class="{ 'is-dragging': draggingId === item._id }"
          :data-drag-index="index"
          :title="imageTitle(item)"
          @touchstart="startDrag($event, item, index)"
          @pointerdown="startDrag($event, item, index)"
          @click="previewImage(item)"
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
          <view
            class="mm-image-space__remove"
            @pointerdown.stop="noop"
            @touchstart.stop="noop"
            @click.stop="removeImage(item)"
          >
            <uni-icons type="trash" size="12" color="var(--mm-text)" />
          </view>
          <text class="mm-image-space__size">{{ formatSize(item.size) }} · {{ item.uploader_nickname || '访客' }}</text>
        </view>
      </view>
    </view>

    <wd-toast />
    <wd-message-box selector="mm-image-space" />
  </view>
</template>

<script setup>
/**
 * 图片空间独立页：从设置页进入，列出已上传图片、预览、单独清理，
 * 并支持拖动调整顺序（order 越大越靠前，插入弹窗共用同一顺序）。
 */
import { onMounted, ref } from 'vue'
import { formatSize } from '@/common/utils/format.js'
import { list as listImages, getTempUrlsBatched, remove as removeImages, removeSilent, reorder as reorderImages } from '@/common/api/mm-image.js'
import { useImageDragSort } from '@/common/utils/drag-order.js'
import { useConfirm } from '@/common/utils/confirm.js'

const { confirm } = useConfirm('mm-image-space')

const imageList = ref([])
const imageUrls = ref({})
const imageLoading = ref(false)

/**
 * 拖动排序：order 越大越靠前，松手后按「数组长度 - 下标」重新编号，
 * 既保持当前可见顺序，又能让新上传的图（服务端取 max+1）继续排在最前。
 */
const { draggingId, startDrag, shouldIgnoreClick } = useImageDragSort(
  () => imageList.value,
  next => { imageList.value = next },
  async (items) => {
    if (items.length === 0) return
    const total = items.length
    const payload = items.map((item, index) => ({ image_id: item._id, order: total - index }))
    const res = await reorderImages({ items: payload })
    if (res.code === 0) {
      imageList.value = items.map((item, index) => ({ ...item, order: total - index }))
      uni.showToast({ title: '顺序已保存', icon: 'none' })
    } else {
      await loadImages()
    }
  }
)

onMounted(loadImages)

async function loadImages() {
  imageLoading.value = true
  const res = await listImages({ page: 1, pageSize: 60 })
  if (res.code === 0 && res.data) {
    imageList.value = res.data.list || []
    const ids = imageList.value.map(item => item.file_id).filter(Boolean)
    if (ids.length > 0) {
      // 云端单次最多换 50 个 URL，这里分批拉取，避免第 51 张起一直显示占位图
      const urlRes = await getTempUrlsBatched(ids)
      if (urlRes.code === 0 && urlRes.data) imageUrls.value = urlRes.data
    }
  }
  imageLoading.value = false
}

/**
 * 点击图片预览：手势松手后浏览器可能补发 click，若刚完成拖动排序则跳过，
 * 避免拖完顺手弹出预览。用全部已换到临时 URL 的图构造预览列表，定位到当前这张。
 */
function previewImage(item) {
  if (!item || shouldIgnoreClick()) return
  const current = imageUrls.value[item.file_id]
  if (!current) return
  const urls = imageList.value
    .map(x => imageUrls.value[x.file_id])
    .filter(Boolean)
  uni.previewImage({
    current,
    urls: urls.length > 0 ? urls : [current]
  })
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

  confirm({
    title: '图片被文档引用',
    content: `该图片被${quoted}${suffix}引用，删除会导致文档中的图片无法显示。是否仍要删除？`,
    confirmText: '仍要删除',
    danger: true
  }).then(async ok => {
    if (!ok) return
    const second = await removeImages({ image_ids: [item._id], force: true })
    if (second.code === 0) {
      uni.showToast({ title: '已清理', icon: 'none' })
      await loadImages()
    }
  })
}

function noop() {}
</script>

<style scoped>
.mm-image-space {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--mm-bg);
  color: var(--mm-text);
  font-size: calc(13px * var(--mm-font-scale, 1));
}

.mm-image-space__tip {
  flex: none;
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  line-height: 1.5;
  color: var(--mm-text-weak);
}

.mm-image-space__body {
  flex: 1;
  min-height: 0;
}

.mm-image-space__status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(48px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-image-space__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: calc(10px * var(--mm-ui-scale, 1));
  padding: calc(12px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1)) calc(24px * var(--mm-ui-scale, 1));
}

.mm-image-space__item {
  position: relative;
  height: calc(96px * var(--mm-ui-scale, 1));
  border: 1px solid var(--mm-border);
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--mm-surface-2);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.mm-image-space__item.is-dragging {
  opacity: 0.45;
  border-color: var(--mm-accent);
  cursor: grabbing;
}

.mm-image-space__refs {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: calc(1px * var(--mm-ui-scale, 1)) calc(6px * var(--mm-ui-scale, 1));
  font-size: calc(10px * var(--mm-ui-scale, 1));
  line-height: calc(14px * var(--mm-ui-scale, 1));
  color: var(--mm-bg);
  background-color: var(--mm-accent);
  border-radius: 7px;
}

.mm-image-space__size {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: calc(2px * var(--mm-ui-scale, 1)) calc(6px * var(--mm-ui-scale, 1));
  font-size: calc(10px * var(--mm-ui-scale, 1));
  line-height: calc(14px * var(--mm-ui-scale, 1));
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
  height: calc(22px * var(--mm-ui-scale, 1));
  border-radius: 11px;
  background-color: var(--mm-surface);
  border: 1px solid var(--mm-border);
  cursor: pointer;
}
</style>
