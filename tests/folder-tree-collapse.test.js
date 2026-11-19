/**
 * 移动端左侧抽屉-文件夹树：子目录展开后无法收起的回归测试
 *
 * 背景：树节点箭头视觉只有 14x14px，而行高 34px。手指点在箭头上下的空白区，
 * 事件落到 .mm-tree__row 的 @click 上变成「选中文件夹」，toggle 根本没被调用，
 * 表现为展开子目录后怎么点都收不回来。
 * 修复：给箭头加透明伪元素扩大命中区到整行高度，不改视觉尺寸与缩进。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readText } = require('./helpers/load-esm.js')

const source = () => readText('components/mm-folder-tree/mm-folder-tree.vue')

test('目录树节点箭头仍绑定 toggle，且 toggle 支持再次点击收起', () => {
  const src = source()
  assert.match(src, /class="mm-tree__arrow"\s+@click\.stop="toggle\(node\._id\)"/,
    '箭头点击必须阻止冒泡到行的选中事件')
  assert.match(src, /function toggle\(folderId\)[\s\S]{0,180}!isExpanded\(folderId\)/,
    'toggle 必须是对当前值的取反，才能再次点击收起')
  assert.match(src, /function isExpanded\(folderId\)[\s\S]{0,80}expanded\.value\[folderId\] === true/,
    '展开状态按节点 id 独立记录')
})

test('箭头命中区用伪元素扩到整行高度，视觉尺寸与布局保持不变', () => {
  const src = source()
  const css = src.slice(src.indexOf('<style'))

  const arrowBlock = /\.mm-tree__arrow\s*\{([\s\S]*?)\}/.exec(css)
  assert.ok(arrowBlock, '应存在 .mm-tree__arrow 样式块')
  assert.match(arrowBlock[1], /position:\s*relative/, '伪元素需要父级定位上下文')
  assert.match(arrowBlock[1], /width:\s*14px/, '视觉宽度保持 14px，不改变缩进')
  assert.match(arrowBlock[1], /height:\s*calc\(34px \* var\(--mm-ui-scale, 1\)\)/,
    '箭头容器高度与行高一致，任何字号档位都能命中')

  const afterBlock = /\.mm-tree__arrow::after\s*\{([\s\S]*?)\}/.exec(css)
  assert.ok(afterBlock, '应存在 .mm-tree__arrow::after 扩大左右命中区')
  const hit = afterBlock[1]
  assert.match(hit, /top:\s*0/, '上下不溢出，命中区随容器占满整行')
  assert.match(hit, /bottom:\s*0/, '上下不溢出，命中区随容器占满整行')
  assert.match(hit, /left:\s*-7px/, '向左扩展命中区')
  assert.match(hit, /right:\s*-4px/, '向右只覆盖 gap，不遮住后面的图标')
  assert.match(hit, /content:\s*''/, '空内容伪元素只承担命中区')
})

test('箭头容器高度表达式与行高完全一致，放大字号后仍覆盖整行', () => {
  const css = source().slice(source().indexOf('<style'))
  const rowBlock = /\.mm-tree__row\s*\{([\s\S]*?)\}/.exec(css)
  const arrowBlock = /\.mm-tree__arrow\s*\{([\s\S]*?)\}/.exec(css)
  const heightExpr = block => /height:\s*([^;]+);/.exec(block[1])[1].trim()
  assert.equal(heightExpr(arrowBlock), heightExpr(rowBlock),
    '箭头与行使用同一高度表达式，缩放时不会出现命中盲区')
})

test('模板编译无错误，箭头命中区改动不破坏 SFC', () => {
  const { parse, compileTemplate } = require('@vue/compiler-sfc')
  const { descriptor, errors } = parse(source())
  assert.equal(errors.length, 0, 'SFC 解析无错误')
  const out = compileTemplate({ source: descriptor.template.content, filename: 'mm-folder-tree.vue', id: 'x' })
  assert.equal(out.errors.length, 0, '模板编译无错误')
  assert.match(out.code, /toggle\(node\._id\)/, '编译产物仍保留箭头 toggle 绑定')
})
