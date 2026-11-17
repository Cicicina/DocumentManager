/**
 * 「选中批注文字也弹添加批注按钮」的运行时回归测试。
 *
 * 不靠静态字符串匹配下结论：直接从 pages/index/index.vue 抽出
 * isBodyTextSelection / captureShellSelection 的真实函数体，注入 jsdom 的
 * window/document 与响应式替身后真调用，断言浮动按钮显隐与锚点缓存的变化。
 *
 * 覆盖：正文选区 / 气泡正文 / 「查看全部」/ 详情弹层文字 / 跨正文与气泡 /
 *       折叠选区（点按钮瞬间）/ 映射失败 / 批注输入弹层打开期间。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const { readText } = require('./helpers/load-esm.js')

/** 按大括号配对抽取函数源码（函数体内注释使用全角括号，不干扰计数） */
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

const OLD_ANCHOR = { start: 1, end: 3, selectedText: '上一次选中的正文' }
const NEW_ANCHOR = { start: 10, end: 14, selectedText: '这次选中的正文' }

/**
 * 构造可独立执行的选区监听环境。
 * @param {object} options
 * @param {Function} [options.offsets] getSelectionOffsets 替身返回值（或函数）
 * @param {boolean} [options.dialogOpen] 批注输入弹层是否打开
 */
function createEnv(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body>' +
    '<div class="mm-viewer__body"><p id="bodyText">这是文档原文前面的内容，后面还有正文。</p>' +
    '<span class="mm-chip" data-mm-ignore><span class="mm-chip__text" id="chipText">这是批注内容</span>' +
    '<span class="mm-chip__more" id="more">查看全部</span></span></div>' +
    '<div id="dialog"><p id="dialogText">弹层里的标记段落</p></div>' +
    '</body></html>')
  const win = dom.window
  const doc = win.document

  const script = /<script setup>([\s\S]*?)<\/script>/.exec(
    readText('pages/index/index.vue')
  )[1]
  assert.ok(script, '未找到 pages/index/index.vue 的 <script setup>')

  const guardSrc = extractFunction(script, 'isBodyTextSelection')
  let captureSrc = extractFunction(script, 'captureShellSelection')
  // 测试环境没有 Vite 的 @ 别名，把防抖里的动态 import 换成注入的替身；
  // 除这一处装载适配外，函数体逐字来自生产源码。
  captureSrc = captureSrc.replace(
    "await import('@/common/utils/selection.js')",
    'await Promise.resolve({ getSelectionOffsets: __getSelectionOffsets })'
  )
  assert.ok(captureSrc.includes('__getSelectionOffsets'), '动态 import 替换失败，防抖分支无法执行')

  let timerFn = null
  const fakeSetTimeout = fn => { timerFn = fn; return 1 }
  const fakeClearTimeout = () => { timerFn = null }

  const hasActiveSelection = { value: false }
  const annotationSelection = { value: null }
  const commentDialogVisible = { value: !!options.dialogOpen }
  const store = { state: { editorContent: '# 标题\n\n这是文档原文前面的内容，后面还有正文。' } }
  const offsetsStub = typeof options.offsets === 'function' ? options.offsets : () => options.offsets

  const factory = new Function(
    'window', 'document', 'commentDialogVisible', 'hasActiveSelection',
    'annotationSelection', 'store', 'setTimeout', 'clearTimeout', '__getSelectionOffsets',
    'let shellSelectionTimer = null\n' + `${guardSrc}\n${captureSrc}\nreturn { isBodyTextSelection, captureShellSelection }`
  )
  const page = factory(
    win, doc, commentDialogVisible, hasActiveSelection, annotationSelection,
    store, fakeSetTimeout, fakeClearTimeout, offsetsStub
  )

  return {
    dom, win, doc, page, hasActiveSelection, annotationSelection, commentDialogVisible,
    nodes: {
      body: doc.querySelector('.mm-viewer__body'),
      bodyText: doc.querySelector('#bodyText').firstChild,
      chipText: doc.querySelector('#chipText').firstChild,
      more: doc.querySelector('#more').firstChild,
      dialogText: doc.querySelector('#dialogText').firstChild
    },
    /** 让 window.getSelection 返回指定选区 */
    select({ start, end, common, collapsed = false }) {
      win.getSelection = () => ({
        rangeCount: 1,
        isCollapsed: collapsed,
        getRangeAt: () => ({
          startContainer: start,
          endContainer: end,
          commonAncestorContainer: common || start
        })
      })
    },
    /** 执行防抖体（若被排入） */
    async flush() {
      if (!timerFn) return
      const fn = timerFn
      timerFn = null
      await fn()
    },
    hasPendingTimer() { return !!timerFn }
  }
}

test('选中正文原文：浮钮出现，防抖后锚点更新为本次选区', async () => {
  const env = createEnv({ offsets: NEW_ANCHOR })
  const { bodyText } = env.nodes
  env.select({ start: bodyText, end: bodyText, common: bodyText })

  env.page.captureShellSelection()
  assert.equal(env.hasActiveSelection.value, true, '正文选中必须立刻显示添加批注')
  assert.equal(env.hasPendingTimer(), true)
  await env.flush()
  assert.deepEqual(env.annotationSelection.value, NEW_ANCHOR)
})

test('选中批注气泡里的批注内容：浮钮不出现，旧锚点被丢弃', async () => {
  const env = createEnv({ offsets: NEW_ANCHOR })
  env.annotationSelection.value = OLD_ANCHOR
  const { chipText } = env.nodes
  env.select({ start: chipText, end: chipText, common: chipText })

  env.page.captureShellSelection()
  assert.equal(env.hasActiveSelection.value, false, '批注内容不是文档原文，不能弹添加批注')
  assert.equal(env.annotationSelection.value, null, '不能复用上一次的正文锚点')
  assert.equal(env.hasPendingTimer(), false, '无效选区不应进入坐标换算')
})

test('选中气泡上的「查看全部」：同样不弹按钮', () => {
  const env = createEnv({ offsets: NEW_ANCHOR })
  env.annotationSelection.value = OLD_ANCHOR
  const { more } = env.nodes
  env.select({ start: more, end: more, common: more })

  env.page.captureShellSelection()
  assert.equal(env.hasActiveSelection.value, false)
  assert.equal(env.annotationSelection.value, null)
})

test('选中批注详情弹层里的标记段落：容器外选区不弹按钮', () => {
  const env = createEnv({ offsets: NEW_ANCHOR })
  env.annotationSelection.value = OLD_ANCHOR
  const { dialogText } = env.nodes
  env.select({ start: dialogText, end: dialogText, common: dialogText })

  env.page.captureShellSelection()
  assert.equal(env.hasActiveSelection.value, false)
  assert.equal(env.annotationSelection.value, null)
})

test('从正文拖到批注气泡的跨选区：任一端点在忽略子树即无效', () => {
  const env = createEnv({ offsets: NEW_ANCHOR })
  env.annotationSelection.value = OLD_ANCHOR
  const { body, bodyText, chipText } = env.nodes
  env.select({ start: bodyText, end: chipText, common: body })

  env.page.captureShellSelection()
  assert.equal(env.hasActiveSelection.value, false)
  assert.equal(env.annotationSelection.value, null)
})

test('选区折叠（点添加批注瞬间）：按钮隐藏但锚点保留，弹层仍能拿到原文', () => {
  const env = createEnv({ offsets: NEW_ANCHOR })
  env.annotationSelection.value = OLD_ANCHOR
  env.select({ start: env.nodes.bodyText, end: env.nodes.bodyText, collapsed: true })

  env.page.captureShellSelection()
  assert.equal(env.hasActiveSelection.value, false)
  assert.deepEqual(env.annotationSelection.value, OLD_ANCHOR, '折叠态不能清空锚点')
})

test('正文选区映射失败（图片 alt / 表格间隙等）：防抖后收起按钮并丢弃旧锚点', async () => {
  const env = createEnv({ offsets: null })
  env.annotationSelection.value = OLD_ANCHOR
  const { bodyText } = env.nodes
  env.select({ start: bodyText, end: bodyText, common: bodyText })

  env.page.captureShellSelection()
  await env.flush()
  assert.equal(env.hasActiveSelection.value, false)
  assert.equal(env.annotationSelection.value, null)
})

test('批注输入弹层打开期间：选区变化不覆盖锚点，按钮保持隐藏', async () => {
  const env = createEnv({ offsets: NEW_ANCHOR, dialogOpen: true })
  env.annotationSelection.value = OLD_ANCHOR
  const { bodyText } = env.nodes
  env.select({ start: bodyText, end: bodyText, common: bodyText })

  env.page.captureShellSelection()
  assert.equal(env.hasActiveSelection.value, false)
  assert.deepEqual(env.annotationSelection.value, OLD_ANCHOR)
  assert.equal(env.hasPendingTimer(), false)
})
