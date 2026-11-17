/**
 * 批注「查看全部」弹层链路的源码契约 + 轻量运行时校验。
 *
 * 背景（回归 bug）：index.vue 曾以命名方式 import getCommentParagraph，
 * 但 common/utils/comment-paragraph.js 采用同构双挂载、没有 export，
 * 真实构建下该绑定为 undefined；模板求值 commentsWithParagraph 时
 * 调用 getCommentParagraph() 抛 TypeError，导致整个页面渲染崩溃，
 * 表现为「点查看全部打不开」。测试框架的 deps 恰好 mock 了同名符号，
 * 所以常规运行时测试全绿也无法发现——必须靠源码契约兜底。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readText } = require('./helpers/load-esm.js')
const {
  extractAnnotatedParagraph,
  getCommentParagraph
} = require('../common/utils/comment-paragraph.js')

test('批注段落工具：getCommentParagraph 返回可用的 extractAnnotatedParagraph', () => {
  const helper = getCommentParagraph()
  assert.equal(typeof helper.extractAnnotatedParagraph, 'function')
  assert.equal(helper.extractAnnotatedParagraph, extractAnnotatedParagraph)
})

test('根因回归：index.vue 不得命名导入 getCommentParagraph，只能副作用导入', () => {
  const page = readText('pages/index/index.vue')
  // 任何「从 comment-paragraph.js 命名导入」的写法都要禁止
  assert.ok(
    !/import\s*\{[^}]*getCommentParagraph[^}]*\}\s*from\s*['"]@\/common\/utils\/comment-paragraph\.js['"]/.test(page),
    '禁止命名导入 getCommentParagraph：该模块无 export，真实构建下为 undefined 会致页面崩溃'
  )
  // 必须保留副作用导入（把纯函数挂到 globalThis）
  assert.match(page, /import\s+['"]@\/common\/utils\/comment-paragraph\.js['"]/,
    '必须保留副作用导入以挂载 globalThis.CommentParagraph')
})

test('根因回归：commentsWithParagraph 从 globalThis 取用且对函数缺失做防御', () => {
  const page = readText('pages/index/index.vue')
  const computedBlock = /const commentsWithParagraph = computed\(\(\) => \{([\s\S]*?)\n\}\)/.exec(page)
  assert.ok(computedBlock, '未找到 commentsWithParagraph computed')
  const body = computedBlock[1]
  assert.match(body, /globalThis\.CommentParagraph/, '必须从 globalThis 取用而非命名导入')
  assert.match(body, /typeof\s+extractAnnotatedParagraph\s*===\s*['"]function['"]/,
    '必须防御 extractAnnotatedParagraph 缺失，否则 globalThis 未挂载时会崩')
})

test('链路完整：查看全部 emit 携带批注，主壳 handler 打开弹层并定位', () => {
  const viewer = readText('components/mm-md-viewer/mm-md-viewer.vue')
  const page = readText('pages/index/index.vue')

  // viewer：命中「查看全部」时 emit 携带命中的 comment
  assert.match(viewer, /emit\(['"]view-all-comments['"]\s*,\s*comment\s*\|\|\s*null\)/,
    'view-all-comments 必须携带命中的批注')
  assert.match(viewer, /closest\(['"]\.mm-chip__more['"]\)/, '必须能命中查看全部按钮')

  // 主壳：模板绑定 handler、handler 置位弹层、弹层用 v-model 绑定该状态
  assert.match(page, /@view-all-comments="handleViewAllComments"/, '模板须绑定 handler')
  assert.match(page, /function handleViewAllComments\(comment\)[\s\S]*?allCommentsVisible\.value\s*=\s*true/,
    'handler 必须打开 allCommentsVisible 弹层')
  assert.match(page, /<wd-popup v-model="allCommentsVisible"/, '弹层须用 v-model 绑定该状态')

  // 弹层内容三要素：标记段落 / 完整批注 / 时间
  assert.match(page, /mm-comment-card__para/, '须显示标记段落')
  assert.match(page, /mm-comment-card__hit/, '须高亮选中片段')
  assert.match(page, /mm-comment-card__text/, '须显示完整批注内容')
  assert.match(page, /formatCommentTime\(item\.created_at\)/, '须显示批注时间')
})
