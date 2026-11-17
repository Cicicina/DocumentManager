/**
 * 前端源码静态一致性校验（AC-07 / AC-27 / AC-28 / AC-29 / AC-30 + 文档一致性）。
 *
 * 全部为「读源码 + 断言」的静态检查，不需要浏览器与 H5 编译：
 * - 主题变量深浅两套键集合是否齐全（缺键会导致深色下不可读）；
 * - 业务前端是否真的用 px 而非 rpx、颜色是否全部走 var(--mm-*)；
 * - AC-27 的响应式断点与三栏栏宽；
 * - AC-28 的加载动画时序（最短展示 / 淡出时长 / 覆盖全屏 / 结束后移除节点）；
 * - AC-29 的 easycom.custom 是否覆盖实际用到的全部 wd-* 标签；
 * - 组件 prop 绑定名与 defineProps 声明是否一致（发现不一致即失败，路由给工程师）；
 * - docs/API.md 的方法名 / 错误码是否与云对象实际导出逐项一致；
 * - docs/AC-CHECKLIST.md 的三态标注是否只有三种合法值、汇总数字是否自洽。
 */

'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createMockUniCloud } from '../helpers/mock-unicloud.js'
import { loadCloudObject } from '../helpers/cloud-env.js'
import { loadEsm } from '../helpers/load-esm.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

/** 12 个业务组件目录名 */
const BUSINESS_COMPONENTS = [
  'mm-loading',
  'mm-folder-tree',
  'mm-file-list',
  'mm-icon-picker',
  'mm-search-panel',
  'mm-settings-panel',
  'mm-trash',
  'mm-md-viewer',
  'mm-md-editor',
  'mm-annotation',
  'mm-conflict-modal',
  'mm-image-picker'
]

/** 业务前端文件（页面 + 12 组件 + common），示例页不在范围内 */
function businessFiles() {
  const files = ['pages/index/index.vue', 'pages/settings/settings.vue']
  for (const name of BUSINESS_COMPONENTS) files.push(`components/${name}/${name}.vue`)
  for (const sub of ['api', 'store', 'utils']) {
    const dir = path.join(ROOT, 'common', sub)
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.js')) files.push(`common/${sub}/${entry}`)
    }
  }
  files.push('common/constants.js', 'common/theme.css', 'pages.json', 'main.js')
  return files
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

/** 取 .vue 的 <style> 块内容 */
function styleBlocks(source) {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
}

/** 取 .vue 的 <template> 块内容 */
function templateBlock(source) {
  const matched = /<template>([\s\S]*)<\/template>/.exec(source)
  return matched ? matched[1] : ''
}

// ---------------------------------------------------------------------------
// AC-07：主题变量深浅两套必须定义同一组键
// ---------------------------------------------------------------------------

test('AC-07 主题变量四组（:root / 系统深色 / data-theme=light / data-theme=dark）键集合完全一致', () => {
  const css = readText('common/theme.css')
  const pickKeys = block => Array.from(block.matchAll(/--mm-[a-z0-9-]+(?=\s*:)/g)).map(m => m[0]).sort()

  const blocks = {
    ':root': /:root\s*\{([\s\S]*?)\}/.exec(css)[1],
    'prefers-color-scheme:dark': /@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\{([\s\S]*?)\}\s*\}/.exec(css)[1],
    'html[data-theme="light"]': /html\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(css)[1],
    'html[data-theme="dark"]': /html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/.exec(css)[1]
  }

  const base = pickKeys(blocks[':root'])
  assert.ok(base.length >= 10, `主题变量过少，疑似缺失：${base.length}`)
  for (const [name, block] of Object.entries(blocks)) {
    const keys = pickKeys(block)
    assert.deepEqual(keys, base,
      `${name} 的变量键集合与 :root 不一致（缺键会让深色/浅色下某些元素取不到值）`)
  }

  // 深浅两套取值必须真的不同，杜绝「深色其实是浅色」
  const lightText = blocks['html[data-theme="light"]']
  const darkText = blocks['html[data-theme="dark"]']
  for (const key of ['--mm-bg', '--mm-surface', '--mm-text', '--mm-border']) {
    const lightValue = new RegExp(`${key}:\\s*([^;]+);`).exec(lightText)[1].trim()
    const darkValue = new RegExp(`${key}:\\s*([^;]+);`).exec(darkText)[1].trim()
    assert.notEqual(darkValue, lightValue, `${key} 在深浅两套中取值相同，深色模式不可用`)
  }
})

test('AC-07 主题样式已被入口实际引入', () => {
  assert.match(readText('main.js'), /import '@\/common\/theme\.css'/,
    'theme.css 必须在入口引入，否则全部 var(--mm-*) 取不到值')
})

// ---------------------------------------------------------------------------
// AC-27：尺寸单位与配色
// ---------------------------------------------------------------------------

test('AC-27 业务前端不使用 rpx（含注释内提及之外的真实用法）', () => {
  const offenders = []
  for (const file of businessFiles()) {
    const source = readText(file)
    source.split('\n').forEach((line, index) => {
      if (!/\brpx\b/.test(line)) return
      // 允许出现在注释中（如「禁止 rpx」这类说明）
      const trimmed = line.trim()
      const isComment = trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')
      if (!isComment) offenders.push(`${file}:${index + 1} ${trimmed}`)
    })
  }
  assert.deepEqual(offenders, [], `业务前端出现 rpx 布局尺寸：\n${offenders.join('\n')}`)
})

test('AC-27 业务组件样式块不出现硬编码色值（一律走 var(--mm-*)）', () => {
  const colorPattern = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g
  const offenders = []
  for (const file of businessFiles()) {
    if (!file.endsWith('.vue')) continue
    const styles = styleBlocks(readText(file))
    const hits = [...styles.matchAll(colorPattern)].map(m => m[0])
    if (hits.length > 0) offenders.push(`${file} => ${hits.join(', ')}`)
  }
  assert.deepEqual(offenders, [], `以下组件样式硬编码了颜色：\n${offenders.join('\n')}`)
})

test('AC-27 响应式：<768px 单栏 + 左抽屉，≥768px 三栏 260/320/自适应', () => {
  const page = readText('pages/index/index.vue')

  // 断点
  assert.match(page, /window\.innerWidth < 768/, '移动端断点应为 <768px')
  assert.match(page, /isMobile\.value = window\.innerWidth < 768/)

  // 三栏栏宽
  const treeWidth = /\.mm-pane--tree\s*\{[\s\S]*?width:\s*(\d+)px/.exec(page)
  const listWidth = /\.mm-pane--list\s*\{[\s\S]*?width:\s*(\d+)px/.exec(page)
  const mainFlex = /\.mm-pane--main\s*\{[\s\S]*?flex:\s*1/.exec(page)
  assert.equal(Number(treeWidth[1]), 260, '左栏目录树应为 260px')
  assert.equal(Number(listWidth[1]), 320, '中栏文件列表应为 320px')
  assert.ok(mainFlex, '右栏应 flex:1 自适应')

  // 移动端隐藏左右两栏
  assert.match(page, /v-if="!isMobile"\s+class="mm-pane mm-pane--tree"/, '移动端应隐藏目录树栏')
  assert.match(page, /v-if="!isMobile"\s+class="mm-pane mm-pane--list"/, '移动端应隐藏文件列表栏')

  // 抽屉
  assert.match(page, /<wd-popup v-model="drawerVisible" position="left"/, '移动端应使用左侧抽屉承载目录树与列表')
  assert.match(page, /v-if="isMobile"[\s\S]{0,200}drawerVisible = true/, '移动端应提供抽屉唤起入口')
})

// ---------------------------------------------------------------------------
// AC-28：首屏加载动画时序
// ---------------------------------------------------------------------------

test('AC-28 mm-loading：最短展示 300ms、淡出 ≥180ms、全屏覆盖、结束后移除节点', () => {
  const loading = readText('components/mm-loading/mm-loading.vue')

  assert.match(loading, /minDuration:\s*\{\s*type:\s*Number,\s*default:\s*300\s*\}/,
    '最短展示时长默认应为 300ms')

  const transition = /transition:\s*opacity\s*([\d.]+)s/.exec(loading)
  assert.ok(transition, '缺少淡出过渡定义')
  assert.ok(Number(transition[1]) * 1000 >= 180, `淡出过渡应 ≥180ms，实际 ${Number(transition[1]) * 1000}ms`)

  const removal = /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?rendered\.value = false[\s\S]*?\},\s*(\d+)\)/.exec(loading)
  assert.ok(removal, '缺少淡出后移除节点的逻辑')
  assert.ok(Number(removal[1]) >= 180, `移除节点应等淡出结束（≥180ms），实际 ${removal[1]}ms`)

  assert.match(loading, /position:\s*fixed/, '加载层应固定定位覆盖全屏')
  assert.match(loading, /top:\s*0;[\s\S]*?right:\s*0;[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*0;/, '加载层应四边贴合覆盖全屏')
  assert.match(loading, /v-if="rendered"/, '淡出结束后应移除节点（v-if）')
  assert.match(loading, /const rendered = ref\(props\.visible\)/, '初始应随 visible 渲染，就绪前覆盖全屏')

  // 首屏：ready 之前必须处于播放态
  assert.match(readText('pages/index/index.vue'), /<mm-loading :visible="!store\.state\.ready" :min-duration="300" \/>/,
    '主壳应把 ready 取反交给 mm-loading，且传入 300ms 下限')
})

test('AC-28 ready 只在配置就绪后置位，且不触碰 editorContent', () => {
  const app = readText('App.vue')
  const readyIndex = app.indexOf('store.setReady(true)')
  const configIndex = app.indexOf('await getConfig()')
  assert.ok(configIndex !== -1 && readyIndex !== -1, 'App.vue 应读取配置后置 ready')
  assert.ok(configIndex < readyIndex, 'ready 必须在配置读取之后置位，否则加载动画会提前淡出')
  assert.ok(!/setEditor\(/.test(app), 'App.vue 不得写 editorContent（唯一编辑内容源）')
})

// ---------------------------------------------------------------------------
// AC-29：easycom 覆盖与实际 wd-* 引用
// ---------------------------------------------------------------------------

test('AC-29 pages.json 只注册业务页与 uni-id-pages，无 tabBar、无示例页', () => {
  const pages = JSON.parse(readText('pages.json'))

  assert.ok(pages.easycom && pages.easycom.custom, '缺少 easycom.custom 配置')
  assert.equal(pages.easycom.custom['^wd-(.*)'], 'wot-design-uni/components/wd-$1/wd-$1.vue',
    'easycom.custom 的 wd 规则不符合架构 R1 的单一形态')
  assert.equal(pages.tabBar, undefined, 'tabBar 应整体移除')

  const paths = pages.pages.map(item => item.path)
  const business = paths.filter(item => item.startsWith('pages/'))
  assert.deepEqual(business.sort(), ['pages/index/index', 'pages/settings/settings', 'pages/share-list/share-list'],
    '只应注册 3 个业务页（分享管理为独立页）')
  assert.equal(paths.length, 19, '业务页 3 + uni-id-pages 16')
  assert.equal(paths.filter(item => item.startsWith('uni_modules/uni-id-pages/')).length, 16,
    'uni-id-pages 登录/注册/资料页必须保留（AC-17）')

  const examplePaths = ['pages/clientDB', 'pages/storage', 'pages/test', 'pages/cloudFunction', 'pages/schema2code']
  for (const prefix of examplePaths) {
    assert.ok(!paths.some(item => item.startsWith(prefix)), `示例页仍被注册：${prefix}`)
  }
})

test('AC-29 实际用到的 wd-* 标签全部能被 easycom.custom 解析到真实组件文件', () => {
  const used = new Set()
  for (const file of businessFiles()) {
    if (!file.endsWith('.vue')) continue
    for (const match of readText(file).matchAll(/<(wd-[a-z0-9-]+)/g)) used.add(match[1])
  }
  assert.ok(used.size >= 3, `Wot UI 组件引用数不足 3 个（实际 ${used.size}）`)

  const missing = []
  for (const tag of used) {
    const target = path.join(ROOT, 'node_modules', 'wot-design-uni', 'components', tag, `${tag}.vue`)
    if (!fs.existsSync(target)) missing.push(`${tag} → ${target}`)
  }
  assert.deepEqual(missing, [], `以下 wd-* 标签无法解析：\n${missing.join('\n')}`)

  // 包内无 wd-dialog（架构 R2），确认没有误用
  const dialogUsage = businessFiles()
    .filter(file => file.endsWith('.vue'))
    .filter(file => readText(file).includes('wd-dialog'))
  assert.deepEqual(dialogUsage, [], 'Wot UI 包内不存在 wd-dialog，不得使用')
})

// ---------------------------------------------------------------------------
// 组件契约：prop 绑定名必须与 defineProps 声明一致
// ---------------------------------------------------------------------------

/** 从 .vue 提取 defineProps 声明的 prop 名 */
function declaredProps(source) {
  const matched = /defineProps\(\{([\s\S]*?)\n\}\)/.exec(source)
  if (!matched) return []
  return Array.from(matched[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*):\s*\{/gm)).map(m => m[1])
}

/** 把 kebab-case 转为 camelCase */
function camelize(name) {
  return name.replace(/-([a-z0-9])/g, (matched, ch) => ch.toUpperCase())
}

test('组件 prop 绑定名与 defineProps 声明一致（契约一致性）', () => {
  const declared = {}
  for (const name of BUSINESS_COMPONENTS) {
    declared[name] = declaredProps(readText(`components/${name}/${name}.vue`))
  }

  const mismatches = []
  for (const page of ['pages/index/index.vue', 'pages/settings/settings.vue']) {
    const source = readText(page)
    for (const tagMatch of source.matchAll(/<(mm-[a-z-]+)([\s\S]*?)\/?>/g)) {
      const tag = tagMatch[1]
      const attrs = tagMatch[2]
      const allow = declared[tag]
      if (!allow) continue

      const bound = new Set()
      for (const attr of attrs.matchAll(/\s(?::|v-model:)([a-zA-Z0-9-]+)(?==)/g)) bound.add(camelize(attr[1]))
      for (const attr of attrs.matchAll(/\sv-model(?==)/g)) bound.add('modelValue')

      for (const prop of bound) {
        if (!allow.includes(prop)) {
          mismatches.push(`${page} → <${tag}> 绑定了 ${prop}，但组件声明的是 [${allow.join(', ')}]`)
        }
      }
    }
  }

  assert.deepEqual(mismatches, [],
    `以下绑定不会生效（Vue 会把未声明的 prop 落到 attrs，组件读不到值）：\n${mismatches.join('\n')}`)
})

// ---------------------------------------------------------------------------
// AC-30：中文文案
// ---------------------------------------------------------------------------

test('AC-30 业务前端主要 UI 文案为中文，且无英文界面词残留', () => {
  // 「设置」等页面级文案在 pages.json 里；保存态文案由 computed 生成（见下一个用例）
  const required = ['保存', '阅读', '编辑', '上传', '导入', '回收站', '批注',
    '账号功能', '权限功能', '彻底删除']

  let allText = ''
  for (const file of businessFiles()) {
    if (!file.endsWith('.vue')) continue
    const source = readText(file)
    allText += templateBlock(source)
  }
  // 去掉注释与标签，只留文本节点
  const textOnly = allText.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')

  for (const word of required) {
    assert.ok(textOnly.includes(word), `缺少中文 UI 文案：${word}`)
  }

  const englishWords = ['Save', 'Cancel', 'Delete', 'Search', 'Upload', 'Import', 'Export',
    'Settings', 'Close', 'Confirm', 'Loading', 'Submit']
  const found = englishWords.filter(word => new RegExp(`\\b${word}\\b`).test(textOnly))
  assert.deepEqual(found, [], `模板块内出现英文界面词：${found.join(', ')}`)
})

test('AC-30 保存状态文案为中文（由 computed 生成，不在模板文本节点中）', () => {
  const page = readText('pages/index/index.vue')
  for (const word of ['已保存', '未保存', '保存中', '有冲突']) {
    assert.ok(page.includes(word), `缺少保存状态中文文案：${word}`)
  }
})

test('AC-30 pages.json 的页面标题全部为中文', () => {
  const pages = JSON.parse(readText('pages.json'))
  const titles = pages.pages
    .map(item => item.style && item.style.navigationBarTitleText)
    .filter(value => typeof value === 'string' && value !== '')

  assert.ok(titles.includes('Markdown 文档库'), '主壳标题应为中文')
  assert.ok(titles.includes('设置'), '设置页标题应为中文')
  assert.ok(titles.length >= 15, '页面标题覆盖不足')

  const englishOnly = titles.filter(title => !/[\u4e00-\u9fa5]/.test(title))
  assert.deepEqual(englishOnly, [], `以下页面标题不含中文：${englishOnly.join(', ')}`)
})

// ---------------------------------------------------------------------------
// 文档一致性：docs/API.md ↔ 云对象实际导出 / 统一错误码
// ---------------------------------------------------------------------------

/** 从 API.md 解析每个云对象章节里列出的方法名 */
function apiDocMethods() {
  const md = readText('docs/API.md')
  const result = {}
  const sections = md.split(/^## /m)
  for (const section of sections) {
    const nameMatched = /^\d+\.\s+`(mm-[a-z]+)`/.exec(section)
    if (!nameMatched) continue
    const methods = []
    for (const row of section.split('\n')) {
      const matched = /^\|\s*`([A-Za-z]+)`\s*\|/.exec(row)
      if (matched) methods.push(matched[1])
    }
    result[nameMatched[1]] = methods
  }
  return result
}

test('docs/API.md 的方法名与 6 个云对象实际导出逐个一致', () => {
  const mock = createMockUniCloud()
  const documented = apiDocMethods()
  const objects = ['mm-file', 'mm-comment', 'mm-search', 'mm-settings', 'mm-image', 'mm-share']

  assert.deepEqual(Object.keys(documented).sort(), objects.slice().sort(),
    'API.md 应覆盖全部 6 个云对象章节')

  for (const name of objects) {
    const exported = Object.keys(loadCloudObject(name, mock)).filter(key => key !== '_before').sort()
    assert.deepEqual(documented[name].slice().sort(), exported,
      `${name} 的 API.md 方法与实际导出不一致`)
  }

  // 架构里声明的方法数量
  assert.equal(documented['mm-file'].length, 17, 'mm-file 应有 17 个方法')
  assert.equal(documented['mm-comment'].length, 5, 'mm-comment 应有 5 个方法')
  assert.equal(documented['mm-settings'].length, 7, 'mm-settings 应有 7 个方法')
  assert.equal(documented['mm-image'].length, 6, 'mm-image 应有 6 个方法')
  assert.equal(documented['mm-share'].length, 5, 'mm-share 应有 5 个方法')
})

test('docs/API.md 错误码表与 common/constants.js 的 ERR 完全一致', async () => {
  const md = readText('docs/API.md')
  const documented = new Set()
  for (const row of md.split('\n')) {
    const matched = /^\|\s*\*{0,2}(\d{1,4})\*{0,2}\s*\|\s*`([A-Z_]+)`\s*\|/.exec(row)
    if (matched) documented.add(`${matched[2]}=${Number(matched[1])}`)
  }

  const constants = await loadEsm('common/constants.js')
  const actual = Object.entries(constants.ERR).map(([name, code]) => `${name}=${code}`).sort()

  assert.deepEqual(Array.from(documented).sort(), actual,
    'API.md 的错误码表必须与 constants.ERR 的 22 个键逐项一致')
  assert.equal(actual.length, 23, '统一错误码应为 23 个（含 4 个分享码与图片引用码）')

  // 新增分享码必须在前端常量与文档中同时存在且取值正确
  for (const [name, code] of Object.entries({
    SHARE_TOKEN_INVALID: 4007,
    SHARE_EXPIRED: 4008,
    SHARE_CREATE_FAILED: 4009,
    SHARE_DOC_UNAVAILABLE: 4010
  })) {
    assert.equal(constants.ERR[name], code, `前端缺少或写错 ${name}`)
    assert.ok(documented.has(`${name}=${code}`), `API.md 错误码表缺少 ${name}=${code}`)
  }
  assert.equal(constants.TABLE.SHARES, 'mm-shares', '前端应声明分享表名')
  assert.equal(constants.SHARE_QUERY_KEY, 'share_token', '分享 query 参数名应固定')
  assert.ok(typeof constants.SHARE_WEB_BASE === 'string' && constants.SHARE_WEB_BASE.startsWith('https://'),
    '分享 Web 基址应为 https 地址')
})

test('前端 common/api 封装调用的云对象方法全部真实存在', () => {
  const apiDir = path.join(ROOT, 'common', 'api')
  const calls = new Set()
  for (const entry of fs.readdirSync(apiDir)) {
    if (!entry.endsWith('.js') || entry === 'index.js') continue
    const source = fs.readFileSync(path.join(apiDir, entry), 'utf8')
    for (const matched of source.matchAll(/call(?:Silent)?\('(mm[A-Z][a-zA-Z]+)',\s*'([A-Za-z]+)'/g)) {
      const objectName = {
        mmFile: 'mm-file',
        mmComment: 'mm-comment',
        mmSearch: 'mm-search',
        mmSettings: 'mm-settings',
        mmImage: 'mm-image'
      }[matched[1]]
      assert.ok(objectName, `api 封装使用了未知云对象键：${matched[1]}`)
      calls.add(`${objectName}.${matched[2]}`)
    }
  }

  assert.ok(calls.size >= 20, `api 封装方法数偏少（实际 ${calls.size}）`)

  const mock = createMockUniCloud()
  const exportedCache = {}
  for (const call of calls) {
    const [objectName, method] = call.split('.')
    if (!exportedCache[objectName]) exportedCache[objectName] = Object.keys(loadCloudObject(objectName, mock))
    assert.ok(exportedCache[objectName].includes(method),
      `前端封装调用了不存在的云对象方法：${call}`)
  }
})

// ---------------------------------------------------------------------------
// 文档一致性：AC-CHECKLIST 三态标注是否合法且汇总自洽
// ---------------------------------------------------------------------------

test('docs/AC-CHECKLIST.md 只使用三种合法状态，31 条齐全且汇总数字自洽', () => {
  const md = readText('docs/AC-CHECKLIST.md')
  const legal = ['本地已验证', '部署后验证', '未验证']
  const counts = {}
  const ids = []

  for (const line of md.split('\n')) {
    const idMatched = /^\|\s*(AC-\d+)\s*\|/.exec(line)
    if (!idMatched) continue
    const cells = line.split('|').map(item => item.trim())
    const statusCell = cells[3] || ''
    const token = (statusCell.match(/`([^`]+)`/) || [])[1]
    assert.ok(token, `${idMatched[1]} 缺少状态标注`)
    assert.ok(legal.includes(token), `${idMatched[1]} 使用了非法状态「${token}」，只允许 ${legal.join(' / ')}`)
    ids.push(idMatched[1])
    counts[token] = (counts[token] || 0) + 1
  }

  assert.equal(ids.length, 31, 'AC-CHECKLIST 应覆盖 AC-01~AC-31')
  assert.equal(new Set(ids).size, 31, 'AC 编号不得重复')
  for (let i = 1; i <= 31; i++) {
    const id = `AC-${String(i).padStart(2, '0')}`
    assert.ok(ids.includes(id), `缺少 ${id}`)
  }

  // 汇总表声明值必须与明细实际统计逐项一致（防止夸大或漏改）
  const summary = {}
  for (const line of md.split('\n')) {
    const matched = /^\|\s*`(本地已验证|部署后验证|未验证)`\s*\|\s*\*\*(\d+)\*\*\s*\|/.exec(line)
    if (matched) summary[matched[1]] = Number(matched[2])
  }
  assert.equal(Object.keys(summary).length, 3, '汇总表应分别声明三种状态的条数')
  for (const token of legal) {
    assert.equal(
      counts[token] || 0,
      summary[token],
      `${token} 汇总表声明 ${summary[token]} 条，与明细实际统计 ${counts[token] || 0} 条不一致`
    )
  }
  assert.equal(
    legal.reduce((sum, token) => sum + (counts[token] || 0), 0),
    31,
    '三种状态条数之和应等于 31'
  )
})
