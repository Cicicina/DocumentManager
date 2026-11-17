/**
 * 外部链接工具：统一处理 iconfont 搜索地址拼接与跨平台打开。
 *
 * - H5：新标签页打开（若被浏览器拦截则回退到当前页跳转）
 * - 其他端：走应用内 /pages/webview/webview 页面
 */

export const ICONFONT_HOME = 'https://www.iconfont.cn/'
export const ICONFONT_SEARCH = 'https://www.iconfont.cn/search/index?searchType=icon&q='

/**
 * 生成 iconfont 地址：有关键词则拼搜索 URL，无关键词则返回首页。
 * @param {string} keyword 搜索关键词
 * @returns {string}
 */
export function buildIconfontUrl(keyword) {
  const kw = String(keyword == null ? '' : keyword).trim()
  return kw ? ICONFONT_SEARCH + encodeURIComponent(kw) : ICONFONT_HOME
}

/**
 * 跨平台打开外部链接。
 * @param {string} url 目标地址
 * @param {string} title 非 H5 端 webview 标题
 */
export function openExternalLink(url, title = '') {
  const target = String(url == null ? '' : url).trim()
  if (!target) return

  // #ifdef H5
  if (typeof window !== 'undefined') {
    const opened = window.open(target, '_blank')
    if (!opened) window.location.href = target
  }
  return
  // #endif

  // #ifndef H5
  if (typeof uni !== 'undefined') {
    uni.navigateTo({
      url: '/pages/webview/webview?url=' + encodeURIComponent(target) + '&title=' + encodeURIComponent(title || '网页')
    })
  }
  // #endif
}
