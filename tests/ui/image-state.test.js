/**
 * 图片双态（存储态 ↔ 显示态）纯逻辑测试（AC-08 / AC-09 / C7 / 契约第 7 条）。
 *
 * 被测实现位于 SFC 的 <script setup> 内（`mm-md-editor` 的 toDisplayState / toStorageState、
 * `mm-md-viewer` 的 toDisplayState），无法通过 import 取得，因此本测试
 * **直接从 .vue 源码文本中抽取这两个函数的原始代码**，注入仅含 `mergedUrlMap` 的
 * 最小作用域后用 new Function 执行——测的是随包发布的真实函数体，不是复制品。
 * 若源码函数被改名或改结构，抽取会抛错，起到回归告警作用。
 *
 * 断言目标：store.editorContent 永远是存储态（`![名称](mm-image://<fileID>)`），
 * 只有渲染层才替换为临时 URL，且反向替换可完全还原。
 */

'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

const EDITOR_SFC = readText('components/mm-md-editor/mm-md-editor.vue')
const VIEWER_SFC = readText('components/mm-md-viewer/mm-md-viewer.vue')
const PAGE_SFC = readText('pages/index/index.vue')

/** 读取项目内文件（统一换行） */
function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

/**
 * 从源码文本中按括号配平抽取一个具名函数声明。
 * @param {string} source 源码
 * @param {string} name 函数名
 * @returns {string} 函数源码（含 function 关键字到收尾大括号）
 */
function extractFunction(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.ok(start !== -1, `未在源码中找到函数 ${name}，实现可能已改名或改结构`)
  const open = source.indexOf('{', start)
  assert.ok(open !== -1, `函数 ${name} 缺少函数体`)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`函数 ${name} 的大括号未闭合`)
}

/**
 * 构造编辑器侧的真实函数对（toDisplayState / toStorageState）。
 * @param {object} urlMap fileID → 临时 URL
 * @returns {{toDisplayState: Function, toStorageState: Function}}
 */
function buildEditorPair(urlMap) {
  const displaySrc = extractFunction(EDITOR_SFC, 'toDisplayState')
  const storageSrc = extractFunction(EDITOR_SFC, 'toStorageState')
  const factory = new Function('__map', `
    const mergedUrlMap = { value: __map }
    ${displaySrc}
    ${storageSrc}
    return { toDisplayState, toStorageState }
  `)
  return factory(urlMap)
}

/**
 * 构造阅读器侧的真实函数（签名带 imageUrlMap 参数）。
 * @returns {Function}
 */
function buildViewerDisplay() {
  const displaySrc = extractFunction(VIEWER_SFC, 'toDisplayState')
  return new Function(`${displaySrc}; return toDisplayState;`)()
}

const FILE_ID = 'cloud://mock-env/images/u1/a.png'
const TEMP_URL = 'https://cdn.example.com/images/u1/a.png?sign=abc&expire=1700000000'
const STORAGE_MD = `# 标题\n\n正文段落\n\n![示意图](mm-image://${FILE_ID})\n\n收尾。`

function buildMap() {
  return { [FILE_ID]: TEMP_URL }
}

test('正向替换：显示态不含 mm-image:// 且包含临时 URL', () => {
  const { toDisplayState } = buildEditorPair(buildMap())
  const display = toDisplayState(STORAGE_MD)

  assert.ok(!display.includes('mm-image://'), '显示态不得残留 mm-image:// 存储 token')
  assert.ok(display.includes(TEMP_URL), '显示态应包含临时 URL')
  assert.ok(display.includes('![示意图]('), '图片 alt 应保留')
  assert.ok(display.includes('# 标题'), '正文其余内容不应被破坏')
})

test('反向替换：显示态可完全还原为存储态（round-trip 恒等）', () => {
  const { toDisplayState, toStorageState } = buildEditorPair(buildMap())
  const restored = toStorageState(toDisplayState(STORAGE_MD))
  assert.equal(restored, STORAGE_MD, '存储态 → 显示态 → 存储态必须完全还原')
})

test('无映射时原样保留，不替换、不抛错（图片未换到临时 URL 也不能丢 token）', () => {
  const { toDisplayState, toStorageState } = buildEditorPair({})
  assert.equal(toDisplayState(STORAGE_MD), STORAGE_MD, '无映射时应保留存储 token')
  assert.equal(toStorageState(STORAGE_MD), STORAGE_MD, '无映射时反向替换应原样返回')
})

test('临时 URL 含 ? / & / = / % 等特殊字符时反向替换仍正确', () => {
  const trickyUrl = 'https://cdn.example.com/a.png?x=1&y=2&z=%E4%B8%AD%E6%96%87#frag'
  const { toDisplayState, toStorageState } = buildEditorPair({ [FILE_ID]: trickyUrl })

  const display = toDisplayState(STORAGE_MD)
  assert.ok(display.includes(trickyUrl), '特殊字符 URL 应完整写入显示态')
  assert.equal(toStorageState(display), STORAGE_MD, '含特殊字符的 URL 必须能精确反向还原')
})

test('多图混合：已换到 URL 的还原、未换到的保留 token，正文其余部分不动', () => {
  const secondId = 'cloud://mock-env/images/u1/b.jpg'
  const source = [
    `![甲](mm-image://${FILE_ID})`,
    `![乙](mm-image://${secondId})`,
    '中间文字'
  ].join('\n')

  // 只有第一张有临时 URL
  const { toDisplayState, toStorageState } = buildEditorPair({ [FILE_ID]: TEMP_URL })
  const display = toDisplayState(source)

  assert.ok(display.includes(TEMP_URL))
  assert.ok(display.includes(`mm-image://${secondId}`), '未映射的图片应保留存储 token')
  assert.equal(toStorageState(display), source)
})

test('连续编辑不产生漂移：多次往返结果稳定', () => {
  const { toDisplayState, toStorageState } = buildEditorPair(buildMap())
  let current = STORAGE_MD
  for (let i = 0; i < 5; i++) {
    current = toStorageState(toDisplayState(current))
    assert.equal(current, STORAGE_MD, `第 ${i + 1} 次往返后存储态发生漂移`)
  }
})

test('非字符串入参安全降级为空串，不抛错', () => {
  const { toDisplayState, toStorageState } = buildEditorPair(buildMap())
  for (const bad of [undefined, null, 0, {}, []]) {
    assert.equal(toDisplayState(bad), '')
    assert.equal(toStorageState(bad), '')
  }
})

test('阅读器与编辑器的正向替换结果一致（同一输入同一映射）', () => {
  const map = buildMap()
  const viewerDisplay = buildViewerDisplay()
  const { toDisplayState } = buildEditorPair(map)

  assert.equal(viewerDisplay(STORAGE_MD, map), toDisplayState(STORAGE_MD),
    '阅读器与编辑器的显示态必须同源，否则阅读态渲染与编辑态内容会不一致')
  assert.equal(viewerDisplay(STORAGE_MD, {}), STORAGE_MD, '阅读器无映射时应保留存储 token')
})

test('存储态不得含 http(s) 绝对地址（库中只存 fileID）', () => {
  const { toDisplayState, toStorageState } = buildEditorPair(buildMap())
  const storage = toStorageState(toDisplayState(STORAGE_MD))
  assert.ok(!/https?:\/\//.test(storage), '存储态一旦含 http URL 就说明临时 URL 被持久化了')
})

// ---------------------------------------------------------------------------
// 接线静态断言：证明「反向替换发生在 emit 之前」「渲染层才做正向替换」
// ---------------------------------------------------------------------------

test('mm-md-editor 的 v-model setter 在 emit 前完成反向替换', () => {
  const setter = /set:\s*\(value\)\s*=>\s*emit\('update:modelValue',\s*toStorageState\(value\)\)/
  assert.match(EDITOR_SFC, setter,
    'displayValue 的 setter 必须把显示态转回存储态再 emit，否则 store.editorContent 会存成临时 URL')
  assert.match(EDITOR_SFC, /get:\s*\(\)\s*=>\s*toDisplayState\(props\.modelValue\)/,
    'displayValue 的 getter 必须把存储态转成显示态交给 MdEditor')
})

test('mm-md-viewer 的渲染入口使用正向替换后的内容', () => {
  assert.match(VIEWER_SFC, /const display = toDisplayState\(props\.mdSource, props\.imageUrlMap\)/,
    '阅读器必须先把存储态换成显示态再交给 marked 渲染')
  assert.match(VIEWER_SFC, /marked\.parse\(display\)/,
    'marked 的输入应是显示态')
})

test('主壳把 store.editorContent（存储态）直接交给阅读器与编辑器', () => {
  assert.match(PAGE_SFC, /:md-source="store\.state\.editorContent"/,
    '阅读器应接收 store.editorContent（存储态），由其内部正向替换')
  assert.match(PAGE_SFC, /v-model="editorContentProxy"/,
    '编辑器应绑定 editorContentProxy')
  assert.match(PAGE_SFC, /set:\s*\(value\)\s*=>\s*store\.setEditor\(value\)/,
    'editorContentProxy 的 setter 必须写回 store.editorContent')
})
