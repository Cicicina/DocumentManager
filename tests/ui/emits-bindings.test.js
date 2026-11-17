/**
 * 组件事件与 prop 绑定双向一致性（回归锁：R2 漏掉的 `@create` vs `emit('add')` 一类缺陷）。
 *
 * 两个方向都扫：
 * A. **致命**：模板上 `@xxx` 绑定了某组件，但该组件既没 `defineEmits('xxx')` 也没 `emit('xxx')`
 *    → 该绑定永远不会触发（R2 的 `@create` 就是这一类）。
 * B. **提示**：组件声明/触发了事件，但全项目没有任何绑定点 → 功能可能没接上（部分是有意的，
 *    如 mm-loading 的 `finish`、mm-file-list 的 `sort-change`），只作为诊断信息列出，不判失败。
 *
 * 事件名在比较前统一归一化为 camelCase，兼容 Vue 3 的 `@batch-delete` ↔ `emit('batch-delete')`、
 * `@update-config` ↔ `emit('update-config')` 以及 `v-model:visible` ↔ `emit('update:visible')`。
 */

'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

/** 事件名归一化：kebab / 冒号形式统一成 camelCase */
function normalizeEvent(name) {
  return String(name).replace(/[-:](\w)/g, (matched, ch) => ch.toUpperCase())
}

/** 列出全部业务组件（components/mm-*） */
function componentNames() {
  const dir = path.join(ROOT, 'components')
  return fs.readdirSync(dir)
    .filter(entry => entry.startsWith('mm-') && fs.statSync(path.join(dir, entry)).isDirectory())
    .filter(entry => fs.existsSync(path.join(dir, entry, `${entry}.vue`)))
}

/** 解析组件声明的事件（defineEmits 数组形式） */
function declaredEvents(source) {
  const matched = /defineEmits\(\[([\s\S]*?)\]\)/.exec(source)
  if (!matched) return []
  return Array.from(matched[1].matchAll(/['"]([^'"]+)['"]/g)).map(m => m[1])
}

/** 解析组件实际 emit 的事件名 */
function emittedEvents(source) {
  const names = new Set()
  for (const matched of source.matchAll(/\bemit\(\s*['"]([^'"]+)['"]/g)) names.add(matched[1])
  for (const matched of source.matchAll(/\$emit\(\s*['"]([^'"]+)['"]/g)) names.add(matched[1])
  return Array.from(names)
}

/** 页面里所有 mm-* 组件的使用点：[{ tag, boundEvents:Set }] */
function usagesIn(source) {
  const usages = []
  for (const matched of source.matchAll(/<(mm-[a-z0-9-]+)([\s\S]*?)\/?>/g)) {
    const tag = matched[1]
    const attrs = matched[2]
    const bound = new Set()

    // @event / @event.modifier
    for (const attr of attrs.matchAll(/\s@([a-zA-Z0-9:-]+)(?:\.[a-zA-Z]+)*\s*=/g)) {
      bound.add(normalizeEvent(attr[1]))
    }
    // v-model:xxx → update:xxx ；v-model → update:modelValue
    for (const attr of attrs.matchAll(/\sv-model:([a-zA-Z0-9-]+)(?:\.[a-zA-Z]+)*\s*=/g)) {
      bound.add(normalizeEvent(`update:${attr[1]}`))
    }
    if (/\sv-model(?:\.[a-zA-Z]+)*\s*=/.test(attrs)) bound.add(normalizeEvent('update:modelValue'))

    usages.push({ tag, bound })
  }
  return usages
}

/** 需要扫描「组件使用点」的文件：pages.json 注册的页面 + 所有业务组件 */
function usageFiles() {
  const pages = JSON.parse(readText('pages.json'))
  const files = pages.pages
    .map(item => `${item.path}.vue`)
    .filter(file => file.startsWith('pages/'))
  for (const name of componentNames()) files.push(`components/${name}/${name}.vue`)
  return files
}

test('A. 模板上绑定的事件，组件必须真的声明或触发（防死绑定）', (t) => {
  const contract = {}
  for (const name of componentNames()) {
    const source = readText(`components/${name}/${name}.vue`)
    const all = new Set([...declaredEvents(source), ...emittedEvents(source)].map(normalizeEvent))
    contract[name] = all
  }

  const dead = []
  for (const file of usageFiles()) {
    for (const usage of usagesIn(readText(file))) {
      const all = contract[usage.tag]
      if (!all) {
        dead.push(`${file} 使用了不存在的组件 <${usage.tag}>`)
        continue
      }
      for (const event of usage.bound) {
        if (!all.has(event)) {
          dead.push(`${file} → <${usage.tag}> 绑定了 @${event}，但组件既未 defineEmits 也未 emit 该事件`)
        }
      }
    }
  }

  t.diagnostic(`扫描组件 ${Object.keys(contract).length} 个；使用点文件 ${usageFiles().length} 个`)
  assert.deepEqual(dead, [], `以下事件绑定永远不会触发：\n${dead.join('\n')}`)
})

test('B. 组件声明/触发但全项目无绑定的事件（仅诊断，不判失败）', (t) => {
  const bound = new Set()
  for (const file of usageFiles()) {
    for (const usage of usagesIn(readText(file))) {
      for (const event of usage.bound) bound.add(`${usage.tag}.${event}`)
    }
  }

  const unbound = []
  for (const name of componentNames()) {
    const source = readText(`components/${name}/${name}.vue`)
    const triggered = new Set([...declaredEvents(source), ...emittedEvents(source)].map(normalizeEvent))
    for (const event of triggered) {
      if (!bound.has(`${name}.${event}`)) unbound.push(`${name}.${event}`)
    }
  }

  t.diagnostic(`无绑定点的事件（多为有意不接，如 mm-loading.finish / mm-file-list.sortChange）：\n  ${unbound.join('\n  ') || '（无）'}`)
  // 只要求「有诊断输出」，不做强断言；真正的致命问题由用例 A 拦截
  assert.ok(Array.isArray(unbound))
})

test('mm-annotation 的四个事件与 activeCommentId 均已正确接线（R2 缺陷回归锁）', () => {
  const source = readText('components/mm-annotation/mm-annotation.vue')
  const declared = declaredEvents(source).map(normalizeEvent).sort()
  assert.deepEqual(declared, ['add', 'locate', 'remove', 'update'],
    'mm-annotation 应声明 add / update / remove / locate 四个事件')

  const page = readText('pages/index/index.vue')
  const annotationUsage = usagesIn(page).filter(usage => usage.tag === 'mm-annotation')
  assert.ok(annotationUsage.length >= 1, '主壳应使用 mm-annotation')

  for (const usage of annotationUsage) {
    for (const event of ['add', 'update', 'remove', 'locate']) {
      assert.ok(usage.bound.has(event), `主壳应绑定 @${event}`)
    }
  }

  // prop 名必须与组件声明一致（R2 的 :active-id 缺陷不得回归）
  assert.match(page, /<mm-annotation[\s\S]*?:active-comment-id="activeCommentId"/,
    '应使用 :active-comment-id 绑定，不能写成 :active-id')
  assert.match(source, /activeCommentId:\s*\{\s*type:\s*String/,
    'mm-annotation 应声明 activeCommentId prop')
})

test('三条 P0 链路的组件事件在 PC 与抽屉两处都已绑定（防单侧漏绑）', () => {
  const page = readText('pages/index/index.vue')

  // 按「PC 三栏」与「移动端抽屉」两个区块分别取使用点
  const pcStart = page.indexOf('<!-- PC 中栏：文件列表 -->')
  const drawerStart = page.indexOf('<!-- 移动端抽屉 -->')
  const popupEnd = page.indexOf('<!-- 通用输入弹层')
  assert.ok(pcStart > 0 && drawerStart > pcStart && popupEnd > drawerStart, '页面结构注释应保持可定位')

  const pcRegions = page.slice(0, drawerStart)
  const drawerRegion = page.slice(drawerStart, popupEnd)

  for (const [label, region] of [['PC 三栏', pcRegions], ['移动端抽屉', drawerRegion]]) {
    const listUsage = usagesIn(region).filter(usage => usage.tag === 'mm-file-list')
    const treeUsage = usagesIn(region).filter(usage => usage.tag === 'mm-folder-tree')
    assert.ok(listUsage.length >= 1, `${label} 应包含 mm-file-list`)
    assert.ok(treeUsage.length >= 1, `${label} 应包含 mm-folder-tree`)

    for (const usage of listUsage) {
      for (const event of ['rename', 'move', 'export']) {
        assert.ok(usage.bound.has(event), `${label} 的 mm-file-list 缺少 @${event} 绑定`)
      }
    }
    const treeMove = treeUsage.some(usage => usage.bound.has('move'))
    assert.ok(treeMove, `${label} 的 mm-folder-tree 缺少 @move 绑定`)
  }
})
