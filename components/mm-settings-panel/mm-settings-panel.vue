<template>
  <view class="mm-settings">
    <!-- 账号 / 权限开关 -->
    <view class="mm-settings__section">
      <view class="mm-settings__row">
        <text class="mm-settings__label">账号功能</text>
        <wd-switch :model-value="accountEnabled" @change="onAccountChange" />
      </view>
      <view class="mm-settings__row">
        <text class="mm-settings__label">权限功能</text>
        <view class="mm-settings__control">
          <text v-if="!accountEnabled" class="mm-settings__hint">需先开启账号功能</text>
          <wd-switch
            :model-value="permissionEnabled"
            :disabled="!accountEnabled"
            @change="onPermissionEnabledChange"
          />
        </view>
      </view>
    </view>

    <!-- 用户授权：仅权限功能开启时有意义 -->
    <view v-if="permissionEnabled" class="mm-settings__section">
      <view class="mm-settings__section-head">
        <text class="mm-settings__section-title">用户权限</text>
        <view class="mm-settings__refresh" @click="emit('refresh-users')">
          <uni-icons type="loop" size="14" color="var(--mm-text-weak)" />
        </view>
      </view>

      <view v-for="user in users" :key="user.user_id" class="mm-settings__user">
        <view class="mm-settings__user-main">
          <text class="mm-settings__user-name">{{ user.username || user.user_id }}</text>
          <text v-if="user.role === 'admin'" class="mm-settings__badge">管理员</text>
        </view>
        <view class="mm-settings__perm">
          <text class="mm-settings__perm-label">可读</text>
          <wd-switch
            size="small"
            :model-value="user.can_read !== false"
            :disabled="user.role === 'admin'"
            @change="event => onPermissionChange(user, 'can_read', event.value)"
          />
          <text class="mm-settings__perm-label">可写</text>
          <wd-switch
            size="small"
            :model-value="user.can_write !== false"
            :disabled="user.role === 'admin'"
            @change="event => onPermissionChange(user, 'can_write', event.value)"
          />
        </view>
      </view>

      <view v-if="loading" class="mm-settings__status">
        <wd-loading size="18px" />
      </view>
      <view v-else-if="users.length === 0" class="mm-settings__status">
        <text>暂无其他用户</text>
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * 设置面板：账号 / 权限开关与用户可读可写授权。
 * 受控组件：开关状态直接由 props.config / props.users 推导，变更只上报，
 * 由父级调用 mm-settings 后回写，失败时开关自动保持原值（如 4001 拒绝关闭账号）。
 */
import { computed } from 'vue'

const props = defineProps({
  config: { type: Object, default: () => ({}) },
  users: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['update-config', 'update-permission', 'refresh-users'])

const accountEnabled = computed(() => props.config.account_enabled !== false)
const permissionEnabled = computed(() => props.config.permission_enabled === true)

function onAccountChange(event) {
  emit('update-config', { account_enabled: event.value === true })
}

function onPermissionEnabledChange(event) {
  emit('update-config', { permission_enabled: event.value === true })
}

function onPermissionChange(user, field, value) {
  const payload = {
    user_id: user.user_id,
    can_read: user.can_read !== false,
    can_write: user.can_write !== false
  }
  payload[field] = value === true
  emit('update-permission', payload)
}
</script>

<style scoped>
.mm-settings {
  padding: calc(4px * var(--mm-ui-scale, 1)) 0 calc(24px * var(--mm-ui-scale, 1));
}

.mm-settings__section {
  margin-bottom: 8px;
  border-bottom: 1px solid var(--mm-border);
}

.mm-settings__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(12px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1)) calc(6px * var(--mm-ui-scale, 1));
}

.mm-settings__section-title {
  font-size: calc(13px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-settings__refresh {
  padding: calc(4px * var(--mm-ui-scale, 1));
  cursor: pointer;
}

.mm-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: calc(46px * var(--mm-ui-scale, 1));
  padding: calc(8px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
}

.mm-settings__label {
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text);
}

.mm-settings__control {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--mm-ui-scale, 1));
}

.mm-settings__hint {
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-settings__user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(12px * var(--mm-ui-scale, 1));
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  border-top: 1px solid var(--mm-border);
}

.mm-settings__user-main {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--mm-ui-scale, 1));
  min-width: 0;
}

.mm-settings__user-name {
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-settings__badge {
  flex: none;
  padding: calc(1px * var(--mm-ui-scale, 1)) calc(6px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
  border-radius: 4px;
}

.mm-settings__perm {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--mm-ui-scale, 1));
  flex: none;
}

.mm-settings__perm-label {
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-settings__status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(20px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}
</style>
