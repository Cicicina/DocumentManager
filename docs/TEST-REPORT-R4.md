# 测试报告 R4 · 快速回归（第 4 轮 · 终轮）

> 角色：QA（严过关）｜ 项目：MarkdownManager ｜ 范围：**只验本轮 7 处改动**，不重做全量验收
> 基线：`docs/TEST-REPORT-R3.md`（上一轮结论与 E-1/N-1~N-6）
> 本轮**未修改任何业务源码**，新增 1 个测试文件（6 用例）与本报告。
> H5 真实编译由主理人并行执行，本轮不重复编译、不因「未编译」判失败。

---

## 0. 执行结果

```text
$ node --test "tests/**/*.test.js"        # 不加 --test-force-exit
1..185
# tests 185
# pass 185
# fail 0
duration_ms 476.353
real        0m0.594s
```

| 项 | 结果 |
| --- | --- |
| 用例总数 | **185**（工程师报的 179 是上一轮我建的基线；本轮我新增 `tests/ui/move-targets.test.js` 6 条 → 179 + 6 = 185） |
| 通过 / 失败 | **185 / 0** |
| 耗时 | **0.594s**（R3 时同样命令为 **30.4s**，`unref` 修复生效，见 §2.1） |
| R3 那条红灯 `p0-chains.test.js:5` | **已转绿**，且断言**一字未改**（证据见 §1.3） |

### 六项结论速览

| # | 验证项 | 结论 |
| --- | --- | --- |
| 1 | P2 是否真修好 | ✅ 双保险都在（`listTree` 加 `type: 1` + `handleMoveFolder` 显式补），实测 `listTree` 已返回 `type: 'folder'` |
| 2 | 6 条打磨 | ✅ 6/6 全部落实，逐条有证据 |
| 3 | 回归测试 + `type` 新字段是否引起误判 | ✅ 185/185、0.594s；`type` 未引起任何误判（已用行为测试锁定） |
| 4 | 是否引入新问题 | ✅ 无。复制后 `_id`/`parent_id` 完整，真实 `move` 走通 |
| 5 | 契约 ↔ emits ↔ 绑定 三方一致 | ⚠️ 代码与绑定**完全一致**（0 死绑定）；契约有 **1 处滞后**（`mm-md-editor.ready`），非阻塞 |
| 6 | 红线 | ✅ rpx 0 / 硬编码色 0 / 前端 `uniCloud.database()` 0 |

---

## 1. P2（R3 E-1）是否真修好 —— ✅ 已修复，双保险

### 1.1 两处修复都在

| 位置 | 改动 | 证据 |
| --- | --- | --- |
| 云对象 `mm-file.listTree` | `.field()` 增加 `type: 1` | `uniCloud-alipay/cloudfunctions/mm-file/index.obj.js`：`.field({ _id: 1, **type: 1**, user_id: 1, parent_id: 1, name: 1, icon: 1, created_at: 1, updated_at: 1 })`，且带注释说明「缺该字段会让拦截恒为 false（服务端 4003 仍兜底）」 |
| 前端 `handleMoveFolder` | 显式补类型 | `pages/index/index.vue:594` `moveSource.value = Object.assign({}, node, { type: 'folder' })` |

### 1.2 用真实云对象代码 + Mock 重跑 `listTree`

```text
节点数: 2
返回字段: _id,created_at,icon,name,parent_id,type,updated_at,user_id
 - 子目录 | type= "folder" | parent_id= "mock_id_2"
 - 父目录 | type= "folder" | parent_id= ""
全部含 type: true
```

**R3 的 `是否含 type: false` 已变为 `true`**，字段清单里 `type` 已出现。

### 1.3 R3 红灯转绿，且断言一字未改

**mtime 证据**（`ls --time-style=full-iso`）：

| 文件 | 修改时间 |
| --- | --- |
| `tests/ui/p0-chains.test.js` | 21:05:22（我 R3 写完后未再变动） |
| `uniCloud-alipay/.../mm-file/index.obj.js` | 21:07:39 |
| `pages/index/index.vue` | 21:07:52 |
| `common/utils/upload.js` | 21:07:59 |
| `components/mm-md-editor/mm-md-editor.vue` | 21:08:05 |
| `docs/COMPONENT-CONTRACT.md` / `docs/DEPLOY.md` | 21:08:37 / 21:08:49 |

→ 测试文件**早于**全部业务改动 2 分 17 秒以上，**工程师没有碰过它**。

断言原文逐行确认（仍是严格形态，未被放宽）：

```js
const missing = res.data.filter(node => !Object.prototype.hasOwnProperty.call(node, 'type'))
assert.deepEqual(missing.map(node => node.name), [],
  `listTree 未返回 type 字段：${missing.map(node => node.name).join(', ')}；` +
  '会导致前端文件夹「移动到自己的子目录」置灰失效')
```

现在 `p0-chains.test.js` **9/9 全绿**（含第 5 条）。

### 1.4 行为级验证（新增，不只是看数据字段）

新增 `tests/ui/move-targets.test.js`（6 用例）——把 `moveTargets` 这个 computed 的**箭头函数体从 .vue 源码抽出来真实执行**，用假 source/tree 断言每一行的 `disabled`/`reason`：

| 场景 | 断言结果 |
| --- | --- |
| 源=根目录下的「父目录」 | 自身→「不能移动到自身」；**直接子目录与孙目录→「不能移动到自己的子目录」（R3 缺陷点，现已置灰）**；无关目录可选；根节点因「已在此目录」置灰 |
| 源=「子目录」（parent=f1） | 自身置灰；父目录→「已在此目录」；孙目录→「不能移动到自己的子目录」；根节点**可选** |
| 源=文档（根 / 文件夹内） | 文档无后代替灰；根节点按 `parent_id` 置灰；文档所在目录→「已在此目录」 |
| 对照：source 缺 `type` | 后代替灰失效（**R3 缺陷形态**，留作对照） |
| 修复后 source 带 `type:'folder'` | 后代替灰生效，且断言 `handleMoveFolder` 确实补了类型 |

**结论：E-1 修好，且是「数据 + 前端兜底 + 行为」三重可验证的修法。**

---

## 2. 六条打磨逐条核对 —— ✅ 6/6

### 2.1 `upload.js` 定时器 `unref` —— ✅ 已加，实测耗时 30.4s → 0.594s

```js
// common/utils/upload.js:53-60
return uniCloud.uploadFile(payload).finally(() => {
  if (createdBlobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    const timer = setTimeout(() => URL.revokeObjectURL(createdBlobUrl), REVOKE_DELAY)
    // Node（单测）环境下解除对事件循环的引用，避免测试被迫等待整个延迟
    if (timer && typeof timer.unref === 'function') timer.unref()
  }
})
```

| 命令 | 耗时 |
| --- | --- |
| R3 时 `node --test "tests/**/*.test.js"` | **30.4s** |
| 本轮同命令（不含 force-exit） | **0.594s** |
| 本轮 `--test-force-exit` | 0.55s（无差异，flag 已非必需） |

`typeof timer.unref === 'function'` 的守卫保证浏览器端不受影响，且释放时机仍在 upload Promise settle 之后。

### 2.2 `DEPLOY.md` 措辞 —— ✅ 已改「业务前端」且写明示例页不参与编译

- 第 259 行：「**业务前端（`common/`、`components/`、`pages/index/`、`pages/settings/`、`main.js`、`App.vue`）** 的 `uniCloud.uploadFile` 调用只剩 `common/utils/upload.js` 一处」。
- 第 261 行新增说明：「`pages/storage/space-storage.vue` 等示例页仍有直接调用，但它们属『hello uniCloud』官方示例、**未在 `pages.json` 注册、不参与编译**，按删除守卫原样保留，不计入本约束。」

经核对 `pages.json` 确实只注册 2 个业务页 + 16 个 `uni-id-pages` 页，`pages/storage` 未注册 ✓。

### 2.3 `COMPONENT-CONTRACT.md` 补事件 + 载荷形态 —— ✅ 已补

- 第 13 行 `mm-folder-tree`：props 的 `folders` 说明加了 `type`，emits 补 `move(node)`（载荷=被移动 folder 节点），说明列补「**`folders` 必须带 `type`**（父级 `moveTargets` 依赖）」。
- 第 14 行 `mm-file-list`：emits 补 `rename(file)`（载荷=被重命名文档记录）、`move(file)`（载荷=被移动文档记录）、`export(file)`（载荷=待导出文档记录），说明列补「行内『更多』菜单提供 重命名 / 移动到… / 导出 md / 删除」。

载荷形态写得明确（`node` / `file` 都是完整记录对象），与 `openRowMenu` / `openMenu` 实际 `emit('rename', file)` / `emit('move', node)` 的传参一致 ✓。

### 2.4 根节点在当前目录时置灰 —— ✅ 已加 `rootIsCurrent`

```js
// pages/index/index.vue:619-627
const rootIsCurrent = (source.parent_id || '') === ''
const list = [{
  _id: '', name: '全部文档', depth: 0,
  // 目标就是当前所在目录时同样置灰，避免发出无效 move 后弹出「已移动」的假成功提示
  disabled: rootIsCurrent,
  current: rootIsCurrent,
  reason: rootIsCurrent ? '已在此目录' : ''
}]
```

- 行为测试已断言：源在根目录时根节点 `disabled=true` / `reason='已在此目录'`；源不在根目录时 `disabled=false`。
- `chooseMoveTarget` 对 `target.disabled` 早退（`p0-chains.test.js:6` 断言），因此**不会再发出无效 move，也不会弹假成功** ✓。

### 2.5 `mm-md-editor` 的 `ready` 删除 —— ✅ 已删，主壳无监听

- `components/mm-md-editor/mm-md-editor.vue:53-54`：
  ```js
  // 只声明实际会 emit 的事件：主壳未监听编辑器就绪事件，故不保留未使用的 `ready`
  const emit = defineEmits(['update:modelValue'])
  ```
  全文再无 `emit('ready')`。
- `pages/index/index.vue`：`@ready` / `onReady` **0 命中**。
- 副作用可见：`emits-bindings` 的「无绑定事件」诊断由 R3 的 4 条降为 **3 条**（`mm-md-editor.ready` 已消失）✓。

### 2.6 `DEPLOY.md` 导出图片降级已知限制 —— ✅ 已补

第 279 行新增第 9 条：「导出时图片临时 URL 换取失败 | `getTempUrls` 失败会让导出内容保留 `mm-image://<fileID>` 原 token —— 不阻断导出，md 文件仍可用，仅图片不显示；属可接受降级，可重试导出」。

与代码一致（`index.vue` 导出时 `urlMap[fileId] || matched`）✓。

---

## 3. 回归测试与 `type` 新字段的影响

### 3.1 全量结果

见 §0：**185/185，0.594s**。分文件：

| 文件 | 用例 | 文件 | 用例 |
| --- | --- | --- | --- |
| 后端 13 个（R1） | 125 | `ui/emits-bindings` | 4 |
| `ui/selection`（工程师） | 7 | `ui/frontend-static` | 17 |
| `ui/image-state` | 12 | `ui/move-targets`（**本轮新增**） | 6 |
| `ui/p0-chains` | 9 | `ui/upload`（工程师） | 5 |

### 3.2 `type` 字段没有引入误判 —— ✅ 独立核对

全项目对 `.type` 的判定点穷举（业务前端）：

| 位置 | 判定对象 | 是否受 `node.type` 影响 |
| --- | --- | --- |
| `index.vue:412/418` | `item.icon.type === 'custom'` | 否，读的是 `icon` 子对象 |
| `index.vue:648` | `source.type === 'folder'` | **是**（唯一依赖点，现已双保险保证有值） |
| `mm-folder-tree.vue:116` | `icon.type === 'preset'` | 否 |
| `mm-icon-picker.vue:85/90` | `props.current.type` / `draft.type` | 否，是图标对象 |
| `mm-trash.vue:27` | `item.type === 'folder'` | 是，但数据来自 `listTrash`（投影仅排除 `content_hash`，本就带 `type`），**与本次改动无关** |

**目录树组件**：`childrenMap` / `visibleNodes` / `hasChildren` / `toggle` 只用 `_id` / `parent_id` / `name`；`iconSrc(node)` 显式 `const icon = node && node.icon` → 与新增的 `node.type` 无关 ✓。

**`store.setTree`**：`state.tree = Array.isArray(tree) ? tree : []` —— 纯赋值，无类型筛选 ✓。

以上两点已写成测试断言（`move-targets.test.js:6`：遍历全部 `.type` 判定并要求命中行必须是 `icon.type` 或 `source.type === 'folder'`），一旦将来出现第三种类型判定就会红灯。

---

## 4. 是否引入新问题 —— ✅ 无

本轮 4 个代码文件：

| 文件 | 改动 | 影响面核查 |
| --- | --- | --- |
| `cloudfunctions/mm-file/index.obj.js` | `listTree` 的 `.field()` 加 `type: 1` | 消费方只有 `mm-folder-tree`（只读 `icon.type`）与 `moveTargets`；`attachIconUrls` 用展开拷贝保留全部字段；`handleRenameFolder/RemoveFolder/ChangeIcon/MoveFolder` 收到带 `type` 的节点也无副作用 → 见 §3.2 |
| `pages/index/index.vue` | `handleMoveFolder` 复制 + `rootIsCurrent` | 见 §4.1 |
| `common/utils/upload.js` | `unref` | `upload.test.js` 5/5 仍绿；浏览器无 `unref` 走 `typeof` 守卫，行为不变 |
| `components/mm-md-editor/mm-md-editor.vue` | 删 `ready` | 无残留 `emit('ready')`、主壳无监听；`v-model` 走 `update:modelValue` 不受影响（`emits-bindings` 方向 A 仍 0 死绑定） |

### 4.1 `handleMoveFolder` 复制后参数完整性 —— ✅

`Object.assign({}, node, { type: 'folder' })` 浅拷贝全部自有可枚举属性，`_id` / `parent_id` / `name` / `icon` 都保留；`chooseMoveTarget` 用 `source._id` 传 `file_id`，用 `target._id || ''` 传 `parent_id`。

两条独立验证：

1. **数据层**：直接断言复制结果 `copied._id === 'f2'`、`copied.parent_id === 'f1'`、`copied.name === '子目录'`（`move-targets.test.js:5`）。
2. **链路层**：用真实云对象 + Mock 跑一次正常移动 —— `move({ file_id: 子目录._id, parent_id: '' })` → `errCode 0`、`parent_id` 变空串、`_id` 不变、同目录无冲突时 `name` 不被改写。**说明移动主链路未被这次复制破坏。**

另外确认：`rootIsCurrent` 计算在 `if (!source) return []` **之后**，`moveSource` 为 null 时不会读 `source.parent_id`，无空指针风险 ✓。

---

## 5. 契约 ↔ 组件 emits ↔ 主壳绑定 三方一致性

用脚本解析 `COMPONENT-CONTRACT.md` 的 emits 列（正确处理单元格内转义的 `\|`），与 12 个组件的 `defineEmits` 及页面的实际绑定三方比对：

| 组件 | 契约 emits | 组件声明 | 一致 |
| --- | --- | --- | --- |
| `mm-loading` | finish | finish | ✅ |
| `mm-folder-tree` | select, create, rename, **move**, remove, change-icon | 同 | ✅ |
| `mm-file-list` | open, select-change, sort-change, upload, import, **rename**, **move**, **export**, batch-delete | 同 | ✅ |
| `mm-icon-picker` | update:visible, confirm | 同 | ✅ |
| `mm-search-panel` | update:visible, select | 同 | ✅ |
| `mm-settings-panel` | update-config, update-permission, refresh-users | 同 | ✅ |
| `mm-trash` | update:visible, changed | 同 | ✅ |
| `mm-md-viewer` | select-comment | 同 | ✅ |
| `mm-md-editor` | update:modelValue, **ready** | **仅 update:modelValue** | ⚠️ **契约滞后** |
| `mm-annotation` | add, update, remove, locate | 同 | ✅ |
| `mm-conflict-modal` | overwrite, discard, update:visible | 同 | ✅ |
| `mm-image-picker` | update:visible, select | 同 | ✅ |

**代码 ↔ 绑定方向**：`emits-bindings` 方向 A（模板绑定了组件既未声明也未触发的事件）**0 处**；方向 B 的诊断降为 3 条，全部有意不接：

```text
mm-file-list.selectChange / mm-file-list.sortChange（组件内部完成本地排序）
mm-loading.finish（页面无需感知）
```

**唯一差异**：契约第 25 行 `mm-md-editor` 的 emits 仍写 `ready`，而 §2.5 已按建议把该事件从代码删除 → **契约需同步删掉 `ready`**（P3，见 §7 N-1）。

> 该差异方向是「文档多写了一个已删事件」，不会导致任何运行时问题（没人监听、也无人 emit），不影响任何 AC。

---

## 6. 红线 —— ✅ 全 0

| 红线 | 扫描范围 | 结果 |
| --- | --- | --- |
| `rpx` | `index.vue` / `upload.js` / `mm-md-editor.vue` | **0 处真实使用**（唯一命中是 `index.vue:228` 的中文注释「禁止 rpx」） |
| 硬编码色值（`#hex` / `rgb()` / `hsl()`） | `index.vue` / `mm-md-editor.vue` 的 `<style>` 块 | **0 处**；新增的 `.mm-move__*` 样式全部走 `var(--mm-*)`（6 处） |
| 前端 `uniCloud.database()` | 上述 3 个前端文件 | **0 处**。仅云对象 `index.obj.js:21` 有 1 处——云函数内直连数据库是架构 1.6 明确允许的正确做法 |

---

## 7. 智能路由判定

### 结论：**NoOne —— 无阻塞项**

R3 的 E-1（P2）已修复并有双重证据（数据字段 + 行为断言）；6 条打磨 6/6 落实；185/185 全绿且耗时从 30.4s 降到 0.594s；未引入新问题；红线全 0。

### 唯一非阻塞项（P3，文档口径，不影响任何 AC）

| # | 事项 | 位置 | 建议 |
| --- | --- | --- | --- |
| N-1 | 契约仍写 `mm-md-editor` 的 `ready` 事件，但代码已按 R3-N5 删除 | `docs/COMPONENT-CONTRACT.md:25` | emits 列删掉 `ready`，改为仅 `update:modelValue(String)`（emit 前已反替换为存储态） |

> 本条属「文档比代码多写一个已删事件」，无运行时影响，也不改变任何 AC 判定，因此不作为阻塞项。若工程师顺手修，改一行即可。

---

## 8. 仍必须由人在 HBuilderX 判定（本轮不判失败）

| # | 条目 | 为什么本地判不了 |
| --- | --- | --- |
| H-1 | **AC-29 最终判据** | 真实 H5 编译 + `easycom.custom` 运行时解析（控制台无 `Failed to resolve component`，7 个 `wd-*` 标签实际渲染） |
| H-2 | **AC-07 渲染与深浅色** | 需真实浏览器渲染 `marked` + DOMPurify + `prefers-color-scheme` |
| H-3 | **AC-27 三栏 / 抽屉目视** | 1440px 三栏 260/320/自适应；375px 单栏 + 左抽屉；**「移动到」居中弹层**在移动端不溢出、置灰行原因文案可读 |
| H-4 | **AC-28 首屏动效目视** | 「不闪烁、不空白跳变」只能看 |
| H-5 | **AC-12「放弃」后编辑框文字仍在页面上** | 需真实 DOM：两会话造冲突 → 点「放弃」→ 确认刚才敲的字原样还在、停留编辑态、可再次保存 |
| H-6 | **R3 真实 DOM 选区四场景** | `window.getSelection()` 与真实 marked 输出：含图片/表格/多段落/纯文本各选一段 → 加批注 → 确认落库 `selected_text` 与所选**逐字相同** |
| H-7 | **三条上传链路实测** | 参数形态已按官方文档核对通过，剩真实跑通：上传 md / 图片空间上传新图 / 上传文件夹自定义图标 |
| H-8 | **导出 / 移动 / 改名的真实交互** | 导出文件里图片应是临时 URL 而非 `mm-image://`；移动后重开确认 `parent_id` 变更；改名后确认顶部标题与列表同步；**文件夹移入自己子目录时置灰且无 toast** |
| H-9 | AC-01/06/08/10/18/19/26 + AC-05/AC-24（R3 已下调为部署后验证） | 真实云存储 / 真实 uni-id 多用户，按 `docs/DEPLOY.md` 执行 |

---

## 9. 结论

- 本轮 7 处改动**全部落实且可验证**：E-1 修复是「云对象补字段 + 前端显式兜底 + 行为级断言」三重保障；6 条打磨逐条有据；测试耗时从 30.4s 回落到 0.594s。
- **185/185 全绿**，R3 那条红灯在断言未改的前提下自然转绿（mtime + 逐行双重证据）。
- 无新增问题，红线全 0。
- 仅剩 1 条 P3 文档口径滞后（契约多写一个已删事件），**不阻塞交付**。

**路由判定：NoOne（无阻塞项）。**
