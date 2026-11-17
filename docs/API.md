# MarkdownManager 云对象接口速查（API）

> 前端统一通过 `uniCloud.importObject('<云对象名>')` 调用，封装在 `common/api/*.js`。
> 出参统一 `{ errCode, errMsg, data }`；前端 `common/api/index.js` 归一化为 `{ code, data, message }`。
> **六张表 `permission` 全为 `false`，前端不得直连数据库**。

---

## 0. 返回结构与通用约定

```js
// 成功
{ errCode: 0, errMsg: 'ok', data: <业务数据> }
// 失败
{ errCode: <非零>, errMsg: '<中文提示>', data: null }
// 版本冲突（业务返回，非异常）
{ errCode: 2001, errMsg: '云端有更新版本', data: { cloudVersion, cloudContent, cloudTempUrl, cloudUpdatedAt } }
```

- 客户端传入的 `user_id` / `created_at` / `updated_at` / `size` / `content_hash` / `version` **一律忽略**，由服务端注入或重算。
- 所有时间字段使用服务器时间（`mm-common.now()`）。
- 每个云对象都有 `_before` 拦截器：解析 token（或匿名身份）注入 `{ uid, role, canRead, canWrite, config, anonymous }`；鉴权失败在方法入口统一返回 `1002`。

---

## 1. `mm-file` — 文件 / 文件夹（17 个方法）

| 方法 | 入参 | 出参 `data` | 权限 | 主要错误码 |
| --- | --- | --- | --- | --- |
| `listTree` | `{}` | `folder[]`（扁平，含 `icon`，前端按 `parent_id` 组树） | 读 | 1002 |
| `listFiles` | `{ parent_id, page, pageSize, orderBy }` | `{ list, total, page, pageSize }` | 读 | 1001 / 1002 |
| `createFolder` | `{ parent_id, name, icon }` | 新文件夹记录 | 写 | 1001 / 1002 / 1003 / 4002 |
| `registerUpload` | `{ name, parent_id, storage_key, content, tags }` | 新文档记录 + `indexed` | 写 | 1001 / 1002 / 1003 / 3001 |
| `getContent` | `{ file_id }` | `{ doc, content, tempUrl }` | 读 | 1001 / 1002 / 1004 |
| `saveContent` | `{ file_id, content, base_version, force }` | `{ version, updated_at, size, content_hash, indexed, relocated }` | 写 | 1001 / 1002 / 1003 / 1004 / **2001** / 3001 |
| `rename` | `{ file_id, name }` | 更新后记录（撞名 `-copyN`） | 写 | 1001 / 1002 / 1003 / 1004 |
| `move` | `{ file_id, parent_id }` | 更新后记录 | 写 | 1001 / 1002 / 1003 / 1004 / 4003 |
| `updateIcon` | `{ folder_id, icon }` | 更新后记录 | 写 | 1001 / 1002 / 1003 / 1004 |
| `setTags` | `{ file_id, tags }` | 更新后记录 | 写 | 1001 / 1002 / 1003 / 1004 |
| `softDelete` | `{ file_ids }` | `{ count }` | 写 | 1001 / 1002 / 1003 / 1004 |
| `listTrash` | `{ page, pageSize }` | `{ list, total, page, pageSize }` | 读 | 1002 |
| `restore` | `{ file_ids }` | `{ count, renamed }` | 写 | 1001 / 1002 / 1003 / 1004 |
| `purgeDelete` | `{ file_ids }` | `{ deletedFiles, deletedKeys }` | 写 | 1001 / 1002 / 1003 / 1004 / 3002 |
| `exportFile` | `{ file_id }` | `{ name, content, content_hash, tempUrl }` | 读 | 1001 / 1002 / 1004 |
| `importFile` | `{ name, parent_id, content, tags }` | 新记录 + `indexed` | 写 | 1001 / 1002 / 1003 / 3001 |
| `rebuildIndex` | `{ file_id }` | `{ chunks }` | 写 | 1001 / 1002 / 1003 / 1004 / 5001 |

**`saveContent` 业务语义（C1）**
- 冲突判定：`cloudVersion > base_version && !force` → 返回 `2001`（等价于 `cloudVersion >= base_version + 1`）。首次保存 `0 > 0` 为假，不冲突。
- 覆写：前端带 `force: true` 且 `base_version = cloudVersion` 重新提交，服务端写 `version = cloudVersion + 1`。
- 服务端流程：覆盖写云存储（同一 cloudPath，fileID 变化则同步 `storage_key`）→ 重算 `size` / `content_hash` → 更新 `version` / `updated_at`（**`created_at` 绝不出现在 update 中**）→ 索引先删后插（`revision = 新 version`）→ active 批注四级重定位。
- 索引或重定位失败**不阻断保存**，返回 `indexed: 0` / `relocated` 统计，前端可调 `rebuildIndex` 补偿。

**`purgeDelete` 业务语义（C2）**
1. 递归收集文件夹全部后代；
2. 逐个 `assertWritable`；非管理员不能删他人文档；
3. **先删云存储** `uniCloud.deleteFile`，任一条 `status !== 0` 或抛错 → 返回 `3002`，**记录一条不删**；
4. 按 `file_id` 级联删 `mm-comments`、`mm-index-chunks`，再删 `mm-files`；
5. **图片资源不级联删除**（Q6）。

---

## 2. `mm-comment` — 批注（5 个方法）

| 方法 | 入参 | 出参 `data` | 权限 | 主要错误码 |
| --- | --- | --- | --- | --- |
| `listByFile` | `{ file_id, status? }` | `comment[]`（含 orphaned） | 读 | 1001 / 1002 / 1004 |
| `add` | `{ file_id, selected_text, prefix, suffix, start_offset, end_offset, comment }` | 新批注（`status=active`） | 写 | 1001 / 1002 / 1003 / 1004 / **4004** |
| `update` | `{ comment_id, comment }` | 更新后批注 | 写 | 1001 / 1002 / 1003 / 1004 |
| `remove` | `{ comment_id }` | `{ deleted }` | 写 | 1001 / 1002 / 1003 / 1004 |
| `relocate` | `{ file_id }` | `{ active, orphaned }` | 写 | 1001 / 1002 / 1003 / 1004 / 5002 |

**`add` 的 4004 二次校验（R3 最后防线）**
- 服务端重新读取文档、`stripMarkdown` 得到 `plainText`，校验 `plainText.slice(start_offset, end_offset) === selected_text`；prefix / suffix 同样以 `plainText` 为准。
- 不一致 → `4004 ANCHOR_MISMATCH`，前端应提示「批注位置已变化，请重新选择」，**不要**把 DOM 序列文本当作 `selected_text`。

**`update` 说明**：只更新 `comment` 与 `updated_at`，不动 `selected_text` / offset / status（架构 3.3 该接口不含 4004）。`status` 只由 `relocateComments` 决定。

---

## 3. `mm-search` — 四维搜索（1 个方法）

| 方法 | 入参 | 出参 `data` | 权限 | 主要错误码 |
| --- | --- | --- | --- | --- |
| `search` | `{ keyword, scope, page, pageSize }` | `{ keyword, scope, groups: { tag, name, comment, content }, total }` | 读 | 1001 / 1002 |

- `scope`：`all` | `tag` | `name` | `comment` | `content`。
- 正文命中项：`{ file_id, file_name, chunk_id, heading, start_offset, end_offset, revision, snippet }`，可按 `start_offset` 回跳。
- 只返回当前身份可见的文档；正文命中按 `chunk.revision === file.version` 过滤陈旧索引。
- 关键词在服务端先做正则转义，避免 `.*` 之类被当正则执行。

---

## 4. `mm-settings` — 配置与权限（6 个方法）

| 方法 | 入参 | 出参 `data` | 权限 | 主要错误码 |
| --- | --- | --- | --- | --- |
| `getConfig` | `{}` | `{ account_enabled, permission_enabled, admin_user_id, anonymous }` | **无需登录** | 9999 |
| `ensureConfig` | `{}` | 配置文档 | 需 ctx（匿名可） | 9999 |
| `updateConfig` | `{ account_enabled?, permission_enabled? }` | 更新后配置 | 管理员（匿名放行） | 1001 / 1002 / 1003 / **4001** / **4005** |
| `listUsers` | `{ page, pageSize }` | `{ list, total }`（含 role / can_read / can_write） | 仅管理员 | 1002 / 1003 |
| `setUserPermission` | `{ user_id, can_read, can_write }` | 权限记录 | 仅管理员 | 1001 / 1002 / 1003 / 1004 |
| `ensureAdmin` | `{}` | `{ admin_user_id }` | 仅管理员 | 1003 |

**`updateConfig` 校验顺序（C5）**
1. `permission_enabled = true` 且 `account_enabled = false` → `4005 PERMISSION_NEEDS_ACCOUNT`；
2. `account_enabled` 由 `true → false` 时统计 `uni-id-users`，`> 1` → `4001 ACCOUNT_DISABLE_REJECTED`；
3. 权限 `false → true` 时自动执行 `ensureAdmin`：按 `register_date` 升序取首个用户，写 `admin_user_id` 并 upsert `mm-user-permissions(role=admin, can_read=true, can_write=true)`，其余用户补默认记录。

---

## 5. `mm-image` — 图片（5 个方法）

| 方法 | 入参 | 出参 `data` | 权限 | 主要错误码 |
| --- | --- | --- | --- | --- |
| `register` | `{ file_id, name, extension, size, cloud_path }` | 图片记录（**幂等**：同一 fileID 返回已有记录） | 写 | 1001 / 1002 / 1003 / 4006 |
| `list` | `{ page, pageSize }` | `{ list, total }`（含 `ref_count` 与 `uploader_nickname`） | 读 | 1002 |
| `getTempUrls` | `{ file_ids: string[] }` | `{ [fileID]: tempUrl }` | 读 | 1001 / 1002 / 3003 |
| `remove` | `{ image_ids: string[], force?: boolean }` | `{ deleted, deletedKeys }`；被引用且未带 `force` 时返回 `4011` 与 `{ refs: [{ image_id, file_id, ref_count, docs }] }` | 写 | 1001 / 1002 / 1003 / 3002 / 4011 |
| `syncRefs` | `{ doc_id, content?, rebuild? }` | `{ added, removed, total }`（幂等，按文档全量对齐引用） | 写 | 1001 / 1002 / 1003 / 1004 |

- 库中只存 fileID；临时 URL **不落库**。
- `remove` 先删云存储再删记录，失败返回 `3002` 且记录不删；图片不随文档彻底删除级联。
- 引用记录存 `mm-image-refs`（`image_file_id` + `doc_id`）；`saveContent` 成功后由前端调 `syncRefs` 对齐，`purgeDelete` 时回收。

---

## 6. 统一错误码

| code | 常量 | 含义 | 前端处理 |
| --- | --- | --- | --- |
| 0 | `OK` | 成功 | 正常 |
| 1001 | `PARAM_INVALID` | 参数缺失/非法 | Toast |
| 1002 | `UNAUTHORIZED` | 未登录 / token 失效 | api 层**静默**，交登录守卫跳登录页 |
| 1003 | `PERMISSION_DENIED` | 无写权限 / 非管理员 | Toast |
| 1004 | `NOT_FOUND` | 资源不存在 | Toast + 刷新列表 |
| **2001** | `VERSION_CONFLICT` | **版本冲突（业务返回，非异常）** | api 层**静默**，交 `mm-conflict-modal`；**不清空编辑器** |
| 3001 | `STORAGE_UPLOAD_FAILED` | 云存储上传失败 | 允许重试 |
| 3002 | `STORAGE_DELETE_FAILED` | 云存储删除失败 | 彻底删除整体失败，记录不删 |
| 3003 | `TEMP_URL_FAILED` | 临时 URL 换取失败 | 图片占位 + 重试 |
| 4001 | `ACCOUNT_DISABLE_REJECTED` | 用户数 >1 拒绝关闭账号 | 原样提示「请先删除至单用户」 |
| 4002 | `FOLDER_CREATE_FAILED` | 文件夹创建失败 | Toast |
| 4003 | `MOVE_INVALID` | 不能移入自身子树 | Toast |
| 4004 | `ANCHOR_MISMATCH` | 批注锚点与原文不一致 | 拒绝新建，提示重新选区 |
| 4005 | `PERMISSION_NEEDS_ACCOUNT` | 权限开关依赖账号开启 | Toast |
| 4006 | `IMAGE_REGISTER_FAILED` | 图片登记失败 | Toast |
| 4007 | `SHARE_TOKEN_INVALID` | 分享链接无效 / 已撤销 | Toast |
| 4008 | `SHARE_EXPIRED` | 分享链接已过期 | Toast |
| 4009 | `SHARE_CREATE_FAILED` | 分享创建失败 | Toast |
| 4010 | `SHARE_DOC_UNAVAILABLE` | 分享的文档不可用 | Toast |
| 4011 | `IMAGE_IN_USE` | 图片被文档引用 | 确认弹窗 |
| 5001 | `INDEX_REBUILD_FAILED` | 索引重建失败 | 调 `rebuildIndex` 补偿 |
| 5002 | `RELOCATE_FAILED` | 批注重定位失败 | 记录日志，不阻断保存 |
| 9999 | `INTERNAL_ERROR` | 服务端未知错误 | Toast |

前端与云侧的 `ERR` / `ERR_MESSAGE` 共 22 个键，逐项相等（由 `tests/error-constants.test.js` 断言）。

---

## 7. 前端调用示例

```js
import { saveContent } from '@/common/api/mm-file.js'

const res = await saveContent({ file_id, content, base_version })
if (res.code === 0) {
  // 成功：刷新 version / 基准版本，保留 editorContent
} else if (res.code === 2001) {
  // 冲突：打开 mm-conflict-modal，不弹 Toast、不清空、不跳转
} else {
  // 其它错误：api 层已按后端 message 弹过一次 Toast
}
```
