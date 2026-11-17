/**
 * 通用展示格式化：图片空间与插入图片弹窗共用，避免两处各写一份。
 */

/**
 * 把字节数格式化为便于阅读的大小。
 * @param {number} bytes 字节数
 * @returns {string} 例如 "820 B" / "12.4 KB" / "3.1 MB"
 */
export function formatSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${Math.round(value)} B`
  const kb = value / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

export default { formatSize }
