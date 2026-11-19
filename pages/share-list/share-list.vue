<template>
  <view class="mm-share-page">
    <view class="mm-share-page__inner">
      <mm-share-manager @changed="noop" />
    </view>
    <mm-global-toast />
  </view>
</template>

<script setup>
/**
 * 分享管理独立页：从设置页「分享管理」入口 navigateTo 进来。
 * 列表逻辑全在 mm-share-manager 组件里，本页只提供页面外壳与主题变量。
 */
function noop() {
  // 组件作废分享后抛出的事件；本页无额外状态需要同步
}
</script>

<style scoped>
.mm-share-page {
  min-height: 100vh;
  background-color: var(--mm-bg);
  color: var(--mm-text);
  font-size: calc(13px * var(--mm-font-scale, 1));
}

.mm-share-page__inner {
  max-width: 720px;
  margin: 0 auto;
  padding: calc(8px * var(--mm-ui-scale, 1)) 0 calc(32px * var(--mm-ui-scale, 1));
}
</style>
