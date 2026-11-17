/**
 * mm-search 云对象源码级测试（AC-21 / AC-23）。
 *
 * 四个维度分别可命中：标签 / 文件名 / 批注 / 正文（走分块索引）；
 * 正文命中需返回 start_offset / end_offset / snippet 供回跳（AC-23），
 * 并过滤 revision 与文件 version 不一致的陈旧索引（C6）。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject } = require('./helpers/cloud-env')
const uniIdStub = require('./helpers/stubs/uni-id-common')

const ANON = '__anonymous__'
/** 分块正文：'前言'×20 + '性能' + '结尾'×20，共 82 字符 */
const CHUNK_CONTENT = '前言'.repeat(20) + '性能' + '结尾'.repeat(20)
const CHUNK_START = 100
const CHUNK_END = CHUNK_START + CHUNK_CONTENT.length

test.beforeEach(() => {
  uniIdStub.__reset()
})

/** 构造匿名模式的搜索数据集 */
function createSearchEnv() {
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: false,
    permission_enabled: false,
    admin_user_id: '',
    updated_by: '',
    updated_at: new Date()
  })

  const design = mock.__seed('mm-files', {
    type: 'file', user_id: ANON, parent_id: '', name: '设计说明.md', extension: 'md',
    storage_key: 'cloud://mock-env/markdown/anon/design.md', size: 0, content_hash: '',
    tags: ['架构', 'markdown'], icon: null, version: 1, is_delete: false,
    created_at: new Date(), updated_at: new Date()
  })
  const deploy = mock.__seed('mm-files', {
    type: 'file', user_id: ANON, parent_id: '', name: '部署手册.md', extension: 'md',
    storage_key: 'cloud://mock-env/markdown/anon/deploy.md', size: 0, content_hash: '',
    tags: ['运维'], icon: null, version: 1, is_delete: false,
    created_at: new Date(), updated_at: new Date()
  })
  // 回收站文档：不应出现在任何搜索结果中
  mock.__seed('mm-files', {
    type: 'file', user_id: ANON, parent_id: '', name: '设计草稿.md', extension: 'md',
    storage_key: '', size: 0, content_hash: '', tags: ['架构'], icon: null,
    version: 0, is_delete: true, deleted_at: new Date(),
    created_at: new Date(), updated_at: new Date()
  })

  // 正文分块（与文件 version 对齐）
  mock.__seed('mm-index-chunks', {
    chunk_id: `${design._id}#1`, file_id: design._id, user_id: ANON, heading: '性能',
    content: CHUNK_CONTENT, keywords: ['检索', '性能'],
    start_offset: CHUNK_START, end_offset: CHUNK_END, revision: 1, created_at: new Date()
  })
  mock.__seed('mm-index-chunks', {
    chunk_id: `${deploy._id}#1`, file_id: deploy._id, user_id: ANON, heading: '部署',
    content: '部署流程说明', keywords: ['部署'],
    start_offset: 0, end_offset: 6, revision: 1, created_at: new Date()
  })
  // 陈旧索引：revision=0 但文件 version=1，必须被过滤
  mock.__seed('mm-index-chunks', {
    chunk_id: `${deploy._id}#2`, file_id: deploy._id, user_id: ANON, heading: '旧章节',
    content: '旧的检索关键词', keywords: ['检索'],
    start_offset: 0, end_offset: 7, revision: 0, created_at: new Date()
  })

  mock.__seed('mm-comments', {
    _id: 'comment-1', file_id: design._id, user_id: ANON, selected_text: '性能',
    prefix: '', suffix: '', start_offset: CHUNK_START, end_offset: CHUNK_START + 2,
    comment: '这里需要补充检索结果', status: 'active',
    created_at: new Date(), updated_at: new Date()
  })

  return { mock, design, deploy }
}

test('scope=tag：按标签命中（AC-21）', async () => {
  const { mock } = createSearchEnv()
  const mmSearch = loadCloudObject('mm-search', mock)

  const result = await callObject(mmSearch, 'search', { keyword: '架构', scope: 'tag' })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.groups.tag.length, 1, '回收站文档不应命中')
  assert.equal(result.data.groups.tag[0].name, '设计说明.md')
  assert.equal(result.data.groups.name.length, 0)
  assert.equal(result.data.groups.comment.length, 0)
  assert.equal(result.data.groups.content.length, 0)
})

test('scope=name：按文件名命中（AC-21）', async () => {
  const { mock } = createSearchEnv()
  const mmSearch = loadCloudObject('mm-search', mock)

  const result = await callObject(mmSearch, 'search', { keyword: '部署', scope: 'name' })
  assert.equal(result.errCode, 0)
  assert.equal(result.data.groups.name.length, 1)
  assert.equal(result.data.groups.name[0].name, '部署手册.md')
})

test('scope=comment：按批注内容命中并回填文件名（AC-21）', async () => {
  const { mock } = createSearchEnv()
  const mmSearch = loadCloudObject('mm-search', mock)

  const result = await callObject(mmSearch, 'search', { keyword: '补充', scope: 'comment' })
  assert.equal(result.errCode, 0)
  assert.equal(result.data.groups.comment.length, 1)
  const hit = result.data.groups.comment[0]
  assert.equal(hit.file_name, '设计说明.md')
  assert.equal(hit.comment, '这里需要补充检索结果')
  assert.equal(hit.status, 'active')
})

test('scope=content：正文命中返回 start_offset / end_offset / snippet（AC-21/23）', async () => {
  const { mock } = createSearchEnv()
  const mmSearch = loadCloudObject('mm-search', mock)

  const result = await callObject(mmSearch, 'search', { keyword: '性能', scope: 'content' })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.groups.content.length, 1)
  const hit = result.data.groups.content[0]
  assert.equal(hit.file_id, mock.__rows('mm-files')[0]._id)
  assert.equal(hit.file_name, '设计说明.md')
  assert.equal(hit.start_offset, CHUNK_START, '正文命中必须返回可回跳的 start_offset')
  assert.equal(hit.end_offset, CHUNK_END)
  assert.ok(hit.snippet.includes('性能'), '摘要片段应包含关键词')
  assert.ok(hit.snippet.length < CHUNK_CONTENT.length, '摘要应为片段而非全文')
})

test('scope=content：关键词只出现在 keywords 数组时同样命中（AC-21）', async () => {
  const { mock } = createSearchEnv()
  const mmSearch = loadCloudObject('mm-search', mock)

  const result = await callObject(mmSearch, 'search', { keyword: '检索', scope: 'content' })
  assert.equal(result.errCode, 0)
  const chunkIds = result.data.groups.content.map(item => item.chunk_id)
  assert.ok(chunkIds.some(id => id.endsWith('#1')), '命中关键词的当前版本分块应返回')
  assert.ok(!chunkIds.some(id => id.endsWith('#2')), '陈旧索引（revision 与文件 version 不一致）必须被过滤')
})

test('scope=all：四个维度同时检索，回收站文档与陈旧索引均被排除（AC-21）', async () => {
  const { mock } = createSearchEnv()
  const mmSearch = loadCloudObject('mm-search', mock)

  const result = await callObject(mmSearch, 'search', { keyword: '检索', scope: 'all' })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.groups.tag.length, 0, '标签无“检索”命中')
  assert.equal(result.data.groups.name.length, 0, '文件名无“检索”命中')
  assert.equal(result.data.groups.comment.length, 1, '批注正文含“检索”')
  assert.equal(result.data.groups.content.length, 1, '当前版本分块含“检索”')
  assert.equal(result.data.total, 2)
})

test('非法 scope 降级为 all；空关键词返回 1001', async () => {
  const { mock } = createSearchEnv()
  const mmSearch = loadCloudObject('mm-search', mock)

  const unknownScope = await callObject(mmSearch, 'search', { keyword: '部署', scope: 'unknown' })
  assert.equal(unknownScope.errCode, 0)
  assert.equal(unknownScope.data.scope, 'all')

  for (const keyword of ['', '   ', undefined]) {
    const result = await callObject(mmSearch, 'search', { keyword })
    assert.equal(result.errCode, 1001, `空关键词应返回 1001：${String(keyword)}`)
  }
})

test('关键词按字面量匹配，正则特殊字符不会扩大命中范围', async () => {
  const { mock } = createSearchEnv()
  const mmSearch = loadCloudObject('mm-search', mock)

  const result = await callObject(mmSearch, 'search', { keyword: '.*', scope: 'name' })
  assert.equal(result.errCode, 0)
  assert.equal(result.data.groups.name.length, 0, '用户输入必须转义，不能当正则执行')
})

test('结果按身份过滤：登录用户搜不到他人名下文档', async () => {
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config', account_enabled: true, permission_enabled: false,
    admin_user_id: '', updated_by: '', updated_at: new Date()
  })
  mock.__seed('uni-id-users', { _id: 'u2', username: '乙', register_date: new Date() })
  mock.__seed('mm-files', {
    type: 'file', user_id: 'u1', parent_id: '', name: '他人文档.md', extension: 'md',
    storage_key: '', size: 0, content_hash: '', tags: ['架构'], icon: null,
    version: 0, is_delete: false, created_at: new Date(), updated_at: new Date()
  })
  const mmSearch = loadCloudObject('mm-search', mock)

  const result = await callObject(mmSearch, 'search', { keyword: '架构', scope: 'tag' },
    { token: uniIdStub.__login('token-u2', 'u2') })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.groups.tag.length, 0, '不得返回他人名下文档')
  assert.equal(result.data.total, 0)

  const anonymous = await callObject(mmSearch, 'search', { keyword: '架构', scope: 'tag' })
  assert.equal(anonymous.errCode, 1002, '账号开启且无 token 时搜索应要求登录')
})
