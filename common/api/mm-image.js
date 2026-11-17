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
