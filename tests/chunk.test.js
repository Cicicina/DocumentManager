/**
 * 索引分块与关键词提取测试（AC-22 / 架构 C6 与 PRD Q5）。
 *
 * 规格：按 Markdown 标题分块，heading 取标题提纯文本；块内超过 1000 字符按固定长度切片，
 * 相邻切片重叠 100 字符；start_offset / end_offset 相对全文 plainText；revision = 文件 version。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIB = path.join(ROOT, 'uniCloud-alipay/cloudfunctions/common/mm-common/lib')
const { buildChunks, extractKeywords } = require(path.join(LIB, 'chunk.js'))
const { stripMarkdown } = require(path.join(LIB, 'mm-text.js'))
const { CHUNK_MAX_LEN, CHUNK_OVERLAP } = require(path.join(LIB, 'constants.js'))

/** 构造 md：若干标题 + 正文 */
function mdWithHeadings() {
  return ['# 第一节', '内容甲', '', '# 第二节', '内容乙'].join('\n')
}

test('常量与 PRD Q5 一致：单块 1000 字符、相邻重叠 100 字符', () => {
  assert.equal(CHUNK_MAX_LEN, 1000)
  assert.equal(CHUNK_OVERLAP, 100)
})

test('按 Markdown 标题分块，heading 取标题文本、offset 相对 plainText', () => {
  const source = mdWithHeadings()
  const plainText = stripMarkdown(source)
  const chunks = buildChunks(plainText, source, 3, 'file-1', 'user-1')

  assert.equal(chunks.length, 2, '两个标题应产生两个分块')
  assert.equal(chunks[0].heading, '第一节')
  assert.equal(chunks[1].heading, '第二节')

  assert.equal(chunks[0].start_offset, 0)
  assert.equal(chunks[1].start_offset, plainText.indexOf('第二节'))
  assert.equal(chunks[chunks.length - 1].end_offset, plainText.length)

  for (const chunk of chunks) {
    assert.equal(chunk.content, plainText.slice(chunk.start_offset, chunk.end_offset),
      '分块内容必须等于 plainText 的对应区间')
    assert.equal(chunk.file_id, 'file-1')
    assert.equal(chunk.user_id, 'user-1')
    assert.equal(chunk.revision, 3, 'revision 必须与文件 version 对齐')
    assert.ok(Array.isArray(chunk.keywords))
  }

  assert.deepEqual(chunks.map(item => item.chunk_id), ['file-1#1', 'file-1#2'])
})

test('首个标题之前的正文单独成段且 heading 为空', () => {
  const source = ['前言文字', '', '# 标题', '内容'].join('\n')
  const plainText = stripMarkdown(source)
  const chunks = buildChunks(plainText, source, 1, 'f', 'u')

  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].heading, '')
  assert.equal(chunks[0].start_offset, 0)
  assert.equal(chunks[0].content, plainText.slice(0, plainText.indexOf('标题')))

  assert.equal(chunks[1].heading, '标题')
  assert.equal(chunks[1].start_offset, plainText.indexOf('标题'))
})

test('无标题文档整篇成一个分块，heading 为空', () => {
  const source = ['第一段文字', '', '第二段文字'].join('\n')
  const plainText = stripMarkdown(source)
  const chunks = buildChunks(plainText, source, 0, 'f', 'u')

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].heading, '')
  assert.equal(chunks[0].start_offset, 0)
  assert.equal(chunks[0].end_offset, plainText.length)
  assert.equal(chunks[0].chunk_id, 'f#1')
})

test('超 1000 字符按固定长度切片，相邻切片重叠恰好 100 字符', () => {
  const source = 'x'.repeat(2500)
  const plainText = stripMarkdown(source)
  assert.equal(plainText.length, 2500)

  const chunks = buildChunks(plainText, source, 7, 'f2', 'u2')
  assert.equal(chunks.length, 3)

  const expected = [
    { start: 0, end: 1000 },
    { start: 900, end: 1900 },
    { start: 1800, end: 2500 }
  ]
  for (let i = 0; i < expected.length; i++) {
    assert.equal(chunks[i].start_offset, expected[i].start, `第 ${i + 1} 块 start_offset 不符`)
    assert.equal(chunks[i].end_offset, expected[i].end, `第 ${i + 1} 块 end_offset 不符`)
    assert.ok(chunks[i].content.length <= CHUNK_MAX_LEN, '分块长度不得超过 1000 字符')
  }

  // 相邻块重叠字符数应为 CHUNK_OVERLAP
  for (let i = 1; i < chunks.length; i++) {
    const overlap = chunks[i - 1].end_offset - chunks[i].start_offset
    assert.equal(overlap, CHUNK_OVERLAP, `第 ${i} 与第 ${i + 1} 块重叠字符数应为 100`)
  }
  assert.deepEqual(chunks.map(item => item.chunk_id), ['f2#1', 'f2#2', 'f2#3'])
})

test('空文档不产生分块', () => {
  assert.deepEqual(buildChunks('', '', 0, 'f', 'u'), [])
  assert.deepEqual(buildChunks('   ', '   ', 0, 'f', 'u'), [])
})

test('extractKeywords：标题词加权高于正文单次出现，且过滤停用词', () => {
  const keywords = extractKeywords('版本控制', '版本控制很重要，使用 git 提交')
  assert.ok(keywords.includes('版本'), '标题词“版本”应进入关键词')
  assert.ok(keywords.includes('控制'), '标题词“控制”应进入关键词')
  assert.ok(!keywords.includes('使用'), '停用词“使用”应被过滤')

  const headingRank = keywords.indexOf('版本')
  const bodyOnlyRank = keywords.indexOf('git')
  assert.ok(headingRank !== -1 && bodyOnlyRank !== -1)
  assert.ok(headingRank < bodyOnlyRank, '标题词应排在正文低频词之前')
})

test('extractKeywords：全停用词时返回空数组，且不为空入参报错', () => {
  assert.deepEqual(extractKeywords('使用', '可以 以及 通过 进行'), [])
  assert.deepEqual(extractKeywords('', ''), [])
  assert.deepEqual(extractKeywords(null, undefined), [])
})

test('extractKeywords：关键词长度不少于 2 且单块最多 12 个', () => {
  const longBody = '苹果 香蕉 橙子 西瓜 葡萄 芒果 柠檬 草莓 樱桃 蓝莓 蜜桃 石榴 柚子 椰子'
  const keywords = extractKeywords('', longBody)
  assert.ok(keywords.length <= 12, '单块关键词不得超过 12 个')
  for (const word of keywords) {
    assert.ok(word.length >= 2, `关键词 ${word} 长度不足 2`)
  }
})
