/**
 * 分享链接与剪贴板工具。
 *
 * 分享 URL 用 hash 路由：`<origin><pathname>#/pages/index/index?share_token=xxx`，
 * query 必须放在 `#` 之后，否则静态托管会把 `?` 后内容当服务端参数而丢失。
 * H5 浏览器不允许静默读剪贴板，readClipboard 失败由调用方降级为显式按钮/粘贴框。
 */
import { SHARE_QUERY_KEY, SHARE_WEB_BASE } from '@/common/constants.js'

/** 上一次处理过的剪贴板文本，避免重复弹窗 */
const LAST_KEY = 'mm_last_clipboard'

/** 拼接分享链接 */
export function buildShareUrl(token) {
  const base = typeof window !== 'undefined' && window.location
    ? `${window.location.origin}${window.location.pathname}`
    : SHARE_WEB_BASE
  return `${base}#/pages/index/index?${SHARE_QUERY_KEY}=${token}`
}

/** 写入剪贴板，返回是否成功 */
export function writeShareUrl(token) {
  const text = buildShareUrl(token)
  return new Promise(resolve => {
    uni.setClipboardData({
      data: text,
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

/** 读取剪贴板：H5 优先 navigator.clipboard（需用户手势），失败回退 uni API */
export function readClipboard() {
  return new Promise(resolve => {
    const fallback = () => {
      uni.getClipboardData({
        success: res => resolve(String((res && res.data) || '')),
        fail: () => resolve('')
      })
    }
    // #ifdef H5
    if (typeof navigator !== 'undefined' && navigator.clipboard &&
      typeof navigator.clipboard.readText === 'function') {
      navigator.clipboard.readText().then(text => resolve(String(text || ''))).catch(fallback)
      return
    }
    // #endif
    fallback()
  })
}

/** 从任意文本里解析 share_token，不是分享链接返回空串 */
export function parseShareUrl(text) {
  const value = typeof text === 'string' ? text : ''
  const matched = new RegExp('[?&]' + SHARE_QUERY_KEY + '=([^&#\\s]+)').exec(value)
  if (!matched) return ''
  try {
    return decodeURIComponent(matched[1])
  } catch (error) {
    return matched[1]
  }
}

/** 判断是否分享链接 */
export function isShareUrl(text) {
  return !!parseShareUrl(text)
}

/** 取上次处理过的剪贴板文本 */
export function getLastClipboard() {
  if (typeof uni === 'undefined' || !uni.getStorageSync) return ''
  try {
    return String(uni.getStorageSync(LAST_KEY) || '')
  } catch (error) {
    return ''
  }
}

/** 记录本次处理过的剪贴板文本 */
export function setLastClipboard(text) {
  if (typeof uni === 'undefined' || !uni.setStorageSync) return
  try {
    uni.setStorageSync(LAST_KEY, typeof text === 'string' ? text : '')
  } catch (error) {
    // 存储不可用时忽略，仅影响去重
  }
}
