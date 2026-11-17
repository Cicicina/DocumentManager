/**
 * 云存储统一上传（客户端）。
 *
 * 官方契约（uniCloud 文档「客户端 API → uploadFile」）：
 *   参数只有 `cloudPath`（必填）、`filePath`（必填，String）、`cloudPathAsRealPath`、
 *   `fileType`、`onUploadProgress`。**没有 `file` 参数**；
 *   官方示例统一传 `filePath: uni.chooseFile/chooseImage 返回的 tempFilePath`，
 *   H5 下该值是 `blob:http://...` 形式的 URL，由 uniCloud 内部完成上传。
 *
 * 因此本项目统一以 `filePath` 提交：
 * - 已有临时路径（chooseFile/chooseImage 的 tempFilePaths[0]）直接传入；
 * - 只有 File/Blob 对象时（如 md-editor-v3 的 onUploadImg 回调），
 *   先用 `URL.createObjectURL(file)` 转成 blob URL 再提交，并在上传后延迟释放。
 *
 * 统一入口的目的：避免同一 API 在多处出现两种参数形态（QA R2 §11.1 H-7）。
 */

/** 由本函数创建的 blob URL 延迟释放时间（毫秒），避免上传尚未读完就失效 */
const REVOKE_DELAY = 30000

/**
 * 上传一个文件到云存储。
 * @param {{ cloudPath: string, filePath?: string, file?: File|Blob, fileType?: string,
 *   onUploadProgress?: Function }} options
 * @returns {Promise<{ fileID: string, requestId?: string }>}
 */
export function uploadCloudFile(options) {
  const opts = options || {}
  const cloudPath = typeof opts.cloudPath === 'string' ? opts.cloudPath : ''
  if (!cloudPath) {
    throw new Error('缺少 cloudPath')
  }

  const providedPath = typeof opts.filePath === 'string' ? opts.filePath : ''
  let filePath = providedPath
  let createdBlobUrl = ''

  // 只有 File/Blob 对象时，转成 blob URL（官方契约只认 filePath）
  if (!filePath && opts.file) {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      filePath = URL.createObjectURL(opts.file)
      createdBlobUrl = filePath
    }
  }
  if (!filePath) {
    throw new Error('缺少可上传的文件（file 或 filePath 至少提供一个）')
  }

  const payload = { cloudPath, filePath }
  if (typeof opts.fileType === 'string' && opts.fileType) payload.fileType = opts.fileType
  if (typeof opts.onUploadProgress === 'function') payload.onUploadProgress = opts.onUploadProgress

  return uniCloud.uploadFile(payload).finally(() => {
    if (createdBlobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      const timer = setTimeout(() => URL.revokeObjectURL(createdBlobUrl), REVOKE_DELAY)
      // Node（单测）环境下解除对事件循环的引用，避免测试被迫等待整个延迟
      if (timer && typeof timer.unref === 'function') timer.unref()
    }
  })
}

export default uploadCloudFile
