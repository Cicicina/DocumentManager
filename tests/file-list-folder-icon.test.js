/**
 * 移动端左侧抽屉-文件列表：文件夹行默认图标回归测试
 *
 * 背景：uni-icons 图标库不存在 folder 这个 key（只有 folder-add），
 * 原文件列表文件夹行的默认回退用 type="folder"，渲染出的 unicode 为空串 →
 * 没有自定义图标的文件夹在文件列表里左侧一片空白。
 * 而文件行左侧有复选框，故需求为「文件夹也要有图标，位置与复选框对齐」。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readText } = require('./helpers/load-esm.js')

test('uni-icons 不存在 folder 图标 key（历史 bug 的客观依据）', () => {
  const vue = readText('uni_modules/uni-icons/components/uni-icons/uniicons_file_vue.js')
  assert.doesNotMatch(vue, /font_class:\s*['"]folder['"]/,
    'uni-icons 没有 folder key，type="folder" 会渲染成空 unicode')
  const js = readText('uni_modules/uni-icons/components/uni-icons/icons.js')
  assert.doesNotMatch(js, /"folder"\s*:/, 'icons.js 也不应有 folder key')
})

test('文件列表文件夹行：默认图标用内置 folder-default.svg，不再用坏的 type="folder"', () => {
  const src = readText('components/mm-file-list/mm-file-list.vue')
  const start = src.indexOf('v-for="folder in childFolders"')
  const end = src.indexOf('v-for="file in sortedFiles"')
  assert.ok(start > -1 && end > start, '应能定位到文件夹行区块')

  const folderRow = src.slice(start, end)
  assert.match(folderRow, /class="mm-list__folder-icon"/, '文件夹行有独立图标容器')
  assert.doesNotMatch(folderRow, /<uni-icons[^>]*type="folder"/, '不再使用不存在的 folder 图标')
  assert.match(folderRow, /folder-default\.svg/, '默认回退用项目内置 folder-default.svg')
  assert.match(folderRow, /class="mm-list__folder-img"/, '默认图标复用 preset 图样式类')
})

test('文件列表：文件夹图标容器与文件复选框容器视觉等宽（左侧位置对齐）', () => {
  const src = readText('components/mm-file-list/mm-file-list.vue')
  const css = src.slice(src.indexOf('<style'))
  const widthOf = (cls) => {
    const m = new RegExp('\\.' + cls + '\\s*\\{[^}]*?width:\\s*([0-9]+px)').exec(css)
    return m ? m[1] : ''
  }
  assert.equal(widthOf('mm-list__folder-icon'), '15px', '文件夹图标容器宽 15px')
  assert.equal(widthOf('mm-list__check'), '15px', '复选框 content 宽 15px（border-box 含边框），两者同列对齐')
})
