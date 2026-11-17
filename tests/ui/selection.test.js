/**
 * R3 阅读态选区桥接单测（node:test + node:assert/strict）。
 *
 * 覆盖四场景：纯文本 / 含图片 / 含表格 / 含多段落空白。
 * 核心断言：plainText.slice(start, end) === selectedText，且 DOM 文本长度与
 * plainText 长度可以不等但映射仍正确；映射不到的间隙不被误绑。
 *
 * 说明（覆盖边界）：本文件测的是 alignTexts / resolveOffset 两个纯函数，
 * 不依赖真实 DOM 与 window.getSelection（jsdom 的 Selection 实现不完整）。
 * 真实浏览器中的 buildDomPlainMap / getSelectionOffsets 复用同一套纯逻辑，
 * 由 T05 在 HBuilderX 编译后的 H5 里做一次人工点击验证。
 *
 * 运行：node --test tests/ui/
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { alignTexts, resolveOffset, getMmText } from '../../common/utils/selection.js'

const mmText = getMmText()

/**
 * 用一段 md 生成 plainText 与模拟的 DOM 文本节点序列。
 * @param {string} md md 原文
 * @param {string[]} domTexts 模拟 marked 渲染后的文本节点内容
 * @returns {{plainText:string, domTexts:string[], aligned:object}}
 */
function build(md, domTexts) {
  assert.ok(mmText, 'mm-text 同构副本应已通过副作用导入挂载到 globalThis')
  const plainText = mmText.stripMarkdown(md)
  const aligned = alignTexts(domTexts, plainText)
  return { plainText, domTexts, aligned }
}

/**
 * 选中某个已映射节点的局部区间，返回 plainText 坐标与切片。
 * @param {object} aligned alignTexts 结果
 * @param {number} nodeIndex 节点下标
 * @param {number} from 节点内起始偏移
 * @param {number} to 节点内结束偏移
 */
function selectInNode(aligned, nodeIndex, from, to) {
  const entry = aligned.nodes[nodeIndex]
  const start = resolveOffset(entry, from)
  const end = resolveOffset(entry, to)
  return { entry, start, end }
}

test('场景一：纯文本（标题 + 两段）', () => {
  const md = '# 标题\n\n第一段正文\n\n第二段正文\n'
  const domTexts = ['标题', '第一段正文', '第二段正文']
  const { plainText, aligned } = build(md, domTexts)

  assert.equal(plainText, '标题\n第一段正文\n第二段正文')
  assert.equal(aligned.mappedCount, 3)
  // DOM 文本长度 14，plainText 长度 15（含段落换行），不相等
  assert.notEqual(domTexts.join('').length, plainText.length)

  const { start, end } = selectInNode(aligned, 1, 0, 5)
  assert.equal(plainText.slice(start, end), '第一段正文')
  assert.equal(start, 3)
  assert.equal(end, 8)
})

test('场景二：含图片（img 无文本节点，alt 保留在 plainText）', () => {
  const md = '前文 ![示意图](https://example.com/img.png) 后文\n'
  // marked 把图片渲染成 <img alt="示意图">，没有文本节点
  const domTexts = ['前文 ', ' 后文']
  const { plainText, aligned } = build(md, domTexts)

  assert.equal(plainText, '前文 示意图 后文')
  // DOM 只有 6 个字符，plainText 有 9 个，二者长度不等但映射正确
  assert.equal(domTexts.join('').length, 6)
  assert.equal(plainText.length, 9)
  assert.notEqual(domTexts.join('').length, plainText.length)
  assert.equal(aligned.mappedCount, 2)

  // 第二段节点在 plainText 中的起点是 6（跳过了 alt 与空格）
  assert.equal(aligned.nodes[1].start, 6)

  const { start, end } = selectInNode(aligned, 1, 1, 3)
  assert.equal(plainText.slice(start, end), '后文')
})

test('场景三：含表格（单元格文字映射，竖线与分隔行不参与）', () => {
  const md = '| A | B |\n|---|---|\n| 1 | 2 |\n'
  // marked 的 table 输出里，单元格之间只有格式化换行文本节点
  const domTexts = ['\n', 'A', '\n', 'B', '\n', '\n', '1', '\n', '2', '\n']
  const { plainText, aligned } = build(md, domTexts)

  // 表格分隔行被 stripMarkdown 剔除，内容行保留竖线
  assert.equal(plainText, '| A | B |\n| 1 | 2 |')
  assert.equal(domTexts.join('').length, 10)
  assert.equal(plainText.length, 19)
  assert.notEqual(domTexts.join('').length, plainText.length)
  // 纯空白节点不参与映射：A / B / 1 / 2 共 4 个
  assert.equal(aligned.mappedCount, 4)

  const cellA = selectInNode(aligned, 1, 0, 1)
  assert.equal(plainText.slice(cellA.start, cellA.end), 'A')
  assert.equal(cellA.start, 2)

  const cell1 = selectInNode(aligned, 6, 0, 1)
  assert.equal(plainText.slice(cell1.start, cell1.end), '1')
  assert.equal(cell1.start, 12)
})

test('场景四：多段落空白（连续空行折叠为单个换行）', () => {
  const md = '第一段\n\n\n\n第二段\n'
  const domTexts = ['第一段', '\n', '第二段']
  const { plainText, aligned } = build(md, domTexts)

  assert.equal(plainText, '第一段\n第二段')
  assert.equal(aligned.mappedCount, 2)

  const { start, end } = selectInNode(aligned, 2, 0, 3)
  assert.equal(plainText.slice(start, end), '第二段')
  assert.equal(start, 4)
})

test('间隙不被误绑：plainText 中不存在的节点整段不可映射', () => {
  const plainText = '正文内容'
  const aligned = alignTexts(['正文内容', '这段在原文中不存在'], plainText)

  assert.equal(aligned.mappedCount, 1)
  assert.equal(aligned.nodes[1].mapped, false)
  assert.equal(aligned.nodes[1].start, -1)
  // 不可映射节点换算结果为 -1，调用方据此提示「该位置不支持批注」，绝不退化成 DOM 长度累加
  assert.equal(resolveOffset(aligned.nodes[1], 0), -1)
  assert.equal(resolveOffset(aligned.nodes[1], 3), -1)
})

test('逐字映射：节点内空白差异仍能定位到正确字符', () => {
  // DOM 节点含多空格，plainText 已归一为单空格
  const plainText = '甲 乙 丙'
  const aligned = alignTexts(['甲   乙', '  丙'], plainText)

  assert.equal(aligned.nodes[0].mapped, true)
  assert.equal(aligned.nodes[0].charMap !== null, true)
  // 节点内 '乙' 位于 index 4（'甲' + 3 个空格 + '乙'），映射到 plainText 的 index 2
  assert.equal(resolveOffset(aligned.nodes[0], 4), 2)
  assert.equal(plainText.slice(2, 3), '乙')

  // 第二个节点前导空格不可映射，但 '丙' 能定位
  assert.equal(aligned.nodes[1].mapped, true)
  assert.equal(resolveOffset(aligned.nodes[1], 2), 4)
  assert.equal(plainText.slice(4, 5), '丙')
})

test('空输入与边界', () => {
  assert.deepEqual(alignTexts([], 'abc'), { nodes: [], mappedCount: 0 })
  assert.deepEqual(alignTexts(['  ', '\n'], 'abc').mappedCount, 0)
  assert.equal(resolveOffset(null, 0), -1)
  assert.equal(resolveOffset({ mapped: false }, 0), -1)
})
