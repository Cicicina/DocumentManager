/**
 * mm-comment 云对象源码级测试（AC-13 / AC-14 / AC-15 / AC-16）。
 *
 * 重点覆盖 R3「最后防线」：mm-comment.add 必须校验
 * `selected_text === plainText.slice(start_offset, end_offset)`，不一致返回 4004 ANCHOR_MISMATCH，
 * 防止前端把 DOM 序列文本当选中原文传入导致 C4 四级定位整体失效。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject } = require('./helpers/cloud-env')

const ANON = '__anonymous__'
const DOC_KEY = `cloud://mock-env/markdown/${ANON}/comment-doc.md`

/** 原文：'# 标题\n\n正文内容' → plainText = '标题\n正文内容'（7 字符） */
const ORIGINAL = '# 标题\n\n正文内容'
const PLAIN_TEXT = '标题\n正文内容'

function createCommentEnv(content) {
  const mock = createMockUniCloud({ storage: { [DOC_KEY]: content === undefined ? ORIGINAL : content } })
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: false,
    permission_enabled: false,
    admin_user_id: '',
    updated_by: '',
    updated_at: new Date()
  })
  const doc = mock.__seed('mm-files', {
    type: 'file',
    user_id: ANON,
    parent_id: '',
    name: 'comment-doc.md',
    extension: 'md',
    storage_key: DOC_KEY,
    size: 0,
    content_hash: '',
    tags: [],
    icon: null,
    version: 0,
    is_delete: false,
    created_at: new Date(),
    updated_at: new Date()
  })
  return { mock, doc }
}

test('前置：样例 md 的 plainText 与预期一致（锚点坐标基准）', () => {
  const { stripMarkdown } = require('../uniCloud-alipay/cloudfunctions/common/mm-common/lib/mm-text.js')
  assert.equal(stripMarkdown(ORIGINAL), PLAIN_TEXT)
  assert.equal(PLAIN_TEXT.slice(3, 7), '正文内容')
})

test('mm-comment.add 正常新建：status=active 且锚点信息完整（AC-13）', async () => {
  const { mock, doc } = createCommentEnv()
  const mmComment = loadCloudObject('mm-comment', mock)

  const result = await callObject(mmComment, 'add', {
    file_id: doc._id,
    selected_text: PLAIN_TEXT.slice(3, 7),
    prefix: PLAIN_TEXT.slice(Math.max(0, 3 - 32), 3),
    suffix: PLAIN_TEXT.slice(7, 7 + 32),
    start_offset: 3,
    end_offset: 7,
    comment: '这里要补充说明'
  })

  assert.equal(result.errCode, 0, result.errMsg)
  const saved = result.data
  assert.equal(saved.status, 'active')
  assert.equal(saved.selected_text, '正文内容')
  assert.equal(saved.start_offset, 3)
  assert.equal(saved.end_offset, 7)
  assert.equal(saved.prefix, '标题\n')
  assert.equal(saved.suffix, '')
  assert.equal(saved.comment, '这里要补充说明')
  assert.equal(saved.user_id, ANON)
  assert.ok(saved.created_at, 'created_at 应写入服务器时间')
  assert.ok(saved.updated_at)
})

test('mm-comment.add：selected_text 与 plainText.slice(start,end) 不一致 → 4004（AC-13/14 最后防线）', async () => {
  const { mock, doc } = createCommentEnv()
  const mmComment = loadCloudObject('mm-comment', mock)

  const result = await callObject(mmComment, 'add', {
    file_id: doc._id,
    selected_text: '正文内容',
    prefix: '',
    suffix: '',
    start_offset: 0,
    end_offset: 4,
    comment: '错误坐标'
  })

  assert.equal(result.errCode, 4004, '锚点与原文不一致必须返回 4004')
  assert.equal(result.errMsg, '批注位置已变化，请重新选择')
  assert.equal(mock.__rows('mm-comments').length, 0, '校验失败不得写入任何批注')
})

test('mm-comment.add：prefix / suffix 与 plainText 不一致 → 4004', async () => {
  const { mock, doc } = createCommentEnv()
  const mmComment = loadCloudObject('mm-comment', mock)

  const badPrefix = await callObject(mmComment, 'add', {
    file_id: doc._id,
    selected_text: '正文内容',
    prefix: '不存在的上文',
    suffix: '',
    start_offset: 3,
    end_offset: 7,
    comment: '前缀不符'
  })
  assert.equal(badPrefix.errCode, 4004)

  const badSuffix = await callObject(mmComment, 'add', {
    file_id: doc._id,
    selected_text: '正文内容',
    prefix: '',
    suffix: '不存在的下文',
    start_offset: 3,
    end_offset: 7,
    comment: '后缀不符'
  })
  assert.equal(badSuffix.errCode, 4004)

  assert.equal(mock.__rows('mm-comments').length, 0)
})

test('R3 场景：含图片文档中误传 DOM 序列文本 → 4004，不写入批注', async () => {
  // 原文 plainText 保留图片 alt「示意图」；预览 DOM 中 <img> 无文本节点，
  // 若前端误用 Range.toString() 拿到 '图片说明' 并配 offset 0..4，服务端必须拒绝。
  const { mock, doc } = createCommentEnv('![示意图](https://example.com/a.png)图片说明')
  const { stripMarkdown } = require('../uniCloud-alipay/cloudfunctions/common/mm-common/lib/mm-text.js')
  assert.equal(stripMarkdown('![示意图](https://example.com/a.png)图片说明'), '示意图图片说明')

  const mmComment = loadCloudObject('mm-comment', mock)
  const result = await callObject(mmComment, 'add', {
    file_id: doc._id,
    selected_text: '图片说明',
    prefix: '',
    suffix: '',
    start_offset: 0,
    end_offset: 4,
    comment: 'DOM 序列文本误传'
  })

  assert.equal(result.errCode, 4004)
  assert.equal(mock.__rows('mm-comments').length, 0)
})

test('mm-comment.add：参数校验失败返回 1001（空选区 / 空批注 / 非法区间）', async () => {
  const { mock, doc } = createCommentEnv()
  const mmComment = loadCloudObject('mm-comment', mock)

  const cases = [
    { file_id: doc._id, selected_text: '', start_offset: 0, end_offset: 1, comment: 'x' },
    { file_id: doc._id, selected_text: '正文', start_offset: 0, end_offset: 1, comment: '  ' },
    { file_id: doc._id, selected_text: '正文', start_offset: 5, end_offset: 5, comment: 'x' },
    { file_id: doc._id, selected_text: '正文', start_offset: -1, end_offset: 2, comment: 'x' },
    { selected_text: '正文', start_offset: 0, end_offset: 1, comment: 'x' }
  ]
  for (const param of cases) {
    const result = await callObject(mmComment, 'add', param)
    assert.equal(result.errCode, 1001, `参数校验未生效：${JSON.stringify(param)}`)
  }
})

test('mm-comment.update：只更新 comment 与 updated_at，created_at 不变（AC-16）', async () => {
  const { mock, doc } = createCommentEnv()
  const createdAt = new Date('2024-03-01T00:00:00Z')
  const comment = mock.__seed('mm-comments', {
    file_id: doc._id,
    user_id: ANON,
    selected_text: '正文内容',
    prefix: '标题\n',
    suffix: '',
    start_offset: 3,
    end_offset: 7,
    comment: '原始批注',
    status: 'active',
    created_at: createdAt,
    updated_at: createdAt
  })
  const mmComment = loadCloudObject('mm-comment', mock)

  const result = await callObject(mmComment, 'update', {
    comment_id: comment._id,
    comment: '修改后的批注'
  })

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.comment, '修改后的批注')
  assert.equal(result.data.created_at.toISOString(), createdAt.toISOString(), 'created_at 必须不变')
  assert.ok(result.data.updated_at instanceof Date)

  const update = mock.__log.updates.find(item => item.table === 'mm-comments')
  assert.deepEqual(Object.keys(update.patch).sort(), ['comment', 'updated_at'],
    'AC-16：只允许更新 comment 与 updated_at')
  assert.ok(!Object.prototype.hasOwnProperty.call(update.patch, 'created_at'))
})

test('mm-comment.relocate：内容变化后按四级定位重定位，命中更新 offset、失配置 orphaned（AC-14/15）', async () => {
  const { mock, doc } = createCommentEnv()
  const mmComment = loadCloudObject('mm-comment', mock)

  const anchored = mock.__seed('mm-comments', {
    file_id: doc._id, user_id: ANON, selected_text: '正文内容', prefix: '标题\n', suffix: '',
    start_offset: 3, end_offset: 7, comment: '会被重定位', status: 'active',
    created_at: new Date(), updated_at: new Date()
  })
  const vanished = mock.__seed('mm-comments', {
    file_id: doc._id, user_id: ANON, selected_text: '早已删除的段落', prefix: '', suffix: '',
    start_offset: 0, end_offset: 7, comment: '会被置 orphaned', status: 'active',
    created_at: new Date(), updated_at: new Date()
  })

  // 模拟编辑：原文改为前插一个标题，目标段落整体后移
  mock.__storage.set(DOC_KEY, '# 新增\n\n标题\n正文内容')

  const result = await callObject(mmComment, 'relocate', { file_id: doc._id })
  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.active, 1)
  assert.equal(result.data.orphaned, 1)

  const rows = mock.__rows('mm-comments')
  const movedComment = rows.find(item => item._id === anchored._id)
  const orphanComment = rows.find(item => item._id === vanished._id)

  assert.equal(movedComment.status, 'active')
  assert.deepEqual([movedComment.start_offset, movedComment.end_offset], [6, 10],
    '应定位到新位置而非原位置')
  assert.equal(orphanComment.status, 'orphaned', '无法定位的批注应置 orphaned')
  assert.deepEqual([orphanComment.start_offset, orphanComment.end_offset], [0, 7],
    'orphaned 批注保持原 offset，不得误绑其他文字')
})

test('mm-comment.listByFile：可按 status 过滤且包含 orphaned', async () => {
  const { mock, doc } = createCommentEnv()
  mock.__seed('mm-comments', {
    file_id: doc._id, user_id: ANON, selected_text: '正文内容', prefix: '', suffix: '',
    start_offset: 3, end_offset: 7, comment: 'a', status: 'active',
    created_at: new Date(), updated_at: new Date()
  })
  mock.__seed('mm-comments', {
    file_id: doc._id, user_id: ANON, selected_text: '旧段落', prefix: '', suffix: '',
    start_offset: 0, end_offset: 3, comment: 'b', status: 'orphaned',
    created_at: new Date(), updated_at: new Date()
  })
  const mmComment = loadCloudObject('mm-comment', mock)

  const all = await callObject(mmComment, 'listByFile', { file_id: doc._id })
  assert.equal(all.errCode, 0)
  assert.equal(all.data.length, 2, '默认返回全部批注（含 orphaned）')

  const orphanedOnly = await callObject(mmComment, 'listByFile', { file_id: doc._id, status: 'orphaned' })
  assert.equal(orphanedOnly.data.length, 1)
  assert.equal(orphanedOnly.data[0].status, 'orphaned')
})

test('mm-comment.remove：删除批注并返回删除条数', async () => {
  const { mock, doc } = createCommentEnv()
  const comment = mock.__seed('mm-comments', {
    file_id: doc._id, user_id: ANON, selected_text: '正文内容', prefix: '', suffix: '',
    start_offset: 3, end_offset: 7, comment: '待删除', status: 'active',
    created_at: new Date(), updated_at: new Date()
  })
  const mmComment = loadCloudObject('mm-comment', mock)

  const result = await callObject(mmComment, 'remove', { comment_id: comment._id })
  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.deleted, 1)
  assert.equal(mock.__rows('mm-comments').length, 0)
})
