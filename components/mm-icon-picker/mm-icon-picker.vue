<template>
  <wd-popup v-model="modelVisible" position="bottom" custom-style="height:min(74vh,620px);border-radius:12px 12px 0 0;">
    <view class="mm-icon-picker">
      <view class="mm-icon-picker__title">选择图标</view>

      <!-- 分类切换：内置文件夹图标 / wot 图标（按语义分组） / 自定义上传 -->
      <view class="mm-icon-picker__tabs">
        <text
          v-for="tab in tabs"
          :key="tab.key"
          class="mm-icon-picker__tab"
          :class="{ 'is-active': activeTab === tab.key }"
          @click="activeTab = tab.key"
        >{{ tab.label }}</text>
      </view>

      <scroll-view class="mm-icon-picker__body" scroll-y>
        <!-- 内置文件夹 SVG -->
        <template v-if="activeTab === 'preset'">
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
            <view class="mm-icon-picker__item" :class="{ 'is-active': !draft }" @click="selectNone">
              <uni-icons type="closeempty" size="16" color="var(--mm-text-weak)" />
            </view>
          </view>
        </template>

        <!-- wot-design-uni 全部图标，按分类分组 -->
        <template v-else-if="activeTab === 'wot'">
          <view v-for="group in WOT_ICON_GROUPS" :key="group.label" class="mm-icon-picker__group">
            <text class="mm-icon-picker__group-title">{{ group.label }}（{{ group.names.length }}）</text>
            <view class="mm-icon-picker__grid">
              <view
                v-for="name in group.names"
                :key="name"
                class="mm-icon-picker__item"
                :class="{ 'is-active': isWotActive(name) }"
                :title="name"
                @click="selectWot(name)"
              >
                <wd-icon :name="name" size="20px" color="var(--mm-text)" />
              </view>
              <view class="mm-icon-picker__item" :class="{ 'is-active': !draft }" @click="selectNone">
                <uni-icons type="closeempty" size="16" color="var(--mm-text-weak)" />
              </view>
            </view>
          </view>
        </template>

        <!-- 自定义上传 -->
        <template v-else-if="activeTab === 'custom'">
          <view class="mm-icon-picker__custom">
            <image v-if="customPreview" class="mm-icon-picker__preview" :src="customPreview" mode="aspectFit" />
            <wd-button size="small" plain @click="chooseCustom">上传自定义图标</wd-button>
          </view>
          <view class="mm-icon-picker__item mm-icon-picker__none" :class="{ 'is-active': !draft }" @click="selectNone">
            <uni-icons type="closeempty" size="16" color="var(--mm-text-weak)" />
            <text>不使用图标</text>
          </view>
        </template>

        <!-- 更多图标：搜索并跳转 iconfont -->
        <template v-else-if="activeTab === 'more'">
          <view class="mm-icon-picker__more">
            <view class="mm-icon-picker__more-tip">
              更多图标可前往 <text class="mm-icon-picker__link" @click="openIconfontHome">iconfont.cn</text> 搜索，找到后可自行下载使用
            </view>
            <wd-input
              v-model="iconfontKeyword"
              placeholder="输入关键词，如：文件夹、文档"
              clearable
              @confirm="openIconfontSearch"
            />
            <view class="mm-icon-picker__more-actions">
              <wd-button size="small" type="primary" @click="openIconfontSearch">搜索图标</wd-button>
              <wd-button size="small" plain @click="openIconfontHome">打开首页</wd-button>
            </view>
          </view>
        </template>
      </scroll-view>

      <view class="mm-icon-picker__actions">
        <wd-button size="small" plain @click="close">取消</wd-button>
        <wd-button size="small" type="primary" @click="confirm">确定</wd-button>
      </view>
    </view>
  </wd-popup>
</template>

<script setup>
/**
 * 文件夹图标选择器：内置 SVG / wot-design-uni 全部字体图标（带分类）/ 自定义上传。
 * 自定义图标先直传云存储拿到 fileID，确认后由父级调 mm-file.updateIcon 落库；
 * wot 图标只存名字（type='wot'），渲染时用 <wd-icon>，不占存储。
 */
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/common/store/index.js'
import { CLOUD_PATH } from '@/common/constants.js'
import { genUuid } from '@/common/utils/uuid.js'
import { toast } from '@/common/utils/toast.js'
import { uploadCloudFile } from '@/common/utils/upload.js'
import { WOT_ICON_GROUPS, WOT_ICON_NAMES } from '@/common/utils/wot-icons.js'
import { buildIconfontUrl, openExternalLink, ICONFONT_HOME } from '@/common/utils/external-link.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  current: { type: Object, default: null }
})

const emit = defineEmits(['update:visible', 'confirm'])

const store = useAppStore()

const tabs = [
  { key: 'preset', label: '内置图标' },
  { key: 'wot', label: `Wot 图标（${WOT_ICON_NAMES.length}）` },
  { key: 'custom', label: '自定义上传' },
  { key: 'more', label: '更多图标' }
]
const activeTab = ref('preset')
/** iconfont 搜索关键词 */
const iconfontKeyword = ref('')

/** 内置 SVG 图标 key，与 static/icons 下文件名一致 */
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
  if (!value) return
  draft.value = props.current ? { ...props.current } : null
  customPreview.value = props.current && props.current.type === 'custom' ? (props.current.url || '') : ''
  // 打开时定位到当前图标所在的分类，避免用户找不到已选项
  if (draft.value && draft.value.type === 'wot') activeTab.value = 'wot'
  else if (draft.value && draft.value.type === 'custom') activeTab.value = 'custom'
  else activeTab.value = 'preset'
})

function isPresetActive(key) {
  return !!(draft.value && draft.value.type === 'preset' && draft.value.value === key)
}

function isWotActive(name) {
  return !!(draft.value && draft.value.type === 'wot' && draft.value.value === name)
}

function selectPreset(key) {
  draft.value = { type: 'preset', value: key }
}

function selectWot(name) {
  draft.value = { type: 'wot', value: name }
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
        toast.error('上传失败，请重试')
      }
    }
  })
}

function openIconfontSearch() {
  openExternalLink(buildIconfontUrl(iconfontKeyword.value), 'iconfont 图标搜索')
}

function openIconfontHome() {
  openExternalLink(ICONFONT_HOME, 'iconfont 图标库')
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
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: calc(14px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1)) calc(18px * var(--mm-ui-scale, 1));
}

.mm-icon-picker__title {
  flex: none;
  margin-bottom: 10px;
  font-size: calc(14px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-icon-picker__tabs {
  display: flex;
  flex: none;
  gap: calc(14px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
}

.mm-icon-picker__tab {
  padding-bottom: calc(8px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  cursor: pointer;
}

.mm-icon-picker__tab.is-active {
  color: var(--mm-accent);
  border-bottom: 2px solid var(--mm-accent);
}

.mm-icon-picker__body {
  flex: 1;
  min-height: 0;
  padding-top: calc(10px * var(--mm-ui-scale, 1));
}

.mm-icon-picker__group-title {
  display: block;
  margin: calc(10px * var(--mm-ui-scale, 1)) 0 calc(6px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-icon-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(46px, 1fr));
  gap: calc(8px * var(--mm-ui-scale, 1));
}

.mm-icon-picker__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: calc(42px * var(--mm-ui-scale, 1));
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
  height: calc(22px * var(--mm-ui-scale, 1));
}

.mm-icon-picker__custom {
  display: flex;
  align-items: center;
  gap: calc(12px * var(--mm-ui-scale, 1));
  margin-bottom: calc(12px * var(--mm-ui-scale, 1));
}

.mm-icon-picker__preview {
  width: 32px;
  height: calc(32px * var(--mm-ui-scale, 1));
  border: 1px solid var(--mm-border);
  border-radius: 6px;
}

.mm-icon-picker__none {
  flex-direction: row;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-icon-picker__more {
  display: flex;
  flex-direction: column;
  gap: calc(12px * var(--mm-ui-scale, 1));
}

.mm-icon-picker__more-tip {
  font-size: calc(12px * var(--mm-ui-scale, 1));
  line-height: 1.6;
  color: var(--mm-text-weak);
}

.mm-icon-picker__link {
  color: var(--mm-accent);
  text-decoration: underline;
  cursor: pointer;
}

.mm-icon-picker__more-actions {
  display: flex;
  gap: calc(10px * var(--mm-ui-scale, 1));
}

.mm-icon-picker__more :deep(.wd-input) {
  width: 100%;
}

.mm-icon-picker__actions {
  display: flex;
  flex: none;
  justify-content: flex-end;
  gap: calc(10px * var(--mm-ui-scale, 1));
  padding-top: calc(12px * var(--mm-ui-scale, 1));
  border-top: 1px solid var(--mm-border);
}
</style>
