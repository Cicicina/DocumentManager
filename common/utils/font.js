/**
 * 字号档位管理：五档「极大 / 大 / 中 / 小 / 极小」，默认「中」。
 *
 * 与 common/theme.css 配合：把档位写到 html[data-font]，CSS 按档位覆盖
 * --mm-font-scale；正文与阅读器用 em 相对单位，自动跟随，不需要逐组件改字号。
 * 手动偏好写入本地存储（uni.setStorageSync，H5 下等价 localStorage）。
 */

/** 本地存储键 */
const FONT_STORAGE_KEY = 'mm_font_scale'

/** 五档定义（数组顺序即设置页展示顺序） */
export const FONT_OPTIONS = [
  { value: 'xl', label: '极大' },
  { value: 'lg', label: '大' },
  { value: 'md', label: '中' },
  { value: 'sm', label: '小' },
  { value: 'xs', label: '极小' }
]

const VALID_SCALES = FONT_OPTIONS.map(item => item.value)

/** 默认档位：本次功能落地后统一为「中」 */
export const DEFAULT_FONT = 'md'

/** 读取本地存储的原始值（无 uni 环境时降级 localStorage） */
function readStorage() {
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.getStorageSync === 'function') {
      return uni.getStorageSync(FONT_STORAGE_KEY)
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(FONT_STORAGE_KEY)
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
      uni.setStorageSync(FONT_STORAGE_KEY, value)
      return
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FONT_STORAGE_KEY, value)
    }
  } catch (error) {
    // 存储不可用时仅影响跨会话保持，不影响本次生效
  }
}

/**
 * 读取用户字号档位。
 * @returns {'xl'|'lg'|'md'|'sm'|'xs'}
 */
export function getStoredFont() {
  const value = readStorage()
  return VALID_SCALES.indexOf(value) !== -1 ? value : DEFAULT_FONT
}

/**
 * 保存用户字号档位并立即生效。
 * @param {'xl'|'lg'|'md'|'sm'|'xs'} value 档位
 * @returns {'xl'|'lg'|'md'|'sm'|'xs'} 实际生效的档位
 */
export function setStoredFont(value) {
  const target = VALID_SCALES.indexOf(value) !== -1 ? value : DEFAULT_FONT
  writeStorage(target)
  return applyFont(target)
}

/**
 * 应用字号档位。
 * @param {'xl'|'lg'|'md'|'sm'|'xs'} value 档位，非法值按默认档位处理
 * @returns {'xl'|'lg'|'md'|'sm'|'xs'} 实际生效的档位
 */
export function applyFont(value) {
  const target = VALID_SCALES.indexOf(value) !== -1 ? value : DEFAULT_FONT
  // #ifdef H5
  const root = typeof document !== 'undefined' ? document.documentElement : null
  if (root) root.setAttribute('data-font', target)
  // #endif
  return target
}

export default { FONT_OPTIONS, DEFAULT_FONT, getStoredFont, setStoredFont, applyFont }
