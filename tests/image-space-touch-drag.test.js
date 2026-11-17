/**
 * 图片空间触屏长按拖动的真实运行时测试。
 *
 * 背景：云端 URL 已取证正常（HTTP 200），桌面鼠标拖动实测正常，
 * 用户反馈的「长按没反应」只发生在触屏 —— 指向事件形态问题。
 *
 * 本测试把 drag-order.js 真实加载（注入 vue.ref），用 jsdom 构造三种事件形态：
 * 1) 原生 pointerdown（pointerType=touch）；
 * 2) uni-app H5 包装事件（原生事件在 $event / mp.detail 里）；
 * 3) 只有 touchstart / changedTouches 的事件（部分内置浏览器不发 pointer 事件）。
 * 三种都应能启动 300ms 长按并 arm。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const vue = require('vue')
const { readText } = require('./helpers/load-esm.js')
const { loadInjectedModule } = require('./helpers/api-runtime.js')

async function loadDragSort() {
  const source = readText('common/utils/drag-order.js')
  const { module } = await loadInjectedModule(source, { deps: { ref: vue.ref } })
  return module.useImageDragSort
}

function makeDom() {
  const dom = new JSDOM('<!doctype html><html><body><div class="grid">' +
    '<div class="item" data-drag-index="0" style=""><span>0</span></div>' +
    '<div class="item" data-drag-index="1" style=""><span>1</span></div>' +
    '<div class="item" data-drag-index="2" style=""><span>2</span></div>' +
    '</div></body></html>')
  global.window = dom.window
  global.document = dom.window.document
  dom.window.document.elementFromPoint = () => null
  return dom
}

function makeEnv() {
  const items = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }]
  let list = items.slice()
  let commitCount = 0
  const env = {
    items,
    getList: () => list,
    setList: next => { list = next },
    onCommit: () => { commitCount += 1 },
    getCommitCount: () => commitCount
  }
  return env
}

async function waitArm() {
  await new Promise(resolve => setTimeout(resolve, 360))
}

test('原生 pointerdown(pointerType=touch) 长按 300ms 应 arm', async () => {
  const useImageDragSort = await loadDragSort()
  makeDom()
  const env = makeEnv()
  const { draggingId, startDrag } = useImageDragSort(env.getList, env.setList, env.onCommit)

  const card = global.document.querySelector('[data-drag-index="0"]')
  startDrag({
    pointerType: 'touch', clientX: 50, clientY: 50,
    currentTarget: card, target: card, cancelable: true, preventDefault() {}
  }, env.items[0], 0)
  assert.equal(draggingId.value, '', '长按未到不能 arm')
  await waitArm()
  assert.equal(draggingId.value, 'a', '原生触屏长按应进入拖动态')
})

test('uni 包装事件（原生在 $event / mp.detail）长按也应 arm', async () => {
  const useImageDragSort = await loadDragSort()
  makeDom()
  const env = makeEnv()
  const { draggingId, startDrag } = useImageDragSort(env.getList, env.setList, env.onCommit)

  const card = global.document.querySelector('[data-drag-index="1"]')
  const native = {
    pointerType: 'touch', clientX: 60, clientY: 60,
    currentTarget: card, target: card, cancelable: true, preventDefault() {}
  }
  // uni-app H5 常见两种包装：外层 $event，或 mp.detail 里带原始信息
  const wrapped = { $event: native, type: 'pointerdown' }
  startDrag(wrapped, env.items[1], 1)
  await waitArm()
  assert.equal(draggingId.value, 'b', 'uni 包装事件下长按也必须 arm')

  // 松手只提交一次（document 上收到的是原生 pointerup）
  global.document.dispatchEvent(new global.window.Event('pointerup'))
  assert.equal(env.getCommitCount(), 1)
})

test('只有 touchstart + changedTouches（无 pointerType）长按也应 arm 并完整拖动提交', async () => {
  const useImageDragSort = await loadDragSort()
  makeDom()
  const env = makeEnv()
  const { draggingId, startDrag } = useImageDragSort(env.getList, env.setList, env.onCommit)

  const card = global.document.querySelector('[data-drag-index="2"]')
  const touch = { clientX: 70, clientY: 70 }
  startDrag({
    type: 'touchstart', touches: [touch], changedTouches: [touch],
    currentTarget: card, target: card, cancelable: true, preventDefault() {}
  }, env.items[2], 2)
  await waitArm()
  assert.equal(draggingId.value, 'c', '仅 touch 事件的浏览器长按也必须 arm')

  // touchmove 到下标 0 的位置（模拟 elementFromPoint 命中第一张卡）
  const moveTouch = { clientX: 20, clientY: 20 }
  global.document.elementFromPoint = () => global.document.querySelector('[data-drag-index="0"]')
  global.document.dispatchEvent(Object.assign(
    new global.window.Event('touchmove'),
    { touches: [moveTouch], changedTouches: [moveTouch] }
  ))
  assert.deepEqual(env.getList().map(x => x._id), ['c', 'a', 'b'], 'touchmove 应完成就地重排')

  // touchend 提交一次
  global.document.dispatchEvent(new global.window.Event('touchend'))
  assert.equal(env.getCommitCount(), 1, 'touchend 应提交且只提交一次')
  assert.equal(draggingId.value, '', '松手后清空拖动态')
})
