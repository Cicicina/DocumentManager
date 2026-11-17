<template>
  <wd-popup v-model="modelVisible" position="center" custom-style="width:min(460px,90vw);border-radius:12px;">
    <view class="mm-conflict">
      <text class="mm-conflict__title">云端已有更新的版本</text>
      <text class="mm-conflict__desc">
        当前文档在你编辑期间被更新过（云端版本 {{ cloudVersion }}）。你可以用本地内容覆写云端，或放弃本次提交继续编辑。
      </text>
      <view v-if="cloudPreview" class="mm-conflict__preview">
        <text class="mm-conflict__preview-title">云端内容预览</text>
        <scroll-view class="mm-conflict__preview-body" scroll-y>
          <text class="mm-conflict__preview-text">{{ cloudPreview }}</text>
        </scroll-view>
      </view>
      <view class="mm-conflict__actions">
        <wd-button size="small" plain @click="onDiscard">放弃</wd-button>
        <wd-button size="small" type="primary" @click="onOverwrite">覆写</wd-button>
      </view>
    </view>
  </wd-popup>
</template>

<script setup>
/**
 * 版本冲突弹层（C1 / AC-12）。
 *
 * 强制约束：两个动作都只 emit 事件，组件本身**绝不**清空编辑内容、不跳转、不刷新；
 * 「放弃」后由父级保持 editorContent 原样并停留在编辑态，「覆写」由父级带 force 重新提交。
 */
import { computed } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  cloudVersion: { type: Number, default: 0 },
  localVersion: { type: Number, default: 0 },
  cloudPreview: { type: String, default: '' },
  cloudUpdatedAt: { type: String, default: '' }
})

const emit = defineEmits(['overwrite', 'discard', 'update:visible'])

const modelVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

function onOverwrite() {
  emit('overwrite')
}

function onDiscard() {
  emit('discard')
}
</script>

<style scoped>
.mm-conflict {
  padding: calc(20px * var(--mm-ui-scale, 1)) calc(18px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
}

.mm-conflict__title {
  display: block;
  font-size: calc(15px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-conflict__desc {
  display: block;
  margin-top: 8px;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  line-height: 1.6;
  color: var(--mm-text-weak);
}

.mm-conflict__preview {
  margin-top: 12px;
  border: 1px solid var(--mm-border);
  border-radius: 8px;
  overflow: hidden;
}

.mm-conflict__preview-title {
  display: block;
  padding: calc(6px * var(--mm-ui-scale, 1)) calc(10px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  background-color: var(--mm-surface-2);
}

.mm-conflict__preview-body {
  max-height: 140px;
  padding: calc(8px * var(--mm-ui-scale, 1)) calc(10px * var(--mm-ui-scale, 1));
}

.mm-conflict__preview-text {
  font-size: calc(12px * var(--mm-ui-scale, 1));
  line-height: 1.6;
  color: var(--mm-text-weak);
  white-space: pre-wrap;
  word-break: break-all;
}

.mm-conflict__actions {
  display: flex;
  justify-content: flex-end;
  gap: calc(10px * var(--mm-ui-scale, 1));
  margin-top: 18px;
}
</style>
