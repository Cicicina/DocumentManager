/**
 * 图片空间「点击预览」回归测试。
 *
 * 需求：点击图片非删除按钮处可预览（uni.previewImage），但必须：
 *  1) 长按拖动排序松手后，浏览器补发的 click 不能误开预览；
 *  2) 点删除按钮（含其 touchstart/pointerdown）不能触发拖动或预览；
 *  3) 预览用全部有临时 URL 的图构造列表并定位到当前图。
 *
 * 本测试真实加载 drag-order.js（注入 vue.ref）验证 shouldIgnoreClick 的时间窗行为，
 * 并从 SFC 抽出 previewImage 的真实函数体注入执行，验证预览参数与拦截逻辑。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const vue = require('vue')
const { readText } = require('./helpers/load-esm.js')
const { loadInjectedModule } = require('./helpers/api-runtime.js')

function extractFunction(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `未找到函数 ${name}`)
  const brace = source.indexOf('{', start)
  assert.notEqual(brace, -1, `函数 ${name} 缺少函数体`)
  let depth = 0
  for (let i = brace; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`函数 ${name} 未闭合`)
}

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
  return {
    items,
    getList: () => list,
    setList: next => { list = next },
    onCommit: () => {}
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('模板契约：卡片绑 click 预览，删除按钮 click/touchstart/pointerdown 均阻止冒泡', () => {
  const src = readText('pages/image-space/image-space.vue')
  assert.match(src, /@click="previewImage\(item\)"/, '卡片必须绑定点击预览')
  const removeTag = src.slice(src.indexOf('class="mm-image-space__remove"'))
    .split('>')[0]
  assert.match(removeTag, /@click\.stop="removeImage\(item\)"/, '删除按钮 click 必须 stop')
  assert.match(removeTag, /@touchstart\.stop="noop"/, '删除按钮 touchstart 必须 stop')
  assert.match(removeTag, /@pointerdown\.stop="noop"/, '删除按钮 pointerdown 必须 stop')
})

test('真实拖动松手后 shouldIgnoreClick=true，普通点击为 false', async () => {
  const useImageDragSort = await loadDragSort()
  makeDom()
  const env = makeEnv()

  // 普通点击（pointerdown 后马上 pointerup，未达长按/位移阈值）→ 不抑制
  const fresh = useImageDragSort(env.getList, env.setList, env.onCommit)
  assert.equal(fresh.shouldIgnoreClick(), false, '初始不应抑制 click')
  const card = global.document.querySelector('[data-drag-index="0"]')
  fresh.startDrag({ pointerType: 'mouse', clientX: 50, clientY: 50, currentTarget: card, target: card, preventDefault() {} }, env.items[0], 0)
  global.document.dispatchEvent(new global.window.Event('pointerup'))
  assert.equal(fresh.shouldIgnoreClick(), false, '未真正拖动的普通点击不应抑制预览')

  // 真实拖动：触屏长按 arm 后松手 → 抑制 click
  const dnd = useImageDragSort(env.getList, env.setList, env.onCommit)
  const touch = { clientX: 60, clientY: 60 }
  dnd.startDrag({ type: 'touchstart', touches: [touch], changedTouches: [touch], currentTarget: card, target: card, preventDefault() {} }, env.items[1], 1)
  await wait(360)
  global.document.dispatchEvent(new global.window.Event('touchend'))
  assert.equal(dnd.shouldIgnoreClick(), true, '真实拖动松手后应抑制紧随的 click（避免误开预览）')
})

test('click 抑制时间窗过期后自动失效（不会误吞下一次正常点击）', async () => {
  const useImageDragSort = await loadDragSort()
  makeDom()
  const env = makeEnv()
  const dnd = useImageDragSort(env.getList, env.setList, env.onCommit)
  const card = global.document.querySelector('[data-drag-index="0"]')
  const touch = { clientX: 50, clientY: 50 }
  dnd.startDrag({ type: 'touchstart', touches: [touch], changedTouches: [touch], currentTarget: card, target: card, preventDefault() {} }, env.items[0], 0)
  await wait(360)
  global.document.dispatchEvent(new global.window.Event('touchend'))
  assert.equal(dnd.shouldIgnoreClick(), true)
  await wait(420)
  assert.equal(dnd.shouldIgnoreClick(), false, '窗口过期后必须放行正常点击')
})

test('previewImage 真实函数体：构造完整 url 列表并定位当前图；被抑制时不预览', () => {
  const src = readText('pages/image-space/image-space.vue')
  const fnSrc = extractFunction(src, 'previewImage')

  const calls = []
  const uniStub = { previewImage: opts => calls.push(opts) }
  const imageUrls = { f1: 'http://t/1', f2: 'http://t/2', f3: 'http://t/3' }
  const imageList = [{ _id: 'a', file_id: 'f1' }, { _id: 'b', file_id: 'f2' }, { _id: 'c', file_id: 'f3' }]

  // 用真实函数体构造：注入依赖
  const factory = new Function(
    'uni', 'imageUrls', 'imageList', 'shouldIgnoreClick',
    `${fnSrc}\nreturn previewImage`
  )
  let ignore = false
  const previewImage = factory(uniStub, { value: imageUrls }, { value: imageList }, () => ignore)

  previewImage(imageList[1])
  assert.equal(calls.length, 1, '点击应触发预览')
  assert.deepEqual(calls[0].urls, ['http://t/1', 'http://t/2', 'http://t/3'], '应含全部有 URL 的图')
  assert.equal(calls[0].current, 'http://t/2', '应定位到当前点击的图')

  // 刚拖动完：抑制
  ignore = true
  previewImage(imageList[0])
  assert.equal(calls.length, 1, 'shouldIgnoreClick 时应跳过预览')

  // 无临时 URL 的占位图不预览
  ignore = false
  previewImage({ file_id: 'no_url' })
  assert.equal(calls.length, 1, '没有临时 URL 的图不触发预览')
})
