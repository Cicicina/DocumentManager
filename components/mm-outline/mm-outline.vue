<template>
  <view class="mm-outline">
    <view class="mm-outline__head">
      <text class="mm-outline__title">大纲</text>
      <view class="mm-outline__close" @click="emit('close')">
        <uni-icons type="closeempty" size="16" color="var(--mm-text-weak)" />
      </view>
    </view>
    <scroll-view class="mm-outline__body" scroll-y>
      <view v-if="items.length === 0" class="mm-outline__empty">
        <text>文档里还没有标题</text>
      </view>
      <view
        v-for="item in items"
        :key="item.index"
        class="mm-outline__item"
        :class="['is-l' + item.level, { 'is-active': item.index === activeIndex }]"
        :style="{ paddingLeft: 'calc(' + (10 + (item.level - 1) * 12) + 'px * var(--mm-ui-scale, 1))' }"
        :title="item.text"
        @click="emit('select', item)"
      >
        <text class="mm-outline__text">{{ item.text }}</text>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
/**
 * 文档大纲（类 Typora 大纲视图）：按标题层级缩进展示，点击跳转。
 * 数据由主壳从 markdown 原文解析，index 是「第几个标题」的全局序号，
 * 阅读态按该序号找 data-mm-h，编辑态按 line 定位 CodeMirror 行。
 */
defineProps({
  items: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: -1 }
})

const emit = defineEmits(['select', 'close'])
</script>

<style scoped>
.mm-outline {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--mm-surface);
  border-left: 1px solid var(--mm-border);
}

.mm-outline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  height: calc(38px * var(--mm-ui-scale, 1));
  padding: 0 calc(12px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
}

.mm-outline__title {
  font-size: calc(13px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-outline__close {
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: 6px;
  cursor: pointer;
}

.mm-outline__close:hover {
  background-color: var(--mm-surface-2);
}

.mm-outline__body {
  flex: 1;
  min-height: 0;
  padding: calc(6px * var(--mm-ui-scale, 1)) 0;
}

.mm-outline__item {
  display: flex;
  align-items: center;
  min-height: calc(28px * var(--mm-ui-scale, 1));
  padding-right: calc(10px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  line-height: 1.5;
  color: var(--mm-text-weak);
  cursor: pointer;
}

.mm-outline__item:hover {
  background-color: var(--mm-surface-2);
  color: var(--mm-text);
}

.mm-outline__item.is-active {
  color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

/* 层级只靠字重与缩进表达，不加额外线条 */
.mm-outline__item.is-l1 .mm-outline__text {
  font-weight: 600;
  color: var(--mm-text);
}

.mm-outline__item.is-l2 .mm-outline__text {
  font-weight: 500;
}

.mm-outline__text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-outline__empty {
  padding: calc(16px * var(--mm-ui-scale, 1)) 12px;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}
</style>
