/**
 * mm-settings 云对象源码级测试（AC-17 / AC-18 / AC-19 / C5）。
 *
 * 覆盖：未登录也能读配置、账号开关关闭前的用户数校验（4001）、
 * 权限开关依赖账号开启（4005）、权限由关→开时首个注册用户成为管理员、
 * 管理员授权与只读用户被服务端拒绝写。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject } = require('./helpers/cloud-env')
const uniIdStub = require('./helpers/stubs/uni-id-common')

const ANON = '__anonymous__'

/** 每个用例前重置 token 映射 */
test.beforeEach(() => {
  uniIdStub.__reset()
})

/**
 * 构造账号开启的 Mock 环境。
 * @param {{users?: boolean, accountEnabled?: boolean, permissionEnabled?: boolean, adminUserId?: string}} [options]
 */
function createAccountEnv(options) {
  const config = options || {}
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: config.accountEnabled === undefined ? true : config.accountEnabled,
    permission_enabled: config.permissionEnabled === true,
    admin_user_id: config.adminUserId || '',
    updated_by: '',
    updated_at: new Date()
  })
  if (config.users !== false) {
    mock.__seedMany('uni-id-users', [
      { _id: 'u1', username: '甲', register_date: new Date('2024-01-01T00:00:00Z') },
      { _id: 'u2', username: '乙', register_date: new Date('2024-02-01T00:00:00Z') }
    ])
  }
  return mock
}

/** 登记登录态并返回 token */
function loginAs(uid) {
  return uniIdStub.__login(`token-${uid}`, uid)
}

// ---------------------------------------------------------------------------
// getConfig（无需登录）
// ---------------------------------------------------------------------------

test('getConfig：未登录（无 token）也能返回配置（AC-17 前提）', async () => {
  const mock = createAccountEnv()
  const mmSettings = loadCloudObject('mm-settings', mock)

  const result = await callObject(mmSettings, 'getConfig')

  assert.equal(result.errCode, 0, `未登录读取配置失败：${result.errMsg}`)
  assert.equal(result.data.account_enabled, true)
  assert.equal(result.data.permission_enabled, false)
  assert.equal(result.data.admin_user_id, '')
  assert.equal(result.data.anonymous, false, '账号开启时不应是匿名态')
})

test('getConfig：配置文档缺失时返回默认值（账号开启 / 权限关闭）', async () => {
  const mock = createMockUniCloud()
  const mmSettings = loadCloudObject('mm-settings', mock)

  const result = await callObject(mmSettings, 'getConfig')
  assert.equal(result.errCode, 0)
  assert.equal(result.data.account_enabled, true, '账号功能默认开启（R12）')
  assert.equal(result.data.permission_enabled, false, '权限功能默认关闭（R13）')
  assert.equal(result.data.anonymous, false)
})

test('getConfig：账号关闭时返回匿名态', async () => {
  const mock = createAccountEnv({ accountEnabled: false })
  const mmSettings = loadCloudObject('mm-settings', mock)

  const result = await callObject(mmSettings, 'getConfig')
  assert.equal(result.errCode, 0)
  assert.equal(result.data.account_enabled, false)
  assert.equal(result.data.anonymous, true)
})

// ---------------------------------------------------------------------------
// updateConfig
// ---------------------------------------------------------------------------

test('updateConfig：账号 true→false 且用户数 >1 → 4001 且配置不变（AC-18）', async () => {
  const mock = createAccountEnv()
  const mmSettings = loadCloudObject('mm-settings', mock)
  const token = loginAs('u1')

  const result = await callObject(mmSettings, 'updateConfig', { account_enabled: false }, { token })

  assert.equal(result.errCode, 4001, '存在多个用户时必须拒绝关闭账号功能')
  assert.equal(result.errMsg, '请先删除至单用户')

  const config = mock.__rows('mm-settings')[0]
  assert.equal(config.account_enabled, true, '被拒绝时不得写入配置')
  assert.equal(mock.__log.updates.filter(item => item.table === 'mm-settings').length, 0)
})

test('updateConfig：账号 true→false 且仅剩单用户 → 允许关闭（AC-18）', async () => {
  const mock = createAccountEnv()
  mock.__clear('uni-id-users')
  mock.__seed('uni-id-users', { _id: 'u1', username: '甲', register_date: new Date('2024-01-01T00:00:00Z') })
  const mmSettings = loadCloudObject('mm-settings', mock)
  const token = loginAs('u1')

  const result = await callObject(mmSettings, 'updateConfig', { account_enabled: false }, { token })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.account_enabled, false)
  assert.equal(result.data.anonymous, true)
  assert.equal(mock.__rows('mm-settings')[0].account_enabled, false)
})

test('updateConfig：permission_enabled=true 且 account_enabled=false → 4005（C5 依赖关系）', async () => {
  const mock = createAccountEnv()
  const mmSettings = loadCloudObject('mm-settings', mock)
  const token = loginAs('u1')

  const result = await callObject(mmSettings, 'updateConfig', {
    account_enabled: false,
    permission_enabled: true
  }, { token })

  assert.equal(result.errCode, 4005, '权限功能依赖账号功能')
  assert.equal(result.errMsg, '请先开启账号功能')
  assert.equal(mock.__rows('mm-settings')[0].permission_enabled, false)
})

test('updateConfig：权限 false→true 时首个注册用户成为管理员，其余用户补默认可读可写（AC-19）', async () => {
  const mock = createAccountEnv()
  const mmSettings = loadCloudObject('mm-settings', mock)
  const token = loginAs('u1')

  const result = await callObject(mmSettings, 'updateConfig', { permission_enabled: true }, { token })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.permission_enabled, true)
  assert.equal(result.data.admin_user_id, 'u1', '首个注册用户应成为管理员')

  const permissions = mock.__rows('mm-user-permissions')
  assert.equal(permissions.length, 2, '应为每个已有用户补权限记录')

  const admin = permissions.find(item => item.user_id === 'u1')
  const normal = permissions.find(item => item.user_id === 'u2')
  assert.equal(admin.role, 'admin')
  assert.equal(admin.can_read, true)
  assert.equal(admin.can_write, true)
  assert.equal(normal.role, 'user')
  assert.equal(normal.can_read, true)
  assert.equal(normal.can_write, true)

  const config = mock.__rows('mm-settings')[0]
  assert.equal(config.admin_user_id, 'u1')
  assert.equal(config.updated_by, 'u1')
})

test('updateConfig：权限开启时非管理员改配置 → 1003', async () => {
  const mock = createAccountEnv({ permissionEnabled: true, adminUserId: 'u1' })
  mock.__seed('mm-user-permissions', {
    user_id: 'u2', role: 'user', can_read: true, can_write: true,
    created_at: new Date(), updated_at: new Date()
  })
  const mmSettings = loadCloudObject('mm-settings', mock)
  const token = loginAs('u2')

  const result = await callObject(mmSettings, 'updateConfig', { account_enabled: false }, { token })
  assert.equal(result.errCode, 1003, '权限开启时仅管理员可修改配置')
})

test('updateConfig：缺参数 → 1001', async () => {
  const mock = createAccountEnv()
  const mmSettings = loadCloudObject('mm-settings', mock)
  const token = loginAs('u1')

  const result = await callObject(mmSettings, 'updateConfig', {}, { token })
  assert.equal(result.errCode, 1001)
})

test('updateConfig：未登录写配置 → 1002', async () => {
  const mock = createAccountEnv()
  const mmSettings = loadCloudObject('mm-settings', mock)

  const result = await callObject(mmSettings, 'updateConfig', { account_enabled: false })
  assert.equal(result.errCode, 1002, '账号开启且无 token 时必须返回未登录')
  assert.equal(mock.__rows('mm-settings')[0].account_enabled, true)
})

// ---------------------------------------------------------------------------
// 用户列表与权限分配
// ---------------------------------------------------------------------------

test('listUsers：管理员可列出用户；权限开启时非管理员 → 1003', async () => {
  const mock = createAccountEnv({ permissionEnabled: true, adminUserId: 'u1' })
  const mmSettings = loadCloudObject('mm-settings', mock)

  const adminResult = await callObject(mmSettings, 'listUsers', {}, { token: loginAs('u1') })
  assert.equal(adminResult.errCode, 0, adminResult.errMsg)
  assert.equal(adminResult.data.total, 2)
  const admin = adminResult.data.list.find(item => item.user_id === 'u1')
  assert.equal(admin.role, 'admin', '管理员角色应正确回显')

  const userResult = await callObject(mmSettings, 'listUsers', {}, { token: loginAs('u2') })
  assert.equal(userResult.errCode, 1003)
})

test('setUserPermission：管理员可设只读；修改管理员自身权限被拒（AC-19）', async () => {
  const mock = createAccountEnv({ permissionEnabled: true, adminUserId: 'u1' })
  const mmSettings = loadCloudObject('mm-settings', mock)
  const adminToken = loginAs('u1')

  const readonly = await callObject(mmSettings, 'setUserPermission', {
    user_id: 'u2',
    can_read: true,
    can_write: false
  }, { token: adminToken })

  assert.equal(readonly.errCode, 0, readonly.errMsg)
  assert.equal(readonly.data.can_read, true)
  assert.equal(readonly.data.can_write, false)

  const stored = mock.__rows('mm-user-permissions').find(item => item.user_id === 'u2')
  assert.equal(stored.can_write, false)

  const onAdmin = await callObject(mmSettings, 'setUserPermission', {
    user_id: 'u1',
    can_write: false
  }, { token: adminToken })
  assert.equal(onAdmin.errCode, 1003, '不得修改管理员自身权限')
})

test('setUserPermission：用户不存在 → 1004，缺 user_id → 1001', async () => {
  const mock = createAccountEnv({ permissionEnabled: true, adminUserId: 'u1' })
  const mmSettings = loadCloudObject('mm-settings', mock)
  const token = loginAs('u1')

  assert.equal((await callObject(mmSettings, 'setUserPermission', {}, { token })).errCode, 1001)
  assert.equal((await callObject(mmSettings, 'setUserPermission', { user_id: 'nobody' }, { token })).errCode, 1004)
})

test('ensureConfig：幂等创建单文档，重复调用不产生第二条配置', async () => {
  const mock = createAccountEnv({ users: false })
  mock.__clear('mm-settings')
  const mmSettings = loadCloudObject('mm-settings', mock)
  const token = loginAs('u1')

  const first = await callObject(mmSettings, 'ensureConfig', {}, { token })
  assert.equal(first.errCode, 0, first.errMsg)
  assert.equal(first.data.key, 'app_config')
  assert.equal(first.data.account_enabled, true)
  assert.equal(first.data.permission_enabled, false)

  const second = await callObject(mmSettings, 'ensureConfig', {}, { token })
  assert.equal(second.errCode, 0)
  assert.equal(mock.__rows('mm-settings').length, 1, '重复调用不得产生第二条配置文档')
  assert.equal(second.data._id, first.data._id)
})

test('匿名模式下 updateConfig 的 updated_by 强制记 __anonymous__', async () => {
  const mock = createAccountEnv({ accountEnabled: false, users: false })
  const mmSettings = loadCloudObject('mm-settings', mock)

  const result = await callObject(mmSettings, 'updateConfig', { permission_enabled: false })
  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(mock.__rows('mm-settings')[0].updated_by, ANON)
})
