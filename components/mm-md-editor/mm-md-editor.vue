<template>
  <view class="mm-editor">
    <component
      :is="MdEditor"
      v-if="MdEditor"
      ref="editorInstance"
      v-model="displayValue"
      class="mm-editor__inner"
      language="zh-CN"
      :theme="editorTheme"
      :preview="showPreview"
      :on-upload-img="handleUploadImg"
      :style="{ height: '100%' }"
    />
    <view v-else class="mm-editor__loading">
      <wd-loading size="20px" />
    </view>
  </view>
</template>

<script setup>
/**
 * Markdown 编辑器：md-editor-v3@4.21.3 的 MdEditor（异步加载），受控 v-model。
 *
 * 版本约束（重要，勿升级到 5.x 及以上）：md-editor-v3 自 5.0 起要求 Vue ^3.5.3 并使用 useId，
 * 而 HBuilderX 内置的 uni-app H5 运行时 @dcloudio/uni-h5-vue 不导出 useId，会导致编译报错
 * （"useId" is not exported by vue.runtime.esm.js）。4.x 只使用 Vue 3.2 级别的 API，是兼容上限。
 *
 * 图片双态（C7）：
 * - store.editorContent 始终保存**存储态** `![名称](mm-image://<fileID>)`；
 * - 组件内部把存储态正向转成显示态（临时 URL）交给 MdEditor 渲染；
 * - 用户编辑触发的 `update:modelValue` 在 emit 前**反向替换**回存储态，
 *   因此 plainText、批注 offset、云侧 content 三者坐标系始终一致。
 *
 * 图片上传走 `:onUploadImg` **prop**（prop 形式；写成事件绑定不会命中该 prop），
 * 签名为 (files, callBack)，回传显示态临时 URL 数组供编辑器插入。
 *
 * 预览分栏：`editorProps` 在 4.21.3 中声明 `preview: boolean`（默认 true，注释「是否展开预览」）。
 * 传 false 时组件内部会把输入区宽度置为 100% 并隐藏拖拽条，编辑器自然占满可用宽度，
 * 不需要额外设置 inputBoxWitdh；该 prop 不影响 v-model 与图片双态转换。
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import { useAppStore } from '@/common/store/index.js'
import { CLOUD_PATH } from '@/common/constants.js'
import { genUuid } from '@/common/utils/uuid.js'
import { register as registerImage, getTempUrls } from '@/common/api/mm-image.js'
// md-editor-v3 4.x 的全局样式（4.x 起路径为 lib/style.css）
import 'md-editor-v3/lib/style.css'
import { uploadCloudFile } from '@/common/utils/upload.js'

// 异步组件：编辑器体积较大，首屏不加载（架构 1.3）
const MdEditor = defineAsyncComponent(() =>
  import('md-editor-v3').then(mod => mod.MdEditor)
)

const props = defineProps({
  modelValue: { type: String, default: '' },
  fileId: { type: String, default: '' },
  readOnly: { type: Boolean, default: false },
  imageUrlMap: { type: Object, default: () => ({}) },
  /** 是否显示右侧实时预览分栏，由主壳编辑工具条控制 */
  showPreview: { type: Boolean, default: true }
})

// 只声明实际会 emit 的事件：主壳未监听编辑器就绪事件，故不保留未使用的 `ready`
const emit = defineEmits(['update:modelValue'])

const store = useAppStore()

/** MdEditor 组件实例：4.x 的 preview prop 只在初始化生效，运行时切换须调实例的 togglePreview */
const editorInstance = ref(null)

/** 组件内维护的 fileID → 临时 URL 映射（外部传入 + 本次上传） */
const urlMap = ref({})

const editorTheme = computed(() => (store.state.theme === 'dark' ? 'dark' : 'light'))

/** 合并外部与本地映射 */
const mergedUrlMap = computed(() => Object.assign({}, props.imageUrlMap || {}, urlMap.value))

/** 存储态 → 显示态 */
function toDisplayState(text) {
  const source = typeof text === 'string' ? text : ''
  const map = mergedUrlMap.value
  return source.replace(/mm-image:\/\/([^\s)'"]+)/g, (matched, fileId) => map[fileId] || matched)
}

/** 显示态 → 存储态（保存到云存储 / 库里的形态） */
function toStorageState(text) {
  const source = typeof text === 'string' ? text : ''
  const map = mergedUrlMap.value
  let result = source
  for (const fileId of Object.keys(map)) {
    const tempUrl = map[fileId]
    if (!tempUrl) continue
    result = result.split(tempUrl).join(`mm-image://${fileId}`)
  }
  return result
}

/** 双向绑定的显示态：get 转显示，set 转回存储态后 emit */
const displayValue = computed({
  get: () => toDisplayState(props.modelValue),
  set: (value) => emit('update:modelValue', toStorageState(value))
})

function guessExtension(fileName) {
  const matched = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(String(fileName || ''))
  return matched ? matched[1].toLowerCase() : 'png'
}

/**
 * 图片上传钩子（prop 形式）。
 * @param {File[]} files 选择/粘贴的图片
 * @param {(urls: string[]) => void} callBack 回传显示态临时 URL 数组
 */
async function handleUploadImg(files, callBack) {
  const list = Array.isArray(files) ? files : []
  const urls = []
  const nextMap = Object.assign({}, urlMap.value)

  for (const file of list) {
    try {
      const name = (file && file.name) || 'image.png'
      const extension = guessExtension(name)
      const uid = (store.state.user && store.state.user.uid) || 'anonymous'
      const cloudPath = CLOUD_PATH.image(uid, extension).replace('{uuid}', genUuid())

      const uploaded = await uploadCloudFile({ cloudPath, file })
      const fileID = uploaded && uploaded.fileID
      if (!fileID) throw new Error('未返回 fileID')

      await registerImage({
        file_id: fileID,
        name,
        extension,
        size: (file && file.size) || 0,
        cloud_path: cloudPath
      })

      const tempRes = await getTempUrls({ file_ids: [fileID] })
      const tempUrl = tempRes.code === 0 && tempRes.data ? tempRes.data[fileID] : ''
      if (tempUrl) {
        nextMap[fileID] = tempUrl
        urls.push(tempUrl)
      }
    } catch (error) {
      uni.showToast({ title: '图片上传失败，请重试', icon: 'none' })
    }
  }

  urlMap.value = nextMap
  if (typeof callBack === 'function') {
    callBack(urls.filter(Boolean))
  }
}

/**
 * 在文档末尾插入图片（存储态），由主壳在 mm-image-picker 选择后调用。
 * 说明：md-editor-v3@4.21.3 未暴露稳定的光标 API，这里退化为追加到末尾；
 * 若后续版本暴露 CodeMirror 实例，可改为按光标插入。
 * @param {string} fileId 云存储 fileID
 * @param {string} name 图片名称（作为 alt）
 */
function insertImage(fileId, name) {
  if (!fileId) return
  const alt = name || '图片'
  const displayUrl = mergedUrlMap.value[fileId]
  const instance = editorInstance.value

  // 优先插到光标处。MdEditor 4.x 的 insert 直接操作编辑器显示态内容，
  // 因此必须传临时 URL；插入后 update:modelValue 会经 toStorageState
  // 反替换回 mm-image://<fileID>，库中仍只存 fileID。
  if (instance && typeof instance.insert === 'function' && displayUrl) {
    instance.insert(() => ({ targetValue: `![${alt}](${displayUrl})` }))
    return
  }

  // 兜底：编辑器未就绪或拿不到临时 URL 时追加存储态到末尾，
  // 由 displayValue 的 getter 在渲染时正向替换为显示态。
  const token = `![${alt}](mm-image://${fileId})`
  const current = typeof props.modelValue === 'string' ? props.modelValue : ''
  const next = current ? `${current}\n${token}\n` : `${token}\n`
  emit('update:modelValue', next)
}

/**
 * 运行时切换右侧预览分栏。
 * md-editor-v3@4.21.3 把 preview 读进内部 setting，prop 后续变化不会驱动面板；
 * 实例方法 togglePreview(bool) 才是官方的即时切换入口（内部调用 r("preview", bool)）。
 * showPreview prop 继续作为初始值保留，不改变 v-model 与图片双态链路。
 * @param {boolean} visible 是否显示预览
 * @returns {void}
 */
function togglePreview(visible) {
  const instance = editorInstance.value
  if (instance && typeof instance.togglePreview === 'function') {
    instance.togglePreview(!!visible)
  }
}

defineExpose({ insertImage, toStorageState, toDisplayState, togglePreview })
</script>

<style scoped>
.mm-editor {
  height: 100%;
  min-height: 0;
  background-color: var(--mm-surface);
}

.mm-editor__inner {
  height: 100%;
}

.mm-editor__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>

<style>
/* md-editor-v3 自带样式之外的容器适配（全局，作用于编辑器内部 DOM） */
.mm-editor .md-editor {
  height: 100%;
  border: none;
  background-color: var(--mm-surface);
  color: var(--mm-text);
}
</style>
