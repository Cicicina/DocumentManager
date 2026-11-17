/**
 * 鉴权与权限位二次校验测试（AC-19 / AC-20）。
 *
 * 覆盖：
 * - 账号功能开启且无 token → 1002（未登录）；
 * - 非本人文档写操作 → 1003；
 * - 权限开启且用户被设为只读 → 保存请求被服务端拒绝且无任何写入；
 * - 账号功能关闭（匿名模式）→ 无需登录即可读写；
 * - 管理员可写他人文档。
 * 真实 uni-id 登录属「部署后验证」，本地用 uni-id-common 替身模拟 token 解析。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject } = require('./helpers/cloud-env')
const uniIdStub = require('./helpers/stubs/uni-id-common')

const ANON = '__anonymous__'
const DOC_KEY = `cloud://mock-env/markdown/u1/doc.md`
const CONTENT = '原始内容'
const ROOT = path.resolve(__dirname, '..')
const { sha256, byteSize } = require(path.join(
  ROOT,
  'uniCloud-alipay/cloudfunctions/common/mm-common/lib/hash.js'
))

test.beforeEach(() => {
  uniIdStub.__reset()
})

/**
 * 构造鉴权场景。
 * @param {{accountEnabled?:boolean, permissionEnabled?:boolean, adminUserId?:string}} [options]
 */
function createAuthEnv(options) {
  const config = options || {}
  const mock = createMockUniCloud({ storage: { [DOC_KEY]: CONTENT } })
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: config.accountEnabled === undefined ? true : config.accountEnabled,
    permission_enabled: config.permissionEnabled === true,
    admin_user_id: config.adminUserId || '',
    updated_by: '',
    updated_at: new Date()
  })
  mock.__seed('uni-id-users', { _id: 'u1', username: '甲', register_date: new Date('2024-01-01T00:00:00Z') })
  mock.__seed('uni-id-users', { _id: 'u2', username: '乙', register_date: new Date('2024-02-01T00:00:00Z') })
  return mock
}

/** 预置文档（默认归属 u1） */
function seedDoc(mock, patch) {
  return mock.__seed('mm-files', Object.assign({
    type: 'file',
    user_id: 'u1',
    parent_id: '',
    name: 'doc.md',
    extension: 'md',
    storage_key: DOC_KEY,
    size: byteSize(CONTENT),
    content_hash: sha256(CONTENT),
    tags: [],
    icon: null,
    version: 0,
    is_delete: false,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z')
  }, patch || {}))
}

test('未登录写操作 → 1002（账号功能开启且无 token）', async () => {
  const mock = createAuthEnv()
  seedDoc(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'saveContent', {
    file_id: mock.__rows('mm-files')[0]._id,
    content: '新内容',
    base_version: 0
  })

  assert.equal(result.errCode, 1002)
  assert.equal(result.errMsg, '请先登录')
  assert.equal(mock.__log.uploads.length, 0, '未登录不得触发云存储写入')
  assert.equal(mock.__rows('mm-files')[0].version, 0)
})

test('非本人文档写操作 → 1003（权限未开启时用户仅可写自己名下文档）', async () => {
  const mock = createAuthEnv()
  const doc = seedDoc(mock, { user_id: 'u1' })
  const mmFile = loadCloudObject('mm-file', mock)
  const token = uniIdStub.__login('token-u2', 'u2')

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: '越权写入',
    base_version: 0
  }, { token })

  assert.equal(result.errCode, 1003, '非本人文档写入必须被服务端拒绝')
  assert.equal(result.errMsg, '没有操作权限')
  assert.equal(mock.__rows('mm-files')[0].version, 0, '被拒绝时不得写入')
  assert.equal(mock.__log.uploads.length, 0)
  assert.equal(mock.__storage.get(DOC_KEY), CONTENT, '被拒绝时不得覆盖云存储')
})

test('权限开启且用户被设为只读 → 保存自己文档同样被 1003 拒绝且无写入（AC-19）', async () => {
  const mock = createAuthEnv({ permissionEnabled: true, adminUserId: 'u1' })
  const doc = seedDoc(mock, { user_id: 'u2' })
  mock.__seed('mm-user-permissions', {
    user_id: 'u2', role: 'user', can_read: true, can_write: false,
    created_at: new Date(), updated_at: new Date()
  })
  const mmFile = loadCloudObject('mm-file', mock)
  const token = uniIdStub.__login('token-u2', 'u2')

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: '只读用户尝试保存',
    base_version: 0
  }, { token })

  assert.equal(result.errCode, 1003)
  assert.equal(mock.__rows('mm-files')[0].version, 0)
  assert.equal(mock.__log.uploads.length, 0)
  assert.equal(mock.__log.adds.filter(item => item.table === 'mm-index-chunks').length, 0,
    '只读用户不得触发索引重建写入')
})

test('管理员可写他人文档（权限开启时管理员直通）', async () => {
  const mock = createAuthEnv({ permissionEnabled: true, adminUserId: 'u1' })
  const doc = seedDoc(mock, { user_id: 'u2' })
  const mmFile = loadCloudObject('mm-file', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: '管理员覆写',
    base_version: 0
  }, { token })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(mock.__rows('mm-files')[0].version, 1)
})

test('账号功能关闭（匿名模式）→ 无需登录即可读写', async () => {
  const mock = createAuthEnv({ accountEnabled: false })
  const doc = seedDoc(mock, { user_id: ANON })
  const mmFile = loadCloudObject('mm-file', mock)

  const saveResult = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: '匿名写入',
    base_version: 0
  })
  assert.equal(saveResult.errCode, 0, `匿名模式应可写：${saveResult.errMsg}`)
  assert.equal(mock.__rows('mm-files')[0].version, 1)

  const listResult = await callObject(mmFile, 'listFiles', { parent_id: '' })
  assert.equal(listResult.errCode, 0, '匿名模式应可读')
  assert.equal(listResult.data.total, 1)
})

test('mm-comment.add 未登录 → 1002；只读用户新建批注 → 1003', async () => {
  const mock = createAuthEnv()
  const doc = seedDoc(mock, { user_id: 'u1' })
  const mmComment = loadCloudObject('mm-comment', mock)

  const anonymous = await callObject(mmComment, 'add', {
    file_id: doc._id,
    selected_text: '原始',
    prefix: '',
    suffix: '',
    start_offset: 0,
    end_offset: 2,
    comment: '未登录批注'
  })
  assert.equal(anonymous.errCode, 1002)

  const readonlyMock = createAuthEnv({ permissionEnabled: true, adminUserId: 'u1' })
  const readonlyDoc = seedDoc(readonlyMock, { user_id: 'u2' })
  readonlyMock.__seed('mm-user-permissions', {
    user_id: 'u2', role: 'user', can_read: true, can_write: false,
    created_at: new Date(), updated_at: new Date()
  })
  const readonlyComment = loadCloudObject('mm-comment', readonlyMock)
  const readonlyResult = await callObject(readonlyComment, 'add', {
    file_id: readonlyDoc._id,
    selected_text: '原始',
    prefix: '',
    suffix: '',
    start_offset: 0,
    end_offset: 2,
    comment: '只读批注'
  }, { token: uniIdStub.__login('token-u2', 'u2') })

  assert.equal(readonlyResult.errCode, 1003)
  assert.equal(readonlyMock.__rows('mm-comments').length, 0)
})

test('mm-image.register 未登录 → 1002', async () => {
  const mock = createAuthEnv()
  const mmImage = loadCloudObject('mm-image', mock)

  const result = await callObject(mmImage, 'register', {
    file_id: 'cloud://mock-env/images/u1/a.png',
    name: 'a.png',
    extension: 'png',
    size: 100,
    cloud_path: 'images/u1/a.png'
  })
  assert.equal(result.errCode, 1002)
  assert.equal(mock.__rows('mm-images').length, 0)
})

/**
 * 回归：线上云对象提供的是 getUniversalUniIdToken（uni-id-co 亦用它）。
 * 早期实现只读 getUniIdToken，token 恒为空，已登录用户的所有请求都被判 1002。
 */
test('只提供 getUniversalUniIdToken 时仍能解析身份（回归：登录后全部 1002）', async () => {
  const mock = createAuthEnv()
  const doc = seedDoc(mock, { user_id: 'u1' })
  const mmFile = loadCloudObject('mm-file', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: '真实运行时取 token',
    base_version: 0
  }, { token, tokenMethods: ['getUniversalUniIdToken'] })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(mock.__rows('mm-files')[0].version, 1)
})

test('两种 token 读取方法都不存在时 → 1002（无凭据不得写入）', async () => {
  const mock = createAuthEnv()
  const doc = seedDoc(mock, { user_id: 'u1' })
  const mmFile = loadCloudObject('mm-file', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: '无 token 方法',
    base_version: 0
  }, { token, tokenMethods: [] })

  assert.equal(result.errCode, 1002)
  assert.equal(mock.__rows('mm-files')[0].version, 0)
})
