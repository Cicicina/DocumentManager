/**
 * Wot UI 确认框的 Promise 封装，用来替换 uni.showModal。
 *
 * useMessage 用 provide/inject 共享一个 option ref，且必须有一个
 * <wd-message-box selector="..."> 在同组件树里渲染。selector 用模块名区分，
 * 避免首页里多个组件（批注列表、分享面板等）共用同一个弹层串台。
 *
 * 用法（在 <script setup> 顶层）：
 *   const { confirm } = useConfirm('index')
 *   模板里挂 <wd-message-box selector="index" />
 *   const ok = await confirm({ title, content, danger: true })
 */
import { useMessage } from 'wot-design-uni'

export function useConfirm(selector = 'mm') {
  const message = useMessage(selector)

  /**
   * @param {object} options
   * @param {string} [options.title]
   * @param {string} [options.content]        正文，对应 wd-message-box 的 msg
   * @param {string} [options.confirmText]
   * @param {string} [options.cancelText]
   * @param {boolean} [options.danger]        确定按钮是否用 error 样式
   * @returns {Promise<boolean>} 点确定返回 true，取消/关蒙层/异常返回 false
   */
  function confirm(options = {}) {
    return message.confirm({
      title: options.title || '',
      msg: options.content || '',
      confirmButtonText: options.confirmText || '确定',
      cancelButtonText: options.cancelText || '取消',
      confirmButtonProps: options.danger ? { type: 'error' } : {},
      closeOnClickModal: false
    })
      .then(res => res && res.action === 'confirm')
      .catch(() => false)
  }

  return { confirm }
}
