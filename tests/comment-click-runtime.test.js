/**
 * mm-md-viewer 点击链路的「真实执行」运行时测试。
 *
 * 与静态契约测试不同：这里把组件的 <script setup> 抽出来，注入 defineProps /
 * defineEmits 及全部依赖的替身，然后真正调用 handleClick(event)，用构造的
 * DOM 目标（closest / getAttribute / getBoundingClientRect）验证：
 * - 点「查看全部」→ emit('view-all-comments', 命中的 comment)；
 * - 点高亮文字/气泡正文 → emit('select-comment', {comment, rect})；
 * - 点空白 → 不 emit。
 *
 * 这样即使浏览器自动化不可用，也能证明点击逻辑本身是否成立。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readText } = require('./helpers/load-esm.js')
const { loadInjectedModule } = require('./helpers/api-runtime.js')

/** 构造一个只实现 handleClick 所需 DOM 接口的目标对象 */
function makeTarget(matchers) {
  // matchers: [{ selector, el }]；el 需带 getAttribute / getBoundingClientRect
  const cache = new Map(matchers.map(m => [m.selector, m.el]))
  return {
    _cache: cache,
    closest(selector) {
      return cache.has(selector) ? cache.get(selector) : null
    }
  }
}

function makeEl(attrs, closestMap) {
  const map = closestMap || {}
  return {
    _attrs: attrs || {},
    closest(selector) {
      return Object.prototype.hasOwnProperty.call(map, selector) ? map[selector] : null
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this._attrs, key) ? this._attrs[key] : null
    },
    getBoundingClientRect() {
      return { top: 1, bottom: 2, left: 3, right: 4 }
    }
  }
}

/**
 * 加载 viewer script setup，返回 { handleClick, events }。
 * @param {object} props 传给 defineProps 的替身 props
 */
async function loadViewer(props) {
  const source = readText('components/mm-md-viewer/mm-md-viewer.vue')
  const scriptMatched = /<script setup>([\s\S]*?)<\/script>/.exec(source)
  assert.ok(scriptMatched, '未找到 mm-md-viewer 的 <script setup>')

  const events = []
  const deps = {
    // vue 替身
    computed: fn => ({ get value() { return typeof fn === 'function' ? fn() : undefined } }),
    nextTick: fn => (typeof fn === 'function' ? Promise.resolve().then(fn) : Promise.resolve()),
    onMounted: () => {},
    ref: value => ({ value }),
    watch: () => {},
    // marked / dompurify / selection 替身（handleClick 不直接用到，但模块初始化会引用）
    marked: { use: () => {}, parse: () => '' },
    DOMPurify: { sanitize: html => html },
    buildDomPlainMap: () => {},
    highlightRange: () => {},
    scrollToOffset: () => {},
    // 编译宏替身：defineProps 返回我们的 props，defineEmits 返回收集 emit 的函数
    defineProps: () => props,
    defineEmits: () => (name, payload) => events.push({ name, payload })
  }

  // IMPORT_BLOCK_RE 只匹配 `import ... from ...`，副作用 import 需先剔除，
  // 否则会残留裸 import 导致 data: URL 模块语法错误。
  let cleaned = scriptMatched[1].replace(/^[ \t]*import[ \t]+['"][^'"]+['"][ \t]*;?[ \t]*$/gm, '')
  // Vue 编译宏不是真实函数：把 defineProps/defineEmits 的替身直接拼进源码顶部，
  // 这样模块顶层调用它们时能拿到真实返回值（loadInjectedModule 只注入 import 绑定，
  // 编译宏不在 import 语句里，无法靠 deps 注入）。
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
    expose: ['handleClick']
  })
  return { handleClick: exposed.handleClick, events }
}

const COMMENT_A = { _id: 'c-a', comment: '批注A', selected_text: '选中A', start_offset: 1, end_offset: 3, status: 'active' }
const COMMENT_B = { _id: 'c-b', comment: '批注B', selected_text: '选中B', start_offset: 5, end_offset: 7, status: 'active' }

test('查看全部：点 .mm-chip__more 真实触发 emit，并携带命中的批注', async () => {
  const { handleClick, events } = await loadViewer({ comments: [COMMENT_A, COMMENT_B] })

  const chip = makeEl({ 'data-comment-id': 'c-b' })
  // more 元素自身也要能用 closest 找到外层 chip（对应真实 DOM 的元素层级）
  const moreEl = makeEl({}, { '.mm-chip': chip })
  const more = makeTarget([
    { selector: '.mm-chip__more', el: moreEl },
    { selector: '.mm-chip', el: chip }
  ])
  handleClick({ target: more })

  assert.equal(events.length, 1, '应恰好 emit 一次')
  assert.equal(events[0].name, 'view-all-comments')
  assert.deepEqual(events[0].payload, COMMENT_B, 'emit 必须携带被点击气泡对应的批注')
})

test('查看全部：点击落在 more 内的文字节点（closest 命中）也能触发', async () => {
  const { handleClick, events } = await loadViewer({ comments: [COMMENT_A] })
  const chip = makeEl({ 'data-comment-id': 'c-a' })
  const moreEl = makeEl({}, { '.mm-chip': chip })
  // 模拟点在「查看全部」文字上：closest('.mm-chip__more') 由文本节点向上命中
  const textNode = makeTarget([
    { selector: '.mm-chip__more', el: moreEl },
    { selector: '.mm-chip', el: chip }
  ])
  handleClick({ target: textNode })
  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'view-all-comments')
  assert.equal(events[0].payload._id, 'c-a')
})

test('单条详情：点高亮文字 emit select-comment，携带批注与 rect', async () => {
  const { handleClick, events } = await loadViewer({ comments: [COMMENT_A] })
  const mark = makeEl({ 'data-comment-id': 'c-a' })
  const target = makeTarget([
    { selector: '.mm-chip__more', el: null },
    { selector: 'mark.mm-anchor', el: mark },
    { selector: '.mm-chip', el: null }
  ])
  handleClick({ target })
  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'select-comment')
  assert.equal(events[0].payload.comment._id, 'c-a')
  assert.deepEqual(events[0].payload.rect, { top: 1, bottom: 2, left: 3, right: 4 })
})

test('点空白：不 emit 任何事件', async () => {
  const { handleClick, events } = await loadViewer({ comments: [COMMENT_A] })
  const target = makeTarget([
    { selector: '.mm-chip__more', el: null },
    { selector: 'mark.mm-anchor', el: null },
    { selector: '.mm-chip', el: null }
  ])
  handleClick({ target })
  assert.equal(events.length, 0)
})
