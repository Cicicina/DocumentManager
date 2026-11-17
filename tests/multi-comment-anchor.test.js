/**
 * 多批注气泡定位回归测试（真实 DOM + 真实 selection.js）。
 *
 * 用户反馈：添加多个批注后，每个批注都显示在最后一个被标记的文字后面，
 * 而不是各自对应的标记文字附近。
 *
 * 根因（已用 artifacts/diag-multi-comment.js 真实复现）：
 * applyHighlights 从后往前依次 highlightRange，再用
 *   created = allMarks.slice(before)
 * 取"本次新增的 mark"。但 querySelectorAll 返回的是 DOM 文档顺序，
 * 与"创建顺序"相反：从后往前高亮时，后创建的 mark 排在 DOM 前面。
 * 结果每次 slice 都取到最后一个 mark，appendChip 把全部气泡挂到同一处。
 *
 * 本测试用真实 highlightRange 构造 DOM，复刻 applyHighlights 的新增 mark 识别逻辑，
 * 断言每个批注的气泡锚点落在各自段落；修复前必须失败。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const { readText } = require('./helpers/load-esm.js')
const { loadInjectedModule } = require('./helpers/api-runtime.js')

async function loadSelection() {
  let source = readText('common/utils/selection.js')
  source = source.replace(/^[ \t]*import[ \t]+['"][^'"]+['"][ \t]*;?[ \t]*$/gm, '')
  const { module } = await loadInjectedModule(source, { deps: { ANCHOR_CONTEXT_LEN: 32 } })
  return module
}

function makeDom() {
  const dom = new JSDOM('<!doctype html><html><body><div class="body">' +
    '<p>阿尔法段落内容甲乙丙。</p>' +
    '<p>贝塔段落内容丁戊己。</p>' +
    '<p>伽马段落内容庚辛壬。</p>' +
    '</div></body></html>')
  global.window = dom.window
  global.document = dom.window.document
  global.NodeFilter = dom.window.NodeFilter
  global.Node = dom.window.Node
  return dom
}

/**
 * 复刻 applyHighlights 里"识别本次新增 mark 并确定 chip 锚点"的逻辑。
 * useSet=true 用元素身份 Set（修复后）；false 用 slice(before)（修复前，有 bug）。
 * 返回 comment.label → 锚点 mark 所在段落前 3 字。
 */
function simulateHighlights(sel, el, plainText, comments, useSet) {
  sel.buildDomPlainMap(el, plainText, true)
  const processed = new Set()
  const anchors = {}
  for (const c of comments) {
    const before = Array.from(el.querySelectorAll('mark.mm-anchor'))
    const beforeSet = new Set(before)
    sel.highlightRange(el, c.start_offset, c.end_offset)
    const all = Array.from(el.querySelectorAll('mark.mm-anchor'))
    let created
    if (useSet) {
      created = all.filter(m => !processed.has(m))
      created.forEach(m => processed.add(m))
    } else {
      created = all.slice(before.length) // bug：DOM 顺序与创建顺序相反
    }
    // 组件把 chip 挂到 created 最后一个
    if (created.length) {
      const anchor = created[created.length - 1]
      anchors[c.label] = anchor.closest('p')?.textContent.slice(0, 3) || ''
    }
    // beforeSet 仅用于说明：旧逻辑用数量，不用引用
    void beforeSet
  }
  return anchors
}

function makeComments(plainText) {
  return [
    { label: '庚辛', start_offset: plainText.indexOf('庚辛'), end_offset: plainText.indexOf('庚辛') + 2 },
    { label: '丁戊', start_offset: plainText.indexOf('丁戊'), end_offset: plainText.indexOf('丁戊') + 2 },
    { label: '甲乙', start_offset: plainText.indexOf('甲乙'), end_offset: plainText.indexOf('甲乙') + 2 }
  ]
}

test('旧逻辑 slice(before) 会把所有气泡锚点落到最后一个 mark（复现 bug）', async () => {
  const sel = await loadSelection()
  makeDom()
  const el = document.querySelector('.body')
  const plainText = Array.from(el.querySelectorAll('p')).map(p => p.textContent).join('\n')
  const anchors = simulateHighlights(sel, el, plainText, makeComments(plainText), false)
  // bug 表现：三个都指向"伽马"（最后一个被创建的 mark 所在段）
  assert.deepEqual(anchors, { 庚辛: '伽马段', 丁戊: '伽马段', 甲乙: '伽马段' })
})

test('修复后：每个气泡锚点落在各自标记文字所在段落', async () => {
  const sel = await loadSelection()
  makeDom()
  const el = document.querySelector('.body')
  const plainText = Array.from(el.querySelectorAll('p')).map(p => p.textContent).join('\n')
  const anchors = simulateHighlights(sel, el, plainText, makeComments(plainText), true)
  assert.deepEqual(anchors, {
    庚辛: '伽马段',
    丁戊: '贝塔段',
    甲乙: '阿尔法'
  }, '每个气泡必须挂到对应批注的锚点 mark 后')
})

test('SFC 契约：applyHighlights 用元素身份 Set 识别新增 mark，不再用 slice 数量切片', () => {
  const src = readText('components/mm-md-viewer/mm-md-viewer.vue')
  const fnStart = src.indexOf('function applyHighlights(')
  const fnEnd = src.indexOf('\nfunction ', fnStart + 10)
  const body = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 2000)
  assert.match(body, /new Set\(/, 'applyHighlights 必须用 Set 记录已处理的 mark')
  assert.doesNotMatch(body, /\.slice\(before\)/, '不得再用 DOM 顺序 slice(before) 猜新增 mark')
})

/**
 * 端到端：加载组件真实的 <script setup>，注入真实 selection.js 的三个函数，
 * contentRef 指向真实三段 DOM，调用真实 applyHighlights，检查三个 .mm-chip
 * 各自紧跟的 mark 落在对应段落。这是最接近浏览器实际执行的验证。
 */
test('端到端：真实 applyHighlights 执行后每个气泡紧跟各自段落的高亮文字', async () => {
  const sel = await loadSelection()
  makeDom()
  const el = document.querySelector('.body')
  const plainText = Array.from(el.querySelectorAll('p')).map(p => p.textContent).join('\n')
  const comments = makeComments(plainText).map(c => ({
    ...c,
    _id: c.label,
    comment: '批注-' + c.label,
    status: 'active'
  }))

  const source = readText('components/mm-md-viewer/mm-md-viewer.vue')
  const scriptMatched = /<script setup>([\s\S]*?)<\/script>/.exec(source)
  assert.ok(scriptMatched, '未找到 script setup')
  const vue = require('vue')
  const macroPrelude =
    'const __props__ = globalThis.__MM_DEPS__.__PROPS__\n' +
    'const defineProps = () => __props__\n' +
    'const defineEmits = () => () => {}\n' +
    'const defineExpose = () => {}\n'

  let cleaned = scriptMatched[1].replace(/^[ \t]*import[ \t]+['"][^'"]+['"][ \t]*;?[ \t]*$/gm, '')
  cleaned = macroPrelude + cleaned
  const deps = {
    computed: vue.computed,
    nextTick: vue.nextTick,
    onMounted: () => {},
    ref: value => vue.ref(value),
    watch: () => {},
    marked: { use: () => {}, parse: () => '' },
    DOMPurify: { sanitize: html => html },
    buildDomPlainMap: sel.buildDomPlainMap,
    highlightRange: sel.highlightRange,
    scrollToOffset: sel.scrollToOffset,
    __PROPS__: { comments, plainText, mdSource: '', activeCommentId: '', imageUrlMap: {} }
  }
  const { exposed } = await loadInjectedModule(cleaned, {
    deps,
    expose: ['contentRef', 'applyHighlights']
  })
  exposed.contentRef.value = el
  exposed.applyHighlights()

  // 每个 chip 前面的兄弟应是 mark，mark 文本即批注标记，所在段即对应段落
  const chips = el.querySelectorAll('.mm-chip')
  assert.equal(chips.length, 3, '应生成 3 个气泡')
  const got = {}
  for (const chip of chips) {
    const mark = chip.previousElementSibling
    assert.ok(mark && mark.classList.contains('mm-anchor'), '气泡应紧跟高亮 mark')
    const para = mark.closest('p')?.textContent.slice(0, 3) || ''
    got[mark.textContent] = para
  }
  assert.deepEqual(got, { 甲乙: '阿尔法', 丁戊: '贝塔段', 庚辛: '伽马段' },
    '每个气泡必须紧跟各自标记文字，不再全部堆到最后一段')
})
