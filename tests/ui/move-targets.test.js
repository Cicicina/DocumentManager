/**
 * 「移动到…」候选置灰的行为级回归锁（R3 E-1 的修复验证）。
 *
 * R3 发现：`moveTargets` 用 `source.type === 'folder'` 判定「不能移动到自己的子目录」，
 * 但 `listTree` 当时不返回 `type`，导致该分支恒不命中。
 * 修复后有两道保险：① 云对象 `listTree` 的 `.field()` 加了 `type: 1`；
 * ② 前端 `handleMoveFolder` 用 `Object.assign({}, node, { type: 'folder' })` 显式补齐。
 *
 * 本文件把 `moveTargets` 这个 computed 的箭头函数体**从 .vue 源码里抽出来真实执行**，
 * 用假 source/tree 断言四类候选的 disabled / reason，而不是只看源码有没有那几行字。
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

/** 抽取 `function name(...) {...}` 的完整源码（含函数签名） */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start !== -1, `未找到函数 ${name}`)
  return source.slice(start, source.indexOf('{', start)) + sliceBraces(source, source.indexOf('{', start))
}

/** 取某个下标所在的整行（去首尾空白） */
function lineOf(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1
  const nextBreak = source.indexOf('\n', index)
  return source.slice(lineStart, nextBreak === -1 ? source.length : nextBreak).trim()
}

/** 从 openBrace 起按括号配平取一段源码 */
function sliceBraces(source, openBrace) {
  let depth = 0
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBrace, i + 1)
    }
  }
  throw new Error('大括号未闭合')
}

/** 抽取 `const name = computed(ARROW)` 里的 ARROW 源码 */
function extractComputedArrow(source, name) {
  const start = source.indexOf(`const ${name} = computed(`)
  assert.ok(start !== -1, `未找到 computed ${name}`)
  const arrowStart = source.indexOf('() => {', start)
  assert.ok(arrowStart > start, `未找到 ${name} 的箭头函数`)
  return source.slice(arrowStart, arrowStart + '() => '.length) +
    sliceBraces(source, arrowStart + '() => '.length)
}

/**
 * 构造可执行的 moveTargets。
 * @returns {(source:object, tree:object[]) => object[]}
 */
function buildMoveTargets() {
  const isDescendantSrc = extractFunction(PAGE, 'isDescendantOf')
  const arrowSrc = extractComputedArrow(PAGE, 'moveTargets')

  const factory = new Function(`
    ${isDescendantSrc}
    return function buildMoveTargets(sourceValue, treeValue) {
      const moveSource = { value: sourceValue }
      const store = { state: { tree: treeValue } }
      const moveTargets = (${arrowSrc})()
      return moveTargets
    }
  `)
  return factory()
}

/** 一棵固定形状的目录树：父目录 / ├子目录 / │└孙目录 / 另一目录 */
function sampleTree() {
  return [
    { _id: 'f1', type: 'folder', parent_id: '', name: '父目录', icon: null },
    { _id: 'f2', type: 'folder', parent_id: 'f1', name: '子目录', icon: null },
    { _id: 'f4', type: 'folder', parent_id: 'f2', name: '孙目录', icon: null },
    { _id: 'f3', type: 'folder', parent_id: '', name: '另一目录', icon: null }
  ]
}

/** 按名称取候选行 */
function row(list, name) {
  return list.find(item => item.name === name)
}

test('源=根目录下的文件夹：自身/子/孙目录置灰，根节点因「已在此目录」置灰', () => {
  const build = buildMoveTargets()
  const source = { _id: 'f1', type: 'folder', parent_id: '', name: '父目录' }
  const list = build(source, sampleTree())

  assert.equal(row(list, '父目录').disabled, true)
  assert.equal(row(list, '父目录').reason, '不能移动到自身')

  assert.equal(row(list, '子目录').disabled, true, '直接子目录必须置灰')
  assert.equal(row(list, '子目录').reason, '不能移动到自己的子目录')

  assert.equal(row(list, '孙目录').disabled, true, '更深层后代也必须置灰')
  assert.equal(row(list, '孙目录').reason, '不能移动到自己的子目录')

  assert.equal(row(list, '另一目录').disabled, false, '无关目录应可选')

  const root = row(list, '全部文档')
  assert.ok(root, '必须包含根节点「全部文档」')
  assert.equal(root.disabled, true, '源已在根目录，根节点应置灰（不再发无效 move）')
  assert.equal(root.reason, '已在此目录')
  assert.equal(root.current, true)
})

test('源=子目录：父目录与根节点可区分（父目录「已在此目录」、根节点可选）', () => {
  const build = buildMoveTargets()
  const source = { _id: 'f2', type: 'folder', parent_id: 'f1', name: '子目录' }
  const list = build(source, sampleTree())

  assert.equal(row(list, '子目录').disabled, true)
  assert.equal(row(list, '子目录').reason, '不能移动到自身')

  assert.equal(row(list, '父目录').disabled, true, '父目录就是当前所在目录')
  assert.equal(row(list, '父目录').reason, '已在此目录')

  assert.equal(row(list, '孙目录').disabled, true, '自己的子目录必须置灰')
  assert.equal(row(list, '孙目录').reason, '不能移动到自己的子目录')

  const root = row(list, '全部文档')
  assert.equal(root.disabled, false, '源不在根目录时根节点应可选')
  assert.equal(root.current, false)

  assert.equal(row(list, '另一目录').disabled, false)
})

test('源=文档：根节点按 parent_id 置灰，文件夹全部可选（文档无后代）', () => {
  const build = buildMoveTargets()
  const atRoot = build({ _id: 'doc1', type: 'file', parent_id: '', name: 'a.md' }, sampleTree())

  assert.equal(row(atRoot, '全部文档').disabled, true, '文档已在根目录 → 根节点置灰')
  assert.equal(row(atRoot, '全部文档').reason, '已在此目录')
  for (const name of ['父目录', '子目录', '孙目录', '另一目录']) {
    assert.equal(row(atRoot, name).disabled, false, `文档可以移动到 ${name}`)
  }

  const inFolder = build({ _id: 'doc1', type: 'file', parent_id: 'f2', name: 'a.md' }, sampleTree())
  assert.equal(row(inFolder, '全部文档').disabled, false)
  assert.equal(row(inFolder, '子目录').disabled, true, '文档所在目录应置灰')
  assert.equal(row(inFolder, '子目录').reason, '已在此目录')
})

test('后代替灰依赖 source.type：这正是 R3 E-1 的根因，已由 handleMoveFolder 补齐', () => {
  const build = buildMoveTargets()
  const tree = sampleTree()

  // 未经 handleMoveFolder 处理、且 listTree 不返回 type 的旧形态 → 后代替灰失效
  const legacy = build({ _id: 'f1', parent_id: '', name: '父目录' }, tree)
  assert.equal(row(legacy, '子目录').disabled, false,
    '缺 type 时后代替灰失效（R3 E-1 的原始缺陷形态，留作对照）')

  // 经 handleMoveFolder 补齐 type 后 → 后代替灰生效
  const fixed = build(Object.assign({}, { _id: 'f1', parent_id: '', name: '父目录' }, { type: 'folder' }), tree)
  assert.equal(row(fixed, '子目录').disabled, true, '补 type 后后代替灰应生效')

  // 真实链路确实做了补齐
  assert.match(PAGE, /moveSource\.value = Object\.assign\(\{\}, node, \{ type: 'folder' \}\)/,
    'handleMoveFolder 必须显式补 type，不能只依赖 listTree 的字段投影')
})

test('handleMoveFolder 复制后 _id / parent_id 仍完整，chooseMoveTarget 传参正确', async () => {
  // 复制不会丢字段
  const node = { _id: 'f2', type: 'folder', parent_id: 'f1', name: '子目录', icon: null }
  const copied = Object.assign({}, node, { type: 'folder' })
  assert.equal(copied._id, 'f2')
  assert.equal(copied.parent_id, 'f1')
  assert.equal(copied.name, '子目录')

  // chooseMoveTarget 读 source._id，且把根节点映射为空 parent_id
  assert.match(PAGE, /move\(\{ file_id: source\._id, parent_id: target\._id \|\| '' \}\)/,
    '必须用 source._id 传 file_id，根节点 target._id 为空串')

  // 用真实云对象跑一次正常移动，确认链路未被破坏
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config', account_enabled: false, permission_enabled: false,
    admin_user_id: '', updated_by: '', updated_at: new Date()
  })
  const owner = '__anonymous__'
  const base = {
    type: 'folder', user_id: owner, parent_id: '', name: '父目录', extension: '',
    storage_key: '', size: 0, content_hash: '', tags: [], icon: null,
    version: 0, is_delete: false, created_at: new Date(), updated_at: new Date()
  }
  const parent = mock.__seed('mm-files', base)
  const child = mock.__seed('mm-files', Object.assign({}, base, { parent_id: parent._id, name: '子目录' }))

  const mmFile = loadCloudObject('mm-file', mock)
  const moved = await callObject(mmFile, 'move', { file_id: child._id, parent_id: '' })
  assert.equal(moved.errCode, 0, moved.errMsg)
  assert.equal(moved.data.parent_id, '', '移动到根目录后 parent_id 应为空串')
  assert.equal(moved.data._id, child._id, '移动不应改变 _id')
  assert.equal(moved.data.name, '子目录', '同目录无冲突时不应改写名称')
})

test('listTree 返回 type 后，目录树组件与 store.setTree 不会误判', () => {
  const treeSrc = fs.readFileSync(path.join(ROOT, 'components', 'mm-folder-tree', 'mm-folder-tree.vue'), 'utf8')
  const storeSrc = fs.readFileSync(path.join(ROOT, 'common', 'store', 'index.js'), 'utf8')
  const page = PAGE

  // 目录树只对 icon.type 做判定，不读 node.type
  for (const matched of treeSrc.matchAll(/\.type\s*[=!]==?\s*['"][a-z]+['"]/g)) {
    const line = lineOf(treeSrc, matched.index)
    assert.match(line, /icon\.type/, `目录树里出现了非 icon.type 的类型判定：${line}`)
  }
  // 图标解析只走 icon 子对象
  assert.match(treeSrc, /function iconSrc\(node\)[\s\S]*?const icon = node && node\.icon/,
    'iconSrc 应从 node.icon 取图标，与新增的 node.type 无关')

  // store.setTree 只做数组赋值，不做类型筛选
  assert.match(storeSrc, /function setTree\(tree\) \{\s*state\.tree = Array\.isArray\(tree\) \? tree : \[\]\s*\}/,
    'setTree 不得按 type 过滤（否则会丢失新增字段或误删节点）')

  // 主壳里对 .type 的判定只允许出现在 icon.type 与 moveTargets 的 source.type
  for (const matched of page.matchAll(/\.type\s*[=!]==?\s*['"][a-z]+['"]/g)) {
    const line = lineOf(page, matched.index)
    const allowed = /icon\.type/.test(line) || /source\.type === 'folder'/.test(line)
    assert.ok(allowed, `主壳出现未预期的类型判定：${line}`)
  }
})
