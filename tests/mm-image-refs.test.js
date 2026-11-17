/**
 * 图片引用追踪（需求 6/7）运行时回归：
 * - syncRefs 按正文提取 mm-image://<fileID> 并与引用表差量对齐（幂等）；
 * - remove 未被引用直接删、被引用返回 4011 + 明细、force 级联清引用；
 * - list 返回真实 ref_count 与 uploader_nickname。
 *
 * 用内存 Mock 真实加载 mm-image 云对象执行，只读被测源码。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject, ROOT } = require('./helpers/cloud-env')
const uniIdStub = require('./helpers/stubs/uni-id-common')

const DOC_KEY = 'cloud://mock-env/markdown/u1/doc1.md'
const IMG_A = 'cloud://mock-env/images/u1/a.png'
const IMG_B = 'cloud://mock-env/images/u1/b.png'
const CONTENT = `# 标题\n\n![a](mm-image://${IMG_A})\n\n![b](mm-image://${IMG_B})`
const CONTENT_ONLY_A = `# 标题\n\n![a](mm-image://${IMG_A})`

const { sha256, byteSize } = require(path.join(
  ROOT, 'uniCloud-alipay/cloudfunctions/common/mm-common/lib/hash.js'
))

test.beforeEach(() => {
  uniIdStub.__reset()
})

function createEnv() {
  const mock = createMockUniCloud({ storage: { [DOC_KEY]: CONTENT } })
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: true,
    permission_enabled: false,
    admin_user_id: 'admin1',
    updated_by: '',
    updated_at: new Date()
  })
  mock.__seed('uni-id-users', { _id: 'u1', username: '甲', nickname: '用户甲' })
  mock.__seed('uni-id-users', { _id: '__anonymous__', username: '访客', nickname: '' })
  return mock
}

function seedDoc(mock, patch) {
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
    created_at: new Date(),
    updated_at: new Date()
  }, patch || {}))
}

function seedImage(mock, fileId, patch) {
  return mock.__seed('mm-images', Object.assign({
    file_id: fileId,
    user_id: 'u1',
    name: 'a.png',
    extension: 'png',
    size: 2048,
    cloud_path: 'images/u1/a.png',
    ref_count: 0,
    created_at: new Date(),
    updated_at: new Date()
  }, patch || {}))
}

test('syncRefs：按正文提取两张图片并写入引用表', async () => {
  const mock = createEnv()
  const doc = seedDoc(mock)
  const obj = loadCloudObject('mm-image', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(obj, 'syncRefs', { doc_id: doc._id, content: CONTENT }, { token })
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.added, 2, '应新增两条引用')
  assert.equal(res.data.removed, 0)
  assert.equal(res.data.total, 2)

  const refs = mock.__rows('mm-image-refs')
  assert.equal(refs.length, 2)
  assert.deepEqual(refs.map(item => item.image_file_id).sort(), [IMG_A, IMG_B].sort())
})

test('syncRefs 幂等：同一内容重复调用不重复写入', async () => {
  const mock = createEnv()
  const doc = seedDoc(mock)
  const obj = loadCloudObject('mm-image', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  await callObject(obj, 'syncRefs', { doc_id: doc._id, content: CONTENT }, { token })
  const second = await callObject(obj, 'syncRefs', { doc_id: doc._id, content: CONTENT }, { token })

  assert.equal(second.errCode, 0, second.errMsg)
  assert.equal(second.data.added, 0, '重复调用不应再新增')
  assert.equal(second.data.removed, 0)
  assert.equal(mock.__rows('mm-image-refs').length, 2)
})

test('syncRefs：正文删掉图片后移除对应引用', async () => {
  const mock = createEnv()
  const doc = seedDoc(mock)
  const obj = loadCloudObject('mm-image', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  await callObject(obj, 'syncRefs', { doc_id: doc._id, content: CONTENT }, { token })
  // 模拟「保存后」状态：库里的 content_hash 已是新内容，syncRefs 才会采信传入的 content
  const docRow = mock.__rows('mm-files').find(item => item._id === doc._id)
  docRow.content_hash = sha256(CONTENT_ONLY_A)
  const res = await callObject(obj, 'syncRefs', { doc_id: doc._id, content: CONTENT_ONLY_A }, { token })

  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.added, 0)
  assert.equal(res.data.removed, 1, '应移除 b 的引用')
  const refs = mock.__rows('mm-image-refs')
  assert.equal(refs.length, 1)
  assert.equal(refs[0].image_file_id, IMG_A)
})

test('remove：未被引用的图片直接删除，不返回 4011', async () => {
  const mock = createEnv()
  const image = seedImage(mock, IMG_A)
  const obj = loadCloudObject('mm-image', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(obj, 'remove', { image_ids: [image._id] }, { token })
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(res.data.deleted, 1)
  assert.equal(mock.__rows('mm-images').length, 0)
})

test('remove：被文档引用时返回 4011 与引用明细，记录不删', async () => {
  const mock = createEnv()
  const image = seedImage(mock, IMG_A)
  const doc = seedDoc(mock)
  mock.__seed('mm-image-refs', { image_file_id: IMG_A, doc_id: doc._id, created_at: new Date() })
  const obj = loadCloudObject('mm-image', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(obj, 'remove', { image_ids: [image._id] }, { token })
  assert.equal(res.errCode, 4011, '被引用应返回 4011')
  assert.ok(res.data && Array.isArray(res.data.refs), '必须透传引用明细')
  assert.equal(res.data.refs[0].ref_count, 1)
  assert.equal(res.data.refs[0].docs[0].name, 'doc1.md')
  assert.equal(mock.__rows('mm-images').length, 1, '未确认前不得删除记录')
})

test('remove：force=true 级联清理引用后再删记录', async () => {
  const mock = createEnv()
  const image = seedImage(mock, IMG_A)
  const doc = seedDoc(mock)
  mock.__seed('mm-image-refs', { image_file_id: IMG_A, doc_id: doc._id, created_at: new Date() })
  const obj = loadCloudObject('mm-image', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(obj, 'remove', { image_ids: [image._id], force: true }, { token })
  assert.equal(res.errCode, 0, res.errMsg)
  assert.equal(mock.__rows('mm-images').length, 0)
  assert.equal(mock.__rows('mm-image-refs').length, 0, 'force 删除应清掉引用记录')
})

test('list：返回真实 ref_count 与上传者昵称', async () => {
  const mock = createEnv()
  const imageA = seedImage(mock, IMG_A)
  seedImage(mock, IMG_B, { name: 'b.png' })
  const doc = seedDoc(mock)
  mock.__seed('mm-image-refs', { image_file_id: IMG_A, doc_id: doc._id, created_at: new Date() })
  const obj = loadCloudObject('mm-image', mock)
  const token = uniIdStub.__login('token-u1', 'u1')

  const res = await callObject(obj, 'list', { page: 1, pageSize: 20 }, { token })
  assert.equal(res.errCode, 0, res.errMsg)
  const rows = res.data.list
  const a = rows.find(item => item.file_id === IMG_A)
  const b = rows.find(item => item.file_id === IMG_B)

  assert.equal(a.ref_count, 1, '被引用一次的图片 ref_count 应为 1')
  assert.equal(a.uploader_nickname, '用户甲')
  assert.equal(b.ref_count, 0)
  assert.equal(imageA.size, 2048)
})
