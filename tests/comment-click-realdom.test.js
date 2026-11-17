/**
 * 用 jsdom 真实 DOM 复现「查看全部」点击链路（不依赖浏览器自动化）。
 *
 * 关键点：
 * - 建立真实的 <div class="mm-viewer__body"> 容器，内含 mark.mm-anchor + 动态插入的 .mm-chip；
 * - 用真实 Vue 的 ref/computed/watch 加载 viewer 的 <script setup>；
 * - 用真实 addEventListener('click', handleClick) 模拟 uni-app 的 @click 事件委托；
 * - 对 .mm-chip__more 真实 dispatchEvent(new MouseEvent('click', {bubbles:true}))；
 * - 断言 emit 是否被触发。
 *
 * 目的：验证「真实 DOM 结构 + 真实事件冒泡」下，查看全部按钮能否触发 emit。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const { readText } = require('./helpers/load-esm.js')
const { loadInjectedModule } = require('./helpers/api-runtime.js')

const COMMENT = {
  _id: 'c-real',
  comment: '这是一条真实批注',
  selected_text: '选中文字',
  start_offset: 2,
  end_offset: 6,
  status: 'active'
}

/** 建立与 viewer 一致真实 DOM 结构：容器 > mark.mm-anchor + span.mm-chip > span.mm-chip__more */
function buildRealDom() {
  const dom = new JSDOM('<!doctype html><html><body><div class="mm-viewer__body"><p>这是<mark class="mm-anchor" data-comment-id="c-real">选中文字</mark>后面</p></div></body></html>')
  const doc = dom.window.document
  const body = doc.querySelector('.mm-viewer__body')
  const mark = doc.querySelector('mark.mm-anchor')

  // 复刻 appendChip 的真实结构
  const chip = doc.createElement('span')
  chip.className = 'mm-chip'
  chip.setAttribute('data-mm-ignore', '')
  chip.setAttribute('data-comment-id', 'c-real')
  const text = doc.createElement('span')
  text.className = 'mm-chip__text'
  text.textContent = '这是一条真实批注'
  const more = doc.createElement('span')
  more.className = 'mm-chip__more'
  more.textContent = '查看全部'
  chip.appendChild(text)
  chip.appendChild(more)
  mark.parentNode.insertBefore(chip, mark.nextSibling)

  return { doc, body, more, chip, mark }
}

/** 用真实 Vue 响应式 API 加载 viewer script setup */
async function loadViewerReal(props, contentRefEl) {
  const source = readText('components/mm-md-viewer/mm-md-viewer.vue')
  const scriptMatched = /<script setup>([\s\S]*?)<\/script>/.exec(source)
  assert.ok(scriptMatched, '未找到 mm-md-viewer 的 <script setup>')

  const vue = require('vue')
  const events = []
  const deps = {
    computed: vue.computed,
    nextTick: vue.nextTick,
    onMounted: fn => { try { fn() } catch (e) {} },
    ref: value => vue.ref(value),
    watch: () => {},
    marked: { use: () => {}, parse: () => '<p>这是<mark class="mm-anchor" data-comment-id="c-real">选中文字</mark>后面</p>' },
    DOMPurify: { sanitize: html => html },
    buildDomPlainMap: () => {},
    highlightRange: () => {},
    scrollToOffset: () => {}
  }

  let cleaned = scriptMatched[1].replace(/^[ \t]*import[ \t]+['"][^'"]+['"][ \t]*;?[ \t]*$/gm, '')
  const macroPrelude =
    'const __props__ = globalThis.__MM_DEPS__.__PROPS__\n' +
    'const __events__ = globalThis.__MM_DEPS__.__EVENTS__\n' +
    'const defineProps = () => __props__\n' +
    'const defineEmits = () => (name, payload) => __events__.push({ name, payload })\n' +
    'const defineExpose = () => {}\n'
  deps.__PROPS__ = props
  deps.__EVENTS__ = events
  cleaned = macroPrelude + cleaned

  const { exposed } = await loadInjectedModule(cleaned, {
    deps,
    expose: ['handleClick', 'contentRef', 'applyHighlights', 'appendChip']
  })
  // 让 contentRef 指向真实 DOM 元素
  if (exposed.contentRef) exposed.contentRef.value = contentRefEl
  return { exposed, events }
}

test('直接绑定修复：appendChip 创建的按钮不靠事件委托，原生 click 也能 emit', async () => {
  // 只有 mark，没有手工 chip；让 appendChip 真实创建按钮并直接绑定 click
  const dom = new JSDOM('<!doctype html><html><body><div class="mm-viewer__body"><p>这是<mark class="mm-anchor" data-comment-id="c-real">选中文字</mark>后面</p></div></body></html>')
  const doc = dom.window.document
  const mark = doc.querySelector('mark.mm-anchor')
  globalThis.document = doc

  const props = { comments: [COMMENT], mdSource: '', plainText: '这是选中文字后面' }
  const { exposed, events } = await loadViewerReal(props, mark.parentNode)

  // 真实调用 appendChip：它会创建 .mm-chip__more 并直接 addEventListener('click')
  exposed.appendChip(mark, COMMENT)
  const more = doc.querySelector('.mm-chip__more')
  assert.ok(more, 'appendChip 应创建查看全部按钮')

  // 关键：这里刻意「不」给父容器绑定 @click 事件委托（模拟 uni-app 委托失效），
  // 只 dispatch 到按钮自身，验证直接绑定是否生效。
  more.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }))

  assert.equal(events.length, 1, '直接绑定的按钮 click 必须触发 emit（不依赖事件委托）')
  assert.equal(events[0].name, 'view-all-comments')
  assert.equal(events[0].payload._id, 'c-real')
})

test('真实 DOM：点 .mm-chip__more 能冒泡到 handleClick 并 emit view-all-comments', async () => {
  const { doc, body, more } = buildRealDom()
  globalThis.document = doc

  const props = { comments: [COMMENT], mdSource: '', plainText: '这是选中文字后面' }
  const { exposed, events } = await loadViewerReal(props, body)

  // 复刻 uni-app <view @click> 的事件委托：在父容器上真实绑定 click
  body.addEventListener('click', exposed.handleClick)

  // 真实派发点击事件（冒泡）：这就是用户在浏览器里点「查看全部」
  more.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }))

  assert.equal(events.length, 1, '真实点击应恰好触发一次 emit')
  assert.equal(events[0].name, 'view-all-comments')
  assert.equal(events[0].payload._id, 'c-real')
})

test('uni-app 包装事件：target 是普通 object 无 closest，从 $event.target 取真 DOM 仍能触发', async () => {
  const { doc, body, more } = buildRealDom()
  globalThis.document = doc

  const props = { comments: [COMMENT], mdSource: '', plainText: '这是选中文字后面' }
  const { exposed, events } = await loadViewerReal(props, body)
  body.addEventListener('click', exposed.handleClick)

  // 模拟 uni-app H5：event.target 是被包装的普通对象（无 closest），
  // 原生 target 藏在 $event.target 里。这是「查看全部」打不开的真正根因场景。
  const uniEvent = {
    target: { dataset: {}, nodeType: 1 },   // uni 包装对象，没有 closest
    $event: { target: more },                // 原生事件的 target 才是真 DOM
    currentTarget: body
  }
  // 直接调用 handleClick（uni 组件 @click 收到的就是这个包装对象）
  exposed.handleClick(uniEvent)

  assert.equal(events.length, 1, 'uni 包装事件下也应触发 emit')
  assert.equal(events[0].name, 'view-all-comments')
  assert.equal(events[0].payload._id, 'c-real')
})

test('真实 DOM：通过 closest 从 more 内部的文字命中（改文本节点场景）', async () => {
  const { doc, body, more } = buildRealDom()
  globalThis.document = doc

  // 在 more 里再塞一个文本节点包裹，模拟点中的是文字
  const inner = doc.createElement('b')
  inner.textContent = '查看全部'
  more.textContent = ''
  more.appendChild(inner)

  const props = { comments: [COMMENT], mdSource: '', plainText: '这是选中文字后面' }
  const { exposed, events } = await loadViewerReal(props, body)
  body.addEventListener('click', exposed.handleClick)

  inner.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }))

  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'view-all-comments')
})
