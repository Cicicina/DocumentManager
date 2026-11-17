/**
 * mm-text 同构纯函数测试（AC-13 基础 / 架构 1.5 与 8.3）。
 *
 * 覆盖：stripMarkdown 提纯规则、buildOffsetMap 双向映射可逆性、
 * 以及「前端与云侧两份源码逐字一致 + 输出完全一致」的同构一致性自检。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { readText } = require('./helpers/load-esm')

const ROOT = path.resolve(__dirname, '..')
const frontMmText = require(path.join(ROOT, 'common/utils/mm-text.js'))
const cloudMmText = require(path.join(
  ROOT,
  'uniCloud-alipay/cloudfunctions/common/mm-common/lib/mm-text.js'
))

/** 含标题 / 强调 / 链接 / 图片 / 列表 / 代码块 / 表格 / HTML 的样例 md */
const RICH_MD = [
  '# 一级标题',
  '',
  '这是**粗体**与*斜体*，还有~~删除线~~与 `行内代码`。',
  '',
  '> 引用一段话',
  '',
  '- 列表项一',
  '- 列表项二',
  '1. 有序项',
  '',
  '参见[架构文档](https://example.com/doc)了解细节。',
  '',
  '![示意图](https://example.com/a.png)图片说明。',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '| 名称 | 数量 |',
  '| --- | --- |',
  '| 苹果 | 3 |',
  '',
  '<div>原始 HTML</div>',
  '',
  '## 二级标题',
  '',
  '收尾段落。'
].join('\n')

test('两份 mm-text.js 源码逐字一致（架构 8.3 同构双份）', () => {
  const front = readText('common/utils/mm-text.js')
  const cloud = readText('uniCloud-alipay/cloudfunctions/common/mm-common/lib/mm-text.js')
  assert.equal(front, cloud, '前端与云侧 mm-text.js 必须逐字一致')
})

test('stripMarkdown 精确提纯结果（逐条规则手工推导）', () => {
  const cases = [
    ['# 标题\n\n正文', '标题\n正文'],
    ['- 项目一\n- 项目二', '项目一\n项目二'],
    ['1. 有序一\n2. 有序二', '有序一\n有序二'],
    ['参见[文档](https://a.com)说明', '参见文档说明'],
    ['![图](a.png)结束', '图结束'],
    ['```\nconst a = 1\n```', 'const a = 1'],
    ['**粗体**和*斜体*和`代码`和~~删除~~', '粗体和斜体和代码和删除'],
    ['> 引用', '引用'],
    ['<div>原始</div>', '原始'],
    ['普通段落', '普通段落']
  ]
  for (const [source, expected] of cases) {
    assert.equal(cloudMmText.stripMarkdown(source), expected, `stripMarkdown 结果不符：${source}`)
    assert.equal(frontMmText.stripMarkdown(source), expected, `前端 stripMarkdown 结果不符：${source}`)
  }
})

test('stripMarkdown 综合样例：各类 md 标记被剔除且正文/alt/代码正文保留', () => {
  const plain = cloudMmText.stripMarkdown(RICH_MD)

  // 标记本身必须消失
  assert.ok(!plain.includes('#'), '标题标记未剔除')
  assert.ok(!plain.includes('**'), '粗体标记未剔除')
  assert.ok(!plain.includes('~~'), '删除线标记未剔除')
  assert.ok(!plain.includes('`'), '代码反引号未剔除')
  assert.ok(!plain.includes(']('), '链接/图片 URL 未剔除')
  assert.ok(!plain.includes('example.com'), '链接 URL 残留')
  assert.ok(!plain.includes('-'), '列表符或表格分隔行未剔除')
  assert.ok(!plain.includes('<div>'), 'HTML 标签未剔除')
  assert.ok(!plain.includes('| --- | --- |'), '表格分隔行未剔除')

  // 正文与 alt 文字必须保留
  for (const expected of [
    '一级标题', '粗体', '斜体', '删除线', '行内代码', '引用一段话',
    '列表项一', '列表项二', '有序项', '架构文档', '示意图', '图片说明',
    'const a = 1', '| 苹果 | 3 |', '原始 HTML', '二级标题', '收尾段落'
  ]) {
    assert.ok(plain.includes(expected), `提纯文本丢失内容：${expected}`)
  }

  // 首尾不得有空白，段间单换行（不出现连续换行）
  assert.equal(plain, plain.trim(), 'plainText 首尾不应有空白')
  assert.ok(!plain.includes('\n\n'), 'plainText 不应出现连续换行')
})

test('buildOffsetMap：srcToPlain / plainToSrc 双向可逆', () => {
  const { plainText, srcToPlain, plainToSrc } = cloudMmText.buildOffsetMap(RICH_MD)

  assert.equal(srcToPlain.length, RICH_MD.length + 1, 'srcToPlain 长度应为源码长度 + 1')
  assert.equal(plainToSrc.length, plainText.length + 1, 'plainToSrc 长度应为 plainText 长度 + 1')
  assert.equal(plainToSrc[plainText.length], RICH_MD.length, 'plainToSrc 末尾哨兵应为源码长度')
  assert.equal(srcToPlain[RICH_MD.length], plainText.length, 'srcToPlain 末尾哨兵应为 plainText 长度')

  for (let j = 0; j < plainText.length; j++) {
    const srcIndex = plainToSrc[j]
    assert.ok(srcIndex >= 0 && srcIndex < RICH_MD.length, `plainToSrc[${j}] 越界`)
    assert.equal(RICH_MD[srcIndex], plainText[j], `plainToSrc[${j}] 未指回原始字符`)
    assert.equal(srcToPlain[srcIndex], j, `srcToPlain[plainToSrc[${j}]] 应为 ${j}`)
  }

  // srcToPlain 必须单调不减
  for (let i = 1; i < srcToPlain.length; i++) {
    assert.ok(srcToPlain[i] >= srcToPlain[i - 1], `srcToPlain 在 ${i} 处不单调`)
  }
})

test('buildOffsetMap：被剔除的标记字符映射到下一个保留字符', () => {
  const source = '# 标题'
  const { plainText, srcToPlain } = cloudMmText.buildOffsetMap(source)
  assert.equal(plainText, '标题')
  // '# ' 两个字符被剔除，应映射到第一个保留字符（plainText 下标 0）
  assert.equal(srcToPlain[0], 0)
  assert.equal(srcToPlain[1], 0)
  assert.equal(srcToPlain[2], 0)
  assert.equal(srcToPlain[3], 1)
})

test('buildOffsetMap：非字符串入参降级为空文本', () => {
  for (const bad of [undefined, null, 0, {}, []]) {
    const result = cloudMmText.buildOffsetMap(bad)
    assert.equal(result.plainText, '')
    assert.equal(cloudMmText.stripMarkdown(bad), '')
  }
})

test('两份实现输出完全一致（含 srcToPlain / plainToSrc 逐元素比对）', () => {
  const samples = [RICH_MD, '', '# 只标题', '- a\n- b', 'no-markdown-at-all', '```\ncode\n```\n正文']

  for (const sample of samples) {
    const front = frontMmText.buildOffsetMap(sample)
    const cloud = cloudMmText.buildOffsetMap(sample)
    assert.equal(front.plainText, cloud.plainText, 'plainText 不一致')
    assert.deepEqual(Array.from(front.srcToPlain), Array.from(cloud.srcToPlain), 'srcToPlain 不一致')
    assert.deepEqual(Array.from(front.plainToSrc), Array.from(cloud.plainToSrc), 'plainToSrc 不一致')
  }
})
