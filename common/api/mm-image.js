/**
 * mm-image 云对象前端薄封装：图片登记、图片空间列表、临时 URL、清理。
 * 库中只保存云存储 fileID；展示用的临时 URL 由 getTempUrls 换出，绝不落库。
 * 客户端直传使用 uniCloud.uploadFile，登记时传入返回的 fileID。
 */
import { call, callSilent } from '@/common/api/index.js'

/** 客户端上传成功后登记图片（同一 fileID 重复登记时幂等返回已有记录） */
export const register = (param = {}) => call('mmImage', 'register', param)

/** 图片空间列表（只含 fileID 等元数据，不含临时 URL） */
export const list = (param = {}) => call('mmImage', 'list', param)

/** 批量换取临时展示 URL，返回 {file_id: tempUrl} 映射 */
export const getTempUrls = (param = {}) => call('mmImage', 'getTempUrls', param)

/**
 * 分批换取临时 URL（前端适配云端批量上限）。
 *
 * 云端 getTempUrls 单次最多处理 50 个 fileID（TEMP_URL_BATCH），而图片空间每页
 * 取 60 张。若一次把 60 个都传过去，云端会静默截断后 10 个 —— 表现就是
 * 「部分上传的图片一直显示占位图、加载不出来」。这里按 50 一批拆分后合并结果。
 *
 * @param {string[]} fileIds 云存储 fileID 列表
 * @returns {Promise<{code:number, data:Object<string,string>}>} 合并后的映射；任一批失败按失败处理
 */
export async function getTempUrlsBatched(fileIds) {
  const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : []
  if (ids.length === 0) return { code: 0, data: {}, message: '' }

  const BATCH = 50
  const merged = Object.create(null)
  let lastFailure = null
  for (let i = 0; i < ids.length; i += BATCH) {
    const res = await getTempUrls({ file_ids: ids.slice(i, i + BATCH) })
    if (res && res.code === 0 && res.data) {
      Object.assign(merged, res.data)
    } else {
      lastFailure = res
    }
  }
  // 已拿到部分映射就照常返回，只有全部失败才把失败码交回调用方提示
  if (lastFailure && Object.keys(merged).length === 0) {
    return { code: lastFailure.code, data: null, message: lastFailure.message }
  }
  return { code: 0, data: merged, message: '' }
}

/**
 * 在图片空间单独清理图片记录，不随文档彻底删除级联。
 * 被文档引用时返回 4011 与引用明细，确认后带 force:true 重试才会级联清引用。
 */
export const remove = (param = {}) => call('mmImage', 'remove', param)

/**
 * 静默版清理：不弹全局 Toast，4011 的引用明细由调用方弹确认框处理，
 * 避免「错误 Toast + 确认弹窗」重复提示。
 */
export const removeSilent = (param = {}) => callSilent('mmImage', 'remove', param)

/**
 * 批量写入图片展示顺序（拖动排序）。order 越大越靠前。
 * @param {{items:Array<{image_id:string, order:number}>}} param
 */
export const reorder = (param = {}) => call('mmImage', 'reorder', param)

/**
 * 按文档对齐图片引用（幂等）。保存成功后调用，失败静默、下次保存自愈。
 * @param {{doc_id:string, content?:string, rebuild?:boolean}} param
 */
export const syncRefs = (param = {}) => callSilent('mmImage', 'syncRefs', param)
