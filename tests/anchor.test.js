/**
 * 批注四级定位测试（AC-14 / AC-15 / 业务规则 C4）。
 *
 * 四级优先级：① 原位命中 → active；② 全文唯一命中 → active；
 * ③ 多命中用 prefix+suffix 消歧、唯一确定才 active；④ 无法定位 → orphaned 且不误绑其他文字。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const { relocateComments, findAll } = require(path.join(
  ROOT,
  'uniCloud-alipay/cloudfunctions/common/mm-common/lib/anchor.js'
))

test('findAll：返回全部命中下标（含重叠命中）', () => {
  assert.deepEqual(findAll('abcabc', 'abc'), [0, 3])
  assert.deepEqual(findAll('aaaa', 'aa'), [0, 1, 2], '重叠命中应全部返回')
  assert.deepEqual(findAll('abc', 'z'), [])
  assert.deepEqual(findAll('abc', ''), [], '空 needle 不应命中任何位置')
  assert.deepEqual(findAll(null, 'a'), [])
})

test('第一级：原位置命中即绑定 active，offset 不变', () => {
  const plainText = 'abcdefghij'
  const { results, active, orphaned } = relocateComments(plainText, [{
    _id: 'c1',
    selected_text: 'cde',
    prefix: '',
    suffix: '',
    start_offset: 2,
    end_offset: 5
  }])

  assert.equal(active, 1)
  assert.equal(orphaned, 0)
  assert.deepEqual(results[0], { _id: 'c1', start_offset: 2, end_offset: 5, status: 'active' })
})

test('第二级：原位置失效但全文唯一命中即绑定 active', () => {
  const plainText = 'abcdefghij'
  const { results, active, orphaned } = relocateComments(plainText, [{
    _id: 'c2',
    selected_text: 'def',
    prefix: '',
    suffix: '',
    start_offset: 0,
    end_offset: 3
  }])

  assert.equal(active, 1)
  assert.equal(orphaned, 0)
  assert.deepEqual(results[0], { _id: 'c2', start_offset: 3, end_offset: 6, status: 'active' })
  assert.equal(plainText.slice(3, 6), 'def')
})

test('第三级：多命中时用 prefix + suffix 消歧，唯一匹配才绑定', () => {
  const plainText = 'A foo | B foo | C'
  assert.deepEqual(findAll(plainText, 'foo'), [2, 10], '样例应存在两处 foo')

  const { results, active, orphaned } = relocateComments(plainText, [{
    _id: 'c3',
    selected_text: 'foo',
    prefix: 'B ',
    suffix: ' |',
    start_offset: 0,
    end_offset: 3
  }])

  assert.equal(active, 1)
  assert.equal(orphaned, 0)
  assert.deepEqual(results[0], { _id: 'c3', start_offset: 10, end_offset: 13, status: 'active' })
  assert.equal(plainText.slice(10, 13), 'foo')
})

test('第三级失败（上下文无法唯一确定）降级为第四级 orphaned', () => {
  const plainText = 'foo bar foo bar'
  assert.deepEqual(findAll(plainText, 'foo'), [0, 8])

  // start_offset 取 4~7 使其在第一级即失效（plain.slice(4,7) === 'bar'），
  // 随后两处 foo 都无法通过 prefix/suffix 上下文校验 → 第四级 orphaned
  const { results, active, orphaned } = relocateComments(plainText, [{
    _id: 'c4',
    selected_text: 'foo',
    prefix: 'ZZZ',
    suffix: 'ZZZ',
    start_offset: 4,
    end_offset: 7
  }])

  assert.equal(active, 0)
  assert.equal(orphaned, 1)
  assert.equal(results[0].status, 'orphaned')
})

test('第四级：原文被整段删除 → orphaned，且不误绑到其他文字', () => {
  const plainText = '完全没有这段内容'
  const { results, active, orphaned } = relocateComments(plainText, [{
    _id: 'c5',
    selected_text: '被删掉的段落',
    prefix: '',
    suffix: '',
    start_offset: 0,
    end_offset: 6
  }])

  assert.equal(active, 0)
  assert.equal(orphaned, 1)
  assert.equal(results[0].status, 'orphaned')
  // 保持原 offset，不绑定到 plainText 的其他片段
  assert.equal(results[0].start_offset, 0)
  assert.equal(results[0].end_offset, 6)
  assert.notEqual(plainText.slice(results[0].start_offset, results[0].end_offset), '被删掉的段落')
})

test('AC-15：删除批注依附的全部原文后保存 → status 自动变为 orphaned', () => {
  const before = '开头 目标段落 结尾'
  const target = '目标段落'
  const start = before.indexOf(target)
  const comment = {
    _id: 'c6',
    selected_text: target,
    prefix: '开头 ',
    suffix: ' 结尾',
    start_offset: start,
    end_offset: start + target.length
  }

  // 编辑前：原位命中，保持 active
  const beforeResult = relocateComments(before, [comment])
  assert.equal(beforeResult.results[0].status, 'active')

  // 编辑后：目标段落被完全删除
  const after = '开头 结尾'
  const afterResult = relocateComments(after, [comment])
  assert.equal(afterResult.orphaned, 1)
  assert.equal(afterResult.results[0].status, 'orphaned')
})

test('多条批注混合场景：各级结果互不干扰，计数准确', () => {
  const plainText = 'A foo | B foo | C 目标段落 结束'
  const targetStart = plainText.indexOf('目标段落')

  const comments = [
    { _id: 'k1', selected_text: '目标段落', prefix: '', suffix: '', start_offset: targetStart, end_offset: targetStart + 4 },
    { _id: 'k2', selected_text: 'foo', prefix: 'B ', suffix: ' |', start_offset: 0, end_offset: 3 },
    { _id: 'k3', selected_text: '早已不存在', prefix: '', suffix: '', start_offset: 0, end_offset: 5 }
  ]

  const { results, active, orphaned } = relocateComments(plainText, comments)
  assert.equal(results.length, 3)
  assert.equal(active, 2)
  assert.equal(orphaned, 1)
  assert.equal(results.find(item => item._id === 'k1').status, 'active')
  assert.equal(results.find(item => item._id === 'k2').status, 'active')
  assert.equal(results.find(item => item._id === 'k3').status, 'orphaned')
})

test('非数组 / 空入参安全降级', () => {
  assert.deepEqual(relocateComments('abc', null), { results: [], active: 0, orphaned: 0 })
  assert.deepEqual(relocateComments('abc', undefined), { results: [], active: 0, orphaned: 0 })
  assert.deepEqual(relocateComments(null, []), { results: [], active: 0, orphaned: 0 })
})
