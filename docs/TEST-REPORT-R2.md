# 测试报告 R2 · 前端源码级验收

> 角色：QA（严过关）｜ 项目：MarkdownManager ｜ 轮次：第 2 轮（只验前端与交付文档一致性）
> 基线：`docs/PRD.md`、`docs/ARCHITECTURE.md`（含 0.5 节 **R1~R4**、1.5 R3 对齐标注、2.6 权限口径、7.4 落地写法）、`docs/COMPONENT-CONTRACT.md`、`docs/AC-CHECKLIST.md`、`docs/TEST-REPORT-R1.md`
> 本轮**未修改任何业务源码**（页面 / 组件 / common / 云对象 / schema / 文档均未改动），只新增 `tests/ui/image-state.test.js`、`tests/ui/frontend-static.test.js` 与本报告。
> **H5 真实编译由主理人并行执行，本轮不重复编译，也不因「未编译」判任何项失败。**

---

## 0. 执行结果总览

```text
$ node --test "tests/**/*.test.js"
1..161
# tests 161
# pass 160
# fail 1
```

| 范围 | 用例 | 通过 | 失败 |
| --- | --- | --- | --- |
| R1 后端源码级（13 文件） | 125 | 125 | 0 |
| R1 前端 R3 纯函数（工程师 `tests/ui/selection.test.js`） | 7 | 7 | 0 |
| **R2 新增** `tests/ui/image-state.test.js`（图片双态） | 12 | 12 | 0 |
| **R2 新增** `tests/ui/frontend-static.test.js`（前端静态 + 文档一致性） | 17 | 16 | **1** |
| 合计 | **161** | **160** | **1** |

**唯一失败用例**：`组件 prop 绑定名与 defineProps 声明一致（契约一致性）`
→ `pages/index/index.vue` 给 `<mm-annotation>` 绑了 `:active-id`，组件声明的是 `activeCommentId`，该绑定**不生效**（详见第 6 项）。

### 本轮 8 项验证结论速览

| # | 验证项 | 结论 |
| --- | --- | --- |
| 1 | AC-12 前端侧（冲突「放弃」不清空编辑器） | ✅ **通过**（逐行证据见 §1） |
| 2 | AC-13/14 前端 R3 最后一环（`plainText.slice()` / 无 `Range.toString()` / 失败返 null） | ✅ **通过** |
| 3 | 图片双态闭环（存储态 ↔ 显示态） | ✅ **通过**（新增 12 用例全绿） |
| 4 | AC-27 代码层（断点 / rpx / 配色） | ✅ **通过**（代码层；布局目视待编译） |
| 5 | AC-28 代码层（加载动画时序） | ✅ **通过**（代码层；动效目视待编译） |
| 6 | AC-07 / AC-29 / AC-30 | ⚠️ **有 1 项缺陷**：AC-07/29/30 均通过，但组件契约一致性失败 1 处（prop 名不匹配） |
| 7 | 交互链路静态走查 | ❌ **3 个 P0 功能未接线**：导出 md、移动、文档改名 |
| 8 | 文档一致性 | ⚠️ **API.md 一致**；`AC-CHECKLIST.md` 有 2 处**证据引用不实** |

---

## 1. AC-12 前端侧：冲突「放弃」不丢内容 —— ✅ 通过

### 1.1 完整数据流与逐行证据

**① 发起保存（`pages/index/index.vue:605-633`）**

```js
605  async function handleSave() {
606    const file = store.state.currentFile
607    if (!file || saveStatus.value === 'saving') return
608    saveStatus.value = 'saving'
610    const res = await saveContent({
611      file_id: file._id,
612      content: store.state.editorContent,     // 只读 store，不写
613      base_version: store.state.baseVersion
614    })
620    if (res.code === 2001) {
622      saveStatus.value = 'conflict'
623      conflict.value = { cloudVersion: …, cloudPreview: …, cloudUpdatedAt: … }
628      conflictVisible.value = true
629      return
630    }
```

→ 冲突分支**只**做三件事：置状态、填弹窗数据、打开弹窗。**没有** Toast、没有 `store.setEditor`、没有 `mode` 变更、没有跳转。

**② API 层不拦不抛（`common/api/index.js:74-93`）**

```js
83   const silent = result.code === ERR.VERSION_CONFLICT || result.code === ERR.UNAUTHORIZED
84   if (result.code !== ERR.OK && !silent) { showErrorToast(result.message) }
87   return result
```

→ `2001` 被判定为业务返回，**不弹全局 Toast、不抛异常**，`{code:2001, data:{cloudVersion, cloudContent, cloudUpdatedAt}}` 原样返回。

**③ 冲突弹窗只发事件（`components/mm-conflict-modal/mm-conflict-modal.vue`）**

- L29 全文唯一 import：`import { computed } from 'vue'` —— **没有** import store / api / uni 任何东西。
- L46-48 `onOverwrite()` 仅 `emit('overwrite')`；L50-52 `onDiscard()` 仅 `emit('discard')`。
- L41-44 `modelVisible` 只 `emit('update:visible')`。
- 模板 L1-20 只渲染文案与两个按钮，**不含任何输入控件**，物理上无法改正文。

**④「放弃」分支（`pages/index/index.vue:672-676`）**

```js
672  function handleConflictDiscard() {
674    conflictVisible.value = false
675    saveStatus.value = 'dirty'
676  }
```

→ 只有两行赋值：关弹窗、状态回 `dirty`。**未触碰 `editorContent`、未切 `mode`、未跳转。**

**⑤「覆写」分支（`pages/index/index.vue:654-670`）**

```js
657    conflictVisible.value = false
658    saveStatus.value = 'saving'
659    const res = await saveContent({
661      content: store.state.editorContent,      // 仍是用户当前内容
662      base_version: conflict.value.cloudVersion,
663      force: true
664    })
665    if (res.code === 0) applySaveSuccess(file, res.data)
```

→ 覆写只改变提交参数，不改内容；失败也只是 `dirty` + Toast。

**⑥ 保存成功后刷新元数据（`pages/index/index.vue:635-652`）—— 关键防回归点**

```js
635  async function applySaveSuccess(file, data) {
636    saveStatus.value = 'saved'
637    store.resetBaseVersion(data.version)
639    store.openFile(
640      { ...file, version: data.version, size: data.size, content_hash: data.content_hash, updated_at: data.updated_at },
647      store.state.editorContent,      // ← 第二参显式传「当前内容」，不会置空
648      store.state.comments
649    )
650    await reloadComments(file._id)
652  }
```

→ `openFile` 是唯一允许替换 `editorContent` 的入口（`common/store/index.js:97-108`），而这里第二参传的就是 `store.state.editorContent` 本身，因此**语义上等价于不变**。
→ `reloadComments`（L400-404）只写 `store.setComments(...)`，**不碰正文**——这是你特别要求排查的点，已确认安全。

**⑦ 全项目跳转 / 内容写入点穷举**

| 检查 | 结果 |
| --- | --- |
| `navigateTo` / `redirectTo` / `reLaunch` / `switchTab` / `location.reload` | 仅 `index.vue:348`（登录守卫）与 `index.vue:812`（进入设置页），**均不在冲突链路上** |
| `store.setEditor(` 调用点 | 仅 `index.vue:286`（编辑器 v-model setter）与 `index.vue:780`（插入图片时**追加**，非重置） |
| 冲突链路是否切换 `mode` | 否（`mode.value` 仅在 `openDocument` L490 / `handleSearchSelect` L756 被置 `'read'`，冲突链路不经过） |

### 1.2 结论

**AC-12 前端侧通过。** 覆写与放弃两条分支、以及保存成功后的元数据刷新，都不会给 `store.editorContent` 赋空、不会跳转、不会把编辑态切回阅读态。「放弃」后用户停留在编辑态、`saveStatus='dirty'`，可继续编辑或再次保存。
（**编辑框内文字是否仍然可见**还需编译后在浏览器目视确认——属 §7 的 HBuilderX 清单。）

---

## 2. AC-13 / AC-14 前端 R3 最后一环 —— ✅ 通过

| 检查点 | 证据 | 结论 |
| --- | --- | --- |
| 阅读器渲染后构造对齐映射 | `components/mm-md-viewer/mm-md-viewer.vue:76` `buildDomPlainMap(el, props.plainText \|\| '', true)`（在 `applyHighlights` 内，`mounted`/`watch` 均会走到） | ✅ |
| 选区换算走映射而非 DOM 长度累加 | `common/utils/selection.js:262-291` `getSelectionOffsets`：L265 强制重建映射 → L273-274 `offsetAtPoint` 查 `map.entries` → L279 `const selectedText = text.slice(start, end)` | ✅ 无退化 |
| `selectedText` / `prefix` / `suffix` 全部来自 `plainText.slice()` | `selection.js:279`、`288`、`289`；`mm-annotation.vue:145-151` 直接透传 `pendingOffsets` 的四个字段 | ✅ |
| 映射失败返回 `null` 并提示 | `selection.js:266/269/271/275/280` 五处 `return null`；`mm-annotation.vue:102-106` `if (!offsets) { uni.showToast({ title: '该位置不支持批注' }); return }` | ✅ |
| 全项目 `Range.toString()` / `getSelection().toString()` 实际调用 | grep 结果：仅 `selection.js:13`、`selection.js:278`、`index.vue:193` **三处注释提到该字样**，**零处实际调用** | ✅ 0 命中 |
| 服务端最后防线仍在 | `mm-comment.add` 4004（R1 已验，`tests/mm-comment.test.js` T-85~T-87） | ✅ |

**次要观察（不判失败）**

1. `mm-annotation` 的 `startAdd()` 用 `document.querySelector('.mm-viewer__body')`（`mm-annotation.vue:97`）。批注侧栏在**编辑态也渲染**（`index.vue:99-107` 在 `mode` 条件之外），此时阅读器不存在 → 命中 `L98-100` 分支，提示「请先打开文档」。文案不准（文档其实已打开，只是不在阅读态），建议改为「请切换到阅读态后再添加批注」。
2. `index.vue:679-684` 的 `handleSelectText` / `pendingSelection` 是**死代码**（`pendingSelection` 从未被写入有效选区，`handleSelectText` 无调用方）。不影响功能，建议清理。

---

## 3. 图片双态闭环 —— ✅ 通过（新增 `tests/ui/image-state.test.js`，12/12）

### 3.1 测试如何测到「真实源码」

双态逻辑写在 SFC 的 `<script setup>` 内，**无法 import**（`mm-md-editor` 的 `toDisplayState` / `toStorageState` 依赖闭包变量 `mergedUrlMap`；`mm-md-viewer` 的 `toDisplayState` 是组件内私有函数）。因此测试采用**从 `.vue` 源码文本按括号配平抽取函数原文 → 注入最小作用域 → `new Function` 执行**的方式，测的是随包发布的真实函数体，不是复制品；函数改名或改结构会直接抛错，起到回归告警作用。

### 3.2 断言覆盖（12 项全通过）

| 用例 | 断言 |
| --- | --- |
| 正向替换 | 显示态不含 `mm-image://`、含临时 URL、alt 与正文不被破坏 |
| 反向替换 round-trip | `toStorageState(toDisplayState(s)) === s` 恒等 |
| 无映射 | 原样保留 token，不崩 |
| 特殊字符 URL | 含 `?` `&` `=` `%` `#` 的临时 URL 正向写入 + 精确反向还原 |
| 多图混合 | 有 URL 的还原、未映射的保留 token、其余正文不动 |
| 连续往返 5 次 | 存储态零漂移 |
| 非字符串入参 | 安全降级为空串 |
| 阅读器 ↔ 编辑器一致 | 同一输入同一映射，两侧 `toDisplayState` 输出**完全相同** |
| 存储态纯净性 | round-trip 后不含 `http(s)://`（证明临时 URL 不会被持久化） |
| 接线静态断言 ×3 | `displayValue.set` 在 emit 前走 `toStorageState`；`renderedHtml` 走 `toDisplayState` 再 `marked.parse`；主壳 `:md-source="store.state.editorContent"` + proxy setter 写回 `store.setEditor` |

### 3.3 代码证据链

```
用户插入/编辑
  ↓  mm-md-editor.vue:85-88  displayValue.set → emit('update:modelValue', toStorageState(value))
  ↓  index.vue:284-287       editorContentProxy.set → store.setEditor(value)      ← store 里永远是存储态
  ↓  index.vue:278-281       plainText = mmText.stripMarkdown(store.state.editorContent)  ← 坐标系基于存储态
渲染
  ↓  index.vue:83-87         :md-source="store.state.editorContent" / :image-url-map="imageUrlMap"
  ↓  mm-md-viewer.vue:47-55  toDisplayState(props.mdSource, props.imageUrlMap) → marked.parse → DOMPurify
  ↓  mm-md-editor.vue:85-87  displayValue.get → toDisplayState(props.modelValue) → MdEditor
```

`index.vue:789-800` `loadImageUrlMap` 从存储态 `mm-image://<fileID>` 提取 fileID 批量 `getTempUrls`，**临时 URL 只进 `imageUrlMap`（内存 ref），不落库、不进 `editorContent`**。与 `tests/schema.test.js` 的 `mm-images` 无 URL 字段互为印证。

**AC-08（双路径：上传新图 / 复用已有）**：`mm-image-picker.chooseNew`（L95-127，uploadFile → register → getTempUrls → emit）与 `pick`（L129-137，直接复用 `file_id`）；`mm-md-editor.handleUploadImg`（L100-139）为第二个上传入口。`mm-image.register` 幂等保证复用不重复登记（R1 已验证）。

**AC-09（库中只存 fileID）**：`tests/schema.test.js` T-60 已验字段清单；本轮新增断言「存储态不含 http」。

---

## 4. AC-27 代码层 —— ✅ 通过（代码层）

| 检查点 | 证据 | 结论 |
| --- | --- | --- |
| `<768px` 单栏 + 左抽屉 | `index.vue:329-336` `isMobile = window.innerWidth < 768`；`index.vue:35`/`55` 左右两栏 `v-if="!isMobile"`；`index.vue:117` `<wd-popup v-model="drawerVisible" position="left" custom-style="width:88vw;height:100%;">`；`index.vue:9-11` 汉堡按钮唤起 | ✅ |
| `≥768px` 三栏 260 / 320 / 自适应 | `index.vue:938-943` `.mm-pane--tree{width:260px}`；`945-950` `.mm-pane--list{width:320px}`；`952-956` `.mm-pane--main{flex:1;min-width:0}` | ✅ |
| 业务前端 `rpx` 0 命中 | 全量扫描（2 页面 + 12 组件 + common）：唯一命中是 `index.vue:193` 的中文注释「禁止 rpx」，**真实用法 0 处** | ✅ |
| 颜色全部走 `--mm-*` | 对 14 个业务 `.vue` 的 `<style>` 块扫 `#hex` / `rgb()` / `hsl()`：**0 处硬编码** | ✅ 无遗留 |
| 深浅两套配色完整 | `common/theme.css` 四组（`:root` / `@media prefers-color-scheme:dark` / `html[data-theme="light"]` / `html[data-theme="dark"]`）**各 11 个变量、键集合完全一致**；抽查 `--mm-bg`/`--mm-surface`/`--mm-text`/`--mm-border` 深浅取值均不同 | ✅ 无缺键 |
| 主题样式真的被引入 | `main.js:18` `import '@/common/theme.css'`（VUE3 条件编译块内） | ✅ |

**代码层通过；「三栏/抽屉在真实浏览器里的实际断点与视觉」须编译后目视**（见 §7）。

**次要观察**：布局用 JS `isMobile` 驱动而非 CSS 媒体查询，`isMobile` 初值 `false`，靠 `onLoad`/`onMounted` 里的 `updateViewport()` 纠正。移动端首帧理论上可能先闪一次三栏（uni-app 的 `onLoad` 早于挂载，实际概率低）。若编译后目视发现闪烁，建议给 `.mm-pane--tree/list` 补 `@media (max-width:767px){display:none}` 兜底。

---

## 5. AC-28 代码层 —— ✅ 通过（代码层）

| 检查点 | 证据 | 结论 |
| --- | --- | --- |
| 最短展示 ≥300ms | `mm-loading.vue:17` `minDuration: { type: Number, default: 300 }` + `L47-53` `scheduleHide()` 用 `remain = max(0, minDuration - elapsed)` 保证总展示不低于 300ms | ✅ |
| 淡出过渡 ≥180ms | `mm-loading.vue:82` `transition: opacity 0.18s ease` | ✅ |
| 淡出结束才移除节点 | `mm-loading.vue:37-45` `hideNow()`：先置 `visibleMark=false` 进入淡出，`setTimeout(200)` 后才 `rendered.value=false` 并 `emit('finish')`（200 ≥ 180） | ✅ |
| `ready` 前覆盖全屏 | `mm-loading.vue:2` `v-if="rendered"`，`L23` 初值 `ref(props.visible)`；`L70-83` `position:fixed` + 四边 `0` + `z-index:999`；`index.vue:4` `:visible="!store.state.ready"` | ✅ |
| 不出现「闪一下就没」 | 初始 `visible=true` → `rendered=true` 立即占屏；就绪后走 `scheduleHide` 补齐 300ms，再 180ms 淡出 | ✅ |
| `ready` 置位时机 | `App.vue:20` `await getConfig()` → `L34` 主题 → `L38` `store.setReady(true)`；配置读取异常被 `try/catch` 吞掉后仍会置位，**不会永久卡在加载页** | ✅ |
| 不出现白屏跳变 | 加载层底色 `var(--mm-bg)` 与主壳 `.mm-app` 底色同源（`index.vue:855`），淡出时无颜色跳变 | ✅ |

**代码层通过；实际动效是否「不闪烁、不空白跳变」须编译后目视**（见 §7）。

---

## 6. AC-07 / AC-29 / AC-30 与组件契约 —— ⚠️ 1 处缺陷

### 6.1 AC-07（渲染与深浅色）

| 检查点 | 结论 |
| --- | --- |
| 主题变量深浅完整（T-1） | ✅ 见 §4 |
| md 渲染链路 | ✅ `mm-md-viewer.vue:36` `marked.use({gfm:true,breaks:true})` → `L49` `marked.parse(display)` → `L51-53` `DOMPurify.sanitize`（**在 computed 内调用，不在模块顶层**，符合 R2 约束③） |
| 标题/列表/代码块/表格样式 | ✅ `theme.css:117-188` 对 h1~h6 / ul·ol / blockquote / pre·code / table / img / a / hr 均有独立层级 |
| 深色下可读性 | ⚠️ 代码层无缺键、无硬编码；**实际目视需编译** |

**结论：代码层通过，渲染效果待编译后目视。**

### 6.2 AC-29（Wot UI 与示例残留）

| 检查点 | 证据 | 结论 |
| --- | --- | --- |
| 依赖已安装 | `node_modules/wot-design-uni@1.14.0` 存在 | ✅ |
| `easycom.custom` 规则 | `pages.json:2-7` `"^wd-(.*)": "wot-design-uni/components/wd-$1/wd-$1.vue"`（与架构 R1 单一形态完全一致） | ✅ |
| 实际用到 7 个 `wd-*` 标签全部可解析 | `wd-button` / `wd-input` / `wd-loading` / `wd-popup` / `wd-switch` / `wd-tag` / `wd-toast`，逐个确认 `node_modules/wot-design-uni/components/<tag>/<tag>.vue` **全部存在**（7/7） | ✅ |
| 未误用包内不存在的 `wd-dialog` | grep：0 处 | ✅ |
| `pages.json` 无示例页残留 | 18 个页面：2 业务页 + 16 个 `uni-id-pages` 页；**无 `tabBar`**；`pages/clientDB|storage|test|cloudFunction|schema2code` 注册数 **0** | ✅ |
| 示例文件未物理删除 | `cloudfunctions` 仍 20 个目录（15 示例 + 5 新增）、`common` 含 `hello-common` + `mm-common`、`database` 的 `mm-*` 13 文件、`static/icons` 8 个预制图标 | ✅ |

**结论：静态判据全部满足；AC-29 的最终判据（真实 H5 编译 + 控制台无 `Failed to resolve component`）待主理人并行执行的结果。**

### 6.3 AC-30（中文 / 增量 / 无删除）

| 检查点 | 结论 |
| --- | --- |
| 中文 UI 文案 | ✅ 模板文本节点抽查「保存/阅读/编辑/上传/导入/回收站/批注/账号功能/权限功能/彻底删除」全在；保存态文案「已保存/未保存/保存中/有冲突」在 computed 中；`pages.json` 18 个页面标题全部含中文 |
| 无英文界面词残留 | ✅ 模板文本节点对 `Save/Cancel/Delete/Search/Upload/Import/Export/Settings/Close/Confirm/Loading/Submit` 黑名单扫描：0 命中 |
| 除目标文件外无无关改动 | ✅ 本轮未改任何文件；示例云函数/schema/静态资源均在位 |

### 6.4 ❌ 组件契约一致性：prop 绑定名不匹配（唯一失败项）

```text
pages/index/index.vue → <mm-annotation> 绑定了 activeId，
但组件声明的是 [comments, plainText, activeCommentId]
```

- **位置**：`pages/index/index.vue:102` `:active-id="activeCommentId"`；`components/mm-annotation/mm-annotation.vue:64` `activeCommentId: { type: String, default: '' }`。
- **后果**：Vue 把 `active-id` 解析成 `activeId` 落到 `attrs`，组件读到的 `props.activeCommentId` 恒为 `''`，`mm-annotation.vue:13` 的 `:class="{ 'is-active': item._id === activeCommentId }"` **永远为 false** → 点击阅读器高亮或侧栏批注时，**侧栏对应条目不会显示选中态**。
- **违反**：`docs/COMPONENT-CONTRACT.md` §2 `mm-annotation` 的 `activeCommentId` 契约。
- **影响面**：仅选中态高亮，锚点跳转（`locate` → `scrollToOffset`）仍正常；不影响 C4/AC-13/14 数据正确性。
- **判定**：**Engineer 路由项（P2）**，一行修复：`:active-id` → `:active-comment-id`。

---

## 7. 交互链路静态走查 —— ❌ 3 个 P0 功能未接线

逐项给出「代码路径 + 是否闭环 + 缺口」。

| # | 链路 | 代码路径 | 闭环 | 缺口 |
| --- | --- | --- | --- | --- |
| 1 | 上传 md | `mm-file-list.vue:5` emit upload → `index.vue:535-571` `handleUpload`：`uni.chooseFile(['.md'])` → `readFileText` → `CLOUD_PATH.markdown(uid)` + `genUuid()` → `uniCloud.uploadFile` → `registerUpload({name,parent_id,storage_key,content})` → 刷新列表与树 | ✅ 逻辑闭环 | `uploadFile` 参数形态待编译验证（见 §8.1） |
| 2 | 导入 md | `mm-file-list.vue:6` emit import → `index.vue:573-602` `handleImport`：`chooseFile` → `readFileText` → `importFile({name,parent_id,content})`（云对象自己上传） → 刷新 | ✅ | 无 |
| 3 | **导出 md** | `common/api/mm-file.js:56` 有 `exportFile`；`common/utils/download.js:13` 有 `downloadMarkdown`；**但全项目无任何调用方，无「导出」按钮/菜单** | ❌ **未接线** | **R15 / AC-24 导出功能整体缺失** |
| 4 | 新建文件夹 | `mm-folder-tree.vue:45/132` emit create → `index.vue:417-425` `handleCreateFolder` → `openInput` → `createFolder` → `loadTree` | ✅ | 无 |
| 5 | **文件夹改名** | `mm-folder-tree.vue:133` emit rename → `index.vue:427-437` `handleRenameFolder` → `rename` | ✅ | 无 |
| 6 | **文档改名** | `mm-file-list.vue` 只有 `open` / `select-change` / `sort-change` / `upload` / `import` / `batch-delete` 六个 emit，**无 rename 入口**；`index.vue` 的 `rename` 只被 `handleRenameFolder`（L431）调用 | ❌ **未接线** | **R06「文件名可修改」前端缺失** |
| 7 | **移动文件/文件夹** | `common/api/mm-file.js:35` 有 `move`；`mm-folder-tree` 菜单 `itemList`（L130）只有「新建子文件夹/重命名/更换图标/删除」；`mm-file-list` 无「移动到」 | ❌ **未接线** | **R06「文件可放入/移动到任意文件夹」前端缺失**（AC-05 前端侧未闭环） |
| 8 | 删除（文档/文件夹） | `mm-file-list.vue:13` emit batch-delete → `index.vue:504-519` `handleBatchDelete` → `uni.showModal` → `softDelete`；文件夹 `index.vue:439-454` `handleRemoveFolder` | ✅ | 无 |
| 9 | 回收站还原 / 彻底删除 | `mm-trash.vue:102-111` restore / `L113-130` purgeDelete，二次确认文案「文件将从云端永久删除，不可恢复」，`changed` → `index.vue:764-767` 刷新 | ✅ | 无 |
| 10 | 搜索五类 scope | `mm-search-panel.vue:121-127` 5 个 scope → `search({keyword, scope})` → 分组渲染；正文命中 `pickContent` 带 `start_offset` → `index.vue:742-762` 打开文档后 `setTimeout(120)` 调 `handleLocateComment` → `viewer.scrollToOffset` | ✅ | `start_offset` 回跳有 120ms 固定延时，若阅读器未及时挂载会跳空（建议改 `nextTick`+重试，非阻塞） |
| 11 | 设置页两开关 + 4001/4005 | `mm-settings-panel.vue:83-89` 受控 emit → `settings.vue:131-141` `handleUpdateConfig` → `updateConfig`；失败时不写 `store.config`，`wd-switch` 因受控自动回滚；错误提示由 `common/api/index.js:84-86` 用**后端原始 message**（4001「请先删除至单用户」/4005「请先开启账号功能」）；且权限开关 `:disabled="!accountEnabled"`（L15）从 UI 层就阻止了 4005 | ✅ | 无 |
| 12 | 标签编辑 | `common/api/mm-file.js:41` 有 `setTags`，**无调用方**；`mm-file-list` 的标签只读展示 | ⚠️ **未接线** | R25（P1）未实现；连带影响 AC-21 的「标签」维度——后端可搜，但前端无法产生标签数据 |

**汇总**：11 条链路中 7 条闭环、**3 条 P0 未接线**（导出 / 移动 / 文档改名）、1 条 P1 未接线（标签）。

---

## 8. 文档一致性 —— ⚠️ API.md 一致，AC-CHECKLIST 有 2 处证据不实

### 8.1 `docs/API.md` ↔ 云对象实际导出：✅ 完全一致（已转成测试）

| 云对象 | API.md 声明 | 实际 `module.exports`（除 `_before`） | 一致 |
| --- | --- | --- | --- |
| `mm-file` | 17 个 | 17 个 | ✅ |
| `mm-comment` | 5 个 | 5 个 | ✅ |
| `mm-search` | 1 个 | 1 个 | ✅ |
| `mm-settings` | 6 个 | 6 个 | ✅ |
| `mm-image` | 4 个 | 4 个 | ✅ |

- 错误码表 18 行 ↔ `common/constants.js` 的 `ERR` 18 个键**逐项一致**（新增测试断言）。
- `common/api/*.js` 里 `call()` 引用的 20+ 个方法名，**全部真实存在**于对应云对象（新增测试断言）。
- 方法名 `move` / `setTags` / `exportFile` 在 API.md 与云对象里都存在，**只是前端没有调用方**（§7）——说明文档本身没写错，是前端未接线。

**轻微瑕疵**：`API.md:149` 出现「已由 IS_PASS 审查验证」——`IS_PASS` 是残留的占位标识，建议改成具体证据（`tests/error-constants.test.js`）。

### 8.2 `docs/AC-CHECKLIST.md` 三态标注：⚠️ 形式合规，**2 处证据引用不实**

**形式层面通过**（已转成测试）：
- 31 条 AC 齐全、编号唯一；
- 状态只用了三种合法值；
- 汇总表 `19 / 7 / 5` 与实际统计**完全自洽**；
- 没有出现「基本/大致/应该已通过」这类含糊词。

**❌ 实质问题（2 处夸大）**：

| AC | 标注 | 声称的证据 | 实际情况 | 判定 |
| --- | --- | --- | --- | --- |
| **AC-05** | `本地已验证` | 「`tests/mm-file.test.js`（**createFolder/move**/collectSubtreeIds）」 | 该文件中 **`createFolder` 与 `move` 各 0 个用例**（grep 计数 = 0）；`collectSubtreeIds` 只是被 `purgeDelete` 间接覆盖。**且前端 move 完全未接线**（§7 #7） | **证据引用不实 + 状态应下调** |
| **AC-24** | `本地已验证` | 「`tests/mm-file.test.js`（**importFile/exportFile**）；字节一致需真实云存储复验」 | 该文件中 **`importFile` 与 `exportFile` 各 0 个用例**（grep 计数 = 0）；**且前端导出功能整体缺失**（§7 #3） | **证据引用不实 + 状态应下调** |

**轻微问题（不单独判失败，一并修正）**：
- AC-09 证据写「`mm-images` 表无 tempUrl 字段（`tests/schema.test.js`）」——该测试断言的是 `required` 字段清单，**并未显式断言「不存在 tempUrl 属性」**。结论正确（本轮 `image-state.test.js` 已从另一侧补证「存储态不含 http」），但引用方式不够严谨。
- AC-12 证据写「`tests/mm-file.test.js` + 源码」——`tests/mm-file.test.js` 只覆盖服务端侧（R1 T-70），前端侧是**纯源码级**证据（即本报告 §1）。建议改成「源码级（TEST-REPORT-R2 §1）+ 服务端 `tests/mm-file.test.js`」。
- AC-13/14/23 的 R3 部分如实标注了「真实 DOM 点击属编译后人工验证」，✅ 诚实。

**建议修订**（由工程师改，我不动业务文档）：

```diff
- | AC-05 | … | `本地已验证` | `tests/mm-file.test.js`（createFolder/move/collectSubtreeIds）；`mm-folder-tree` 扁平渲染支持不限层 |
+ | AC-05 | … | `未验证`（后端 move/createFolder 无用例，前端无移动入口） | `mm-folder-tree` 扁平渲染支持不限层（源码级）；**移动功能前端未接线** |

- | AC-24 | … | `本地已验证` | `tests/mm-file.test.js`（importFile/exportFile）；字节一致需真实云存储复验 |
+ | AC-24 | … | `未验证`（前端无导出入口；importFile/exportFile 无用例） | 导入链路源码闭环；**导出功能前端缺失**；字节一致需部署后验证 |
```

---

## 9. 智能路由判定

### 结论：**Engineer（4 项，其中 3 项 P0）**

| # | 路由项 | 严重度 | 证据 | 建议修复 |
| --- | --- | --- | --- | --- |
| **E-1** | **导出 md 功能整体缺失** | **P0** | `api/mm-file.js:56` 有 `exportFile`、`utils/download.js:13` 有 `downloadMarkdown`，**全项目 0 调用方、0 按钮** | 在 `mm-file-list` 工具条或文件行菜单加「导出」，调 `exportFile` → 若 `data.content` 为空则 `fetch(data.tempUrl)` → `downloadMarkdown(name, content)` |
| **E-2** | **移动文件/文件夹功能缺失** | **P0** | `api/mm-file.js:35` 有 `move`，**0 调用方**；`mm-folder-tree` 菜单无「移动到」；`mm-file-list` 无移动入口 | 文件行菜单加「移动到…」→ 选目标文件夹 → `move({file_id, parent_id})` → 刷新 |
| **E-3** | **文档改名功能缺失** | **P0** | `rename` 仅被 `handleRenameFolder`（`index.vue:431`）调用；`mm-file-list` 无 rename emit | `mm-file-list` 加 rename emit + 文件行菜单，页面接 `openInput` → `rename({file_id, name})` |
| **E-4** | `<mm-annotation>` prop 名不匹配 | **P2** | `index.vue:102` `:active-id` vs `mm-annotation.vue:64` `activeCommentId` | 改为 `:active-comment-id` |

**非阻塞但建议一并处理（不构成 Engineer 路由）**

| # | 事项 | 说明 |
| --- | --- | --- |
| N-1 | AC-CHECKLIST 的 AC-05 / AC-24 证据引用不实 | 见 §8.2，建议随 E-1~E-3 一并把状态下调为 `未验证` |
| N-2 | 标签编辑无入口（`setTags` 0 调用） | R25 属 P1，可在下一迭代补；但会让 AC-21「标签」维度前端不可达，建议在 CHECKLIST 注明 |
| N-3 | `API.md:149` 残留 `IS_PASS` 字样 | 文档质量，改成 `tests/error-constants.test.js` |
| N-4 | 批注侧栏在编辑态提示「请先打开文档」 | 文案不准，建议改「请切换到阅读态」 |
| N-5 | `index.vue:679-684` 死代码（`handleSelectText` / `pendingSelection`） | 建议清理 |
| N-6 | 搜索回跳固定 120ms 延时 | 建议改 `nextTick` + 重试 |

### QA 自身修正记录（不路由）

本轮新增测试初版有 3 处断言写错，均由 QA 自行修正，**源码无问题**：

1. `frontend-static.test.js` AC-30 把「设置」当成模板文本节点 —— 它实际来自 `pages.json` 的 `navigationBarTitleText`，已拆成独立用例；
2. 同文件把「已保存/未保存/有冲突」当成模板文本 —— 它们由 `saveStatusText` computed 生成，已拆成独立用例；
3. 同一用例里对 `common/constants.js`（ESM）误用 `require()`，已改用既有 `helpers/load-esm.js`。

---

## 10. 必须由人在 HBuilderX 完成才能判定（本轮一律不判失败）

| # | 条目 | 为什么本地判不了 | 判定方法 |
| --- | --- | --- | --- |
| H-1 | **AC-29 最终判据** | 真实 H5 编译 + `easycom.custom` 运行时解析 | HBuilderX 发行 → 网站-PC Web/手机 H5；控制台无 `Failed to resolve component` / `Unknown custom element`；`<wd-button>` 等 7 个标签实际渲染 |
| H-2 | **AC-07 渲染与深浅色** | 需真实浏览器渲染 `marked` + DOMPurify + `prefers-color-scheme` | 切换系统深/浅色，核对标题/列表/代码块/表格/图片的可读性与对比度 |
| H-3 | **AC-27 三栏/抽屉目视** | 需真实断点与视口 | PC 1440px 看 260/320/自适应三栏；375px 看单栏 + 左抽屉；无横向滚动、无元素重叠 |
| H-4 | **AC-28 首屏动效目视** | 「不闪烁、不空白跳变」只能看 | 弱网限速下刷新，确认加载层整段覆盖、淡出无闪白 |
| H-5 | **AC-12 编辑框内文字仍在页面上** | 需真实 DOM | 两会话造冲突 → 点「放弃」→ 确认编辑器里刚才敲的字**原样还在**、停留编辑态、可再次保存 |
| H-6 | **R3 真实 DOM 选区四场景** | `window.getSelection()` 与真实 marked 输出 | 含图片/含表格/多段落/纯文本各选一段 → 加批注 → 确认落库的 `selected_text` 与所选文字**逐字相同**（不是 DOM 序列文本） |
| H-7 | **图片上传 H5 参数形态（高风险）** | 见 §11.1 | 三处上传各实测一次：编辑器粘贴/选择图片、`mm-image-picker` 上传新图、`mm-icon-picker` 上传自定义图标 |
| H-8 | AC-01/06/08/10/18/19/26 | 真实云存储 / 真实 uni-id 多用户 | 按 `docs/DEPLOY.md` 部署后验证清单执行 |

---

## 11. 遗留风险

### 11.1 高风险：`uniCloud.uploadFile` 的 H5 参数形态在四处用法里不自洽

| 位置 | 传参 |
| --- | --- |
| `components/mm-md-editor/mm-md-editor.vue:112` | `uniCloud.uploadFile({ cloudPath, file })` ← 传 **File 对象** |
| `components/mm-image-picker/mm-image-picker.vue:108` | `uniCloud.uploadFile({ cloudPath, filePath })` ← 传 **blob URL 字符串** |
| `components/mm-icon-picker/mm-icon-picker.vue:115` | `uniCloud.uploadFile({ cloudPath, filePath })` |
| `pages/index/index.vue:548` | `uniCloud.uploadFile({ cloudPath, filePath })` |

同一个 API 在同一项目里出现两种参数形态，至少一组与 H5 端实际契约不符。按 uniCloud 官方 H5 说明，客户端上传需要 `file`（`File`/`Blob`），`filePath` 主要面向小程序/App 的临时路径。若 `filePath` 在 H5 无效，则**上传 md、导入图片、上传自定义图标三条链路会一起失败**（AC-01 / AC-06 / AC-08 全挂）。

我无法在无服务空间的环境下验证真实行为，因此**不判失败**，但列为交付前**必须实测**的第一优先项（H-7）。建议统一改为同时传 `file`（`chooseFile`/`chooseImage` 返回的 `tempFiles[0]`）以消除歧义。

### 11.2 中风险

1. **`exportFile` 依赖服务端 `downloadFile`**：`mm-file.readDocContent` 在云函数端 `downloadFile` 不可用时只返回 `tempUrl`、`content` 为空串。导出若直接用 `data.content` 会得到空文件——即使补了导出入口，也必须处理 `content === ''` 时 `fetch(tempUrl)` 的降级分支。
2. **`mm-loading` 依赖 `App.vue.onLaunch` 一定结束**：若 `getConfig()` 的 Promise 永不 settle（服务空间未绑定 + 网络挂起），`store.setReady(true)` 永不执行，加载动画会永久停留。`callSilent` 有 try/catch，但无法拦截「promise 不 resolve」。建议加超时兜底。
3. **归档索引与标签**：`setTags` 无入口，导致新建文档永远 `tags: []`，AC-21 的标签维度在真实使用中无数据可命中。
4. **`reloadComments` 与保存的竞态**：`applySaveSuccess` 中 `store.openFile(...)` 会把 `comments` 置为旧数组再 `reloadComments` 覆盖，若两次渲染间有批注操作可能闪一下。影响很小。

### 11.3 低风险

1. 编辑态批注按钮提示文案不准（N-4）。
2. 死代码（N-5）。
3. 搜索回跳固定延时（N-6）。
4. `mm-annotation` 用全局 `document.querySelector('.mm-viewer__body')` 定位容器，若未来出现多实例会取错（当前单实例，无影响）。

---

## 12. 结论

- **前端核心正确性通过**：AC-12（放弃不清空）、AC-13/14（R3 最后一环：`plainText.slice()` + 0 处 `Range.toString()` + 失败返 null 提示）、图片双态闭环、AC-07/27/28/29/30 的代码层判据，全部有源码级证据，新增 29 个用例（12 + 17）把其中可自动化的部分固化成回归测试。
- **交付前必须解决 3 条 P0**：导出 md、移动、文档改名均**未接线**（`api` 与云对象都有，前端没有调用方）。这三条直接影响 R06 / R15 与 AC-05 / AC-24。
- **1 条 P2**：`<mm-annotation>` 的 `:active-id` → `:active-comment-id`。
- **2 处文档标注需订正**：AC-05 / AC-24 引用了不存在于 `tests/mm-file.test.js` 的用例。
- **1 条高风险待实测**：`uniCloud.uploadFile` 的 `filePath` vs `file` 形态不一致，可能一次拖垮上传链路。
