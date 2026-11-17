/**
 * 真机长按「入口」回归测试。
 *
 * 上次把 touch 兼容加在 startDrag 内部，但两个页面模板只绑了 @pointerdown。
 * 真机上存在两种失效：
 *  A) 内置浏览器只发 touchstart、不发 pointerdown → startDrag 根本不被调用；
 *  B) touchstart 与 pointerdown 都发，但 pointerdown 经 uni 包装后丢了 pointerType，
 *     后到的 pointerdown 把先到的 touchstart 设好的长按定时器 clearHold 掉 → 永不 arm。
 *
 * 本测试：
 *  1) 静态锁定两个模板都把 touchstart 与 pointerdown 都绑到 startDrag；
 *  2) 运行时用真实 startDrag 验证「pointerdown 先到且丢 pointerType、touchstart 后到」
 *     仍能启动触屏长按并 arm（防重复 + 补充触屏判定）；
 *  3) 运行时验证仅有 touchstart 的完整链路不受影响。
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
    '<div class="item" data-drag-index="0" style=""></div>' +
    '<div class="item" data-drag-index="1" style=""></div>' +
    '</div></body></html>')
  global.window = dom.window
  global.document = dom.window.document
  dom.window.document.elementFromPoint = () => null
  return dom
}

function makeEnv() {
  const items = [{ _id: 'a' }, { _id: 'b' }]
  let list = items.slice()
  let commitCount = 0
  return {
    items,
    getList: () => list,
    setList: next => { list = next },
    onCommit: () => { commitCount += 1 },
    getCommitCount: () => commitCount
  }
}

const waitArm = () => new Promise(resolve => setTimeout(resolve, 360))

test('两个页面模板都把 touchstart 与 pointerdown 绑定到 startDrag', () => {
  for (const file of [
    'pages/image-space/image-space.vue',
    'components/mm-image-picker/mm-image-picker.vue'
  ]) {
    const src = readText(file)
    assert.match(src, /@pointerdown="startDrag\(/, file + ' 必须绑定 @pointerdown')
    assert.match(src, /@touchstart="startDrag\(/, file + ' 必须绑定 @touchstart（真机只发 touchstart 时的唯一入口）')
  }
})

test('pointerdown 先到且丢失 pointerType、touchstart 后到：仍能启动长按并 arm', async () => {
  const useImageDragSort = await loadDragSort()
  makeDom()
  const env = makeEnv()
  const { draggingId, startDrag } = useImageDragSort(env.getList, env.setList, env.onCommit)
  const card = global.document.querySelector('[data-drag-index="0"]')
  const touch = { clientX: 50, clientY: 50 }

  // 第一枪：pointerdown，pointerType 在 uni 包装后丢失（真机常见）
  startDrag({
    type: 'pointerdown', clientX: 50, clientY: 50,
    currentTarget: card, target: card, cancelable: true, preventDefault() {}
  }, env.items[0], 0)
  // 第二枪：touchstart，带触点 → 应补判定为触屏并保住长按定时器
  startDrag({
    type: 'touchstart', touches: [touch], changedTouches: [touch],
    currentTarget: card, target: card, cancelable: true, preventDefault() {}
  }, env.items[0], 0)

  await waitArm()
  assert.equal(draggingId.value, 'a', '双事件下长按定时器不应被后到的 pointerdown 清掉')

  // 松手只提交一次（pointerup + touchend 都发，也不能重复写库）
  global.document.dispatchEvent(new global.window.Event('pointerup'))
  global.document.dispatchEvent(new global.window.Event('touchend'))
  assert.equal(env.getCommitCount(), 1, '同一次手势只提交一次')
})

test('真实顺序：touchstart 先到、pointerdown 后到且丢 pointerType：长按不被清掉', async () => {
  const useImageDragSort = await loadDragSort()
  makeDom()
  const env = makeEnv()
  const { draggingId, startDrag } = useImageDragSort(env.getList, env.setList, env.onCommit)
  const card = global.document.querySelector('[data-drag-index="0"]')
  const touch = { clientX: 50, clientY: 50 }

  // 真实顺序：先 touchstart（判定触屏、启动定时器）
  startDrag({
    type: 'touchstart', touches: [touch], changedTouches: [touch],
    currentTarget: card, target: card, cancelable: true, preventDefault() {}
  }, env.items[0], 0)
  // 后到的 pointerdown，pointerType 丢失 → isTouch=false
  startDrag({
    type: 'pointerdown', clientX: 50, clientY: 50,
    currentTarget: card, target: card, cancelable: true, preventDefault() {}
  }, env.items[0], 0)

  await waitArm()
  assert.equal(draggingId.value, 'a', '后到且丢 pointerType 的 pointerdown 不应清掉长按定时器')
})

test('仅 touchstart（无 pointerdown）时 touchmove 重排 + touchend 提交仍成立', async () => {
  const useImageDragSort = await loadDragSort()
  makeDom()
  const env = makeEnv()
  const { draggingId, startDrag } = useImageDragSort(env.getList, env.setList, env.onCommit)
  const card = global.document.querySelector('[data-drag-index="1"]')
  const touch = { clientX: 60, clientY: 60 }
  startDrag({
    type: 'touchstart', touches: [touch], changedTouches: [touch],
    currentTarget: card, target: card, cancelable: true, preventDefault() {}
  }, env.items[1], 1)
  await waitArm()
  assert.equal(draggingId.value, 'b')

  global.document.elementFromPoint = () => global.document.querySelector('[data-drag-index="0"]')
  const moveTouch = { clientX: 20, clientY: 20 }
  global.document.dispatchEvent(Object.assign(new global.window.Event('touchmove'), {
    touches: [moveTouch], changedTouches: [moveTouch]
  }))
  assert.deepEqual(env.getList().map(x => x._id), ['b', 'a'])
  global.document.dispatchEvent(new global.window.Event('touchend'))
  assert.equal(env.getCommitCount(), 1)
})
