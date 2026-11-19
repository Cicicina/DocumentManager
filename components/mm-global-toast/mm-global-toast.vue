<template>
  <!-- 常规 / 成功 / 错误等短提示（自动消失） -->
  <wd-toast />
  <!-- 加载提示（常驻带遮罩），独立 selector，close 只关它，不误伤短提示 -->
  <wd-toast selector="mm-loading" />
</template>

<script setup>
/**
 * 全局 toast 渲染器：订阅 common/utils/toast.js 的命令总线，
 * 转发给 wot 原生 useToast()，让非 setup 上下文也能弹 wot toast。
 *
 * 用两套实例是刻意的：loading 带遮罩且需手动 close，若与 success/error 共用
 * 同一实例，close 会把紧随其后的错误提示一起关掉。独立 selector 后两者互不干扰。
 *
 * 必须在用到的页面挂载一次（替代原来的 <wd-toast />）。
 */
import { onMounted, onUnmounted } from 'vue'
import { useToast } from 'wot-design-uni'
import { subscribe, reset } from '@/common/utils/toast.js'

const shortToast = useToast()
const loadingToast = useToast('mm-loading')

let unsubscribe = null
let loadingVisible = false

onMounted(() => {
  unsubscribe = subscribe((cmd) => {
    if (cmd.type === 'loading') {
      loadingVisible = true
      loadingToast.loading(cmd.options || '')
      return
    }
    if (cmd.type === 'close') {
      if (loadingVisible) {
        loadingToast.close()
        loadingVisible = false
      }
      return
    }
    // success / error / warning / info / show 都走短提示实例，自动消失
    const method = typeof shortToast[cmd.type] === 'function' ? cmd.type : 'show'
    shortToast[method](cmd.options || '')
  })
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  if (loadingVisible) loadingToast.close()
  loadingVisible = false
  // 页面卸载时丢弃未关闭的 loading，避免转圈被带到下一个页面
  reset()
})
</script>
