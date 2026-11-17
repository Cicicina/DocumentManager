# MarkdownManager 组件契约（T04a / T04b 共用基线）

> 目的：T04a（页面壳 + 管理类组件）与 T04b（阅读 / 编辑 / 批注 / 冲突 / 图片）分两轮实现，
> 本文件固定 12 个组件的 props / emits / expose，两轮严格照此对接，避免接口打架。
> 约定：全部组件位于 `components/<name>/<name>.vue`，靠 `easycom` autoscan 自动引入，页面不写 import。
> 事件命名统一 `kebab-case` 在模板中使用（Vue 自动转换），下表按 `camelCase` 定义。

## 1. T04a 本轮交付组件

| 组件 | props | emits | expose | 说明 |
| --- | --- | --- | --- | --- |
| `mm-loading` | `visible: Boolean`（默认 `true`）<br/>`minDuration: Number`（默认 `300`，毫秒） | `finish` | — | 全屏首屏加载动画；`visible` 转 false 后淡出（≥180ms），且总展示不低于 `minDuration` |
| `mm-folder-tree` | `folders: Array`（扁平 folder 节点，含 `_id/type/parent_id/name/icon`）<br/>`currentId: String`（默认 `''`）<br/>`loading: Boolean` | `select(node)`<br/>`create({ parent_id })`<br/>`rename(node)`（载荷=被操作 folder 节点）<br/>`move(node)`（载荷=被移动 folder 节点）<br/>`remove(node)`<br/>`change-icon(node)` | `expandAll()`<br/>`collapseAll()` | 递归嵌套目录树；`parent_id` 驱动，扁平渲染 + 层级缩进，不限层数；根节点「全部文档」由本组件内置；**`folders` 必须带 `type`**（父级 `moveTargets` 依赖它判定「不能移动到自己的子目录」） |
| `mm-file-list` | `files: Array`<br/>`loading: Boolean`<br/>`selectedIds: Array` | `open(file)`<br/>`select-change(ids)`<br/>`sort-change({ key, dir })`<br/>`upload`<br/>`import`<br/>`rename(file)`（载荷=被重命名文档记录）<br/>`move(file)`（载荷=被移动文档记录）<br/>`export(file)`（载荷=待导出文档记录）<br/>`batch-delete(ids)` | `clearSelection()` | 文档清单：名称 / 标签 / 更新时间 / 大小；本地排序；多选与批量删除；行内「更多」菜单提供 重命名 / 移动到… / 导出 md / 删除 |
| `mm-icon-picker` | `visible: Boolean`<br/>`current: Object\|null`（`{ type, value }`） | `update:visible(Boolean)`<br/>`confirm(icon \| null)` | — | 8 个预制图标 + 自定义上传（`icons/{uid}/{uuid}.{ext}` → `mm-file.updateIcon` 由父级执行） |
| `mm-search-panel` | `visible: Boolean` | `update:visible(Boolean)`<br/>`select({ file_id, start_offset })` | `focus()` | 搜索浮层：关键词 + scope 切换（全部/文件名/标签/批注/正文）；正文命中带 snippet，点击抛出回跳坐标 |
| `mm-settings-panel` | `config: Object`（`{ account_enabled, permission_enabled, admin_user_id }`）<br/>`users: Array`<br/>`loading: Boolean` | `update-config({ account_enabled, permission_enabled })`<br/>`update-permission({ user_id, can_read, can_write })`<br/>`refresh-users` | — | 账号 / 权限开关（权限依赖账号）、用户可读可写授权、4001 原样提示 |
| `mm-trash` | `visible: Boolean` | `update:visible(Boolean)`<br/>`changed` | `refresh()` | 回收站：还原（撞名 `-copyN` 由云侧处理）、彻底删除（二次确认文案「文件将从云端永久删除，不可恢复」）、批量操作 |

## 2. T04b 下一轮交付组件（本文件先固定，T04a 页面已按此引用）

| 组件 | props | emits | expose | 说明 |
| --- | --- | --- | --- | --- |
| `mm-md-viewer` | `mdSource: String`（md 原文，存储态）<br/>`plainText: String`（提纯纯文本，唯一坐标系）<br/>`comments: Array`<br/>`activeCommentId: String`（默认 `''`）<br/>`imageUrlMap: Object`（fileID → 临时 URL） | `select-comment(comment)` | `scrollToOffset(offset)`<br/>`highlightRange(start, end)`<br/>`refresh()` | `marked.parse()` + `DOMPurify.sanitize()` 自渲染；挂载后调 `buildDomPlainMap`；`mm-image://<fileID>` 正向替换为临时 URL 后渲染；**`selectedText/prefix/suffix` 由 `plainText.slice()` 产出，禁止 `Range.toString()`** |
| `mm-md-editor` | `modelValue: String`（**存储态**）<br/>`fileId: String`<br/>`readOnly: Boolean`（默认 `false`）<br/>`imageUrlMap: Object` | `update:modelValue(String)`（emit 前已反替换为存储态） | `insertImage(fileId, name)`<br/>`toStorageState(text)`<br/>`toDisplayState(text)` | 异步加载 `md-editor-v3` 的 `MdEditor`；`:onUploadImg` 为 **prop**；存储态 ↔ 显示态在组件内部双向转换，`store.editorContent` 始终是存储态 |
| `mm-annotation` | `comments: Array`<br/>`plainText: String`<br/>`activeCommentId: String`（默认 `''`） | `add({ start, end, selectedText, prefix, suffix, comment })`<br/>`update({ comment_id, comment })`<br/>`remove({ comment_id })`<br/>`locate(comment)` | — | 批注侧栏：列表 / 新建（阅读态选区，映射不到时提示「该位置不支持批注」）/ 编辑 / 删除 / orphaned 独立态 / 锚点跳转 |
| `mm-conflict-modal` | `visible: Boolean`<br/>`cloudVersion: Number`<br/>`localVersion: Number`<br/>`cloudPreview: String`<br/>`cloudUpdatedAt: String` | `overwrite`<br/>`discard`<br/>`update:visible(Boolean)` | — | 版本冲突弹层；组件只发事件，**绝不改内容 / 不跳转**（C1 / AC-12） |
| `mm-image-picker` | `visible: Boolean`<br/>`uid: String` | `update:visible(Boolean)`<br/>`select({ fileId, name, tempUrl })` | — | 双路径：新上传（`uploadFile` → `mm-image.register`）/ 复用图片空间；临时 URL 不落库 |

## 3. 页面与组件的职责边界

| 页面 | 依赖组件 | 职责 |
| --- | --- | --- |
| `pages/index/index.vue` | `mm-loading`、`mm-folder-tree`、`mm-file-list`、`mm-icon-picker`、`mm-search-panel`、`mm-trash`、`mm-md-viewer`、`mm-md-editor`、`mm-annotation`、`mm-conflict-modal`、`mm-image-picker` | 主壳：首屏 / 登录守卫 / 三栏与抽屉 / 顶部工具栏 / 全链路接线（上传、导入、保存、冲突、主题） |
| `pages/settings/settings.vue` | `mm-settings-panel`、`mm-trash` | 设置页：复用设置面板，并提供图片空间与回收站入口 |

## 4. 全局约束（两轮共同遵守）

1. **数据来源**：展示型组件只接收 props、不发请求，云对象调用集中在页面并通过 emits 上报意图；**例外**：`mm-trash` 与 `mm-search-panel` 作为完整功能面板，允许内部调用 `common/api/*`（查询与自身操作），完成后 emit `changed` / `select` 通知页面刷新或回跳。
2. **坐标系统一**：批注与索引 offset 一律相对 `plainText`（`mm-common.stripMarkdown` 的结果），组件不得自行换算。
3. **主题**：颜色只用 `var(--mm-*)`，禁止硬编码色值；深浅色两套都要可读。
4. **尺寸**：H5 一律 `px` / `rem`，**禁止 rpx 做布局尺寸**。
5. **Wot UI**：`<wd-*>` 标签直接用（`easycom.custom` 解析），不写 import；轻提示需页面放 `<wd-toast />` 挂载点；包内无 `wd-dialog`，确认弹层用 `wd-message-box` / `wd-popup`。
6. **中文 UI**，避免多余小字说明，保留必要的错误与操作反馈。
7. **图片双态**：库与 `store.editorContent` 一律存储态 `![名称](mm-image://<fileID>)`；阅读器 / 编辑器 / 导出渲染时才正向替换为 `getTempUrls` 的临时 URL；编辑器在 `update:modelValue` 前反替换回存储态。临时 URL 不落库，其时效在 `docs/DEPLOY.md` 注明。
