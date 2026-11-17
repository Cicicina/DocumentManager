/**
 * mm-file.saveContent 保存不生效修复的「运行时闭环」回归测试。
 *
 * 与既有 mm-file.test.js 的源码级断言互补：这里在内存 Mock 的 uploadFile /
 * downloadFile 上注入各种真实云存储异常形态（覆盖写假成功、fileID 变化、
 * 两次写入都不一致、下载通道不可用等），加载并真实执行云对象 saveContent，
 * 再用 getContent「重开文档」验证读到的正文，锁定用户原始症状不再复现。
 *
 * 本文件只读被测源码，不修改任何云对象 / 前端实现。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject } = require('./helpers/cloud-env')

const ROOT = path.resolve(__dirname, '..')
const { sha256, byteSize } = require(path.join(
  ROOT, 'uniCloud-alipay/cloudfunctions/common/mm-common/lib/hash.js'
))

const ANON = '__anonymous__'
const DOC_KEY = `cloud://mock-env/markdown/${ANON}/doc1.md`
const OLD_CONTENT = '旧内容'
const NEW_CONTENT = '# 新标题\n\n新内容'
/** 固定向量：不复用被测实现自证 */
const NEW_HASH = 'ef67d8c1d56dbb493e2fc17ebff7b9815d7e8cba920fb4d8dd3ac69a735bf243'
const VERSIONED_KEY = `${DOC_KEY}.v1`

/** 构造匿名模式 Mock（账号功能关闭，无需 token） */
function createAnonEnv(options) {
  const mock = createMockUniCloud(options)
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: false,
    permission_enabled: false,
    admin_user_id: '',
    updated_by: '',
    updated_at: new Date()
  })
  return mock
}

/** 预置文档记录（storage_key 可被用例覆盖） */
function seedDoc(mock, patch) {
  return mock.__seed('mm-files', Object.assign({
    type: 'file',
    user_id: ANON,
    parent_id: '',
    name: 'doc1.md',
    extension: 'md',
    storage_key: DOC_KEY,
    size: byteSize(OLD_CONTENT),
    content_hash: sha256(OLD_CONTENT),
    tags: [],
    icon: null,
    version: 0,
    is_delete: false,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z')
  }, patch || {}))
}

/**
 * 在 mock 上注入可控的 uploadFile 行为。
 *
 * decide(cloudPath, 第几次上传) 返回：
 * - {mode:'real'}      真实写入（默认）
 * - {mode:'skip'}      返回成功 fileID 但不落盘 —— 模拟支付宝云覆盖「假成功」
 * - {mode:'wrongContent', content} 写入错误正文 —— 模拟回读不一致
 * - {mode:'remap', key} 写入后改用另一个 fileID —— 模拟 fileID 变化
 *
 * @returns {{calls:Array}} 每次上传的调用记录
 */
function installUploadBehavior(mock, options) {
  const opts = options || {}
  const realUpload = mock.uploadFile.bind(mock)
  const state = { calls: [] }

  mock.uploadFile = async (param) => {
    const payload = param || {}
    const nth = state.calls.length + 1
    state.calls.push({ cloudPath: payload.cloudPath, nth })
    const decision = typeof opts.decide === 'function'
      ? opts.decide(payload.cloudPath, nth)
      : { mode: 'real' }
    const fileID = `cloud://mock-env/${payload.cloudPath}`
    const wrap = key => (opts.lowerCamel ? { fileId: key } : { fileID: key })
    const logUpload = () => {
      mock.__log.uploads.push({
        cloudPath: payload.cloudPath,
        size: payload.fileContent ? payload.fileContent.length : 0
      })
      mock.__log.order.push({ type: 'uploadFile' })
    }

    if (decision.mode === 'skip') {
      logUpload()
      return wrap(fileID)
    }
    if (decision.mode === 'wrongContent') {
      mock.__storage.set(fileID, decision.content)
      logUpload()
      return wrap(fileID)
    }

    const res = await realUpload(payload)
    if (decision.mode === 'remap') {
      mock.__storage.set(decision.key, mock.__storage.get(res.fileID))
      return wrap(decision.key)
    }
    return opts.lowerCamel ? { fileId: res.fileID } : res
  }
  return state
}

/** 保存一次并断言成功 */
async function saveOk(mmFile, doc, content) {
  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content,
    base_version: 0
  })
  assert.equal(result.errCode, 0, result.errMsg)
  return result
}

/** 重开文档，返回落盘正文 */
async function reopen(mmFile, doc) {
  const result = await callObject(mmFile, 'getContent', { file_id: doc._id })
  assert.equal(result.errCode, 0, result.errMsg)
  return result.data
}

// ---------------------------------------------------------------------------
// 一、成功闭环：覆盖写、fileID 变化、假成功改写、字段兼容
// ---------------------------------------------------------------------------

test('正常覆盖写：保存成功，重开读到新内容，且回读一致时不额外换路径', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const uploads = installUploadBehavior(mock, {})
  const mmFile = loadCloudObject('mm-file', mock)

  await saveOk(mmFile, doc, NEW_CONTENT)

  assert.equal(uploads.calls.length, 1, '回读一致只需一次上传，不应每次保存都换路径')
  assert.equal(uploads.calls[0].cloudPath, `markdown/${ANON}/doc1.md`)
  assert.equal(mock.__rows('mm-files')[0].storage_key, DOC_KEY)
  assert.equal((await reopen(mmFile, doc)).content, NEW_CONTENT, '重开必须读到新正文')
})

test('覆盖后 fileID 变化：storage_key 同步为新的 fileID，重开读到新内容', async () => {
  const remappedKey = `cloud://mock-env/markdown/${ANON}/renamed.md`
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  installUploadBehavior(mock, {
    decide: cloudPath => ({ mode: 'remap', key: remappedKey })
  })
  const mmFile = loadCloudObject('mm-file', mock)

  await saveOk(mmFile, doc, NEW_CONTENT)

  assert.equal(mock.__rows('mm-files')[0].storage_key, remappedKey, 'fileID 变化必须回写 storage_key')
  assert.equal(mock.__storage.get(remappedKey), NEW_CONTENT)
  assert.equal((await reopen(mmFile, doc)).content, NEW_CONTENT)
})

test('覆盖写「假成功」（未落盘）：自动改写带版本号新路径，保存成功且重开读到新内容', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const uploads = installUploadBehavior(mock, {
    // 第一次覆盖写返回成功但原对象仍是旧正文；第二次写全新路径真实落盘
    decide: (cloudPath, nth) => (nth === 1 ? { mode: 'skip' } : { mode: 'real' })
  })
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await saveOk(mmFile, doc, NEW_CONTENT)

  assert.equal(uploads.calls.length, 2, '假成功后应改写一次新路径（换目标，不是延时重试）')
  assert.equal(uploads.calls[1].cloudPath, `markdown/${ANON}/doc1.md.v1`)
  assert.equal(result.data.version, 1)
  assert.equal(mock.__rows('mm-files')[0].storage_key, VERSIONED_KEY)
  assert.equal((await reopen(mmFile, doc)).content, NEW_CONTENT, '原症状：重开读旧正文，必须消除')
})

test('上传结果字段名为 fileId（非 fileID）时也能采纳并回写 storage_key', async () => {
  const lowerKey = `cloud://mock-env/markdown/${ANON}/lowercamel.md`
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  installUploadBehavior(mock, {
    lowerCamel: true,
    decide: () => ({ mode: 'remap', key: lowerKey })
  })
  const mmFile = loadCloudObject('mm-file', mock)

  await saveOk(mmFile, doc, NEW_CONTENT)

  assert.equal(mock.__rows('mm-files')[0].storage_key, lowerKey, 'fileId 字段必须被识别')
  assert.equal((await reopen(mmFile, doc)).content, NEW_CONTENT)
})

// ---------------------------------------------------------------------------
// 二、失败闭环：明确报错、数据库完全不变
// ---------------------------------------------------------------------------

test('两次写入回读都不一致：明确报错，数据库 version/content_hash/size 完全不变', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const uploads = installUploadBehavior(mock, {
    // 第一次假成功（原对象仍是旧正文）；第二次虽落盘但写入旧正文，回读仍不一致
    decide: (cloudPath, nth) => (
      nth === 1 ? { mode: 'skip' } : { mode: 'wrongContent', content: OLD_CONTENT }
    )
  })
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id, content: NEW_CONTENT, base_version: 0
  })

  assert.equal(result.errCode, 3001, '两次写入都失败必须报 STORAGE_UPLOAD_FAILED')
  assert.equal(uploads.calls.length, 2)
  const saved = mock.__rows('mm-files')[0]
  assert.equal(saved.version, 0, 'version 不得推进')
  assert.equal(saved.content_hash, sha256(OLD_CONTENT), 'content_hash 必须保持旧值')
  assert.equal(saved.size, byteSize(OLD_CONTENT), 'size 必须保持旧值')
  assert.equal(saved.storage_key, DOC_KEY, 'storage_key 不得改写')
  assert.equal(mock.__log.updates.filter(item => item.table === 'mm-files').length, 0,
    '数据库不得有任何部分写入')
  assert.equal(mock.__rows('mm-index-chunks').length, 0, '失败时不得重建索引')
})

test('storage_key 为空：明确报错、版本不推进、不产生任何上传', async () => {
  const mock = createAnonEnv({ storage: {} })
  const doc = seedDoc(mock, { storage_key: '' })
  const uploads = installUploadBehavior(mock, {})
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id, content: NEW_CONTENT, base_version: 0
  })

  assert.equal(result.errCode, 3001, '空 storage_key 不得静默成功')
  assert.equal(result.errMsg, '保存失败，请重试')
  assert.equal(uploads.calls.length, 0)
  assert.equal(mock.__rows('mm-files')[0].version, 0)
  assert.equal(mock.__log.updates.filter(item => item.table === 'mm-files').length, 0)
})

// ---------------------------------------------------------------------------
// 三、降级与边界：下载通道不可用、哈希口径、孤儿对象
// ---------------------------------------------------------------------------

test('downloadFile 通道不可用：verifyStoredHash 降级为 null，不阻断保存', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  mock.__behavior.downloadThrows = true
  const doc = seedDoc(mock)
  const uploads = installUploadBehavior(mock, {})
  const mmFile = loadCloudObject('mm-file', mock)

  await saveOk(mmFile, doc, NEW_CONTENT)

  assert.equal(uploads.calls.length, 1, '下载不可用时不应触发换路径重写')
  assert.equal(mock.__rows('mm-files')[0].version, 1, '降级路径仍应完成保存')
  assert.equal(mock.__rows('mm-files')[0].content_hash, NEW_HASH)
})

test('中文与 emoji 内容：sha256 按 UTF-8 字节口径一致，重开正文无损', async () => {
  const content = '# 中文标题 😀\n\n正文含表情 🚀 与换行\n第二行'
  // 用 Node 内建 crypto 独立计算，避免用被测 mm.sha256 自证
  const expectedHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex')
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  installUploadBehavior(mock, {})
  const mmFile = loadCloudObject('mm-file', mock)

  await saveOk(mmFile, doc, content)

  assert.equal(mock.__rows('mm-files')[0].content_hash, expectedHash,
    '云侧 sha256 必须与标准 UTF-8 SHA-256 同口径')
  assert.equal(expectedHash, sha256(content))
  const opened = await reopen(mmFile, doc)
  assert.equal(opened.content, content, 'Buffer utf8 往返不得丢失 emoji / 换行')
  assert.equal(opened.error, '')
})

test('边界观察：改写新路径后旧 storage_key 对象仍存在（成为孤儿）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  installUploadBehavior(mock, { decide: (cloudPath, nth) => (nth === 1 ? { mode: 'skip' } : { mode: 'real' }) })
  const mmFile = loadCloudObject('mm-file', mock)

  await saveOk(mmFile, doc, NEW_CONTENT)

  assert.equal(mock.__rows('mm-files')[0].storage_key, VERSIONED_KEY)
  assert.equal(mock.__storage.get(VERSIONED_KEY), NEW_CONTENT)
  // 如实记录：旧对象未被清理。这不是本次修复引入的错误，但长期会占用云存储。
  const orphanRemoval = mock.__log.deletes.filter(item =>
    item.fileList && item.fileList.includes(DOC_KEY)
  )
  assert.equal(orphanRemoval.length, 0, '当前实现不删除旧对象（隐患，供主理人决策）')
})
