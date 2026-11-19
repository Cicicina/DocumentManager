/**
 * 三条 P0 链路（导出 / 移动 / 改名）的源码级回归锁。
 *
 * 这三条在 R2 被判「未接线」，R3 由工程师补齐。本文件的目的是把关键分支顺序与
 * 早退条件固定下来，防止后续重构时悄悄退化：
 * - 导出：content 为空 → fetch(tempUrl) → 仍为空则提示并 return（**不得产出空文件**），
 *   且 mm-image:// 必须替换成显示态后才交给 downloadMarkdown；
 * - 移动：自身 / 后代 / 当前目录三类非法目标必须置灰并给出原因，disabled 目标必须早退；
 * - 改名：改的是当前打开文档时必须同步 store.currentFile.name（否则顶部标题与列表不一致）。
 *
 * 说明：三个 handler 都在 SFC 内并依赖 uni / store / api，无法直接单测，
 * 因此采用「读源码 + 定位 + 顺序断言」的方式锁定结构；行为正确性另有 emits-bindings
 * 用例保证事件确实接通。
 */

'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createMockUniCloud } from '../helpers/mock-unicloud.js'
import { loadCloudObject, callObject } from '../helpers/cloud-env.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const PAGE = fs.readFileSync(path.join(ROOT, 'pages', 'index', 'index.vue'), 'utf8').replace(/\r\n/g, '\n')

/** 取一个具名函数/常量的源码片段（按大括号配平；兼容 function 声明与 const = computed(() => {...})） */
function functionOf(source, name) {
  const markers = [`async function ${name}(`, `function ${name}(`, `const ${name} = `]
  let start = -1
  for (const marker of markers) {
    start = source.indexOf(marker)
    if (start !== -1) break
  }
  assert.ok(start !== -1, `未找到函数 ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`函数 ${name} 大括号未闭合`)
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

test('导出链路：exportFile → tempUrl 兜底 → 空内容中止 → 显示态替换 → downloadMarkdown', () => {
  const body = functionOf(PAGE, 'handleExport')

  const idxExport = body.indexOf('exportFile(')
  const idxFetch = body.indexOf('fetch(res.data.tempUrl)')
  // 空内容提示改为 error 类型（wot 错误图标），兼容旧的 show 写法
  const idxGuard = body.search(/toast\.(?:error|show)\('导出失败，请重试'\)/)
  const idxResolve = body.indexOf('resolveImageUrlsForText(')
  const idxReplace = body.indexOf('mm-image:\\/\\/')
  const idxDownload = body.indexOf('downloadMarkdown(')

  assert.ok(idxExport !== -1, '应调用 exportFile')
  assert.ok(idxFetch > idxExport, 'content 为空时应走 fetch(tempUrl) 兜底')
  assert.ok(idxGuard > idxFetch, '兜底后仍为空必须提示并中止（不得产出空文件）')
  assert.ok(idxResolve > idxGuard, '中止判断必须在换取图片 URL 之前')
  assert.ok(idxReplace > idxResolve, '应把 mm-image:// 替换为显示态临时 URL')
  assert.ok(idxDownload > idxReplace, 'downloadMarkdown 必须拿到已替换的显示态内容')

  // 早退：兜底失败后必须 return，不落盘
  const guardBlock = body.slice(idxGuard, idxResolve)
  assert.match(guardBlock, /return/, '空内容分支必须 return，不能继续导出')

  // 存储态 token 不得原样写进导出文件（有映射时才替换，但替换逻辑必须存在）
  assert.match(body, /urlMap\[fileId\] \|\| matched/, '无临时 URL 时应保留原 token 而不是变成 undefined')
})

test('导出使用服务端返回的文件名，缺失时回退列表项名称', () => {
  const body = functionOf(PAGE, 'handleExport')
  assert.match(body, /downloadMarkdown\(\s*res\.data\.name \|\| file\.name/, '文件名应优先用服务端返回值')
})

// ---------------------------------------------------------------------------
// 移动
// ---------------------------------------------------------------------------

test('移动弹层：三类非法目标均置灰并给出原因，根节点可选', () => {
  const body = functionOf(PAGE, 'moveTargets')

  assert.match(body, /folder\._id === source\._id/, '必须拦截「移动到自身」')
  assert.match(body, /不能移动到自身/)
  assert.match(body, /isDescendantOf\(folder\._id, source\._id, folders\)/, '必须拦截「移动到自己的子目录」')
  assert.match(body, /不能移动到自己的子目录/)
  assert.match(body, /已在此目录/, '必须标注并拦截「已在当前目录」')

  // 根节点（_id 为空串）必须出现在候选里
  assert.match(body, /_id: ''/, '根目录「全部文档」应作为可选目标')
  assert.match(body, /name: '全部文档'/)
})

test('isDescendantOf：沿 parent_id 上溯判定后代，且带深度上限防环', () => {
  const body = functionOf(PAGE, 'isDescendantOf')
  assert.match(body, /node\.parent_id === ancestorId/, '应以 parent_id 链判定祖先关系')
  assert.match(body, /depth < \d+/, '应有深度上限，避免脏数据成环导致死循环')
})

test('listTree 返回的节点必须带 type：否则「移动到自己的子目录」置灰失效', async () => {
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config', account_enabled: false, permission_enabled: false,
    admin_user_id: '', updated_by: '', updated_at: new Date()
  })
  const owner = '__anonymous__'
  const baseFolder = {
    type: 'folder', user_id: owner, parent_id: '', name: '父目录', extension: '',
    storage_key: '', size: 0, content_hash: '', tags: [], icon: null,
    version: 0, is_delete: false, created_at: new Date(), updated_at: new Date()
  }
  const parent = mock.__seed('mm-files', baseFolder)
  mock.__seed('mm-files', Object.assign({}, baseFolder, { parent_id: parent._id, name: '子目录' }))

  const mmFile = loadCloudObject('mm-file', mock)
  const res = await callObject(mmFile, 'listTree', {})
  assert.equal(res.errCode, 0, res.errMsg)
  assert.ok(res.data.length >= 2, '应返回至少两个文件夹节点')

  // 前端 moveTargets 用 `source.type === 'folder'` 判定后代替灰（index.vue handleMoveFolder → moveTargets）。
  // listTree 若不返回 type，该判定恒为 false，「不能移动到自己的子目录」不会置灰，
  // 用户可点选后代目录，最终只能靠服务端 4003 拒绝（无数据损坏，但交互与文案失效）。
  const missing = res.data.filter(node => !Object.prototype.hasOwnProperty.call(node, 'type'))
  assert.deepEqual(missing.map(node => node.name), [],
    `listTree 未返回 type 字段：${missing.map(node => node.name).join(', ')}；` +
    '会导致前端文件夹「移动到自己的子目录」置灰失效')
})

test('移动执行：disabled 目标早退，成功后刷新目录树与当前目录列表', () => {
  const body = functionOf(PAGE, 'chooseMoveTarget')
  assert.match(body, /if \(!source \|\| !target \|\| target\.disabled\) return/, '置灰目标必须早退，不发起请求')
  assert.match(body, /move\(\{ file_id: source\._id, parent_id: target\._id \|\| '' \}\)/, '应调用 move 并把根节点视为空 parent_id')
  assert.match(body, /move\(\{ file_id: source\._id, parent_id: target\._id \|\| '' \}\)/, '应调用 move 并把根节点视为空 parent_id')
  // 刷新链路抽成统一函数：内部仍必须同时刷新目录树、当前目录与展开目录缓存
  assert.match(body, /await reloadDirectoryAfterChange\(\)/, '成功后应刷新目录')
  assert.match(PAGE, /async function reloadDirectoryAfterChange\(\)[\s\S]*?await loadTree\(\)[\s\S]*?await loadFiles\(currentFolderId\.value\)[\s\S]*?await reconcileExpandedFolders\(\)/,
    '统一刷新函数必须覆盖目录树、当前目录与展开目录')
})

test('移动入口：文档与文件夹都能唤起同一弹层', () => {
  const fileBody = functionOf(PAGE, 'handleMoveFile')
  const folderBody = functionOf(PAGE, 'handleMoveFolder')
  for (const [label, body] of [['handleMoveFile', fileBody], ['handleMoveFolder', folderBody]]) {
    assert.match(body, /moveSource\.value = /, `${label} 应记录移动源`)
    assert.match(body, /moveVisible\.value = true/, `${label} 应打开移动弹层`)
  }
})

// ---------------------------------------------------------------------------
// 改名
// ---------------------------------------------------------------------------

test('改名：改的是当前打开文档时同步 currentFile.name（顶部标题依赖它）', () => {
  const body = functionOf(PAGE, 'handleRenameFile')

  assert.match(body, /rename\(\{ file_id: file\._id, name \}\)/, '应调用 rename')
  assert.match(body, /res\.data\.name/, '应用服务端返回的最终名称（可能已追加 -copyN）')

  const idxGuard = body.indexOf('store.state.currentFile._id === file._id')
  assert.ok(idxGuard !== -1, '命中当前打开文档时应做同步分支')
  const idxSync = body.indexOf('store.openFile(')
  assert.ok(idxSync > idxGuard, '同步分支内应调用 store.openFile 更新 currentFile')
  assert.match(body, /name: res\.data\.name/, '同步时要写入服务端返回的名称')

  // currentTitle 读的是 currentFile.name
  assert.match(PAGE, /const currentTitle = computed\(\(\) => \{[\s\S]*?file \? file\.name :/, '顶部标题必须读 currentFile.name')
})

test('改名：取消或名称未变化时不发请求', () => {
  const body = functionOf(PAGE, 'handleRenameFile')
  assert.match(body, /if \(!name \|\| name === file\.name\) return/, '空名称或未改名应早退')
})
