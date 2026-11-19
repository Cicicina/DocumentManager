/**
 * 手机端编辑栏调整回归测试：
 *  1) 文档操作栏：插入图片→图片、阅读/编辑合并为单一切换按钮；
 *  2) 编辑器格式栏：默认顺序与 md-editor-v3 allToolbar 一致、归一化去重/过滤/补齐、
 *     buildToolbars 末尾追加「更多」索引；
 *  3) 云端 setToolbarOrder 鉴权 + 归一化 + getConfig 回读；
 *  4) mm-md-editor 模板/脚本契约：defToolbars 插槽、toolbars prop、拖动排序、保存接线。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { loadEsm, readText } = require('./helpers/load-esm.js')
const { createMockUniCloud } = require('./helpers/mock-unicloud.js')
const { loadCloudObject, callObject } = require('./helpers/cloud-env.js')
const uniIdStub = require('./helpers/stubs/uni-id-common.js')

const ANON = '__anonymous__'

test.beforeEach(() => {
  uniIdStub.__reset()
})

// ---------------------------------------------------------------------------
// 文档操作栏契约
// ---------------------------------------------------------------------------

test('index.vue：图片按钮文案为「图片」，阅读/编辑合并为单个 toggleMode 按钮', () => {
  const src = readText('pages/index/index.vue')
  const modeBlock = src.slice(src.indexOf('<view class="mm-mode">'), src.indexOf('<view class="mm-content">'))

  // 旧的「插入图片」文案与两个 mm-mode__item 必须消失
  assert.doesNotMatch(modeBlock, />\s*插入图片\s*</, '按钮文案应缩短为「图片」')
  assert.doesNotMatch(modeBlock, /class="mm-mode__item"/, '不应再有独立的阅读/编辑 item')

  // 新的合并按钮：class + @click + 文字 + icon
  assert.match(modeBlock, /class="mm-mode__switch"/, '应有合并切换按钮')
  assert.match(modeBlock, /@click="toggleMode"/, '合并按钮单击调用 toggleMode')
  assert.match(modeBlock, />\s*图片\s*</, '图片按钮文案')
  assert.match(modeBlock, />\s*大纲\s*</)
  assert.match(modeBlock, />\s*分享\s*</)
  assert.match(modeBlock, />\s*预览\s*</)

  // toggleMode 单击在 read/edit 间互切，且只读分享时不动
  const funcStart = src.indexOf('function toggleMode()')
  assert.notEqual(funcStart, -1, '应定义 toggleMode')
  const func = src.slice(funcStart, src.indexOf('\n}', funcStart) + 2)
  assert.match(func, /if \(shareReadOnly\.value\) return/, '只读分享不切换')
  assert.match(func, /mode\.value = mode\.value === 'read' \? 'edit' : 'read'/, 'read/edit 互切')
})

// ---------------------------------------------------------------------------
// 工具栏顺序工具
// ---------------------------------------------------------------------------

test('editor-toolbar：默认顺序与 md-editor-v3 allToolbar 逐项一致', async () => {
  const util = await loadEsm('common/utils/editor-toolbar.js')
  const configSrc = readText('node_modules/md-editor-v3/lib/es/chunks/config.mjs')
  const block = configSrc.slice(configSrc.indexOf('const allToolbar = ['))
  const arrText = block.slice(block.indexOf('['), block.indexOf(']') + 1)
  // 去掉 JS 字符串引号后按逗号切
  const lib = arrText.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  assert.deepEqual(util.DEFAULT_TOOLBAR_ORDER, lib, '前端默认顺序应与 md-editor-v3 一致')
  assert.equal(util.MORE_TOOLBAR_INDEX, 0, '更多按钮固定用 defToolbars 索引 0')
})

test('editor-toolbar：normalizeToolbarOrder 去重、过滤未知、补齐缺失', async () => {
  const { normalizeToolbarOrder, DEFAULT_TOOLBAR_ORDER } = await loadEsm('common/utils/editor-toolbar.js')
  const full = normalizeToolbarOrder([])
  assert.equal(full.length, DEFAULT_TOOLBAR_ORDER.length, '默认输入应保持 33 项（含重复分隔线）')

  // 非法输入回退默认
  assert.deepEqual(normalizeToolbarOrder(null), full)
  assert.deepEqual(normalizeToolbarOrder('bold'), full)
  assert.deepEqual(normalizeToolbarOrder({}), full)

  // 去重 + 过滤未知 + 补齐：自定义顺序保序，未知项剔除，缺失按钮追加
  const result = normalizeToolbarOrder(['save', 'bold', 'bold', 'NOT_A_KEY', 'image'])
  assert.equal(result[0], 'save')
  assert.equal(result[1], 'bold')
  assert.equal(result[2], 'image')
  assert.equal(result.filter(k => k === 'bold').length, 1, 'bold 只出现一次')
  assert.equal(result.includes('NOT_A_KEY'), false, '未知 key 被过滤')
  assert.equal(new Set(result).size, result.length, '结果无重复')

  // 所有按钮 key（非分隔符）都补齐到位
  const buttons = DEFAULT_TOOLBAR_ORDER.filter(k => k !== '-' && k !== '=')
  for (const key of buttons) {
    assert.equal(result.filter(k => k === key).length, 1, `${key} 应恰好出现一次`)
  }
})

test('editor-toolbar：buildToolbars 在末尾追加更多按钮索引', async () => {
  const { buildToolbars, normalizeToolbarOrder, MORE_TOOLBAR_INDEX } =
    await loadEsm('common/utils/editor-toolbar.js')
  const bars = buildToolbars(['save', 'bold'])
  assert.equal(bars[bars.length - 1], MORE_TOOLBAR_INDEX, '更多按钮在工具条最右')
  assert.equal(bars.length, normalizeToolbarOrder(['save', 'bold']).length + 1)
})

test('前后端工具栏默认顺序清单逐项一致（防止漂移）', async () => {
  const util = await loadEsm('common/utils/editor-toolbar.js')
  const cloudSrc = readText('uniCloud-alipay/cloudfunctions/mm-settings/index.obj.js')
  const start = cloudSrc.indexOf('const DEFAULT_TOOLBAR_ORDER = [')
  const block = cloudSrc.slice(start)
  const arrText = block.slice(block.indexOf('['), block.indexOf(']') + 1)
  const cloud = arrText.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  assert.deepEqual(cloud, util.DEFAULT_TOOLBAR_ORDER, '云侧与前端默认顺序必须一致')
})

// ---------------------------------------------------------------------------
// 云端 getConfig / setToolbarOrder
// ---------------------------------------------------------------------------

function makeEnv() {
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config',
    account_enabled: true,
    permission_enabled: false,
    admin_user_id: '',
    root_name: '',
    root_icon: null
  })
  return mock
}

test('getConfig：toolbar_order 从原始配置文档回读，无需登录', async () => {
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config', account_enabled: true, permission_enabled: false,
    admin_user_id: '', root_name: '', root_icon: null,
    toolbar_order: ['save', 'bold', 'image']
  })
  const obj = loadCloudObject('mm-settings', mock)
  const res = await callObject(obj, 'getConfig')
  assert.equal(res.errCode, 0)
  assert.equal(res.data.toolbar_order[0], 'save', '应回读用户保存的顺序')
  assert.equal(res.data.toolbar_order.filter(k => k !== '-' && k !== '=').length, 29,
    '缺失按钮被补齐（29 个按钮，分隔符按用户顺序保留）')
})

test('setToolbarOrder：匿名放行，归一化后写回并可从 getConfig 读回', async () => {
  const mock = makeEnv()
  const obj = loadCloudObject('mm-settings', mock)
  const token = uniIdStub.__login('token-anon', ANON)

  const res = await callObject(obj, 'setToolbarOrder',
    { order: ['save', 'bold', 'bold', 'BAD_KEY'] }, { token })
  assert.equal(res.errCode, 0, `保存失败：${res.errMsg}`)
  assert.equal(res.data.toolbar_order[0], 'save')
  assert.equal(res.data.toolbar_order.filter(k => k === 'bold').length, 1)
  assert.equal(res.data.toolbar_order.includes('BAD_KEY'), false)

  const again = await callObject(obj, 'getConfig')
  assert.equal(again.data.toolbar_order[0], 'save', '顺序应持久化到配置文档')
})

test('setToolbarOrder：order 非数组时返回 1001 且不落库', async () => {
  const mock = makeEnv()
  const obj = loadCloudObject('mm-settings', mock)
  const token = uniIdStub.__login('token-anon', ANON)
  const res = await callObject(obj, 'setToolbarOrder', { order: 'save,bold' }, { token })
  assert.equal(res.errCode, 1001)
})

test('setToolbarOrder：权限开启时非管理员被拒（1003）', async () => {
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config', account_enabled: true, permission_enabled: true,
    admin_user_id: 'u1', root_name: '', root_icon: null, toolbar_order: []
  })
  mock.__seed('mm-user-permissions', {
    user_id: 'u2', role: 'user', can_read: true, can_write: true
  })
  const obj = loadCloudObject('mm-settings', mock)
  const token = uniIdStub.__login('token-u2', 'u2')
  const res = await callObject(obj, 'setToolbarOrder', { order: ['save'] }, { token })
  assert.equal(res.errCode, 1003, '非管理员不能改全局工具栏顺序')
})

// ---------------------------------------------------------------------------
// mm-md-editor 契约
// ---------------------------------------------------------------------------

test('mm-md-editor：绑定 :toolbars，defToolbars 插槽放「更多」，拖动排序并保存', () => {
  const src = readText('components/mm-md-editor/mm-md-editor.vue')

  assert.match(src, /:toolbars="mdToolbars"/, '应把排序后的顺序传给 MdEditor')
  assert.match(src, /<template #defToolbars>/, '应提供自定义工具栏插槽')
  assert.match(src, /mm-editor__tool-more/, '插槽里放「更多」按钮')
  assert.match(src, /@click="openToolbarPanel"/, '更多按钮打开排序面板')

  // 拖动排序：绑定 pointerdown/touchstart 与 data-drag-index
  assert.match(src, /@pointerdown="startToolbarDrag\(\$event, item, index\)"/)
  assert.match(src, /@touchstart="startToolbarDrag\(\$event, item, index\)"/)
  assert.match(src, /:data-drag-index="index"/)

  // useImageDragSort 接线 + 保存回调 + 云端写入
  assert.match(src, /useImageDragSort\(/, '复用触屏拖动排序')
  assert.match(src, /setToolbarOrder\(\{ order \}\)/, '提交时写入云端')
  assert.match(src, /store\.setConfig\(res\.data\)/, '保存成功后同步本地 store')
  assert.match(src, /function resetToolbarOrder\(\)/, '提供恢复默认')
})

test('mm-md-editor：mdToolbars 基于 store.config.toolbar_order 构建', () => {
  const src = readText('components/mm-md-editor/mm-md-editor.vue')
  assert.match(src, /buildToolbars\(store\.state\.config\.toolbar_order\)/,
    '工具条顺序应来自全局配置（App.vue 启动时从云端读取）')
})
