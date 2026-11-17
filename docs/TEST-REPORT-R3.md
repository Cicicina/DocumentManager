# 测试报告 R3 · 回归验证

> 角色：QA（严过关）｜ 项目：MarkdownManager ｜ 轮次：第 3 轮（**回归验证**，非全量重做）
> 基线：`docs/PRD.md`、`docs/ARCHITECTURE.md`（0.5 R1~R4）、`docs/COMPONENT-CONTRACT.md`、`docs/AC-CHECKLIST.md`、`docs/TEST-REPORT-R1.md`、`docs/TEST-REPORT-R2.md`
> 本轮**未修改任何业务源码**，新增 3 个测试文件（13 个用例）与本报告。
> H5 真实编译由主理人并行执行，本轮**不重复编译、不因「未编译」判失败**。

---

## 0. 执行结果

```text
$ node --test --test-force-exit "tests/**/*.test.js"
1..179
# tests 179
# pass 178
# fail 1
```

| 范围 | 用例 | 通过 | 失败 |
| --- | --- | --- | --- |
| R1 后端（13 文件） | 125 | 125 | 0 |
| R1 前端 R3 纯函数（`tests/ui/selection.test.js`） | 7 | 7 | 0 |
| R2 图片双态（`tests/ui/image-state.test.js`） | 12 | 12 | 0 |
| R2 前端静态（`tests/ui/frontend-static.test.js`，工程师已修正断言） | 17 | 17 | 0 |
| R3 新增 上传契约（`tests/ui/upload.test.js`，工程师编写） | 5 | 5 | 0 |
| **R3 新增** 事件接线双向扫描（`tests/ui/emits-bindings.test.js`） | 4 | 4 | 0 |
| **R3 新增** 三条 P0 链路回归锁（`tests/ui/p0-chains.test.js`） | 9 | 8 | **1** |
| 合计 | **179** | **178** | **1** |

**唯一失败用例**：`listTree 返回的节点必须带 type：否则「移动到自己的子目录」置灰失效`
→ 见 §1.2 与 §7 的 **E-1**（文件夹移动的后代替灰失效）。

> **运行耗时提醒**：直接 `node --test` 需 **30.4s**，加 `--test-force-exit` 后 **0.5s**。
> 原因是 `common/utils/upload.js:55` 的 `setTimeout(revokeObjectURL, 30000)` 未 `unref`，Node 会等这个定时器。
> 浏览器里无害，但拖慢本地与 CI。详见 §6.3。

### 六项验证结论速览

| # | 验证项 | 结论 |
| --- | --- | --- |
| 1 | 三条 P0 链路是否真闭环 | 导出 ✅ / 改名 ✅ / **移动 ⚠️ 1 处缺陷**（后代替灰失效） |
| 2 | `@add` 修复 + 全项目 emits 双向扫描 | ✅ 四处事件全接；**0 处死绑定**（`@create` 类缺陷已清零） |
| 3 | `uniCloud.uploadFile` 统一 | ✅ 业务前端仅 1 处；官方契约核对通过（同时**纠正 R2 的 H-7 误判**） |
| 4 | 回归测试 + `frontend-static` 断言是否被放宽 | ✅ 178/179；断言**加强**而非放宽（取消硬编码条数，改为汇总↔明细交叉校验 + 三态之和=31） |
| 5 | 文档订正是否诚实 | ✅ AC-05/AC-24 已下调、无残留用例名、汇总 17/9/5 自洽、API.md 占位已清；⚠️ 2 处措辞/同步滞后（非阻塞） |
| 6 | 新增代码红线 | ✅ rpx 0 / 硬编码色 0 / `uniCloud.database()` 0 / `wd-dialog` 0；catch 均有提示；⚠️ 30s 定时器未 unref |

---

## 1. 三条 P0 链路闭环验证

### 1.1 导出 md —— ✅ 闭环

| 环节 | 证据 |
| --- | --- |
| UI 入口 | `components/mm-file-list/mm-file-list.vue:63-65` 行尾「更多」按钮 → `openRowMenu`（L161-172），菜单第 3 项「导出 md」→ `emit('export', file)` |
| 组件声明 | `mm-file-list.vue:92-102` `defineEmits` 含 `export` |
| 主壳绑定（PC / 抽屉双处） | `pages/index/index.vue:65` `@export="handleExport"`；`index.vue:149` 同（抽屉内） |
| api 调用 | `index.vue:692` `exportFile({ file_id: file._id })`（`index.vue:252` 已 import） |
| **`content` 为空 + 有 `tempUrl` → fetch** | `index.vue:696-703` `if (!content && res.data.tempUrl && typeof fetch === 'function') { response = await fetch(...); content = await response.text() }` |
| **两者都空 → 中止、不产出空文件** | `index.vue:704-707` `if (!content) { toast.show('导出失败，请重试'); return }` —— 位于 `downloadMarkdown` 之前，**不会落一个空文件** |
| **导出内容用显示态** | `index.vue:709-710` `resolveImageUrlsForText(content)`（L675-683，扫 `mm-image://<fileID>` 批量 `getTempUrls`）→ `content.replace(/mm-image:\/\/([^\s)'"]+)/g, (m, id) => urlMap[id] || m)` |
| 落盘 + 反馈 | `index.vue:711-712` `downloadMarkdown(res.data.name \|\| file.name, displayContent)`；`toast.show('已导出')` |

**seq 断言**（已转成测试 `p0-chains.test.js:1`）：`exportFile` → `fetch(tempUrl)` → 空内容守卫 → `resolveImageUrlsForText` → `mm-image://` 替换 → `downloadMarkdown`，顺序正确。

**降级行为说明（非缺陷）**：若 `getTempUrls` 失败，导出内容会保留 `mm-image://<fileID>` token（`urlMap[id] || m` 的 `|| m` 分支）。此时 api 层已弹出 3003 提示，属可接受的降级，不会崩、不会产出 undefined。

### 1.2 移动 —— ⚠️ 基本闭环，但**后代替灰失效**

**已闭环部分**

| 环节 | 证据 |
| --- | --- |
| 文档入口 | `mm-file-list.vue:63-65` 行尾「更多」→ 菜单第 2 项「移动到…」→ `emit('move', file)` |
| 文件夹入口 | `mm-folder-tree.vue:128-139` 菜单 5 项，第 3 项「移动到…」→ `emit('move', node)`；`defineEmits`（L65）含 `move` |
| **PC 与抽屉双处绑定** | 文件列表：`index.vue:64`（PC）+ `index.vue:148`（抽屉）；目录树：`index.vue:43`（PC）+ `index.vue:131`（抽屉）。**四处齐全，无单侧漏绑**（已转成测试 `emits-bindings.test.js:4`，按 PC/抽屉区块分别断言） |
| 唤起弹层 | `index.vue:585-596` `handleMoveFile` / `handleMoveFolder` 写 `moveSource` + `moveVisible=true`；弹层模板 `index.vue:169-190` |
| 候选与置灰 | `index.vue:613-659` `moveTargets` |
| 执行 | `index.vue:662-672` `chooseMoveTarget` → `move({ file_id, parent_id: target._id \|\| '' })` → `toast('已移动')` → `loadTree()` + `loadFiles(currentFolderId)` |

**置灰规则逐条核对**

| 场景 | 代码 | 判定 |
| --- | --- | --- |
| 移动到自身 | `index.vue:641-643` `folder._id === source._id` → `disabled=true`，文案「不能移动到自身」 | ✅ 正确（对文件夹生效；文档 id 不会与 folder id 相同，天然不进入该分支） |
| 移动到自己的子目录 | `index.vue:644-647` `source.type === 'folder' && isDescendantOf(folder._id, source._id, folders)` →「不能移动到自己的子目录」 | ❌ **失效**（见下） |
| 已在此目录 | `index.vue:648-652` `isCurrent` →「已在此目录」 | ✅ 正确（但**根节点行例外**，见下） |
| 根节点是否可选 | `index.vue:617-624` 首项 `{_id: '', name: '全部文档', disabled: false}` | ✅ 出现在候选里、可点；`chooseMoveTarget` 用 `target._id \|\| ''` 正确映射为空 `parent_id` |
| disabled 早退 | `index.vue:664` `if (!source \|\| !target \|\| target.disabled) return` | ✅ 不会对置灰项目发请求 |

**❌ 缺陷 E-1：文件夹「移动到自己的子目录」置灰失效**

根因：`moveTargets` 用 `source.type === 'folder'` 判定，但 `handleMoveFolder` 传入的 `source` 来自 `store.state.tree`，而云对象 `mm-file.listTree` 的字段投影**不含 `type`**：

```js
// uniCloud-alipay/cloudfunctions/mm-file/index.obj.js  listTree
.field({ _id: 1, user_id: 1, parent_id: 1, name: 1, icon: 1, created_at: 1, updated_at: 1 })
//        ↑ 没有 type
```

实测（Mock + 真实云对象代码）：

```text
listTree 返回字段: _id,created_at,icon,name,parent_id,updated_at,user_id
是否含 type: false
```

因此 `source.type === 'folder'` 恒为 `false` → `isDescendantOf` 那一路**永远不会命中**，用户可以把文件夹「移动」到自己的子目录，UI 上不置灰、不提示。

**影响面（已收敛）**：云对象 `move` 有独立的后代校验（`index.obj.js` `move` 中从目标目录向上回溯 `parent_id` 链，命中自身即抛 `4003 MOVE_INVALID`），所以**不会产生数据损坏**，最终表现为「点了没反应 + 弹出『不能移入自身目录』」。属**交互与文案层面的功能失效**，不是数据缺陷。

**最小修复（建议）**
- 方案 A（一行，前端）：`handleMoveFolder` 里补目标类型 —— `moveSource.value = Object.assign({}, node, { type: 'folder' })`；或
- 方案 B（更干净，云对象）：`listTree` 的 `.field()` 加 `type: 1`（树节点本就该带 `type`，前端 `mm-folder-tree` 也可用于区分节点类型）。

> 未改业务源码，交由工程师选择。已用失败用例 `p0-chains.test.js:5` 锁定该缺陷，修复后自动转绿。

**另一处不一致（P3，不单列缺陷）**：根节点行固定 `disabled: false`，未走 `index.vue:649-652` 的「已在此目录」判定。因此当移动源**已在根目录**时，其它目录行会置灰并写「已在此目录」，而根目录行仍可点 → 触发一次无效 `move` + 提示「已移动」。无副作用，建议同样置灰。

### 1.3 改名 —— ✅ 闭环

| 环节 | 证据 |
| --- | --- |
| UI 入口 | `mm-file-list.vue:63-65` → 菜单第 1 项「重命名」→ `emit('rename', file)` |
| 主壳绑定（双处） | `index.vue:63`（PC）、`index.vue:147`（抽屉） |
| 输入与早退 | `index.vue:563-566` `openInput(...)`；`if (!name \|\| name === file.name) return`（取消 / 未改不发请求） |
| api | `index.vue:567` `rename({ file_id, name })` |
| 刷新列表 | `index.vue:570` `loadFiles(currentFolderId.value)` |
| **`currentFile.name` 同步** | `index.vue:571-577`：命中当前打开文档时 `store.openFile({ ...store.state.currentFile, name: res.data.name }, store.state.editorContent, store.state.comments)` |
| 标题联动 | `index.vue:301-304` `currentTitle = file ? file.name : 'Markdown 文档库'` → 顶部标题随 `currentFile.name` 更新 ✅ |
| 命名正确性 | 用 `res.data.name`（服务端 `genUniqueName` 后的真实名，可能已追加 `-copyN`），而不是用户输入的 `name` ✅ |

**结论**：改的是当前打开文档时，顶部标题与列表都会同步，不会出现「标题还是旧名」的不一致。

---

## 2. `@add` 修复与全项目事件接线

### 2.1 `mm-annotation` 逐个比对 —— ✅ 全通

| 事件 | 组件声明 | 组件触发 | 主壳绑定 |
| --- | --- | --- | --- |
| `add` | `mm-annotation.vue:67` | `:145` | `index.vue:107` `@add="handleCreateComment"` ✅ |
| `update` | 同上 | `:143` | `index.vue:108` ✅ |
| `remove` | 同上 | `:131` | `index.vue:109` ✅ |
| `locate` | 同上 | `:14` | `index.vue:110` ✅ |

prop 名：`mm-annotation.vue:64` 声明 `activeCommentId`；`index.vue:106` 绑定 `:active-comment-id="activeCommentId"` ✅（R2 的 `:active-id` 缺陷已修复）。R2 那条失败用例（`frontend-static.test.js:269`）现在**转绿**，且该用例本身的断言逻辑未改动。

### 2.2 全项目双向扫描 —— ✅ 0 死绑定

新增 `tests/ui/emits-bindings.test.js`（4 用例，全绿），做法：

1. 从每个 `components/mm-*/mm-*.vue` 抽取 `defineEmits([...])` 与所有 `emit('xxx')`；
2. 从 `pages.json` 注册的页面 + 全部业务组件里抽取所有 `<mm-*>` 使用点，解析 `@event` / `@event.modifier` / `v-model:xxx` / `v-model`；
3. 事件名统一归一化为 camelCase 后双向比对。

| 方向 | 结果 |
| --- | --- |
| **A（致命）模板绑定了组件既未声明也未触发的事件** | **0 处** —— `@create` 这一类缺陷已清零（扫描 12 个业务组件、14 个使用点文件） |
| **B（诊断）组件声明/触发但全项目无绑定** | 4 处：`mm-file-list.selectChange`、`mm-file-list.sortChange`、`mm-loading.finish`、`mm-md-editor.ready` —— **均为有意不接**（前两个由组件内部完成本地排序；`finish` 页面无需感知；`ready` 未被使用） |

> 补记：`mm-md-editor` 的 `ready` 只声明、从未 `emit`，属**未被使用的 API 面**，无害；若要精简可删掉该声明。

**另一条锁**：`emits-bindings.test.js:4` 按「PC 三栏区」与「移动端抽屉区」两个区块**分别**断言 `rename/move/export` 与文件夹树的 `move` 都已绑定，专门防「只绑一处」的单侧漏绑。

---

## 3. `uniCloud.uploadFile` 统一

### 3.1 调用点收敛

| 范围 | 结果 |
| --- | --- |
| 业务前端（`pages/index`、`pages/settings`、`components/mm-*`、`common/`） | `uniCloud.uploadFile` **仅 1 处**：`common/utils/upload.js:53` ✅ |
| 四处上传全部走统一函数 | `index.vue:742`、`mm-image-picker:109`、`mm-icon-picker:116`、`mm-md-editor:113` 均为 `uploadCloudFile(...)` ✅ |
| 示例页 | `pages/storage/space-storage.vue:151` 仍直接调用 —— **该页未在 `pages.json` 注册、不参与编译**，属删除守卫允许保留的原模板，不是业务代码 |

### 3.2 归一逻辑与官方文档核对 —— ✅ 一致

对照官方文档《uniCloud 云存储 → 客户端 API → uploadFile》（`doc.dcloud.net.cn/uniCloud/storage/dev.html`）：

| 文档参数 | 类型 | 必填 | 项目实现 |
| --- | --- | --- | --- |
| `cloudPath` | String | 是 | 必传，缺失即 `throw` ✅ |
| `filePath` | String | 是 | 主形态 ✅ |
| `cloudPathAsRealPath` | Boolean | 否 | 未用（支付宝云支持目录路径，不需要） |
| `fileType` | String | 否 | 支持透传 ✅ |
| `onUploadProgress` | Function | 否 | 支持透传 ✅ |
| **`file`** | — | — | **官方参数表里没有 `file`** ✅ 与 `upload.js` 注释一致 |

官方示例同样是 `filePath: res.tempFilePaths[0]`（H5 下即 `blob:` URL），DCloud 自带模板 `pages/storage/space-storage.vue:105-112` 的 H5 分支亦为 `{ filePath: path, cloudPath }`。**双重印证 `filePath` 才是唯一正确形态。**

### 3.3 ⚠️ 更正 R2 的 H-7 误判

R2 报告 §11.1 把「`mm-md-editor` 传 `file`、其余传 `filePath`」判为「至少一组与 H5 契约不符」，并推测「若 `filePath` 无效，三条链路会一起挂」。
**该判断错误**：官方契约只有 `filePath`，`file` 不是合法参数。工程师的统一封装（`filePath` 优先、只有 `File/Blob` 时 `createObjectURL` 转 blob URL）方向正确，R2 那条「高风险」应撤销。保留的只有一项**部署后实测**（三条链路真实跑通），不再是「参数形态可能错」的风险。

### 3.4 `revokeObjectURL` 时序 —— ✅ 安全

```js
// common/utils/upload.js:53-57
return uniCloud.uploadFile(payload).finally(() => {
  if (createdBlobUrl && ...) setTimeout(() => URL.revokeObjectURL(createdBlobUrl), REVOKE_DELAY)  // 30s
})
```

- 只在 **upload Promise settle（成功或失败）之后**才安排释放 → 上传过程中不会被回收 ✅
- 30s 延迟远超实际需要（上传已结束），可作为二次兜底 ✅
- 仅对「本函数自己 `createObjectURL` 出来的 URL」释放，不碰外部传入的 `filePath` ✅（不会误回收 `chooseFile` 的 tempFilePath）

---

## 4. 回归测试与断言强度核查

### 4.1 结果

`node --test --test-force-exit "tests/**/*.test.js"` → **179 / 178 pass / 1 fail**（失败项即 E-1，非本轮修复引入）。

### 4.2 `frontend-static.test.js` 被修改的断言**是加强，不是放宽** —— ✅

工程师只改了 `AC-CHECKLIST` 那一条（`tests/ui/frontend-static.test.js:443`），对比 R2 版本：

| | R2 版本 | R3 版本 | 强度变化 |
| --- | --- | --- | --- |
| 三态合法性 | ✅ 只允许三种 | ✅ 保留 | 不变 |
| 31 条齐全 + 编号唯一 | ✅ | ✅ 保留 | 不变 |
| 汇总条数校验 | **硬编码** `assert.equal(counts['本地已验证'], 19)` 等三条 | **读取汇总表声明值** `summary[token]`，与明细 `counts[token]` 逐项比对；再断言三态之和 = 31 | **加强**：R2 版本在文案调整后必须手改数字（容易「改小数字让它过」）；R3 版本自动交叉校验，且暴露「汇总与明细不一致」 |
| 其余 16 条用例 | — | 一条未删、断言未改 | 不变 |

**结论**：不是「把硬编码数字改小」，而是「取消硬编码 → 读声明值 → 与明细交叉校验 + 总和自洽」。17 条用例一条未少。

> 该改动仍有固有局限：它保证「汇总与明细自洽」，不保证「标注内容真实」。后者只能靠人工审阅，本轮已在 §5 逐条复核。

---

## 5. 文档订正是否诚实 —— ✅ 通过（2 处措辞滞后）

### 5.1 `AC-CHECKLIST.md`

| 检查点 | 结果 |
| --- | --- |
| AC-05 是否下调 | ✅ 由 `本地已验证` → `部署后验证`；证据改为「前端链路已闭环（源码级）……**无单测覆盖**，实际嵌套与移动效果需部署后验证」（第 27 行） |
| AC-24 是否下调 | ✅ 由 `本地已验证` → `部署后验证`；证据明确「`handleExport` → `exportFile`（`content` 为空时 `fetch(tempUrl)` 降级）→ 图片双态替换 → `downloadMarkdown`；**无单测覆盖**」（第 76 行） |
| 是否残留不存在的用例名 | ✅ **0 处**。用脚本把文中所有 `tests/xxx.test.js（…）` 的括号内标识符逐个到对应文件里检索，**全部命中** |
| 汇总是否 17/9/5 且与明细一致 | ✅ 明细统计 `本地已验证 17 / 部署后验证 9 / 未验证 5`，汇总表声明完全相同，和为 31 |
| 只有三种状态词、无含糊表达 | ✅ |
| 剩余风险段是否同步 | ✅ 第 3 条已写明「9 条部署后验证……AC-05（嵌套/移动）与 AC-24（导入导出字节一致）—— 后两条因**无单测覆盖**已由『本地已验证』下调」 |

### 5.2 `API.md`

| 检查点 | 结果 |
| --- | --- |
| 占位字样 `IS_PASS` | ✅ 已清除；第 149 行改为「由 `tests/error-constants.test.js` 断言」 |
| 方法名 ↔ 云对象导出 | ✅ R2 已建测试锁定（17/5/1/6/4），本轮仍绿 |
| 错误码表 ↔ `constants.ERR` | ✅ 18 项一致，测试仍绿 |

### 5.3 ⚠️ 2 处非阻塞滞后

1. **`DEPLOY.md:259`「全项目 `uniCloud.uploadFile` 调用只剩 `common/utils/upload.js` 一处」** —— 严格说不精确：示例页 `pages/storage/space-storage.vue:151` 仍有 1 处（未注册、不参与编译）。建议改为「**业务前端**仅剩一处；`pages/storage/` 为保留的官方示例，未在 `pages.json` 注册、不参与编译」。
2. **`COMPONENT-CONTRACT.md` 未同步新增事件** —— 第 13 行 `mm-folder-tree` 仍只列 `select/create/rename/remove/change-icon`（缺 `move`），第 14 行 `mm-file-list` 仍只列 `open/select-change/sort-change/upload/import/batch-delete`（缺 `rename`/`move`/`export`）。契约是 T04a/T04b 的共用基线，建议补齐以免后续误判为「多出来的野事件」。

---

## 6. 新增代码红线

### 6.1 红线逐项（本轮改动文件）

| 红线 | 结果 |
| --- | --- |
| `rpx` | **0 处真实使用**。仅 `index.vue:228` 的中文注释「禁止 rpx」 |
| 硬编码色值 | **0 处**（14 个业务 `.vue` 的 `<style>` 块扫 `#hex` / `rgb()` / `hsl()` 全空；新加的 `.mm-move__*` 样式全部 `var(--mm-*)`） |
| `uniCloud.database()` | **0 处** |
| `<wd-dialog>` | **0 处** |
| `uniCloud.importObject` | 1 处 `index.vue:395`（`uni-id-co.getUserInfo()` 取身份），非业务表直连，允许 |

### 6.2 静默失败检查 —— ✅ 无 `any` 式吞错

| 位置 | catch 行为 |
| --- | --- |
| `handleExport` `index.vue:700-702` | 吞掉 fetch 失败但**立刻转成用户可见提示**：`content=''` → `L704` `toast.show('导出失败，请重试'); return` ✅ |
| `handleUpload` / `handleImport` | catch → `toast.show('上传/导入失败，请重试')` ✅ |
| `mm-md-editor` / `mm-image-picker` / `mm-icon-picker` 上传 | catch → `uni.showToast(...)` ✅ |
| `chooseMoveTarget` / `handleRenameFile` | **无 try/catch**，依赖 `common/api/index.js` 的 `call()` 保证不抛（L74-93 内部 try/catch + 非静默码统一 Toast） ✅ |
| `upload.js` | 缺参直接 `throw`，不静默返回空 ✅ |
| `resolveImageUrlsForText` | `getTempUrls` 失败返回 `{}`，导出保留 token；api 层已弹 3003 ✅ |

### 6.3 ⚠️ 30s 定时器未 `unref`（P3，非阻塞）

`common/utils/upload.js:55` 的 `setTimeout(..., 30000)` 在 Node 下会阻止进程退出，导致**每次跑测试多等 30 秒**：

```text
node --test "tests/**/*.test.js"                      → 30.46s
node --test --test-force-exit "tests/**/*.test.js"    → 0.55s
单独跑 tests/ui/upload.test.js                        → 30.22s（其余 165 条只需 0.56s）
```

浏览器里无影响（`setTimeout` 不阻塞页面），但会拖慢本地与 CI。建议：

```js
const timer = setTimeout(() => URL.revokeObjectURL(createdBlobUrl), REVOKE_DELAY)
if (timer && typeof timer.unref === 'function') timer.unref()
```

**临时绕过**：CI/本地统一加 `--test-force-exit`（已实测 179 条 0.55s 跑完，结果不变）。

---

## 7. 智能路由判定

### 结论：**Engineer（1 项，P2）**

| # | 路由项 | 严重度 | 复现方式 | 建议修复 |
| --- | --- | --- | --- | --- |
| **E-1** | **文件夹「移动到自己的子目录」在 UI 上不置灰** | **P2**（无数据损坏，服务端 4003 兜底） | ① 新建 `父目录/子目录`；② 在目录树对「父目录」点「移动到…」；③ 候选里「子目录」**未置灰、无原因文案**，可点击；④ 点击后被服务端拒绝并弹「不能移入自身目录」 | 方案 A（一行）：`pages/index/index.vue:592-596` `handleMoveFolder` 改为 `moveSource.value = Object.assign({}, node, { type: 'folder' })`；方案 B（更干净）：`uniCloud-alipay/cloudfunctions/mm-file/index.obj.js` `listTree` 的 `.field()` 增加 `type: 1` |

**根因链（已实测确认）**：`moveTargets`（`index.vue:644`）读 `source.type === 'folder'` → `source` 来自 `store.state.tree` → `mm-file.listTree` 的字段投影不含 `type` → 恒为 `undefined` → 后代替灰分支永不命中。

**回归锁**：`tests/ui/p0-chains.test.js:5`（当前红灯，修复后自动转绿）。

### 非阻塞建议（不构成路由，不计入交付阻塞）

| # | 事项 | 位置 |
| --- | --- | --- |
| N-1 | `upload.js` 的 30s 定时器加 `unref`（或 CI 统一用 `--test-force-exit`） | `common/utils/upload.js:55` |
| N-2 | `DEPLOY.md` 第 259 行「全项目只剩一处」措辞改为「业务前端只剩一处」 | `docs/DEPLOY.md:259` |
| N-3 | `COMPONENT-CONTRACT.md` 补 `mm-folder-tree.move` 与 `mm-file-list.rename/move/export` | `docs/COMPONENT-CONTRACT.md:13-14` |
| N-4 | 移动弹层根节点在「已在根目录」时同样置灰（与其它目录行一致），避免无效 move + 假提示 | `pages/index/index.vue:617-624` |
| N-5 | `mm-md-editor` 声明了 `ready` 但从未 `emit`，可删声明 | `components/mm-md-editor/mm-md-editor.vue` |
| N-6 | 导出时 `getTempUrls` 失败会保留 `mm-image://` token（可接受，但建议在 `DEPLOY.md` 已知限制里补一句） | `pages/index/index.vue:709-710` |

### QA 自身修正（不路由）

`tests/ui/p0-chains.test.js` 初版的源码抽取工具只支持 `function xxx()`，取不到 `const moveTargets = computed(() => {...})` 形式的声明，已扩展为兼容 `const X = ` 前缀。**源码无问题**。

---

## 8. 仍必须由人在 HBuilderX 判定（本轮一律不判失败）

| # | 条目 | 为什么本地判不了 | 判定方法 |
| --- | --- | --- | --- |
| H-1 | **AC-29 最终判据** | 真实 H5 编译 + `easycom.custom` 运行时解析 | 控制台无 `Failed to resolve component` / `Unknown custom element`；7 个 `wd-*` 标签实际渲染 |
| H-2 | **AC-07 渲染与深浅色** | 需真实浏览器渲染 `marked` + DOMPurify + `prefers-color-scheme` | 切系统深/浅色，核对标题/列表/代码块/表格/图片 |
| H-3 | **AC-27 三栏 / 抽屉目视** | 需真实断点与视口 | 1440px 看 260/320/自适应；375px 看单栏 + 左抽屉；**新增的「移动到」居中弹层**在移动端不溢出 |
| H-4 | **AC-28 首屏动效目视** | 「不闪烁、不空白跳变」只能看 | 弱网刷新，确认加载层整段覆盖、淡出无闪白 |
| H-5 | **AC-12「放弃」后编辑框文字仍在** | 需真实 DOM | 两会话造冲突 → 点「放弃」→ 确认编辑器里刚才敲的字原样还在、停留编辑态、可再次保存 |
| H-6 | **R3 真实 DOM 选区四场景** | `window.getSelection()` 与真实 marked 输出 | 含图片/表格/多段落/纯文本各选一段 → 加批注 → 确认落库 `selected_text` 与所选**逐字相同** |
| H-7 | **三条上传链路实测**（参数形态已按官方文档核对通过，剩真实跑通） | 需真实服务空间 | 上传 md、图片空间上传新图、上传文件夹自定义图标，各自确认云存储出现文件 + 表里出现记录 |
| H-8 | **导出/移动/改名的真实交互** | 需真实云存储与 `downloadFile` | 导出确认下载文件内容完整且图片是临时 URL（不是 `mm-image://`）；移动后重开确认 `parent_id` 变更；改名后确认顶部标题与列表同步 |
| H-9 | AC-01/06/08/10/18/19/26 + AC-05/AC-24（本轮已下调为部署后验证） | 真实云存储 / 真实 uni-id 多用户 | 按 `docs/DEPLOY.md` 部署清单执行 |

---

## 9. 结论

- **工程师报告的修复项基本落实**：导出 / 移动 / 改名三条 P0 链路均已接线（PC 与抽屉双处绑定齐全），`@add` 与 `:active-comment-id` 修好，全项目**死绑定 0 处**（`@create` 类缺陷清零），`uploadFile` 统一到单一工具且与官方契约一致，文档订正诚实（AC-05/AC-24 已下调、无残留用例名、汇总 17/9/5 自洽）。
- **R2 的 H-7「上传参数形态」误判本轮撤销**：官方文档与 DCloud 自带示例均证实 `filePath` 是唯一正确形态。
- **仍有 1 条 Engineer 项（E-1，P2）**：文件夹「移动到自己的子目录」置灰失效，根因是 `listTree` 不返回 `type`；服务端 4003 兜底，无数据损坏，一行即可修复。
- 另有 6 条**非阻塞建议**（30s 定时器、2 处文档同步、根节点置灰一致性等），不影响任何 AC 判定。

**因此本轮路由判定为 Engineer，任务 #4 保持 in_progress。**
