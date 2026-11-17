# MarkdownManager 部署与联调文档

> 适用：uni-app（Vue 3）+ uniCloud 支付宝云 + Wot UI + uni-id，交付端仅 H5 网页。
> 本地已完成：源码、6 张 DB Schema、5 个云对象 + 1 个公共模块、单元测试 132 条。
> 本地**未完成**：真实云空间部署与联调（无凭证、无服务空间），以及 H5 真实编译（CLI 通道未通，见第 9 节）。

---

## 0. 交付边界

| 项 | 本地状态 |
| --- | --- |
| H5 源码（页面 / 组件 / 公共层） | 已完成 |
| 6 张表 Schema + 6 个索引 + init_data | 已完成 |
| 公共模块 `mm-common` + 5 个云对象 | 已完成 |
| 单元测试 | 132 条全通过（`npm test`） |
| 服务空间创建/绑定、Schema 与云函数上传 | **需按本文在 HBuilderX 完成** |
| H5 真实编译 | **需按本文第 9 节在 HBuilderX 完成** |
| 真实登录、云存储读写联调 | **部署后验证** |

---

## 1. 环境要求

- HBuilderX ≥ 3.8（本项目核验版本 5.26，`C:\HBuilderX\cli.exe` 存在）
- Node.js ≥ 20（本地核验 22.22.2）
- 支付宝云服务空间 1 个
- `sass` ≥ 1.78（推荐 ^1.98）：Wot UI 组件内的 `index.scss` 需要，已加入 `devDependencies`

---

## 2. 依赖安装

```bash
# 运行依赖
npm install

# 若 node_modules 缺失，重新安装四个运行依赖
npm install wot-design-uni md-editor-v3 marked dompurify

# 样式编译依赖（Wot UI 组件内 scss）
npm i -D sass@^1.98
```

当前锁定版本（`package.json` 实际安装值）：

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `wot-design-uni` | ^1.14.0 | UI 组件（**走 easycom，不走 app.use**） |
| `md-editor-v3` | ^4.21.3 | Markdown 编辑器（`MdEditor` 具名导出）。**不可升级到 5.x 及以上**：5.0 起要求 Vue ^3.5.3 并使用 `useId`，HBuilderX 内置的 `@dcloudio/uni-h5-vue` 不导出该 API，会导致编译报错 |
| `marked` | ^18.2.0 | 阅读态 md → HTML |
| `dompurify` | ^3.4.17 | 渲染前 XSS 消毒（仅 H5 客户端调用） |
| `sass` | ^1.108.2 | devDependency，编译 Wot 组件 scss |

`package.json` 已包含脚本：

```json
"scripts": {
  "test": "node --test \"tests/**/*.test.js\"",
  "test:ui": "node --test \"tests/ui/selection.test.js\""
}
```

> 注意：Windows + Node 22 下 `node --test tests/`（目录形式）会报 `MODULE_NOT_FOUND`，必须用上面的 glob 形式。

---

## 3. 服务空间创建与绑定

1. HBuilderX 打开本项目（`C:\Users\markJing\Desktop\work\MarkdownManager`）。
2. 右键 `uniCloud-alipay` 目录 → **关联云服务空间** → 选择或创建支付宝云空间。
3. 确认 `uniCloud-alipay/` 下出现 `cloudfunctions`、`database` 与空间绑定关系。

---

## 4. 上传数据库 Schema

在 HBuilderX 的 `uniCloud-alipay/database` 目录中，对以下 13 个文件逐个右键 → **上传 DB Schema / 索引 / 初始数据**：

| 文件 | 类型 |
| --- | --- |
| `mm-files.schema.json` / `mm-files.index.json` | 文件 / 文件夹表 |
| `mm-comments.schema.json` / `mm-comments.index.json` | 批注表 |
| `mm-images.schema.json` / `mm-images.index.json` | 图片空间表 |
| `mm-index-chunks.schema.json` / `mm-index-chunks.index.json` | 索引分块表 |
| `mm-settings.schema.json` / `mm-settings.index.json` | 系统配置表 |
| `mm-settings.init_data.json` | 预置 `key=app_config` 单文档 |
| `mm-user-permissions.schema.json` / `mm-user-permissions.index.json` | 用户权限表 |

要点：
- 六张表 `permission` 四项全为 `false`，**前端无法直连**，所有读写只能走云对象。
- 若 `init_data` 因日期写法未被接受，跳过即可：第 10 节 `ensureConfig()` 会幂等创建。
- 索引含 4 个唯一索引：`mm-images.file_id`、`mm-index-chunks.chunk_id`、`mm-settings.key`、`mm-user-permissions.user_id`。

---

## 5. 上传云函数公共模块

`uniCloud-alipay/cloudfunctions/common/mm-common` → 右键 → **上传公共模块**。

该模块被 5 个云对象通过 `package.json` 的 `"mm-common": "file:../common/mm-common"` 引用，**必须先上传**，否则云对象部署会报依赖缺失。

**依赖声明（修复「已登录仍提示未登录」后新增）**：`mm-common/package.json` 已声明 `uni-id-common` 依赖，指向 `uni_modules/uni-id-common/uniCloud/cloudfunctions/common/uni-id-common`。

上传 `mm-common` 时，HBuilderX 会按该依赖自动收集 `uni-id-common`（及其依赖的 `uni-config-center`）。如果上传对话框出现「选择公共模块」，必须勾选 `uni-id-common` 与 `uni-config-center`。**缺少 `uni-id-common` 时，云对象里的 `require('uni-id-common')` 会抛错并被鉴权逻辑吞掉，表现为所有操作返回 1002「请先登录」。**

---

## 6. 上传 5 个云对象

对以下目录逐个右键 → **上传部署**（云对象）：

| 云对象 | 文件 | 方法数 |
| --- | --- | --- |
| `mm-file` | `index.obj.js` | 17 |
| `mm-comment` | `index.obj.js` | 5 |
| `mm-search` | `index.obj.js` | 1 |
| `mm-settings` | `index.obj.js` | 6 |
| `mm-image` | `index.obj.js` | 4 |

部署顺序建议：`mm-common` → `mm-settings` → `mm-file` → `mm-comment` → `mm-search` → `mm-image`。

---

## 7. 单独上传 `uni-id-co`（易漏）

`uni-id-co` **不在** `uniCloud-alipay/cloudfunctions/`，而在：

```
uni_modules/uni-id-pages/uniCloud/cloudfunctions/uni-id-co
```

在 HBuilderX 中右键该目录 → **上传部署**。登录/注册/`getUserInfo` 均依赖它。

---

## 8. `uni-config-center` 配置（令牌密钥）

`uni-id-common` 依赖 `uni-config-center` 的 `uni-id/config.json`（`tokenSecret` 等）。
在 HBuilderX 中打开 `uni_modules/uni-config-center/uniCloud/cloudfunctions/common/uni-config-center/uni-id/config.json`，按官方模板确认：

- `passwordSecret`：密码加密盐（自定义随机串）
- `tokenSecret`：token 签名密钥（自定义随机串，**务必修改默认值**）
- `tokenExpiresIn` / `tokenExpiresThreshold`：token 有效期与续期阈值
- 登录方式配置（用户名密码 / 短信 / 邮箱）按需开启

上传该公共模块后，重新部署 `uni-id-co` 使配置生效。

### 8.1 登录后仍提示「请先登录」的排查顺序

1. **云对象是否重新部署**：本次修复了云侧读取 token 的方法名（优先 `this.getUniversalUniIdToken()`，旧方法 `getUniIdToken()` 作回退）。修改后必须重新上传 `mm-common` 与 5 个云对象，旧版本仍会返回 1002。
2. **`uni-id-common` 是否随云对象上传**：见第 5 节的依赖声明。这是「有 token 但服务端验不了」的最常见原因。
3. **`uni-id-co` 是否部署**：注册、登录、`getUserInfo` 都依赖它（第 7 节）。
4. **`tokenSecret` 是否一致**：`uni-id-co` 与 `mm-*` 云对象必须读取同一份 `uni-config-center/uni-id/config.json`。只给其中一方上传配置时，token 验签会失败。
5. **前端登录入口**：主壳顶栏右侧已提供入口——未登录显示「登录」，已登录显示人像图标（点击可进个人资料或退出登录）。登录态失效时，接口层会提示并自动跳转到账号密码登录页。

---

## 9. H5 构建与部署

### 9.1 在 HBuilderX 中编译（推荐）

1. 菜单 **发行 → 网站-PC Web 或手机 H5**（或 **运行 → 运行到浏览器**）。
2. 产物目录：`unpackage/dist/build/web`（发行）或 `unpackage/dist/dev/web`（运行）。
3. `manifest.json` 已配置 `h5.router.mode = hash`、`base = /mymarkdown/web/`（以实际值为准）。部署时把 `build/web` 的内容放到站点 `/mymarkdown/web/` 下，或同步修改 `base`。

   > **为什么必须用 hash 模式（2026-11-13 实测）**：静态托管（含 uniCloud 静态托管 `*.cloudstatic.cn`）不支持 history 模式所需的 URL rewrite。部署为 history 时，访问 `/mymarkdown/web/index.html` 会把 `index.html` 当成路由路径，而 `pages.json` 中没有该路由，Vue 渲染为空（HTML 里 `#app` 内只剩空注释节点），表现为白屏；访问目录又会 302 回到 `index.html`，无法绕开。hash 模式下入口为 `/mymarkdown/web/index.html#/`，路由由 `#` 后的路径决定，静态托管可直接工作。
4. **跨域配置**：H5 页面与云函数不同域时，需在 uniCloud 控制台 → 跨域配置 中添加页面域名（如 `https://env-xxxx-static.normal.cloudstatic.cn`），否则登录与云对象请求会被浏览器拦截。

### 9.2 关于 CLI 编译（本地已尝试，未成功）

本地尝试过 `C:\HBuilderX\cli.exe launch web --compile`：

| 尝试 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `launch web --project <绝对路径> --compile --continue-on-error` | 退出码 0，但提示「参数 compile 类型为boolean 值必须为true或false」 |
| 2 | `... --compile=true --continue-on-error=true` | `error: unknown option 'compile=true'` |
| 3 | `... --compile true --continue-on-error true` | 进程超时（300s）被终止，仅输出 `HBuilderX Version: 5.26`，`unpackage/` 无产物 |

结论：**CLI 通道未能完成真实编译**，因此 AC-29 / AC-31 的编译结论为「待用户在 HBuilderX 中编译验证」。本地只做了编译前置静态校验（见 9.3），全部通过。

### 9.3 编译前置静态校验（本地已通过）

| 校验项 | 结果 |
| --- | --- |
| `pages.json` 注册页 ↔ 实际 `.vue` | 18 / 18 存在 |
| 12 个业务组件存在且被引用 | 12 / 12 |
| `easycom.custom` `^wd-(.*)` 可解析 | 7 / 7（button/toast/popup/switch/input/tag/loading） |
| 包内 `wd-*` 组件目录覆盖率 | 99 / 99 符合 `wd-X/wd-X.vue` |
| `md-editor-v3/lib/style.css` 存在 | 是 |
| 裸 import 可解析 | 无缺失（vue / @dcloudio/uni-app / marked / dompurify / md-editor-v3 / wot-design-uni） |
| `rpx` 使用 | 0（本次交付 30 个业务文件） |
| 前端 `uniCloud.database()` | 0 |
| `<wd-dialog>` | 0（包内无此组件） |

### 9.4 部署后必检（真实编译时执行）

1. 页面放 `<wd-button>` 等标签，确认控制台无 `Failed to resolve component` / `Unknown custom element`；
2. 组件内 `index.scss` 无 sass 版本报错（否则升级 `sass`）；
3. `<wd-toast />` 挂载点下 `useToast().show()` 能出现实际轻提示；
4. 打开一篇含图片/表格/代码块的文档，阅读区 md 元素与深浅色正常；
5. 在阅读区选中一段文字点「添加批注」，确认能保存（R3 选区映射的真实 DOM 验证）。

---

## 10. 首次启动初始化

1. 打开站点，首页 `onLoad` 会调用 `mm-settings.getConfig()`。
2. 若配置文档不存在，调用一次 `mm-settings.ensureConfig()`（可在云对象调试面板手动执行，或首次进设置页触发）创建 `key=app_config`：`account_enabled=true`、`permission_enabled=false`、`admin_user_id=''`。
3. 默认账号功能开启 → 未登录会跳转 uni-id-pages 登录页；注册首个账号。
4. 如需单机匿名使用：进设置页关闭「账号功能」（用户数 > 1 时会被拒绝）。

---

## 11. 验收顺序（建议）

1. 注册 / 登录（AC-17）
2. 新建文件夹 → 三级嵌套（AC-05）
3. 上传 md → 列表出现 → 打开阅读（AC-01、AC-07）
4. 编辑 → 保存 → 再打开确认内容与版本（AC-03、AC-11）
5. 两个标签页同时编辑保存，验证冲突弹窗与「放弃不清空」（AC-10、AC-12）
6. 阅读区选段添加批注 → 修改原文 → 保存后看 orphaned（AC-13~AC-16）
7. 插入图片（新上传 + 已有空间复用）（AC-08、AC-09）
8. 搜索四个维度（AC-21）
9. 回收站还原 / 彻底删除（AC-25、AC-26）
10. 关闭账号功能校验用户数（AC-18）
11. 权限开启后把某用户设为只读（AC-19、AC-20）

---

## 12. 关键口径（务必了解）

### 12.1 账号 / 权限口径（个人空间模型）

- **文档按 `user_id` 隔离**：不是共享文档库。普通用户的列表/搜索/回收站只显示自己名下的文档。
- **权限关闭**（默认）：每个用户对自己文档默认可读可写；**不产生任何跨用户可见性**。
- **权限开启**：首个注册用户成为管理员；管理员可给其他用户分配「可读 / 可写」。该授权是**账号级能力**（作用于该账号能访问的文档范围），**不会把别人的文档变成可见**。
- **账号关闭**：固定匿名身份 `__anonymous__`，所有访客共用同一身份与同一份文档；关闭前若用户数 > 1 会被服务端拒绝（`4001`）。
- 跨用户共享文档需同时满足：账号开启 + 权限开启 + 管理员授权；当前表结构只支持账号级授权，**不支持「某文档只给某人看」的文档级授权**（已知限制）。

### 12.2 图片双态与临时 URL 时效

- 库与正文一律存储态：`![名称](mm-image://<fileID>)`，`fileID` 原样保存。
- 阅读器 / 编辑器 / 导出渲染时才把 `mm-image://<fileID>` 正向替换成 `uniCloud.getTempFileURL` 返回的临时 URL。
- 编辑器在 `update:modelValue` 之前反替换回存储态，因此 `store.editorContent`、`plainText`、云侧 `content` 三者始终是同一坐标系。
- **临时 URL 有时效**（支付宝云默认数小时）：`getTempFileURL` 每次打开文档重新换取，故正文不落库不会失效；若把临时 URL 复制到外部系统，过期后需重新换取。
- 图片不随文档彻底删除级联清理，需在「设置 → 图片空间」单独清理。

### 12.3 Wot UI 走 easycom，不走 `app.use`

`wot-design-uni@1.14.0` 的 npm 包是 uni_modules 源码形态（`main` 指向 `index.ts`，无 default 插件、无 `dist/*.css`），因此：

- `main.js` **不写** `import WotUI` / `app.use` / `app.component`；
- 组件统一由 `pages.json` 的 `easycom.custom` 解析：
  `"^wd-(.*)": "wot-design-uni/components/wd-$1/wd-$1.vue"`；
- 页面/组件里直接写 `<wd-button>` 等标签，不写 Wot 的 import（唯一例外是 `useToast` / `useMessage` 需 `import { useToast } from 'wot-design-uni'`，且页面必须放 `<wd-toast />` 挂载点）；
- 包内**没有 `wd-dialog`**，确认弹层用 `wd-message-box` 或 `wd-popup`。

### 12.4 sass 版本

Wot UI 组件内 scss 需要 `sass >= 1.78`（推荐 ^1.98）。若编译报 `legacy-js-api` 弃用警告，可在 `vite.config` 里设置 `css.preprocessorOptions.scss.api = 'modern-compiler'`；HBuilderX 内置编译一般可忽略该警告。

### 12.5 上传参数形态（H-7）

`uniCloud.uploadFile`（**客户端**）的官方契约只有 `cloudPath` 与 `filePath`（String，必填），
**没有 `file` 参数**；H5 下 `filePath` 是 `uni.chooseFile` / `uni.chooseImage` 返回的 `blob:` URL。

项目内已统一走 `common/utils/upload.js` 的 `uploadCloudFile({ cloudPath, filePath, file })`：

- 有 `filePath` 时直接提交；
- 只有 `File`/`Blob`（如 `md-editor-v3` 的 `onUploadImg` 回调）时，用 `URL.createObjectURL(file)` 转成 blob URL 再提交，上传后延迟 30s 释放；
- 两者都没有直接抛错。

**业务前端（`common/`、`components/`、`pages/index/`、`pages/settings/`、`main.js`、`App.vue`）的 `uniCloud.uploadFile` 调用只剩 `common/utils/upload.js` 一处**（已由 `tests/ui/upload.test.js` 固化）。

> 说明：`pages/storage/space-storage.vue` 等示例页仍有直接调用，但它们属「hello uniCloud」官方示例、**未在 `pages.json` 注册、不参与编译**，按删除守卫原样保留，不计入本约束。

部署后需实测三条链路：上传 md、图片空间上传新图、上传文件夹自定义图标。

---

## 13. 已知限制与加固建议

| # | 限制 | 说明 / 建议 |
| --- | --- | --- |
| 1 | 图片按光标插入退化为追加末尾 | `md-editor-v3@4.21.3` 未暴露稳定 CodeMirror 实例，`insertImage()` 追加到文档末尾 |
| 2 | R3 真实 DOM 选区未人工点验 | 四场景已用纯函数单测覆盖，真实 `window.getSelection()` 需编译后在 H5 手动验证 |
| 3 | 文档级授权不支持 | 当前权限为账号级 `can_read/can_write`；如需「某文档只给某人」需新增文档级权限表 |
| 4 | 搜索范围限本人文档 | 个人空间模型下非管理员只搜自己名下文档 |
| 5 | 云函数端 `downloadFile` 兼容性 | `getContent` 优先 `uniCloud.downloadFile`，不可用时回退临时 URL 由前端 fetch；支付宝云实际行为需部署后验证 |
| 6 | 匿名模式设置入口无独立口令 | 架构 9.2 裁决本期不引入第二套认证；建议上线前用云函数 URL 化 + 白名单加固 |
| 7 | 索引/批注重定位失败不阻断保存 | 返回 `indexed:0`，前端可调 `mm-file.rebuildIndex` 补偿 |
| 8 | 文档彻底删除产生孤立云存储文件 | 上传成功但落库失败时可能出现，需在云存储控制台清理 |
| 9 | 导出时图片临时 URL 换取失败 | `getTempUrls` 失败会让导出内容保留 `mm-image://<fileID>` 原 token —— 不阻断导出，md 文件仍可用，仅图片不显示；属可接受降级，可重试导出 |
