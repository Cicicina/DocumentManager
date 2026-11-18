/**
 * 分享打开按访问者文档库权限决定可编辑的运行时回归。
 *
 * 真实加载 mm-share / mm-file 云对象并用内存 Mock 执行：
 * - open 返回的 can_edit 在匿名 / 所有者 / 管理员 / 权限位各组合下的取值；
 * - can_edit 与 mm-file.saveContent 的 assertWritable 口径一致
 *   （can_edit=false 的身份保存必被 1003 拒绝，不会「前端可编辑、保存却失败」）；
 * - 前端契约：resolveShare 用 data.can_edit 决定只读/编辑，不再写死只读。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject, ROOT } = require('./helpers/cloud-env')
const uniIdStub = require('./helpers/stubs/uni-id-common')
const { readText } = require('./helpers/load-esm.js')

const SHARE_TOKEN = 'ValidToken1234567890'
const DOC_KEY = 'cloud://mock-env/markdown/u1/doc1.md'
const CONTENT = '# 标题\n\n正文内容'

const { sha256, byteSize } = require(path.join(
  ROOT, 'uniCloud-alipay/cloudfunctions/common/mm-common/lib/hash.js'
))

test.beforeEach(() => {
  uniIdStub.__reset()
})

/**
 * 构造分享环境。
 * @param {object} config accountEnabled / permissionEnabled / adminUserId / docOwner / permissions
 * @returns {{mock:object, doc:object}}
 */
function makeEnv(config) {
  const c = config || {}
  const mock = createMockUniCloud({ storage: { [DOC_KEY]: CONTENT } })
  mock.command.inc = value => ({ __op: 'inc', value })
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: c.accountEnabled !== false,
    permission_enabled: c.permissionEnabled === true,
    admin_user_id: c.adminUserId || '',
    updated_by: '',
    updated_at: new Date()
  })
  const doc = mock.__seed('mm-files', {
    type: 'file',
    user_id: c.docOwner || 'u1',
    parent_id: '',
    name: 'doc1.md',
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
  })
  mock.__seed('mm-shares', {
    token: SHARE_TOKEN,
    doc_id: doc._id,
    creator_uid: c.docOwner || 'u1',
    expire_at: new Date(Date.now() + 3600000),
    created_at: new Date(),
    revoked: false,
    access_count: 0
  })
  for (const p of (c.permissions || [])) {
    mock.__seed('mm-user-permissions', {
      user_id: p.user_id,
      role: p.role || 'user',
      can_read: p.can_read !== false,
      can_write: p.can_write !== false,
      created_at: new Date(),
      updated_at: new Date()
    })
  }
  return { mock, doc }
}

/** 执行一次 open，返回 res；loginUid 为空表示不登录 */
async function doOpen(env, loginUid) {
  const mmShare = loadCloudObject('mm-share', env.mock)
  const options = {}
  if (loginUid) options.token = uniIdStub.__login('tok-' + loginUid, loginUid)
  return callObject(mmShare, 'open', { token: SHARE_TOKEN }, options)
}

// ---------------------------------------------------------------------------
// can_edit 身份矩阵
// ---------------------------------------------------------------------------

test('账号功能关闭：匿名访问他人文档也可编辑（can_edit=true）', async () => {
  const env = makeEnv({ accountEnabled: false, docOwner: 'u1' })
  const res = await doOpen(env, '')
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.can_edit, true)
})

test('账号开启：文档所有者可编辑', async () => {
  const env = makeEnv({ accountEnabled: true, docOwner: 'u1' })
  const res = await doOpen(env, 'u1')
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.can_edit, true)
})

test('账号开启 + 权限开启：管理员可编辑他人文档', async () => {
  const env = makeEnv({
    accountEnabled: true,
    permissionEnabled: true,
    docOwner: 'u1',
    adminUserId: 'admin'
  })
  const res = await doOpen(env, 'admin')
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.can_edit, true)
})

test('权限关闭时管理员对他人文档也不可编辑（与 mm-file.canAccess 同口径）', async () => {
  const env = makeEnv({ accountEnabled: true, permissionEnabled: false, docOwner: 'u1', adminUserId: 'admin' })
  const opened = await doOpen(env, 'admin')
  assert.equal(opened.data.can_edit, false)
  const saved = await doSave(env, 'admin')
  assert.equal(saved.errCode, 1003, '权限关闭时管理员也不能写他人文档，与 can_edit 一致')
})

test('账号开启 + 权限关闭：其他登录用户不可编辑他人文档', async () => {
  const env = makeEnv({ accountEnabled: true, permissionEnabled: false, docOwner: 'u1' })
  const res = await doOpen(env, 'u2')
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.can_edit, false)
})

test('账号开启 + 权限开启：有写权限的其他用户可编辑', async () => {
  const env = makeEnv({
    accountEnabled: true,
    permissionEnabled: true,
    docOwner: 'u1',
    permissions: [{ user_id: 'u2', can_read: true, can_write: true }]
  })
  const res = await doOpen(env, 'u2')
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.can_edit, true)
})

test('账号开启 + 权限开启：只读权限的其他用户不可编辑', async () => {
  const env = makeEnv({
    accountEnabled: true,
    permissionEnabled: true,
    docOwner: 'u1',
    permissions: [{ user_id: 'u2', can_read: true, can_write: false }]
  })
  const res = await doOpen(env, 'u2')
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.can_edit, false)
})

test('账号开启未登录：open 仍返回 1002，由前端守卫引导登录', async () => {
  const env = makeEnv({ accountEnabled: true, docOwner: 'u1' })
  const res = await doOpen(env, '')
  assert.equal(res.errCode, 1002)
})

// ---------------------------------------------------------------------------
// can_edit 与服务端保存鉴权口径一致
// ---------------------------------------------------------------------------

/** 用同一身份调用 mm-file.saveContent，返回 errCode */
async function doSave(env, loginUid) {
  const mmFile = loadCloudObject('mm-file', env.mock)
  const options = {}
  if (loginUid) options.token = uniIdStub.__login('tok-' + loginUid, loginUid)
  return callObject(mmFile, 'saveContent', {
    file_id: env.doc._id,
    content: '# 改动\n\n新正文',
    base_version: 0
  }, options)
}

test('口径一致：can_edit=false 的只读用户保存必被 1003 拒绝', async () => {
  const env = makeEnv({
    accountEnabled: true,
    permissionEnabled: true,
    docOwner: 'u1',
    permissions: [{ user_id: 'u2', can_read: true, can_write: false }]
  })
  const opened = await doOpen(env, 'u2')
  assert.equal(opened.data.can_edit, false)
  const saved = await doSave(env, 'u2')
  assert.equal(saved.errCode, 1003, 'can_edit=false 时保存必须被服务端拒绝')
})

test('口径一致：can_edit=true 的写权限用户保存不被鉴权拒绝', async () => {
  const env = makeEnv({
    accountEnabled: true,
    permissionEnabled: true,
    docOwner: 'u1',
    permissions: [{ user_id: 'u2', can_read: true, can_write: true }]
  })
  const opened = await doOpen(env, 'u2')
  assert.equal(opened.data.can_edit, true)
  const saved = await doSave(env, 'u2')
  assert.notEqual(saved.errCode, 1003, 'can_edit=true 时不应被权限拒绝')
})

// ---------------------------------------------------------------------------
// 前端契约
// ---------------------------------------------------------------------------

test('前端契约：resolveShare 用 can_edit 决定只读/编辑，不再写死只读', () => {
  const src = readText('pages/index/index.vue')
  const start = src.indexOf('async function resolveShare()')
  assert.ok(start > 0, '应存在 resolveShare')
  const end = src.indexOf('\n}', start)
  const body = src.slice(start, end > 0 ? end : start + 3000)

  assert.match(body, /data\.can_edit === true/, '必须读取云端 can_edit')
  assert.match(body, /shareReadOnly\.value = !editable/, '只读标志取 can_edit 反值')
  assert.match(body, /mode\.value = editable \? 'edit' : 'read'/, '编辑态由 can_edit 决定')
  assert.doesNotMatch(body, /shareReadOnly\.value = true/, '不得再无条件写死只读')
})
