<template>
  <view class="mm-trash-page">
    <mm-trash @changed="handleChanged" />
    <wd-toast />
  </view>
</template>

<script setup>
/**
 * 回收站独立页：从首页左栏或设置页进入。
 * 还原/彻底删除后通知文档库刷新目录树（首页仍在页面栈中，能收到全局事件）。
 */
function handleChanged() {
  if (typeof uni.$emit === 'function') uni.$emit('mm-library-changed')
}
</script>

<style scoped>
.mm-trash-page {
  min-height: 100vh;
  background-color: var(--mm-bg);
  color: var(--mm-text);
  font-size: calc(13px * var(--mm-font-scale, 1));
}
</style>
