/**
 * comment-paragraph 纯函数测试。
 * 覆盖：从 plainText 按 offset 提取批注所在完整段落、拆出 before/selected/after 高亮三段、
 * 多段落文本不越界、以及 orphaned / offset 失效等边界返回 null。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const { extractAnnotatedParagraph, getCommentParagraph } = require(
  path.join(ROOT, 'common/utils/comment-paragraph.js')
)

test('单段落：取出整段并拆成高亮三段', () => {
  const text = '这是第一段正文，里面有被标记的内容，后面还有字。'
  const selected = '被标记的内容'
  const start = text.indexOf(selected)
  const end = start + selected.length

  const result = extractAnnotatedParagraph(text, start, end)
  assert.ok(result)
  assert.equal(result.paragraph, text)
  assert.equal(result.before, '这是第一段正文，里面有')
  assert.equal(result.selected, selected)
  assert.equal(result.after, '，后面还有字。')
  assert.equal(result.selectedStart, start)
  assert.equal(result.selectedEnd, end)
  assert.equal(result.before + result.selected + result.after, result.paragraph)
})

test('多段落：只取批注所在那一段，不跨换行', () => {
  const text = '第一段文字在这里。\n第二段含有目标词这里。\n第三段文字结尾。'
  const selected = '目标词'
  const start = text.indexOf(selected)
  const end = start + selected.length

  const result = extractAnnotatedParagraph(text, start, end)
  assert.ok(result)
  assert.equal(result.paragraph, '第二段含有目标词这里。')
  assert.equal(result.selected, selected)
  assert.equal(result.before, '第二段含有')
  assert.equal(result.after, '这里。')
  assert.ok(result.paragraph.indexOf('\n') === -1, '段落内不应含换行')
})

test('选中片段跨段首：段落起点从上一换行后开始', () => {
  const text = '前一行。\n目标短语在后一行开头。'
  const selected = '目标短语'
  const start = text.indexOf(selected)
  const result = extractAnnotatedParagraph(text, start, start + selected.length)
  assert.ok(result)
  assert.equal(result.paragraph, '目标短语在后一行开头。')
  assert.equal(result.selectedStart, 0)
})

test('选中片段跨段尾：段落终点到下一换行前结束', () => {
  const text = '目标短语在段落结尾。\n下一行。'
  const selected = '目标短语'
  const start = text.indexOf(selected)
  const result = extractAnnotatedParagraph(text, start, start + selected.length)
  assert.ok(result)
  assert.equal(result.paragraph, '目标短语在段落结尾。')
  assert.ok(result.after.endsWith('。'))
})

test('边界：end 超出文本长度时按文本末尾截断', () => {
  const text = '短段落'
  const result = extractAnnotatedParagraph(text, 1, 999)
  assert.ok(result)
  assert.equal(result.paragraph, '短段落')
  assert.equal(result.selected, '段落')
  assert.equal(result.after, '')
})

test('失效输入一律返回 null（orphaned / offset 非法 / 空文本）', () => {
  assert.equal(extractAnnotatedParagraph('', 0, 1), null)
  assert.equal(extractAnnotatedParagraph('有内容', -1, 2), null)
  assert.equal(extractAnnotatedParagraph('有内容', 2, 2), null)
  assert.equal(extractAnnotatedParagraph('有内容', 3, 1), null)
  assert.equal(extractAnnotatedParagraph('有内容', 3, 4), null, 'start 等于长度时无选中内容')
  assert.equal(extractAnnotatedParagraph(null, 0, 1), null)
  assert.equal(extractAnnotatedParagraph('有内容', 'x', 2), null)
  assert.equal(extractAnnotatedParagraph('有内容', NaN, 2), null)
})

test('getCommentParagraph 返回可用的函数集合', () => {
  const api = getCommentParagraph()
  assert.equal(typeof api.extractAnnotatedParagraph, 'function')
  assert.equal(api.extractAnnotatedParagraph, extractAnnotatedParagraph)
})
