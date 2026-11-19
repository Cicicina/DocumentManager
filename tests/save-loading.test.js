/**
 * 保存文件时的 wot loading 遮罩：手动保存 + 冲突覆盖两条写入路径都要拦住用户操作。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readText } = require('./helpers/load-esm.js')

function sliceFn(src, startMark, endMark) {
  const start = src.indexOf(startMark)
  assert.ok(start > -1, '找不到起点：' + startMark)
  const end = src.indexOf(endMark, start + startMark.length)
  assert.ok(end > start, '找不到终点：' + endMark)
  return src.slice(start, end)
}

test('handleSave：保存期间 toast.loading，且在 finally 中关闭（成功/冲突/失败都不残留遮罩）', () => {
  const src = readText('pages/index/index.vue')
  const body = sliceFn(src, 'async function handleSave()', 'async function applySaveSuccess')
  const loadingAt = body.indexOf('toast.loading(')
  const tryAt = body.indexOf('try {')
  const awaitAt = body.indexOf('await saveContent(')
  const finallyAt = body.indexOf('finally {')
  const closeAt = body.indexOf('toast.close()')
  assert.ok(loadingAt > -1, '手动保存应弹 loading')
  assert.ok(loadingAt < tryAt && tryAt < awaitAt && awaitAt < finallyAt && finallyAt < closeAt,
    '顺序：loading → try → await 保存 → finally → close')
  assert.match(body, /toast\.loading\('正在保存…'\)/, 'loading 文案为中文')
  assert.match(body, /let res/, '请求结果提升到 try 外，finally 后再判定分支')
})

test('handleConflictOverwrite：冲突覆盖保存同样带 loading + finally close', () => {
  const src = readText('pages/index/index.vue')
  const body = sliceFn(src, 'async function handleConflictOverwrite()', 'function handleConflictDiscard')
  assert.match(body, /toast\.loading\('正在保存…'\)/, '覆盖保存弹 loading')
  const loadingAt = body.indexOf('toast.loading(')
  const awaitAt = body.indexOf('await saveContent(')
  const closeAt = body.indexOf('toast.close()')
  assert.ok(loadingAt > -1 && loadingAt < awaitAt && awaitAt < closeAt,
    '顺序：loading → await 保存 → close')
  assert.match(body, /finally\s*\{\s*toast\.close\(\)/, 'close 放在 finally，失败路径也关闭遮罩')
})

test('两条保存路径的 loading 都在请求前、成功提示之前，不与 toast.success 抢同一实例', () => {
  const src = readText('pages/index/index.vue')
  const save = sliceFn(src, 'async function handleSave()', 'async function applySaveSuccess')
  assert.ok(save.indexOf('toast.loading(') < save.indexOf('applySaveSuccess(') ,
    'loading 早于成功处理')
  assert.match(src, /finally\s*\{\s*toast\.close\(\)\s*\}/, '关闭 loading 后由 applySaveSuccess 弹「已保存」短提示')
})
