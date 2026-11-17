/**
 * 八项综合规格中「运行时强相关」部分的独立回归：
 * - 第 3 项：call() 的 PASS_THROUGH_CODES 透传白名单，必须不破坏「云端 500 仍兜底」契约；
 * - 第 7 项：mm-share 云对象 create / verify / open 的鉴权、校验顺序、过期判断与降级；
 * - 第 6 项：mm-comment.listByFile 批量 join 昵称、匿名显示「访客」。
 *
 * 只读被测源码；云对象用内存 Mock 真实加载执行，前端 API 层用运行时 harness 执行。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject, ROOT } = require('./helpers/cloud-env')
const uniIdStub = require('./helpers/stubs/uni-id-common')
const { loadConstants, installGlobals, loadApiModule } = require('./helpers/api-runtime')

const ANON = '__anonymous__'
const DOC_KEY = 'cloud://mock-env/markdown/u1/doc1.md'
const CONTENT = '# 标题\n\n正文内容'
const { sha256, byteSize } = require(path.join(
  ROOT, 'uniCloud-alipay/cloudfunctions/common/mm-common/lib/hash.js'
))

test.beforeEach(() => {
  uniIdStub.__reset()
})

// ---------------------------------------------------------------------------
// 第 3 项：PASS_THROUGH_CODES 透传白名单 + 500 兜底契约
// ---------------------------------------------------------------------------

/** 在运行时 harness 里执行一次 call()，返回 {api, env} */
async function withApi(objects, fn) {
  const constants = await loadConstants()
  const env = installGlobals({ objects })
  try {
    const { module: api } = await loadApiModule(constants)
    await fn({ api, env, constants })
  } finally {
    env.restore()
  }
}

/** 构造一个云端抛出的业务错误（带 errCode / errMsg） */
function cloudBizError(code, message) {
  return async () => {
    const error = new Error(message)
    error.errCode = code
    error.errMsg = message
    throw error
  }
}

test('第3项：code=1001 + 具体 errMsg 透传具体文案，不再统一成「服务异常」', async () => {
  await withApi({
    'mm-image': { register: cloudBizError(1001, '图标格式不正确') }
  }, async ({ api, env }) => {
    const res = await api.call('mmImage', 'register', {})
    assert.equal(res.code, 1001)
    assert.equal(res.message, '图标格式不正确')
    assert.equal(env.calls.toasts.length, 1)
    assert.equal(env.calls.toasts[0].title, '图标格式不正确')
    assert.ok(!env.calls.toasts.some(item => item.title === '服务异常，请重试'),
      '白名单业务码不应落到服务异常兜底')
  })
})

test('第3项【关键契约】：云端 500「用户函数代码语法或逻辑异常」仍兜底「服务异常，请重试」，不透传 errMsg', async () => {
  const variants = [
    cloudBizError(500, '用户函数代码语法或逻辑异常'),
    cloudBizError('SYSTEM_ERROR', '云函数执行失败：用户函数代码语法或逻辑异常'),
    async () => { throw new Error('用户函数代码语法或逻辑异常') }
  ]
  for (const handler of variants) {
    await withApi({ 'mm-image': { register: handler } }, async ({ api, env }) => {
      const res = await api.call('mmImage', 'register', {})
      assert.equal(res.code, 9999, '500 / 未知错误必须收敛为 9999')
      assert.equal(res.message, '服务异常，请重试')
      assert.equal(env.calls.toasts.length, 1)
      assert.equal(env.calls.toasts[0].title, '服务异常，请重试')
      assert.ok(!env.calls.toasts.some(item => /语法|逻辑异常|SYSTEM_ERROR/.test(item.title)),
        '绝不能把云端 500 异常原文透传给用户')
    })
  }
})

test('第3项：9999 仍走兜底，不透传自定义 errMsg', async () => {
  await withApi({
    'mm-file': { saveContent: cloudBizError(9999, '底层堆栈信息不应展示') }
  }, async ({ api, env }) => {
    const res = await api.call('mmFile', 'saveContent', {})
    assert.equal(res.code, 9999)
    assert.equal(res.message, '服务异常，请重试')
    assert.equal(env.calls.toasts[0].title, '服务异常，请重试')
  })
})

test('第3项：4007-4010 分享错误码全部透传具体文案', async () => {
  const cases = [
    [4007, '分享链接无效'],
    [4008, '分享链接已过期'],
    [4009, '分享创建失败，请重试'],
    [4010, '分享的文档不可用']
  ]
  for (const [code, message] of cases) {
    await withApi({
      'mm-share': { verify: cloudBizError(code, message) }
    }, async ({ api, env }) => {
      const res = await api.call('mmShare', 'verify', {})
      assert.equal(res.code, code, `分享码 ${code} 应原样返回`)
      assert.equal(res.message, message)
      assert.equal(env.calls.toasts[0].title, message)
    })
  }
})

test('第3项：isTokenInvalid 分支优先级最高，token 失效即使 errMsg 像业务文案也先走失效处理', async () => {
  await withApi({
    'mm-file': {
      listTree: async () => {
        const error = new Error('登录状态失效，token已过期')
        error.errCode = 'uni-id-token-expired'
        error.errMsg = '登录状态失效，token已过期'
        throw error
      }
    }
  }, async ({ api, env }) => {
    const res = await api.call('mmFile', 'listTree', {})
    assert.equal(res.code, 1002, '必须先判 token 失效并返回 1002')
    assert.equal(env.calls.toasts[0].title, '登录状态已失效，请重新登录')
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1, '失效仍要跳登录页')
  })
})

test('第3项：白名单 3001 透传，未在白名单的 5002 之外的普通码仍保留原 code', async () => {
  await withApi({
    'mm-file': { saveContent: cloudBizError(3001, '上传失败：文件过大') }
  }, async ({ api, env }) => {
    const res = await api.call('mmFile', 'saveContent', {})
    assert.equal(res.code, 3001)
    assert.equal(res.message, '上传失败：文件过大')
    assert.equal(env.calls.toasts[0].title, '上传失败：文件过大')
  })
})

// ---------------------------------------------------------------------------
// 第 7 项：mm-share 云对象
// ---------------------------------------------------------------------------

/** 构造分享场景 Mock（默认账号功能开启） */
function createShareEnv(options) {
  const config = options || {}
  const mock = createMockUniCloud({ storage: config.storage || { [DOC_KEY]: CONTENT } })
  // mock 缺 db.command.inc（access_count 自增），补齐避免无谓抛错干扰
  mock.command.inc = value => ({ __op: 'inc', value })
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: config.accountEnabled !== false,
    permission_enabled: config.permissionEnabled === true,
    admin_user_id: '',
    updated_by: '',
    updated_at: new Date()
  })
  mock.__seed('uni-id-users', { _id: 'u1', username: '甲', nickname: '用户甲' })
  mock.__seed('uni-id-users', { _id: 'u2', username: '乙', nickname: '用户乙' })
  return mock
}

/** 预置一个 md 文档（默认归属 u1） */
function seedShareDoc(mock, patch) {
  return mock.__seed('mm-files', Object.assign({
    type: 'file',
    user_id: 'u1',
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
  }, patch || {}))
}

/** 预置一条分享记录 */
function seedShare(mock, patch) {
  return mock.__seed('mm-shares', Object.assign({
    token: 'ValidToken1234567890',
    doc_id: '',
    creator_uid: 'u1',
    expire_at: new Date(Date.now() + 3600 * 1000),
    created_at: new Date(),
    revoked: false,
    access_count: 0
  }, patch || {}))
}

test('第7项 verify：免登录可校验，且不读正文', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  seedShare(mock, { token: 'ValidToken1234567890', doc_id: doc._id })
  const mmShare = loadCloudObject('mm-share', mock)

  // 账号功能开启且不传 token：run 会拦成 1002，但 verify 不走 run，必须照样成功
  const res = await callObject(mmShare, 'verify', { token: 'ValidToken1234567890' })
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.valid, true)
  assert.equal(res.data.file_id, doc._id)
  assert.equal(res.data.doc_name, 'doc1.md')
  assert.equal(mock.__log.downloads.length, 0, 'verify 不得下载正文')
  assert.equal(mock.__log.tempUrls.length, 0, 'verify 不得换取临时链接')
})

test('第7项 verify：校验顺序 token 格式 → revoked → expired → 文档可用', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  const mmShare = loadCloudObject('mm-share', mock)

  // 格式非法
  const badFormat = await callObject(mmShare, 'verify', { token: 'bad token!' })
  assert.equal(badFormat.errCode, 4007)

  // revoked
  seedShare(mock, { token: 'RevokedToken1234567', doc_id: doc._id, revoked: true })
  const revoked = await callObject(mmShare, 'verify', { token: 'RevokedToken1234567' })
  assert.equal(revoked.errCode, 4007, 'revoked 应返回 4007 而非 4008')

  // expired（用 getTime 比较，过期 1 秒）
  seedShare(mock, {
    token: 'ExpiredToken1234567',
    doc_id: doc._id,
    expire_at: new Date(Date.now() - 1000)
  })
  const expired = await callObject(mmShare, 'verify', { token: 'ExpiredToken1234567' })
  assert.equal(expired.errCode, 4008, '过期应返回 4008')

  // 文档已删除
  seedShare(mock, { token: 'DocGoneToken1234567', doc_id: 'not-exist-doc' })
  const gone = await callObject(mmShare, 'verify', { token: 'DocGoneToken1234567' })
  assert.equal(gone.errCode, 4010, '文档不可用应返回 4010')
})

test('第7项 create：expire_at 为毫秒时间戳（.getTime()，非字符串拼接）', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  const mmShare = loadCloudObject('mm-share', mock)
  const token = uniIdStub.__login('token-u1', 'u1')
  const before = Date.now()

  const res = await callObject(mmShare, 'create', {
    file_id: doc._id,
    expire_seconds: 3600
  }, { token })

  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(typeof res.data.expire_at, 'number', '过期时间必须是数字时间戳，不能是字符串拼接')
  const expected = before + 3600 * 1000
  assert.ok(Math.abs(res.data.expire_at - expected) < 10000,
    `expire_at 应约为 now+1h，实际 ${res.data.expire_at}，期望约 ${expected}`)
  const row = mock.__rows('mm-shares')[0]
  assert.ok(row.expire_at instanceof Date, '落库应为 Date 对象')
  assert.ok(Math.abs(row.expire_at.getTime() - expected) < 10000)
  assert.equal(row.revoked, false)
  assert.equal(row.creator_uid, 'u1')
})

test('第7项 create：非所有者无写权限 → 1003；有效期越界 → 1001', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  const mmShare = loadCloudObject('mm-share', mock)
  const owner = uniIdStub.__login('token-u1', 'u1')
  const other = uniIdStub.__login('token-u2', 'u2')

  const forbidden = await callObject(mmShare, 'create', {
    file_id: doc._id, expire_seconds: 3600
  }, { token: other })
  assert.equal(forbidden.errCode, 1003, '非所有者不得创建分享')

  for (const bad of [299, 2592001, -1, 'abc']) {
    const res = await callObject(mmShare, 'create', {
      file_id: doc._id, expire_seconds: bad
    }, { token: owner })
    assert.equal(res.errCode, 1001, `有效期 ${bad} 应被拒绝`)
  }
  assert.equal(mock.__rows('mm-shares').length, 0, '校验失败不得写入分享记录')
})

test('无限期分享：expire_seconds=0 落远期哨兵，verify/open 永不判过期', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  const mmShare = loadCloudObject('mm-share', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const created = await callObject(mmShare, 'create', {
    file_id: doc._id, expire_seconds: 0
  }, { token })
  assert.equal(created.errCode, 0, created.errMsg)
  assert.equal(created.data.infinite, true, '应标记为无限期')
  assert.ok(created.data.expire_at > Date.now() + 365 * 10 * 86400 * 1000, '到期时间应为远未来哨兵')

  const verified = await callObject(mmShare, 'verify', { token: created.data.token })
  assert.equal(verified.errCode, 0, verified.errMsg)
  assert.equal(verified.data.infinite, true)

  const opened = await callObject(mmShare, 'open', { token: created.data.token }, { token })
  assert.equal(opened.errCode, 0, opened.errMsg)
  assert.equal(opened.data.infinite, true)
})

test('分享管理 list：只看自己的分享，状态与文档名正确', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  seedShare(mock, {
    token: 'ValidToken1234567890',
    doc_id: doc._id,
    creator_uid: 'u1',
    expire_at: new Date(Date.now() + 3600 * 1000)
  })
  seedShare(mock, {
    token: 'RevokedToken1234567',
    doc_id: doc._id,
    creator_uid: 'u1',
    revoked: true
  })
  seedShare(mock, {
    token: 'ExpiredToken1234567',
    doc_id: doc._id,
    creator_uid: 'u1',
    expire_at: new Date(Date.now() - 1000)
  })
  seedShare(mock, {
    token: 'OtherUserToken12345',
    doc_id: doc._id,
    creator_uid: 'u2'
  })
  const mmShare = loadCloudObject('mm-share', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(mmShare, 'list', { page: 1, page_size: 10 }, { token })
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.total, 3, '只能看到自己创建的分享')
  const byToken = Object.fromEntries(res.data.items.map(item => [item.token, item]))
  assert.equal(byToken.ValidToken1234567890.status, 'active')
  assert.equal(byToken.ValidToken1234567890.doc_name, 'doc1.md')
  assert.equal(byToken.RevokedToken1234567.status, 'revoked')
  assert.equal(byToken.ExpiredToken1234567.status, 'expired')
})

test('分享管理 revoke：所有者可作废，他人不可；作废后 verify 失效', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  const share = seedShare(mock, { token: 'ValidToken1234567890', doc_id: doc._id })
  const mmShare = loadCloudObject('mm-share', mock)
  const owner = uniIdStub.__login('token-u1', 'u1')

  const other = uniIdStub.__login('token-u2', 'u2')
  const denied = await callObject(mmShare, 'revoke', { share_id: share._id }, { token: other })
  assert.equal(denied.errCode, 1003, '非所有者不得作废他人分享')

  const ok = await callObject(mmShare, 'revoke', { share_id: share._id }, { token: owner })
  assert.equal(ok.errCode, 0, ok.errMsg)
  assert.equal(ok.data.revoked, true)
  const verified = await callObject(mmShare, 'verify', { token: 'ValidToken1234567890' })
  assert.equal(verified.errCode, 4007, '作废后链接必须立即失效')
})

test('第7项 create：令牌碰撞时重生，连续碰撞超过上限报 4009', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  const mmShare = loadCloudObject('mm-share', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  // 让生成器始终返回已存在的令牌，验证重试 3 次后报错
  const mmCommon = require(path.join(
    ROOT, 'uniCloud-alipay/cloudfunctions/common/mm-common/index.js'
  ))
  const original = mmCommon.genShareToken
  try {
    mmCommon.genShareToken = () => 'CollisionToken123456'
    seedShare(mock, { token: 'CollisionToken123456', doc_id: doc._id })
    const res = await callObject(mmShare, 'create', {
      file_id: doc._id, expire_seconds: 3600
    }, { token })
    assert.equal(res.errCode, 4009, '令牌始终碰撞应报 SHARE_CREATE_FAILED')
    assert.equal(mock.__rows('mm-shares').length, 1, '不得写入重复令牌记录')
  } finally {
    mmCommon.genShareToken = original
  }
})

test('第7项 open：只读返回正文，不返回任何写授权字段', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  seedShare(mock, { token: 'ValidToken1234567890', doc_id: doc._id })
  const mmShare = loadCloudObject('mm-share', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(mmShare, 'open', { token: 'ValidToken1234567890' }, { token })
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.content, CONTENT)
  assert.equal(res.data.source, 'download')
  assert.equal(res.data.file_id, doc._id)

  // 不得出现任何写授权 / 权限提升字段
  for (const field of ['canWrite', 'can_write', 'permissions', 'role', 'uid', 'write']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(res.data, field),
      `open 不得返回写授权字段 ${field}`)
  }
})

test('第7项 open：downloadFile 失败时降级 getTempFileURL', async () => {
  const mock = createShareEnv()
  mock.__behavior.downloadThrows = true
  const doc = seedShareDoc(mock)
  seedShare(mock, { token: 'ValidToken1234567890', doc_id: doc._id })
  const mmShare = loadCloudObject('mm-share', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(mmShare, 'open', { token: 'ValidToken1234567890' }, { token })
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.source, 'tempUrl')
  assert.ok(res.data.tempUrl, '降级后应返回临时链接')
  assert.equal(res.data.content, '')
})

test('第7项 open：token 非法 / 过期 / 已撤销分别返回 4007 / 4008 / 4007', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  const mmShare = loadCloudObject('mm-share', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const bad = await callObject(mmShare, 'open', { token: 'x' }, { token })
  assert.equal(bad.errCode, 4007)

  seedShare(mock, { token: 'RevokedToken1234567', doc_id: doc._id, revoked: true })
  const revoked = await callObject(mmShare, 'open', { token: 'RevokedToken1234567' }, { token })
  assert.equal(revoked.errCode, 4007)

  seedShare(mock, {
    token: 'ExpiredToken1234567',
    doc_id: doc._id,
    expire_at: new Date(Date.now() - 1000)
  })
  const expired = await callObject(mmShare, 'open', { token: 'ExpiredToken1234567' }, { token })
  assert.equal(expired.errCode, 4008)
})

// ---------------------------------------------------------------------------
// 第 6 项：mm-comment.listByFile 昵称 join
// ---------------------------------------------------------------------------

test('第6项 listByFile：批量 join 昵称，匿名统一显示「访客」，不调用管理员限定接口', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock)
  mock.__seed('mm-comments', {
    file_id: doc._id, user_id: 'u1', selected_text: '正', prefix: '', suffix: '',
    start_offset: 0, end_offset: 1, comment: '甲的批注', status: 'active',
    created_at: new Date('2024-01-02T00:00:00Z'), updated_at: new Date()
  })
  mock.__seed('mm-comments', {
    file_id: doc._id, user_id: ANON, selected_text: '文', prefix: '', suffix: '',
    start_offset: 2, end_offset: 3, comment: '游客批注', status: 'active',
    created_at: new Date('2024-01-03T00:00:00Z'), updated_at: new Date()
  })
  const mmComment = loadCloudObject('mm-comment', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(mmComment, 'listByFile', { file_id: doc._id }, { token })
  assert.equal(res.errCode, 0, res.errMsg)
  const list = res.data
  assert.equal(list.length, 2)
  const mine = list.find(item => item.user_id === 'u1')
  const guest = list.find(item => item.user_id === ANON)
  assert.equal(mine.nickname, '用户甲', '本人批注应补齐真实昵称')
  assert.equal(guest.nickname, '访客', '匿名批注统一显示访客')

  // 昵称查询应直接查 uni-id-users，不得走 mm-settings.listUsers（管理员限定）
  const { readText } = require('./helpers/load-esm.js')
  const commentSource = readText('uniCloud-alipay/cloudfunctions/mm-comment/index.obj.js')
  const listBody = /async listByFile\(param\)[\s\S]*?\n  \},/.exec(commentSource)[0]
  assert.ok(!/listUsers/.test(listBody), 'listByFile 不得调用管理员限定的 listUsers')
  // 只校验「直接查用户表」，不绑定 collection 的第二个参数形态（列裁剪可用 field 也可用参数）
  assert.match(listBody, /TABLE\.USERS/, '应直接批量查询用户表补齐昵称')
  assert.match(listBody, /nicknameMap/, '应使用批量昵称映射，避免逐条查询')
})

test('第6项 listByFile：用户表查不到昵称时不阻断，昵称降级为空串', async () => {
  const mock = createShareEnv()
  const doc = seedShareDoc(mock, { user_id: 'u1' })
  mock.__seed('mm-comments', {
    file_id: doc._id, user_id: 'ghost-user', selected_text: 'x', prefix: '', suffix: '',
    start_offset: 0, end_offset: 1, comment: '陌生人批注', status: 'active',
    created_at: new Date(), updated_at: new Date()
  })
  const mmComment = loadCloudObject('mm-comment', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(mmComment, 'listByFile', { file_id: doc._id }, { token })
  assert.equal(res.errCode, 0, '昵称缺失不得导致列表失败')
  assert.equal(res.data[0].nickname, '')
  assert.equal(res.data[0].comment, '陌生人批注')
})
