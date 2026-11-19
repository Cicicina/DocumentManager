/**
 * 全局轻提示命令总线：让非 setup 上下文（common/api 等）也能触发 wot toast。
 *
 * wot 的 useToast() 依赖 provide/inject，只能在组件 setup 里调用，而 API 层、
 * 云对象回调、工具函数是普通 JS 模块，拿不到那个注入实例。这里用模块级命令总线
 * 解耦：调用方只管发命令，<mm-global-toast /> 组件订阅命令后转发给 wot 原生
 * useToast() 的 show/success/error/warning/info/loading/close，图标/时长/遮罩
 * 全部走 wot 原生实现。
 *
 * 兜底：若当前没有任何组件订阅（非 H5、测试环境、组件尚未挂载），
 * 退回 uni.showToast，保证提示不丢。生产 H5 中页面都挂了组件，走 wot。
 */

'use strict'

/** 订阅者集合：每个挂载的 <mm-global-toast /> 一个 */
const subscribers = new Set()

/**
 * 最近一次 loading 命令（供晚挂载的组件补渲染）。
 * 只缓存 loading：它常驻、需手动 close，晚挂载补上是对的；
 * 一次性提示（success/error）若晚挂载重放反而会误弹，故不缓存。
 */
let pendingLoading = null

/**
 * 兜底输出：无组件订阅时用 uni.showToast。
 * 保留 icon:'none' 与 title 字段，兼容既有测试对 calls.toasts[].title 的断言。
 * @param {object} cmd 命令
 */
function fallback(cmd) {
  // 显式走 globalThis.uni：ESM 模块作用域里裸标识符 uni 未必解析到全局对象，
  // 而 uni-app 在 H5 / 各端都把 uni 挂在 globalThis 上。
  const runtime = typeof globalThis !== 'undefined' ? globalThis.uni : (typeof uni !== 'undefined' ? uni : null)
  if (!runtime || typeof runtime.showToast !== 'function') return
  if (cmd.type === 'close') return
  const options = (cmd && cmd.options) || {}
  const text = options.msg || options.title || ''
  if (!text) return
  runtime.showToast({ title: text, icon: 'none' })
}

/**
 * 发送一条 toast 命令。
 * @param {string} type 命令类型：show/success/error/warning/info/loading/close
 * @param {string|object} payload 文案或 wot ToastOptions
 */
function emit(type, payload) {
  const options = typeof payload === 'string' ? { msg: payload } : (payload || {})
  const cmd = { type, options, at: Date.now() }
  if (type === 'loading') pendingLoading = cmd
  else if (type === 'close') pendingLoading = null
  if (subscribers.size === 0) {
    fallback(cmd)
    return
  }
  for (const fn of subscribers) {
    try { fn(cmd) } catch (error) { /* 单个组件异常不影响其他订阅者 */ }
  }
}

/** 订阅命令，返回取消订阅函数；晚挂载者补上尚未关闭的 loading */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  subscribers.add(fn)
  if (pendingLoading) {
    try { fn(pendingLoading) } catch (error) { /* 忽略 */ }
  }
  return () => subscribers.delete(fn)
}

/** 清空缓存的 loading（页面切换时避免旧页面的转圈带到新页面） */
function reset() {
  pendingLoading = null
}

export const toast = {
  /** 常规轻提示（无图标） */
  show(payload) { emit('show', payload) },
  /** 成功提示 */
  success(payload) { emit('success', payload) },
  /** 错误提示 */
  error(payload) { emit('error', payload) },
  /** 警告提示 */
  warning(payload) { emit('warning', payload) },
  /** 信息提示 */
  info(payload) { emit('info', payload) },
  /** 加载提示（带遮罩，需手动 close） */
  loading(payload) { emit('loading', payload) },
  /** 关闭当前提示（通常配合 loading） */
  close() { emit('close') }
}

export { subscribe, reset, emit }
export default toast
