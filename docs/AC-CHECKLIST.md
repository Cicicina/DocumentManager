# AC 验收自检对照表（AC-01 ~ AC-31）

> 状态口径只有三种，**不许含糊**：
> - `本地已验证`：已用测试文件或源码级证据确认，注明证据；
> - `部署后验证`：依赖真实服务空间 / 云存储 / 登录态，需按 `docs/DEPLOY.md` 在 HBuilderX 完成后验证；
> - `未验证`：本地既未编译也未测到，写明原因。
>
> 单元测试汇总（QA 与工程师共同）：`npm test` → **132 pass / 0 fail**，详见 `docs/TEST-REPORT-R1.md`。
> 测试文件：`tests/*.test.js`（13 个）+ `tests/ui/selection.test.js`（1 个）。
> H5 真实编译：CLI 通道未通（见 DEPLOY.md 9.2），因此涉及「编译/目视」的条目一律记「未验证」。

---

## A. 上传与元数据

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-01 | 上传后云存储出现 `markdown/{uid}/{uuid}.md`，文件表 12 字段齐全、`version=0`、`extension='md'` | `部署后验证` | 源码已实现：`mm-file.registerUpload`（`CLOUD_PATH.markdown(uid)` + `genUuid()`）；真实云存储需部署后验证 |
| AC-02 | 同目录同名依次 `原名-copy1.md`、`-copy2.md`；改名撞名同样 | `本地已验证` | `tests/name.test.js`；`mm-common/lib/name.js` `genUniqueName` |
| AC-03 | 保存后 `size`/`content_hash`/`updated_at` 变化、`version+1`、`created_at` 不变 | `本地已验证` | `tests/mm-file.test.js`；`mm-file` `saveContent` 559~620 行 update 字段不含 `created_at` |
| AC-04 | 客户端伪造时间提交，落库仍为服务器时间 | `本地已验证` | `tests/schema.test.js`（全部 timestamp 带 `forceDefaultValue: {$env:'now'}`）；云对象用 `mm-common.now()` |

## B. 目录与图标

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-05 | 可创建三级嵌套文件夹，文件可放入/移动，`parent_id` 一致 | `部署后验证` | 前端链路已闭环（源码级）：`mm-folder-tree` emit `create`/`move` → `index.vue` `handleCreateFolder` / `handleMoveFile` + `chooseMoveTarget` → `mm-file.createFolder` / `move`（含 4003 自身子树校验）；**无单测覆盖**，实际嵌套与移动效果需部署后验证（新建三级目录 → 移动文件 → 重开确认 `parent_id`） |
| AC-06 | 文件夹可预制图标、可上传自定义图标并显示 | `部署后验证` | 预制图标 8 个已就绪（`static/icons/folder-*.svg`），自定义图标需 `uniCloud.uploadFile` → `icons/{uid}/{uuid}.{ext}`，属部署后验证 |

## C. 阅读 / 编辑 / 图片

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-07 | 深浅色自动跟随；md 标题/列表/代码块/表格/图片渲染正确 | `未验证` | 源码已实现（`common/theme.css` 的 `prefers-color-scheme` + `marked` gfm）；**H5 未编译，渲染效果需编译后目视** |
| AC-08 | 「上传新图片」落库；「从已有空间选择」不重复上传 | `部署后验证` | `mm-image.register` 幂等（同 fileID 返回已有记录）已实现；真实云存储需部署后验证 |
| AC-09 | 库中只存 fileID，展示 URL 由 `getTempFileURL` 临时生成且未持久化 | `本地已验证` | 图片双态实现：存储态 `mm-image://<fileID>`、渲染时换取临时 URL；`tests/ui/image-state.test.js`（QA R2 新增，12 用例）断言存储态不含 http；`mm-images` schema 也无 tempUrl 属性 |

## D. 版本冲突

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-10 | 两会话同基准版本，A 先保存，B 保存收到冲突提示 | `部署后验证` | 源码已实现（`cloudVersion > base_version` → 2001）；两会话真实场景需部署后验证 |
| AC-11 | B 选「覆写」：内容写入、`version = 云端+1`、元数据与索引刷新 | `本地已验证` | `tests/mm-file.test.js`（force 分支）；`saveContent` 641 行起 |
| AC-12 | B 选「放弃」：服务端不变，**编辑器内容仍在页面** | `本地已验证` | 源码级（`docs/TEST-REPORT-R2.md` §1）：`mm-conflict-modal` 只 emit 事件；`handleConflictDiscard` 仅置 `dirty`；服务端侧由 `tests/mm-file.test.js` 覆盖 |

## E. 批注

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-13 | 新建批注记录含 `selected_text/prefix/suffix/offset/comment/status=active` | `本地已验证` | `tests/mm-comment.test.js`（含 4004 校验） |
| AC-14 | 四级定位分别验证；无法定位置 `orphaned` 且不误绑 | `本地已验证` | `tests/anchor.test.js`（四级场景）+ `tests/ui/selection.test.js`（R3 四场景） |
| AC-15 | 删除批注所依附原文并保存，`status` 自动 orphaned | `本地已验证` | `tests/anchor.test.js` + `tests/mm-file.test.js`（saveContent 内 relocate） |
| AC-16 | 修改批注后 `updated_at` 更新、`created_at` 不变 | `本地已验证` | `tests/mm-comment.test.js`（update 只更新 comment + updated_at） |

## F. 账号 / 权限

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-17 | 默认账号功能开启，未登录进登录/注册页 | `本地已验证` | `pages.json` 保留 16 个 uni-id-pages 页面；`mm-settings.getConfig` 默认 `account_enabled=true`；主壳 `guardLogin()` 无 token 跳登录 |
| AC-18 | 关闭账号后免登录；>1 用户时拒绝并提示 | `部署后验证` | 源码已实现（`count(uni-id-users) > 1` → 4001）；需真实用户数据 |
| AC-19 | 权限开启时首个注册用户为管理员；只读用户保存被拒 | `部署后验证` | 源码已实现（`ensureAdminInternal` 按 `register_date` 取首个 + `assertWrite`）；需真实用户与登录态 |
| AC-20 | 权限关闭时默认可读可写；所有写接口服务端二次校验 | `本地已验证` | `tests/auth.test.js` + `tests/mm-file.test.js`（assertWrite / assertAdmin）；真实绕过前端的拦截属部署后复验 |

## G. 搜索 / 索引

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-21 | 标签/文件名/批注/正文四维可命中 | `本地已验证` | `tests/mm-search.test.js`（四 scope + 权限过滤 + 陈旧索引过滤）；注意：标签**编辑入口**属 R25（P1）未实现，真实使用时标签维度暂无数据来源（搜索本身可用） |
| AC-22 | 保存后索引重建，`revision` 与文件 `version` 一致 | `本地已验证` | `tests/mm-file.test.js`（rebuildChunks 先删后插 + revision） |
| AC-23 | 正文命中可按 `start_offset` 回跳 | `本地已验证` | `tests/ui/selection.test.js`（R3 映射定位）+ `mm-md-viewer.scrollToOffset`；真实 DOM 点击属编译后人工验证 |

## H. 导入导出 / 删除

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-24 | 导入生成记录 + 云存储文件；导出内容字节一致 | `部署后验证` | 前端链路已闭环（源码级）：`handleImport` → `mm-file.importFile`；`handleExport` → `mm-file.exportFile`（`content` 为空时 `fetch(tempUrl)` 降级）→ 图片双态替换 → `downloadMarkdown`；**无单测覆盖**，字节一致需部署后导出与云端内容比对 |
| AC-25 | 普通删除 `is_delete=true`，回收站可见可还原；还原撞名 `-copyN` | `本地已验证` | `tests/mm-file.test.js`（softDelete/restore + rename 撞名） |
| AC-26 | 彻底删除后云存储、文件记录、关联批注与索引均清理；文件夹递归 | `部署后验证` | 源码已实现（`purgeDelete` 先删云存储再级联）；真实 `deleteFile` 行为需部署后验证 |

## I. UI / 工程 / 交付

| 编号 | 验收条目 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| AC-27 | PC 三栏、移动单栏 + 抽屉；深浅色完整；无多余小字 | `未验证` | 源码已实现（260/320px 三栏 + `<768px` 抽屉 + `--mm-*` 主题）；**H5 未编译，布局与视觉需编译后目视** |
| AC-28 | 首屏加载动画，就绪后淡出，无闪烁空白 | `未验证` | 源码已实现（`mm-loading` 最短 300ms + 180ms 淡出）；实际动效需编译后目视 |
| AC-29 | `wot-design-uni` 已安装且被引用；无示例页残留 | `未验证`（静态校验已通过，待 HBuilderX 编译验证） | 依赖已装（1.14.0）；`easycom.custom` 规则 7/7 可解析、包内 99/99 组件目录匹配；`pages.json` 只注册 2 个业务页 + 16 个 uni-id-pages 页、tabBar 已移除、示例页 0 注册；**CLI 编译未成功，AC-29 最终判据以 HBuilderX 真实编译结果为准** |
| AC-30 | 全中文；除目标文件外无无关改动；无文件被永久删除 | `本地已验证` | 中文 UI/注释；`cloudfunctions` 仍 20 个目录（15 示例 + 5 新增）、`common` 含 `hello-common` 与 `mm-common`、示例 schema 与 `static/` 原样保留 |
| AC-31 | 本地源码可编译 H5；Schema / 云对象 / 依赖 / 文档齐备 | `未验证`（文档与源码齐备，H5 编译未完成） | Schema 13 文件、云对象 5 个 + 公共模块、依赖清单、`DEPLOY.md` / `API.md` / `AC-CHECKLIST.md` 均齐备；**H5 未编译成功**，需在 HBuilderX 完成 |

---

## 汇总

| 状态 | 条数 | 编号 |
| --- | --- | --- |
| `本地已验证` | **17** | AC-02/03/04/09/11/12/13/14/15/16/17/20/21/22/23/25/30 |
| `部署后验证` | **9** | AC-01/05/06/08/10/18/19/24/26 |
| `未验证` | **5** | AC-07/27/28（H5 未编译，需目视）、AC-29/31（H5 编译未完成） |
| 合计 | 31 | — |

### 剩余风险与下一步

1. **H5 真实编译未完成**：`C:\HBuilderX\cli.exe launch web --compile` 三次尝试均未产出 `unpackage/dist`（参数解析错误 / 进程超时），详见 `docs/DEPLOY.md` 9.2。需在 HBuilderX 图形界面执行「发行 → 网站-PC Web 或手机 H5」。
2. **5 条未验证**全部依赖编译或真实运行：AC-07（md 渲染与深浅色）、AC-27（三栏/抽屉布局）、AC-28（首屏动画）、AC-29/31（编译相关）。
3. **9 条部署后验证**依赖真实服务空间：云存储读写、`deleteFile`、多用户校验、两会话冲突、自定义图标上传，以及 AC-05（嵌套/移动）与 AC-24（导入导出字节一致）—— 后两条因**无单测覆盖**已由「本地已验证」下调为「部署后验证」。
4. **R3 真实 DOM 选区**：四场景已用纯函数单测覆盖，但 `window.getSelection()` 的真实行为需编译后在 H5 手动点验一次（建议作为验收第一步）。
5. **图片按光标插入**退化为追加末尾（`md-editor-v3@4.21.3` 未暴露稳定光标 API；5.x 起因 `useId` 与 uni-h5-vue 不兼容，版本上限锁在 4.x）。
