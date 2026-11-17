/**
 * 云对象统一出参工具与前后端常量一致性测试。
 *
 * 覆盖：error.js 的 ok / fail / assert 出参结构 {errCode, errMsg, data}；
 * 前端 common/constants.js 与云侧 mm-common/lib/constants.js 的六表名、
 * 匿名用户 ID、配置键、云存储路径模板、算法参数与错误码逐项相等（架构 8.1）。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { loadEsm } = require('./helpers/load-esm')

const ROOT = path.resolve(__dirname, '..')
const LIB = path.join(ROOT, 'uniCloud-alipay/cloudfunctions/common/mm-common/lib')
const cloudConstants = require(path.join(LIB, 'constants.js'))
const { ok, fail, assert: mmAssert } = require(path.join(LIB, 'error.js'))

let frontConstants = null

test.before(async () => {
  frontConstants = await loadEsm('common/constants.js')
})

// ---------------------------------------------------------------- error.js

test('ok() 出参结构为 {errCode:0, errMsg:"ok", data}', () => {
  assert.deepEqual(ok(), { errCode: 0, errMsg: 'ok', data: null })
  assert.deepEqual(ok({ a: 1 }), { errCode: 0, errMsg: 'ok', data: { a: 1 } })
  assert.deepEqual(ok(0), { errCode: 0, errMsg: 'ok', data: 0 }, '0 不应被当作空值丢失')
  assert.deepEqual(ok(null), { errCode: 0, errMsg: 'ok', data: null })
})

test('fail() 出参结构为 {errCode, errMsg, data:null}，缺省取错误码默认中文', () => {
  const denied = fail(cloudConstants.ERR.PERMISSION_DENIED)
  assert.deepEqual(denied, { errCode: 1003, errMsg: '没有操作权限', data: null })

  const conflict = fail(cloudConstants.ERR.VERSION_CONFLICT)
  assert.equal(conflict.errCode, 2001)
  assert.equal(conflict.errMsg, '云端有更新版本')
  assert.equal(conflict.data, null)
})

test('fail() 支持自定义中文提示，非法错误码降级为 9999', () => {
  assert.deepEqual(fail(4004, '自定义提示'), { errCode: 4004, errMsg: '自定义提示', data: null })
  assert.equal(fail('abc').errCode, 9999)
  assert.equal(fail(undefined).errCode, 9999)
  assert.equal(fail(9999).errMsg, '服务异常，请重试')
})

test('assert() 条件成立不抛错，不成立抛出带 errCode / errMsg 的错误', () => {
  assert.equal(mmAssert(true, 1001, '不会抛出'), undefined)

  let caught = null
  try {
    mmAssert(false, cloudConstants.ERR.ANCHOR_MISMATCH)
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof Error)
  assert.equal(caught.errCode, 4004)
  assert.equal(caught.errMsg, '批注位置已变化，请重新选择')
  assert.equal(caught.message, '批注位置已变化，请重新选择')
})

test('所有云对象出参三键齐备（errCode / errMsg / data）', () => {
  for (const result of [ok('x'), fail(1001), fail(9999, '异常')]) {
    assert.deepEqual(Object.keys(result).sort(), ['data', 'errCode', 'errMsg'])
    assert.equal(typeof result.errCode, 'number')
    assert.equal(typeof result.errMsg, 'string')
  }
})

// ------------------------------------------------------------ 常量一致性

test('业务表名与 uni-id 用户表名前后端逐项相等（含新增分享表）', () => {
  assert.deepEqual(cloudConstants.TABLE, frontConstants.TABLE)
  assert.deepEqual(cloudConstants.TABLE, {
    FILES: 'mm-files',
    COMMENTS: 'mm-comments',
    IMAGES: 'mm-images',
    CHUNKS: 'mm-index-chunks',
    SETTINGS: 'mm-settings',
    USER_PERMISSIONS: 'mm-user-permissions',
    USERS: 'uni-id-users',
    SHARES: 'mm-shares',
    IMAGE_REFS: 'mm-image-refs'
  })
  assert.equal(Object.keys(cloudConstants.TABLE).length, 9, '表名常量应为 8 张业务表 + 1 张用户表')
  assert.equal(cloudConstants.TABLE.SHARES, 'mm-shares', '分享功能必须使用统一表名常量')
  assert.equal(frontConstants.TABLE.SHARES, cloudConstants.TABLE.SHARES)
  assert.equal(cloudConstants.TABLE.IMAGE_REFS, 'mm-image-refs', '图片引用表必须使用统一表名常量')
  assert.equal(frontConstants.TABLE.IMAGE_REFS, cloudConstants.TABLE.IMAGE_REFS)
})

test('匿名用户 ID / 配置键 / 扩展名前后端一致且符合 PRD 默认假设', () => {
  assert.equal(cloudConstants.ANONYMOUS_USER_ID, '__anonymous__')
  assert.equal(frontConstants.ANONYMOUS_USER_ID, '__anonymous__')
  assert.equal(cloudConstants.SETTINGS_KEY, 'app_config')
  assert.equal(frontConstants.SETTINGS_KEY, 'app_config')
  assert.equal(cloudConstants.DEFAULT_EXTENSION, 'md')
  assert.equal(frontConstants.DEFAULT_EXTENSION, 'md')
})

test('算法参数前后端一致：锚点上下文 32、分块上限 1000、重叠 100', () => {
  for (const key of ['ANCHOR_CONTEXT_LEN', 'CHUNK_MAX_LEN', 'CHUNK_OVERLAP']) {
    assert.equal(cloudConstants[key], frontConstants[key], `${key} 前后端不一致`)
  }
  assert.equal(cloudConstants.ANCHOR_CONTEXT_LEN, 32)
  assert.equal(cloudConstants.CHUNK_MAX_LEN, 1000)
  assert.equal(cloudConstants.CHUNK_OVERLAP, 100)
})

test('云存储路径模板前后端输出一致（markdown / images / icons）', () => {
  assert.doesNotThrow(() => assert.deepEqual(cloudConstants.CLOUD_PATH, cloudConstants.CLOUD_PATH))

  const cloudMarkdown = cloudConstants.CLOUD_PATH.markdown('u1')
  const frontMarkdown = frontConstants.CLOUD_PATH.markdown('u1')
  assert.equal(cloudMarkdown, 'markdown/u1/{uuid}.md')
  assert.equal(frontMarkdown, cloudMarkdown)

  assert.equal(cloudConstants.CLOUD_PATH.image('u1', 'png'), 'images/u1/{uuid}.png')
  assert.equal(frontConstants.CLOUD_PATH.image('u1', 'png'), 'images/u1/{uuid}.png')
  assert.equal(cloudConstants.CLOUD_PATH.icon('u1', 'svg'), 'icons/u1/{uuid}.svg')
  assert.equal(frontConstants.CLOUD_PATH.icon('u1', 'svg'), 'icons/u1/{uuid}.svg')
})

test('错误码 ERR 与错误文案 ERR_MESSAGE 前后端逐项相等，且与架构 3.8 一致', () => {
  assert.deepEqual(cloudConstants.ERR, frontConstants.ERR)
  assert.deepEqual(cloudConstants.ERR_MESSAGE, frontConstants.ERR_MESSAGE)

  const expected = {
    OK: 0,
    PARAM_INVALID: 1001,
    UNAUTHORIZED: 1002,
    PERMISSION_DENIED: 1003,
    NOT_FOUND: 1004,
    VERSION_CONFLICT: 2001,
    STORAGE_UPLOAD_FAILED: 3001,
    STORAGE_DELETE_FAILED: 3002,
    TEMP_URL_FAILED: 3003,
    ACCOUNT_DISABLE_REJECTED: 4001,
    FOLDER_CREATE_FAILED: 4002,
    MOVE_INVALID: 4003,
    ANCHOR_MISMATCH: 4004,
    PERMISSION_NEEDS_ACCOUNT: 4005,
    IMAGE_REGISTER_FAILED: 4006,
    SHARE_TOKEN_INVALID: 4007,
    SHARE_EXPIRED: 4008,
    SHARE_CREATE_FAILED: 4009,
    SHARE_DOC_UNAVAILABLE: 4010,
    IMAGE_IN_USE: 4011,
    INDEX_REBUILD_FAILED: 5001,
    RELOCATE_FAILED: 5002,
    INTERNAL_ERROR: 9999
  }
  assert.deepEqual(cloudConstants.ERR, expected)
  assert.equal(Object.keys(cloudConstants.ERR).length, 23, '统一错误码应为 23 个（含 4 个分享码与图片引用码）')
  assert.equal(cloudConstants.ERR.IMAGE_IN_USE, 4011, '图片引用错误码应为 4011')
  assert.equal(frontConstants.ERR.IMAGE_IN_USE, 4011)
  assert.equal(cloudConstants.ERR_MESSAGE[4011], '图片被文档引用')

  // 分享相关错误码的取值与文案必须逐项正确，不能只放宽数量断言
  const shareMessages = {
    SHARE_TOKEN_INVALID: [4007, '分享链接无效'],
    SHARE_EXPIRED: [4008, '分享链接已过期'],
    SHARE_CREATE_FAILED: [4009, '分享创建失败，请重试'],
    SHARE_DOC_UNAVAILABLE: [4010, '分享的文档不可用']
  }
  for (const [name, [code, message]] of Object.entries(shareMessages)) {
    assert.equal(cloudConstants.ERR[name], code, `${name} 应为 ${code}`)
    assert.equal(frontConstants.ERR[name], code, `前端 ${name} 与云侧不一致`)
    assert.equal(cloudConstants.ERR_MESSAGE[code], message, `${code} 文案不正确`)
    assert.equal(frontConstants.ERR_MESSAGE[code], message, `前端 ${code} 文案与云侧不一致`)
  }

  // 每个错误码都必须有中文文案
  for (const code of Object.values(expected)) {
    assert.equal(typeof cloudConstants.ERR_MESSAGE[code], 'string', `错误码 ${code} 缺少中文文案`)
    assert.ok(cloudConstants.ERR_MESSAGE[code].length > 0)
  }
})
