/**
 * 主题管理：跟随系统 prefers-color-scheme，并支持手动覆盖持久化。
 *
 * 与 common/theme.css 配合：
 *   auto  → 移除 html[data-theme]，交给 CSS 的 @media 规则；
 *   light → html[data-theme="light"]；
 *   dark  → html[data-theme="dark"]。
 * 手动偏好写入本地存储（uni.setStorageSync，H5 下等价 localStorage）。
 */

/** 本地存储键 */
const THEME_STORAGE_KEY = 'mm_theme'

/** 合法的模式值 */
const VALID_MODES = ['auto', 'light', 'dark']

/** 读取本地存储的原始值（无 uni 环境时降级 localStorage） */
function readStorage() {
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.getStorageSync === 'function') {
      return uni.getStorageSync(THEME_STORAGE_KEY)
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(THEME_STORAGE_KEY)
    }
  } catch (error) {
    return ''
  }
  return ''
}

/** 写入本地存储（无 uni 环境时降级 localStorage） */
function writeStorage(value) {
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.setStorageSync === 'function') {
      uni.setStorageSync(THEME_STORAGE_KEY, value)
      return
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, value)
    }
  } catch (error) {
    // 存储不可用时仅影响手动偏好的持久化，不影响本次主题生效
  }
}

/**
 * 读取系统当前配色偏好。
 * @returns {'light'|'dark'}
 */
export function getSystemTheme() {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

/**
 * 读取用户手动偏好。
 * @returns {'auto'|'light'|'dark'}
 */
export function getStoredTheme() {
  const value = readStorage()
  return VALID_MODES.indexOf(value) !== -1 ? value : 'auto'
}

/**
 * 保存用户手动偏好并立即生效。
 * @param {'auto'|'light'|'dark'} mode 模式
 * @returns {'light'|'dark'} 实际生效的明暗模式
 */
export function setStoredTheme(mode) {
  const target = VALID_MODES.indexOf(mode) !== -1 ? mode : 'auto'
  writeStorage(target)
  return applyTheme(target)
}

/**
 * 应用主题。
 * @param {'auto'|'light'|'dark'} mode 模式，非法值按 auto 处理
 * @returns {'light'|'dark'} 实际生效的明暗模式
 */
export function applyTheme(mode) {
  const target = VALID_MODES.indexOf(mode) !== -1 ? mode : 'auto'
  const root = typeof document !== 'undefined' ? document.documentElement : null
  if (root) {
    if (target === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', target)
  }
  const effective = target === 'auto' ? getSystemTheme() : target

  // 原生导航栏跟随明暗：设置页等未使用 navigationStyle:"custom" 的页面
  // 由 pages.json 固定成浅色，深色主题下会出现「页面深、导航栏浅」的割裂。
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.setNavigationBarColor === 'function') {
      uni.setNavigationBarColor({
        frontColor: effective === 'dark' ? '#ffffff' : '#000000',
        backgroundColor: effective === 'dark' ? '#1C1D1F' : '#FAF9F6'
      })
    }
  } catch (error) {
    // 不支持的平台忽略即可，不影响主题正文
  }

  return effective
}

/**
 * 监听系统配色变化；仅在 auto 模式下重新应用，避免覆盖用户手动选择。
 * @param {(mode: 'light'|'dark') => void} callback 变化回调，可省略
 * @returns {() => void} 取消监听函数
 */
export function watchSystemTheme(callback) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return function noop() {}
  }
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = function onChange() {
    if (getStoredTheme() !== 'auto') return
    const mode = applyTheme('auto')
    if (typeof callback === 'function') callback(mode)
  }
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler)
    return function unwatch() { query.removeEventListener('change', handler) }
  }
  if (typeof query.addListener === 'function') {
    query.addListener(handler)
    return function unwatch() { query.removeListener(handler) }
  }
  return function noop() {}
}

export default { getSystemTheme, getStoredTheme, setStoredTheme, applyTheme, watchSystemTheme }
