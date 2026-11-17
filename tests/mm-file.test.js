/**
 * mm-file 云对象源码级测试（AC-03 / AC-10 / AC-11 / AC-12 / AC-25 / AC-26）。
 *
 * 数据库与云存储全部由内存 Mock 承担（见 tests/helpers/mock-unicloud.js）；
 * 真实云存储 uploadFile / deleteFile 与真实 uni-id 登录属「部署后验证」范畴，本地只验源码逻辑。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
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
/** NEW_CONTENT 的标准 SHA-256（固定向量，避免用同一实现自证） */
const NEW_HASH = 'ef67d8c1d56dbb493e2fc17ebff7b9815d7e8cba920fb4d8dd3ac69a735bf243'

/** 构造匿名模式 Mock：账号功能关闭，所有访客共享 __anonymous__ 身份 */
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

/** 预置一个 md 文档记录 */
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

// ---------------------------------------------------------------------------
// saveContent
// ---------------------------------------------------------------------------

test('saveContent 正常保存：version+1、size/content_hash 重算、created_at 不在更新字段（AC-03）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: NEW_CONTENT,
    base_version: 0
  })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.version, 1)
  assert.equal(result.data.size, byteSize(NEW_CONTENT))
  assert.equal(result.data.size, 22, '中文按 UTF-8 字节计')
  assert.equal(result.data.content_hash, NEW_HASH, 'content_hash 必须按新内容重算')

  const saved = mock.__rows('mm-files')[0]
  assert.equal(saved.version, 1)
  assert.equal(saved.size, byteSize(NEW_CONTENT))
  assert.equal(saved.content_hash, NEW_HASH)
  assert.equal(saved.created_at.toISOString(), '2024-01-01T00:00:00.000Z', 'created_at 必须保持不变')

  // C3：created_at 绝不出现在 update 字段中
  const update = mock.__log.updates.find(item => item.table === 'mm-files')
  assert.ok(update, '应有 mm-files 更新')
  assert.ok(!Object.prototype.hasOwnProperty.call(update.patch, 'created_at'),
    'created_at 不得出现在 update 字段')
  assert.deepEqual(Object.keys(update.patch).sort(),
    ['content_hash', 'size', 'storage_key', 'updated_at', 'version'])

  // 云存储覆盖写：复用原 cloudPath
  assert.equal(mock.__log.uploads.length, 1)
  assert.equal(mock.__log.uploads[0].cloudPath, `markdown/${ANON}/doc1.md`)
  assert.equal(mock.__storage.get(DOC_KEY), NEW_CONTENT, '云存储内容应被覆盖')

  // C6：索引先删后插，revision 与新 version 对齐
  const chunks = mock.__rows('mm-index-chunks')
  assert.ok(chunks.length > 0, '保存后应重建索引分块')
  for (const chunk of chunks) {
    assert.equal(chunk.revision, 1, 'index revision 必须与文件 version 对齐')
    assert.equal(chunk.file_id, doc._id)
  }
})

test('saveContent 首次保存不误报冲突（云端 0、基准 0）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: NEW_CONTENT,
    base_version: 0
  })
  assert.equal(result.errCode, 0, '云端 version=0、base_version=0 不应冲突')
})

test('saveContent 并发冲突：A 先保存成功后 B 收到 2001 且不写库、不覆盖云存储（AC-10）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  // A 会话：基准版本 0 → 保存成功
  const first = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: 'A 的内容',
    base_version: 0
  })
  assert.equal(first.errCode, 0)
  assert.equal(first.data.version, 1)

  const storageAfterA = mock.__storage.get(DOC_KEY)
  const fileUpdateCountAfterA = mock.__log.updates.filter(item => item.table === 'mm-files').length
  const uploadCountAfterA = mock.__log.uploads.length

  // B 会话：基准版本仍为 0 → 冲突
  const second = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: 'B 的内容',
    base_version: 0
  })

  assert.equal(second.errCode, 2001, '应返回版本冲突业务码 2001')
  assert.equal(second.errMsg, '云端有更新版本')
  assert.equal(second.data.cloudVersion, 1, '冲突包应携带云端最新 version')
  assert.equal(second.data.cloudContent, 'A 的内容', '冲突包应携带云端内容供前端弹窗')
  assert.ok(Object.prototype.hasOwnProperty.call(second.data, 'cloudUpdatedAt'))

  // 不写库、不覆盖云存储
  assert.equal(mock.__log.updates.filter(item => item.table === 'mm-files').length,
    fileUpdateCountAfterA, '冲突时不得更新文件记录')
  assert.equal(mock.__log.uploads.length, uploadCountAfterA, '冲突时不得覆盖云存储')
  assert.equal(mock.__storage.get(DOC_KEY), storageAfterA, '冲突时云端内容必须保持不变')
  assert.equal(mock.__rows('mm-files')[0].version, 1, '冲突时云端 version 必须保持不变')
})

test('saveContent 冲突后选择覆写（force=true）：写入内容且 version=cloudVersion+1（AC-11）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock, { version: 3 })
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: NEW_CONTENT,
    base_version: 0,
    force: true
  })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.version, 4, '覆写后 version 应为云端 version + 1')
  assert.equal(mock.__rows('mm-files')[0].version, 4)
  assert.equal(mock.__storage.get(DOC_KEY), NEW_CONTENT, '覆写必须写入云存储')
  assert.equal(mock.__log.uploads.length, 1)

  const chunks = mock.__rows('mm-index-chunks')
  assert.ok(chunks.length > 0)
  for (const chunk of chunks) {
    assert.equal(chunk.revision, 4, '覆写后索引 revision 应刷新为新 version')
  }
})

test('saveContent 冲突「放弃」等价于不调用保存，云端 version 与内容均不变（AC-12 服务端侧）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock, { version: 2, size: 9, content_hash: sha256(OLD_CONTENT) })
  const mmFile = loadCloudObject('mm-file', mock)

  const conflict = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: NEW_CONTENT,
    base_version: 1
  })
  assert.equal(conflict.errCode, 2001)

  const saved = mock.__rows('mm-files')[0]
  assert.equal(saved.version, 2, '放弃后云端 version 不变')
  assert.equal(saved.size, 9, '放弃后云端 size 不变')
  assert.equal(mock.__storage.get(DOC_KEY), OLD_CONTENT, '放弃后云端内容不变')
})

test('saveContent 忽略客户端伪造的 created_at / size / content_hash / version（AC-04 源码级）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const mmFile = loadCloudObject('mm-file', mock)
  const forgedTime = new Date('1999-01-01T00:00:00Z')

  const result = await callObject(mmFile, 'saveContent', {
    file_id: doc._id,
    content: NEW_CONTENT,
    base_version: 0,
    created_at: forgedTime,
    updated_at: forgedTime,
    size: 999999,
    content_hash: 'forged-hash',
    version: 99,
    user_id: 'hacker'
  })

  assert.equal(result.errCode, 0)
  const saved = mock.__rows('mm-files')[0]
  assert.equal(saved.created_at.toISOString(), '2024-01-01T00:00:00.000Z')
  assert.equal(saved.size, byteSize(NEW_CONTENT))
  assert.equal(saved.content_hash, NEW_HASH)
  assert.equal(saved.version, 1, 'version 必须由服务端 cloudVersion+1 计算')
  assert.equal(saved.user_id, ANON, 'user_id 由 _before 注入，客户端传值必须被忽略')
})

test('saveContent 二次保存：索引先删后插，旧关键词不再命中、新关键词可命中（AC-22）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const first = await callObject(mmFile, 'saveContent', {
    file_id: doc._id, content: '# 标题\n\n旧关键词内容', base_version: 0
  })
  assert.equal(first.errCode, 0, first.errMsg)
  const chunksAfterFirst = mock.__rows('mm-index-chunks')
  assert.ok(chunksAfterFirst.some(chunk => chunk.content.includes('旧关键词')))
  assert.equal(chunksAfterFirst.length, 1, '同一文档重建索引必须按 file_id 先删后插，不留重复分块')

  const second = await callObject(mmFile, 'saveContent', {
    file_id: doc._id, content: '# 标题\n\n新关键词内容', base_version: 1
  })
  assert.equal(second.errCode, 0, second.errMsg)
  assert.equal(second.data.version, 2)

  const chunksAfterSecond = mock.__rows('mm-index-chunks')
  assert.equal(chunksAfterSecond.length, 1, '旧分块必须被删除，不得累积')
  assert.ok(!chunksAfterSecond.some(chunk => chunk.content.includes('旧关键词')),
    '旧关键词不应再命中')
  assert.ok(chunksAfterSecond.some(chunk => chunk.content.includes('新关键词')),
    '新关键词应可命中')
  for (const chunk of chunksAfterSecond) {
    assert.equal(chunk.revision, 2, 'revision 必须与文件最新 version 一致')
  }
})

test('saveContent 参数与资源校验：缺 file_id → 1001，文档不存在 → 1004', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const missing = await callObject(mmFile, 'saveContent', { content: 'x', base_version: 0 })
  assert.equal(missing.errCode, 1001)

  const notFound = await callObject(mmFile, 'saveContent', {
    file_id: 'not-exist', content: 'x', base_version: 0
  })
  assert.equal(notFound.errCode, 1004)

  const badType = await callObject(mmFile, 'saveContent', {
    file_id: doc._id, content: 123, base_version: 0
  })
  assert.equal(badType.errCode, 1001)
})

// ---------------------------------------------------------------------------
// purgeDelete
// ---------------------------------------------------------------------------

/** 预置「目录 + 文档 + 批注 + 分块」的彻底删除场景 */
function seedPurgeScene(mock) {
  const folder = mock.__seed('mm-files', {
    type: 'folder', user_id: ANON, parent_id: '', name: '项目目录', extension: '',
    storage_key: '', size: 0, content_hash: '', tags: [], icon: null,
    version: 0, is_delete: false,
    created_at: new Date(), updated_at: new Date()
  })
  const file = seedDoc(mock, { parent_id: folder._id, storage_key: DOC_KEY })
  mock.__seed('mm-comments', {
    file_id: file._id, user_id: ANON, selected_text: '旧', prefix: '', suffix: '',
    start_offset: 0, end_offset: 1, comment: '备注一', status: 'active',
    created_at: new Date(), updated_at: new Date()
  })
  mock.__seed('mm-comments', {
    file_id: file._id, user_id: ANON, selected_text: '内容', prefix: '', suffix: '',
    start_offset: 1, end_offset: 3, comment: '备注二', status: 'active',
    created_at: new Date(), updated_at: new Date()
  })
  mock.__seed('mm-index-chunks', {
    chunk_id: `${file._id}#1`, file_id: file._id, user_id: ANON, heading: '',
    content: OLD_CONTENT, keywords: [], start_offset: 0, end_offset: OLD_CONTENT.length,
    revision: 0, created_at: new Date()
  })
  return { folder, file }
}

test('purgeDelete：云存储删除失败（status!==0）→ 3002 且一条记录都不删（AC-26）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  mock.__behavior.deleteFailed.add(DOC_KEY)
  const { folder, file } = seedPurgeScene(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'purgeDelete', { file_ids: [folder._id] })

  assert.equal(result.errCode, 3002, '云存储删除失败必须整体报错 3002')
  assert.equal(result.errMsg, '删除失败，请重试')
  assert.equal(mock.__rows('mm-files').length, 2, '失败时文件表记录必须全部保留')
  assert.equal(mock.__rows('mm-comments').length, 2, '失败时批注记录必须保留')
  assert.equal(mock.__rows('mm-index-chunks').length, 1, '失败时索引分块必须保留')
  assert.ok(mock.__rows('mm-files').some(item => item._id === file._id))
})

test('purgeDelete：deleteFile 抛错同样返回 3002 且不删记录', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  mock.__behavior.deleteThrows = true
  const { folder } = seedPurgeScene(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'purgeDelete', { file_ids: [folder._id] })
  assert.equal(result.errCode, 3002)
  assert.equal(mock.__rows('mm-files').length, 2)
})

test('purgeDelete 成功：先删云存储 → 级联删批注/索引 → 再删文件记录（AC-26）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const { folder, file } = seedPurgeScene(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'purgeDelete', { file_ids: [folder._id] })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.deletedFiles, 2, '文件夹本身与后代文档都应删除')
  assert.equal(result.data.deletedKeys, 1, '仅文档有云存储 fileID')

  assert.equal(mock.__log.deletes.length, 1, '应调用一次 deleteFile')
  assert.deepEqual(mock.__log.deletes[0].fileList, [DOC_KEY])

  assert.equal(mock.__rows('mm-files').length, 0, '文件表记录应清空')
  assert.equal(mock.__rows('mm-comments').length, 0, '关联批注应级联清理')
  assert.equal(mock.__rows('mm-index-chunks').length, 0, '关联索引分块应级联清理')
  assert.ok(!mock.__rows('mm-files').some(item => item._id === file._id))

  // 顺序断言：deleteFile 必须先于任何记录删除
  const order = mock.__log.order
  const deleteFileIndex = order.findIndex(item => item.type === 'deleteFile')
  const firstRemoveIndex = order.findIndex(item => item.type === 'remove')
  assert.ok(deleteFileIndex >= 0 && firstRemoveIndex >= 0)
  assert.ok(deleteFileIndex < firstRemoveIndex, '必须先确认云存储删除成功再删记录')

  const commentsRemove = order.findIndex(item => item.type === 'remove' && item.table === 'mm-comments')
  const chunksRemove = order.findIndex(item => item.type === 'remove' && item.table === 'mm-index-chunks')
  const filesRemove = order.findIndex(item => item.type === 'remove' && item.table === 'mm-files')
  assert.ok(commentsRemove < filesRemove, '批注应先于文件记录删除')
  assert.ok(chunksRemove < filesRemove, '索引分块应先于文件记录删除')
})

// ---------------------------------------------------------------------------
// softDelete / restore
// ---------------------------------------------------------------------------

test('softDelete：只置 is_delete=true 与 deleted_at，不调用 deleteFile（AC-25）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const doc = seedDoc(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'softDelete', { file_ids: [doc._id] })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.count, 1)

  const saved = mock.__rows('mm-files')[0]
  assert.equal(saved.is_delete, true)
  assert.ok(saved.deleted_at instanceof Date, 'deleted_at 应为服务器时间')
  assert.equal(saved.storage_key, DOC_KEY, '软删不得清空 storage_key')
  assert.equal(mock.__log.deletes.length, 0, '普通删除不得调用 deleteFile')
  assert.equal(mock.__storage.get(DOC_KEY), OLD_CONTENT, '普通删除不得动云存储文件')
})

test('restore：deleted_at 置 null、is_delete 置回 false，撞名走 -copyN（AC-25）', async () => {
  const mock = createAnonEnv({ storage: { [DOC_KEY]: OLD_CONTENT } })
  const deleted = seedDoc(mock, {
    is_delete: true,
    deleted_at: new Date('2024-06-01T00:00:00Z')
  })
  // 目标目录内已存在同名文档
  mock.__seed('mm-files', {
    type: 'file', user_id: ANON, parent_id: '', name: 'doc1.md', extension: 'md',
    storage_key: '', size: 0, content_hash: '', tags: [], icon: null,
    version: 0, is_delete: false, created_at: new Date(), updated_at: new Date()
  })
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'restore', { file_ids: [deleted._id] })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.count, 1)
  assert.equal(result.data.renamed.length, 1, '撞名应返回改名信息')
  assert.equal(result.data.renamed[0].name, 'doc1-copy1.md')

  const restored = mock.__rows('mm-files').find(item => item._id === deleted._id)
  assert.equal(restored.is_delete, false)
  assert.equal(restored.deleted_at, null, 'deleted_at 必须显式置 null')
  assert.equal(restored.name, 'doc1-copy1.md')
  assert.equal(mock.__log.deletes.length, 0, '还原不得调用 deleteFile')
})

test('softDelete / restore：空入参返回 1001', async () => {
  const mock = createAnonEnv({ storage: {} })
  const mmFile = loadCloudObject('mm-file', mock)

  assert.equal((await callObject(mmFile, 'softDelete', { file_ids: [] })).errCode, 1001)
  assert.equal((await callObject(mmFile, 'restore', {})).errCode, 1001)
})

// ---------------------------------------------------------------------------
// 其他一致性
// ---------------------------------------------------------------------------

test('listFiles：按目录 + 未删除过滤，返回分页结构', async () => {
  const mock = createAnonEnv({ storage: {} })
  seedDoc(mock, { name: 'a.md' })
  seedDoc(mock, { name: 'b.md' })
  seedDoc(mock, { name: 'deleted.md', is_delete: true, deleted_at: new Date() })
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'listFiles', { parent_id: '' })
  assert.equal(result.errCode, 0)
  assert.equal(result.data.total, 2, '回收站文档不应出现在文件列表')
  assert.equal(result.data.page, 1)
  assert.equal(result.data.list.length, 2)
})

test('rename：同目录撞名追加 -copyN（AC-02 服务端侧）', async () => {
  const mock = createAnonEnv({ storage: {} })
  const first = seedDoc(mock, { name: 'a.md' })
  seedDoc(mock, { name: 'a.md' })
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'rename', { file_id: first._id, name: 'a.md' })
  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.name, 'a-copy1.md')
})

// ---------------------------------------------------------------------------
// 文件夹图标
// ---------------------------------------------------------------------------

/** 预置一个文件夹记录 */
function seedFolder(mock, patch) {
  return mock.__seed('mm-files', Object.assign({
    type: 'folder',
    user_id: ANON,
    parent_id: '',
    name: 'dir',
    extension: '',
    storage_key: '',
    size: 0,
    content_hash: '',
    tags: [],
    icon: null,
    version: 0,
    is_delete: false,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z')
  }, patch || {}))
}

test('createFolder 未选图标时不落 icon 字段（null 会阻断后续设置）', async () => {
  const mock = createAnonEnv({ storage: {} })
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'createFolder', { name: '新建文件夹' })

  assert.equal(result.errCode, 0, result.errMsg)
  const row = mock.__rows('mm-files').find(item => item._id === result.data._id)
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'icon'), false, '不应写入 icon: null')
})

test('updateIcon：历史记录 icon 为 null 时仍可设置（必须用 set 整体替换）', async () => {
  const mock = createAnonEnv({ storage: {} })
  const folder = seedFolder(mock)
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'updateIcon', {
    folder_id: folder._id,
    icon: { type: 'preset', value: 'folder-blue' }
  })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.deepEqual(result.data.icon, { type: 'preset', value: 'folder-blue' })
  assert.equal(mock.__log.updates[0].patch.icon.__op, 'set', 'icon 不能裸传对象，否则线上被展开成点号路径')
})

test('updateIcon 传 null：移除 icon 字段而非写入 null', async () => {
  const mock = createAnonEnv({ storage: {} })
  const folder = seedFolder(mock, { icon: { type: 'preset', value: 'folder-blue' } })
  const mmFile = loadCloudObject('mm-file', mock)

  const result = await callObject(mmFile, 'updateIcon', { folder_id: folder._id, icon: null })

  assert.equal(result.errCode, 0, result.errMsg)
  const row = mock.__rows('mm-files').find(item => item._id === folder._id)
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'icon'), false, 'icon 字段应被删除')
})
