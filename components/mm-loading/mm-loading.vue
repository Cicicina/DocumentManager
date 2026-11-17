<template>
  <view v-if="rendered" class="mm-loading" :class="{ 'is-hidden': !visibleMark }">
    <image class="mm-loading__mark" src="/static/brand/loading-mark.svg" mode="widthFix" />
  </view>
</template>

<script setup>
/**
 * 首屏加载动画：全屏覆盖播放品牌线稿，数据就绪后淡出。
 * - visible 置 false 时先满足 minDuration（默认 300ms）再淡出，避免「闪一下就没」；
 * - 淡出过渡 180ms，结束后移除节点并抛 finish（AC-28）。
 */
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: true },
  minDuration: { type: Number, default: 300 }
})

const emit = defineEmits(['finish'])

/** 是否仍占用 DOM */
const rendered = ref(props.visible)
/** 是否保持不透明（false 时进入淡出） */
const visibleMark = ref(props.visible)
/** 开始展示的时间戳 */
let shownAt = props.visible ? Date.now() : 0
let timer = null

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function hideNow() {
  visibleMark.value = false
  clearTimer()
  // 等淡出过渡（180ms）结束再移除节点
  timer = setTimeout(() => {
    rendered.value = false
    emit('finish')
  }, 200)
}

function scheduleHide() {
  const elapsed = shownAt ? Date.now() - shownAt : props.minDuration
  const remain = Math.max(0, Number(props.minDuration) - elapsed)
  clearTimer()
  if (remain > 0) timer = setTimeout(hideNow, remain)
  else hideNow()
}

watch(() => props.visible, (value) => {
  if (value) {
    clearTimer()
    shownAt = Date.now()
    rendered.value = true
    requestAnimationFrame(() => {
      visibleMark.value = true
    })
  } else {
    scheduleHide()
  }
})
</script>

<style scoped>
.mm-loading {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--mm-bg);
  opacity: 1;
  transition: opacity 0.18s ease;
}

.mm-loading.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.mm-loading__mark {
  width: 96px;
  height: auto;
}
</style>
