/**
 * md 导出：Blob + <a download> 下载（仅 H5，带运行时守卫）。
 * content 按 UTF-8 原样写入 Blob，不追加 BOM、不做换行转换，
 * 保证导出的 md 与云端内容字节一致（AC-24）。
 */

/**
 * 下载 md 文档。
 * @param {string} name 文件名（不含 .md 时自动补齐）
 * @param {string} content md 原文
 * @returns {void}
 */
export function downloadMarkdown(name, content) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  if (typeof Blob === 'undefined' || typeof URL === 'undefined') return

  const rawName = typeof name === 'string' && name ? name : 'document'
  const fileName = /\.md$/i.test(rawName) ? rawName : `${rawName}.md`
  const text = typeof content === 'string' ? content : ''
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  // 延迟释放，避免浏览器尚未开始下载就失效
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default downloadMarkdown
