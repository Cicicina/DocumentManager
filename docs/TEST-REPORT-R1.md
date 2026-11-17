# 测试报告 R1 · 后端源码级测试

> 角色：QA（严过关）｜ 项目：MarkdownManager ｜ 轮次：第 1 轮（T04 前端并行开发中，本轮不等前端）
> 基线：`docs/PRD.md`（R01~R21、C1~C7、AC-01~AC-31）、`docs/ARCHITECTURE.md`（含 0.5 节 R1/R2/R3 修订）、`AGENTS.md`
> 被测对象：`common/utils/*`、`uniCloud-alipay/cloudfunctions/common/mm-common/lib/*`、5 个业务云对象、6 张 DB Schema 与索引
> 本轮**未修改任何业务源码**（schema / 云对象 / 前端文件均未改动），仅新增 `tests/` 下的测试代码与 Mock 辅助。

---

## 1. 测试环境与执行方式

| 项 | 值 |
| --- | --- |
| Node | v22.22.2 ｜ npm 10.9.7 |
| 测试框架 | Node 内置 `node:test` + `node:assert/strict`（**零新增依赖**） |
| 新增文件 | `tests/*.test.js`（13 个）、`tests/helpers/mock-unicloud.js`、`tests/helpers/cloud-env.js`、`tests/helpers/load-esm.js`、`tests/helpers/stubs/uni-id-common.js` |
| 被测环境隔离 | 内存版 `uniCloud`（数据库 + 云存储 + 调用顺序日志）；`uni-id-common` 用本地替身模拟 token→uid |

### 执行命令（实测可用）

```bash
# 后端源码级测试（本轮范围，13 个文件 / 125 用例）
node --test "tests/*.test.js"

# 含工程师已交付的前端 R3 选区桥接测试（tests/ui/selection.test.js，7 用例）
node --test "tests/**/*.test.js"
```

> **环境提示**：本机 Node 22.22.2（Windows）下 `node --test tests/`（目录模式）会把目录当模块入口解析并报
> `MODULE_NOT_FOUND`，需改用上面的 glob 形式。已实测确认属于 Node CLI 行为差异，不是测试代码问题；后续接入 CI 或
> `package.json` scripts 时按 glob 写法落。

### 执行输出摘要

```text
$ node --test "tests/*.test.js"
1..125
# tests 125
# pass 125
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 239.0837

$ node --test "tests/**/*.test.js"     # 含 tests/ui
1..132
# tests 132
# pass 132
# fail 0
```

| 测试文件 | 用例数 | 通过 | 失败 | 覆盖范围 |
| --- | --- | --- | --- | --- |
| `tests/mm-text.test.js` | 7 | 7 | 0 | 提纯 / offset 双向映射 / 双份一致性 |
| `tests/chunk.test.js` | 9 | 9 | 0 | 分块 / 切片重叠 / 关键词 |
| `tests/anchor.test.js` | 9 | 9 | 0 | 批注四级定位 / findAll |
| `tests/name.test.js` | 9 | 9 | 0 | 重名 -copyN / 幂等 / 前后端一致 |
| `tests/hash.test.js` | 7 | 7 | 0 | sha256 / byteSize / uuid |
| `tests/error-constants.test.js` | 10 | 10 | 0 | ok/fail/assert + 前后端常量一致 |
| `tests/schema.test.js` | 11 | 11 | 0 | 6 表 permission / 字段 / 索引静态校验 |
| `tests/mm-file.test.js` | 16 | 16 | 0 | saveContent / purgeDelete / softDelete / restore |
| `tests/mm-comment.test.js` | 10 | 10 | 0 | 4004 锚点校验 / 重定位 / AC-16 |
| `tests/mm-settings.test.js` | 15 | 15 | 0 | getConfig / 4001 / 4005 / 首个管理员 |
| `tests/auth.test.js` | 7 | 7 | 0 | 1002 / 1003 / 匿名模式 / 管理员直通 |
| `tests/mm-search.test.js` | 9 | 9 | 0 | 四维搜索 / 陈旧索引过滤 / 回跳 offset |
| `tests/mm-image.test.js` | 6 | 6 | 0 | 幂等登记 / 临时 URL / 清理顺序 |
| **小计（本轮范围）** | **125** | **125** | **0** | |
| `tests/ui/selection.test.js`（工程师交付） | 7 | 7 | 0 | R3 domPlainMap 纯函数四场景 |
| **合计** | **132** | **132** | **0** | |

---

## 2. 用例表

> 编号 T-01~T-129 对应**断言覆盖点**（一个 `node:test` 用例可能覆盖多个覆盖点，例如「正常保存」同时验 version/元数据/update 字段/云存储/索引）；
> 第 1 节表格中的 125 为 `node:test` 实际用例数。

### A. 纯函数（两份同构实现同测）

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-01 | 两份 `mm-text.js` 源码逐字一致（去 CRLF 后字符串相等） | AC-13 基础 / 架构 8.3 | 通过 |
| T-02 | `stripMarkdown` 10 组手工推导精确值（标题/列表/链接/图片 alt/代码块/强调/引用/HTML） | AC-13 | 通过 |
| T-03 | 综合样例：`#` `**` `~~` 反引号 `](` 列表符 表格分隔行 HTML 标签全部剔除；alt、代码正文、表格内容行保留；无连续换行 | AC-13 / R3 背景 | 通过 |
| T-04 | `srcToPlain` / `plainToSrc` 双向可逆：`srcToPlain[plainToSrc[j]] === j`、字符指回原文、两端哨兵、单调性 | AC-13 / C4 坐标基准 | 通过 |
| T-05 | 被剔除标记字符映射到「下一个保留字符」 | 架构 1.5 | 通过 |
| T-06 | 非字符串入参降级为空文本 | 健壮性 | 通过 |
| T-07 | 两份实现 `plainText` / `srcToPlain` / `plainToSrc` 逐元素一致（6 组样例） | AC-13 / 8.3 | 通过 |
| T-08 | `buildChunks` 常量：单块 1000、重叠 100 | AC-22 / Q5 | 通过 |
| T-09 | 按标题分块，heading 取标题文本，`content === plainText.slice(start,end)`，`chunk_id = {file_id}#{序号}` | AC-22 / R14 | 通过 |
| T-10 | 首个标题之前的正文单独成段，heading 为空 | AC-22 | 通过 |
| T-11 | 无标题文档整篇成一块 | AC-22 | 通过 |
| T-12 | 2500 字符切片为 (0,1000)(900,1900)(1800,2500)，相邻重叠恰 100，单块不超 1000 | AC-22 / Q5 | 通过 |
| T-13 | 空文档不产生分块 | AC-22 | 通过 |
| T-14 | `extractKeywords` 标题词加权高于正文低频词、过滤停用词 | R14 | 通过 |
| T-15 | 全停用词返回空数组、空入参不抛错 | R14 | 通过 |
| T-16 | 关键词长度 ≥2 且单块 ≤12 个 | R14 | 通过 |
| T-17 | `findAll` 含重叠命中、空 needle 返回空 | AC-14 | 通过 |
| T-18 | 一级：原位置命中 → active，offset 不变 | AC-14 | 通过 |
| T-19 | 二级：原位置失败、全文唯一命中 → active 且 offset 更新 | AC-14 | 通过 |
| T-20 | 三级：两处 `foo`，靠 prefix+suffix 消歧唯一绑定到第 2 处 | AC-14 | 通过 |
| T-21 | 三级歧义失败 → 降级四级 orphaned | AC-14 | 通过 |
| T-22 | 四级：原文整段被删 → orphaned，且**保持原 offset、不误绑其他文字** | AC-14 | 通过 |
| T-23 | 编辑删除批注依附原文 → status 由 active 变 orphaned | AC-15 | 通过 |
| T-24 | 多条批注混合（1/2/3/4 级共存）计数与状态互不干扰 | AC-14 | 通过 |
| T-25 | `relocateComments` 非数组/空入参安全降级 | 健壮性 | 通过 |
| T-26 | `genUniqueName`：`a.md → a-copy1.md → a-copy2.md` | AC-02 | 通过 |
| T-27 | 改名撞名追加 `-copyN`（中文名 `周报.md`） | AC-02 | 通过 |
| T-28 | 无冲突原名返回、不产生多余后缀 | AC-02 | 通过 |
| T-29 | 幂等：同输入同集合多次调用结果一致，且填最小可用序号 | AC-02 | 通过 |
| T-30 | 已是 `-copyN` 形态继续递增，不产生 `-copy1-copy1` | AC-02 | 通过 |
| T-31 | 跨目录同名互不影响（重名作用域为同目录） | AC-02 | 通过 |
| T-32 | `splitName` 无扩展名 / 多点扩展名 / 中文 / `.hidden` 规则 | AC-02 | 通过 |
| T-33 | `genUniqueName` 非字符串与非数组入参不抛错 | 健壮性 | 通过 |
| T-34 | 前端 `utils/name.js` 与云侧 `lib/name.js` 结果逐项一致（7 组） | 8.1 / AC-02 | 通过 |
| T-35 | `sha256` 与标准 SHA-256 固定向量一致（空串 / `abc` / `中文` / 样例 md） | AC-03 | 通过 |
| T-36 | `sha256` 恒为 64 位小写 hex | AC-03 | 通过 |
| T-37 | 内容变化 → hash 变化 | AC-03 | 通过 |
| T-38 | `byteSize` 按 UTF-8 字节：中文 3 字节/字、emoji 4 字节 | AC-03 | 通过 |
| T-39 | `sha256` / `byteSize` 非字符串入参安全降级 | 健壮性 | 通过 |
| T-40 | 云侧 `genUuid` 合法 UUID v4 且 50 次不重复 | R01 | 通过 |
| T-41 | 前端 `utils/uuid.js` 同规则（合法 UUID v4） | R01 / 8.2 | 通过 |

### B. 出参工具与常量一致性

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-42 | `ok()` → `{errCode:0, errMsg:'ok', data}`，`ok(0)` 不丢值 | 3.1 出参约定 | 通过 |
| T-43 | `fail()` → `{errCode, errMsg, data:null}`，缺省取错误码中文 | 3.8 | 通过 |
| T-44 | `fail()` 自定义文案生效，非法错误码降级 9999 | 3.8 | 通过 |
| T-45 | `assert()` 条件成立不抛错，不成立抛错且带 `errCode`/`errMsg` | 3.8 / AC-20 基础 | 通过 |
| T-46 | 所有出参三键齐备且类型正确 | 3.1 | 通过 |
| T-47 | 六表名 + `uni-id-users` 前后端 `deepEqual` | 8.1 | 通过 |
| T-48 | `ANONYMOUS_USER_ID='__anonymous__'`、`SETTINGS_KEY='app_config'`、`DEFAULT_EXTENSION='md'` 前后端一致 | Q2/Q3/Q7 | 通过 |
| T-49 | `ANCHOR_CONTEXT_LEN=32`、`CHUNK_MAX_LEN=1000`、`CHUNK_OVERLAP=100` 前后端一致 | Q5 | 通过 |
| T-50 | `CLOUD_PATH` 三个模板前后端输出一致（`markdown/{uid}/{uuid}.md` 等） | R01 / C7 | 通过 |
| T-51 | `ERR` 18 个错误码与 `ERR_MESSAGE` 中文文案前后端逐项相等，且与架构 3.8 完全一致，每码均有文案 | 3.8 | 通过 |

### C. DB Schema / 索引静态校验

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-52 | 6 张 schema 文件存在、合法 JSON、`bsonType:object`、含 `properties` 与 `required` | AC-01 | 通过 |
| T-53 | **6 张表 `permission` 四项全 `false`** | AC-20 | 通过 |
| T-54 | 所有出现的 `created_at`/`updated_at`/`deleted_at` 均为 `bsonType:timestamp` | AC-04 兜底 | 通过 |
| T-55 | 各表时间字段覆盖与架构 2.1~2.6 一致（`mm-index-chunks` 仅 `created_at`、`mm-settings` 仅 `updated_at`） | 架构 2.x | 通过 |
| T-56 | `mm-files` 覆盖 PRD R02 全 13 字段 + 扩展 `type`/`icon`/`deleted_at`，`type` 与 `icon.type` 枚举正确 | R02 / R06 / R07 | 通过 |
| T-57 | `mm-files.required` 与架构 2.1 一致 | R02 | 通过 |
| T-58 | `mm-comments` 覆盖 PRD R10 全 12 字段，`status` enum 为 `active`/`orphaned` | R10 / C4 | 通过 |
| T-59 | `mm-index-chunks` 覆盖 PRD R14 全 9 字段 | R14 / C6 | 通过 |
| T-60 | `mm-images` / `mm-settings` / `mm-user-permissions` required 与架构 2.3/2.5/2.6 一致；账号默认 true、权限默认 false | R09 / R12 / R13 | 通过 |
| T-61 | 6 个 `.index.json` JSON 合法、索引名/键序/唯一标记与架构 2.7 完全一致（4 个唯一索引） | 架构 2.7 | 通过 |
| T-62 | `mm-settings.init_data.json` 预置单条 `app_config`（账号开 / 权限关） | 架构 2.9 | 通过 |

### D. mm-file 云对象

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-63 | 正常保存：`version=1`、`size`/`content_hash` 重算、`created_at` **不在 update 字段**（精确断言 patch 键集合） | AC-03 / C3 | 通过 |
| T-64 | 云存储复用原 `cloudPath` 覆盖写，`storage_key` 保持稳定 | D3 | 通过 |
| T-65 | 保存后重建索引，分块 `revision` 与新 version 对齐 | AC-22 | 通过 |
| T-66 | 首次保存（云端 0 / 基准 0）不误报冲突 | Q1 裁决 / AC-03 | 通过 |
| T-67 | **并发冲突**：A 先保存成功后 B（base_version 相同）收 2001，且**不写库、不覆盖云存储** | AC-10 | 通过 |
| T-68 | 冲突返回携带 `cloudVersion` / `cloudContent` / `cloudUpdatedAt`（供前端弹窗） | AC-10 / 3.2 | 通过 |
| T-69 | `force=true` 覆写：`version = cloudVersion + 1`，写入云存储，索引 revision 刷新 | AC-11 | 通过 |
| T-70 | 冲突「放弃」（不重试保存）→ 云端 version / size / 内容全部不变 | AC-12 服务端侧 | 通过 |
| T-71 | 忽略客户端伪造的 `created_at`/`updated_at`/`size`/`content_hash`/`version`/`user_id` | AC-04 源码级 | 通过 |
| T-72 | 二次保存索引先删后插：旧关键词不再命中、新关键词可命中、无重复分块 | AC-22 / C6 | 通过 |
| T-73 | 参数/资源校验：缺 `file_id` → 1001，文档不存在 → 1004，`content` 非字符串 → 1001 | 3.2 | 通过 |
| T-74 | **purgeDelete 云存储删除失败（status!==0）→ 3002 且文件/批注/分块一条都没删** | AC-26 / Q6 | 通过 |
| T-75 | `deleteFile` 抛错同样 3002 且不删记录 | AC-26 | 通过 |
| T-76 | purgeDelete 成功：`deleteFile` 先于任何记录删除 → 级联删 comments → chunks → 最后删 files（顺序断言） | AC-26 / 5.4 | 通过 |
| T-77 | 文件夹彻底删除递归收集后代 `storage_key` 一并删除（`deletedFiles=2`、`deletedKeys=1`） | AC-26 | 通过 |
| T-78 | softDelete 只置 `is_delete=true` + `deleted_at`，**不调 deleteFile**、不清 `storage_key`、云存储内容不变 | AC-25 / C2 | 通过 |
| T-79 | restore：`deleted_at` 置 `null`、`is_delete=false`、撞名走 `genUniqueName` 返回 `renamed` | AC-25 | 通过 |
| T-80 | softDelete / restore 空入参 → 1001 | 3.2 | 通过 |
| T-81 | listFiles 按目录 + 未删除过滤，回收站文档不入列表，返回分页结构 | R05 | 通过 |
| T-82 | rename 同目录撞名追加 `-copy1` | AC-02 | 通过 |

### E. mm-comment 云对象

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-83 | 前置：样例 md 的 plainText 与预期一致（锚点坐标基准） | AC-13 | 通过 |
| T-84 | 正常新建：`status=active`，`selected_text`/`prefix`/`suffix`/`start_offset`/`end_offset`/`comment` 齐全 | AC-13 / R10 | 通过 |
| T-85 | **`selected_text !== plainText.slice(start,end)` → 4004 且不写入任何批注** | AC-13/14 / R3 防线 | 通过 |
| T-86 | `prefix` 不符 → 4004；`suffix` 不符 → 4004 | R3 防线 | 通过 |
| T-87 | **R3 场景**：含图片文档中误传 DOM 序列文本（缺 alt）→ 4004，不写入 | R3 / AC-13 | 通过 |
| T-88 | 参数校验：空选区 / 空批注 / 空区间 / 负偏移 / 缺 file_id → 1001 | 3.3 | 通过 |
| T-89 | update 只改 `comment` 与 `updated_at`，`created_at` 不变（patch 键集合精确断言） | AC-16 / C3 | 通过 |
| T-90 | relocate：内容前插后批注被重定位到新位置（3→6），失陪批注置 orphaned 且保持原 offset | AC-14/15 | 通过 |
| T-91 | listByFile 默认含 orphaned，可按 status 过滤 | AC-14 | 通过 |
| T-92 | remove 删除批注并返回删除条数 | 3.3 | 通过 |

### F. mm-settings 云对象

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-93 | **未登录（无 token）也能返回配置**，且 `anonymous=false` | AC-17 前提 / Q2 | 通过 |
| T-94 | 配置文档缺失时返回默认值（账号开 / 权限关） | R12 / R13 | 通过 |
| T-95 | 账号关闭时 `getConfig` 返回 `anonymous=true` | Q3 | 通过 |
| T-96 | **账号 true→false 且用户数 >1 → 4001，配置零写入** | AC-18 / C5 | 通过 |
| T-97 | 账号 true→false 且仅单用户 → 允许关闭 | AC-18 | 通过 |
| T-98 | **`permission_enabled=true` 且 `account_enabled=false` → 4005** | C5 / 3.5 | 通过 |
| T-99 | **权限 false→true：首个注册用户（register_date 最早）成为 admin**，其余用户补 `can_read/can_write=true` | AC-19 / C5 | 通过 |
| T-100 | 权限开启时非管理员改配置 → 1003 | AC-19 / AC-20 | 通过 |
| T-101 | updateConfig 缺参数 → 1001 | 3.5 | 通过 |
| T-102 | 未登录写配置（账号开启且无 token）→ 1002 | AC-20 | 通过 |
| T-103 | 管理员可 listUsers 且角色回显正确；权限开启时非管理员 → 1003 | AC-19 | 通过 |
| T-104 | setUserPermission 设 `can_write=false` 生效；修改管理员自身权限 → 1003 | AC-19 | 通过 |
| T-105 | setUserPermission 用户不存在 → 1004，缺 user_id → 1001 | 3.5 | 通过 |
| T-106 | ensureConfig 幂等：重复调用不产生第二条配置文档（唯一键语义） | 架构 2.5 | 通过 |
| T-107 | 匿名模式下 `updated_by` 强制记 `__anonymous__` | 架构 9.2 | 通过 |

### G. 鉴权与权限位二次校验

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-108 | 未登录写 `saveContent` → 1002，无云存储写入、version 不变 | AC-20 | 通过 |
| T-109 | **非本人文档写操作 → 1003**，不写库、不覆盖云存储 | AC-20 | 通过 |
| T-110 | **权限开启 + 用户被设只读 → 保存被 1003 拒绝且无任何写入（含索引）** | AC-19 | 通过 |
| T-111 | 权限开启时管理员可写他人文档（直通） | C5 | 通过 |
| T-112 | 账号关闭（匿名模式）无需登录即可读写 | AC-18 / Q3 | 通过 |
| T-113 | `mm-comment.add` 未登录 → 1002；只读用户新建批注 → 1003 且不写入 | AC-20 | 通过 |
| T-114 | `mm-image.register` 未登录 → 1002 | AC-20 | 通过 |

### H. mm-search 云对象

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-115 | `scope=tag` 按标签命中，回收站文档不命中 | AC-21 | 通过 |
| T-116 | `scope=name` 按文件名命中 | AC-21 | 通过 |
| T-117 | `scope=comment` 按批注内容命中并回填 `file_name` | AC-21 | 通过 |
| T-118 | **`scope=content` 返回 `start_offset`/`end_offset`/`snippet` 供回跳** | AC-21 / AC-23 | 通过 |
| T-119 | 关键词仅出现在 `keywords` 数组时同样命中，且**陈旧索引（revision≠文件 version）被过滤** | AC-21 / AC-22 | 通过 |
| T-120 | `scope=all` 四维同时检索，`total` 正确，回收站与陈旧索引排除 | AC-21 | 通过 |
| T-121 | 非法 scope 降级 all；空关键词 → 1001 | 3.4 | 通过 |
| T-122 | 用户输入按字面量转义，`.*` 不扩大命中范围 | 安全性 | 通过 |
| T-123 | 结果按身份过滤：登录用户搜不到他人名下文档；无 token → 1002 | AC-20 | 通过 |

### I. mm-image 云对象（追加覆盖）

| 编号 | 用例 | 对应 AC | 结果 |
| --- | --- | --- | --- |
| T-124 | register 成功后库中**只存 fileID**，无 `http` 临时 URL 落库，扩展名小写化 | AC-09 / C7 | 通过 |
| T-125 | **register 幂等**：同一 fileID 重复登记返回已有记录、不产生重复行（复用不重复上传） | AC-08 / C7 | 通过 |
| T-126 | register 四类缺参 → 1001 | 3.6 | 通过 |
| T-127 | getTempUrls 现场换取 URL 且**不写库**；换取失败 → 3003；空入参 → 1001 | AC-09 | 通过 |
| T-128 | remove 云存储失败 → 3002 且记录保留；成功后调用 deleteFile 再删记录 | Q6 | 通过 |
| T-129 | list 只返回本人记录且不含临时 URL | AC-09 | 通过 |

---

## 3. 未覆盖项（本轮不判定，属「部署后验证」）

以下条目依赖真实服务空间 / 真实云存储 / 真实 uni-id，本地只做了源码逻辑与静态校验，**不判失败**：

| AC | 条目 | 本轮处理 |
| --- | --- | --- |
| AC-01 | 上传后云存储出现 `markdown/{uid}/{uuid}.md`、落库 12 字段齐全 | 仅静态核对 schema + `CLOUD_PATH` 模板一致性（T-47/T-50/T-56） |
| AC-04 | 真实落库时间仍为服务器时间 | 源码级核对（T-71）通过，真实 `db.serverDate()` 需部署验证 |
| AC-08 | 「上传新图片」云存储新增 + 图片表新增 | 用 Mock 验证调用契约与幂等（T-124/T-125） |
| AC-20 后半 | 绕过前端入口亦被拦截（部署后真实网关） | 源码级 `permission` 全 false（T-53）+ `assertWrite` 二次校验（T-108~T-114） |
| AC-26 | 真实云存储文件确实不存在 | Mock 验证顺序与失败回滚（T-74~T-77） |
| AC-29 | Wot UI 组件被实际引用 + 真实 H5 编译通过 | **按架构 R2 口径本轮不判定**，最终判据为 T05 真实编译 |
| AC-27/28/30/31 | 三栏布局 / 首屏动画 / 中文文案 / 可编译 H5 | T04、T05 范围，本轮未判 |
| AC-12 前半 | 「放弃」后编辑器内文字保留在页面上 | 纯前端行为（T04），本轮只验服务端不写库（T-70） |

---

## 4. 智能路由判定

### 结论：**NoOne（本轮全部通过）**

- 本轮 125 个后端用例 + 工程师已交付 7 个前端 R3 用例 = **132/132 全部通过**，失败 0。
- **未发现需要路由给工程师（Alex）的源码 Bug**：所有断言均按 PRD / 架构口径编写，实现均满足；
  AC-03/10/11/12（服务端侧）/13/14/15/16/17（前提）/18/19/20/21/22/23/25/26 的服务端逻辑均已源码级验证通过。

### 本轮由 QA 自行修正的测试代码问题（2 处，未涉及业务源码）

| # | 问题 | 处置 |
| --- | --- | --- |
| 1 | `anchor.test.js` 第三级消歧用例的 `start_offset` 误设为 0~3，恰好命中「第一级原位匹配」，导致用例语义失效 | 改为 4~7 使一级失效，用例真实进入三级 → 四级路径 |
| 2 | `hash.test.js` 中 `byteSize('# 标题')` 期望值手算为 7，实际 8（`#`+空格+中文 6 字节） | 修正期望值为 8 |

两处均为**测试代码自身缺陷**（断言/夹具写错），源码行为正确，按规则由 QA 自行修复，不路由。

---

## 5. 遗留风险与待确认项

### R1-1（需架构/主理人确认口径，非阻塞）「权限关闭时」跨用户访问的语义

- 现状：`canAccess()` 在 `permission_enabled=false` 时，非本人文档一律拒绝（1003）。
- 依据冲突：`ARCHITECTURE.md` 4.5 / 2.6 写「权限关闭：所有用户默认全部可读可写」，字面可理解为「所有用户对**所有**文档可读写」；
  而 PRD 角色表写「普通用户：自己名下文档的…；按权限位被授予他人文档的可读/可写」。
- 影响：默认配置（账号开 / 权限关）下，团队成员之间**看不到彼此的文档**；要共享需开启权限并逐人授权，或直接关闭账号功能进入匿名共享库。
- 我的判定：实现口径与 PRD 角色表自洽、且更保守（更安全），**不判为 Bug**，本轮按「非本人文档 → 1003」编写用例（AC-20 要求）。
  建议架构在 T05 文档中明确一句口径，避免后续误判为缺陷。

### R1-2 `stripMarkdown` 把 `_` 一律当强调标记

`snake_case_name` 会被提纯为 `snakecasename`，影响正文搜索召回与批注锚点可读性。属架构 1.5 规格的既定行为（规格未区分下划线强调与标识符），
不判 Bug；若后续需要，建议 P2 增加「`_` 仅在成对出现时视为强调」的规则（需两份同构副本同步改）。

### R1-3 `isTableSeparatorLine` 会把 `- - -` 这类水平分隔线整行剔除

同一规则也剔除了表格分隔行，属规格预期；但 `---` 前后段落会在 plainText 中直接相邻（无额外分隔符），
不影响 offset 一致性，仅影响可读性。低风险。

### R1-4 部署后方可证实的假设

- `uni-id-common.createInstance().checkToken()` 的真实签名与返回结构（`payload.uid` / `payload.user_id`）需在部署后核对；
  `auth.js` 已按两种字段名兜底，但 tokenSecret 配置缺失时会导致全部写操作返回 1002。
- 支付宝云 `uniCloud.deleteFile` 在云对象侧调用权限、覆盖写后 fileID 是否变化（代码已兜底同步 `storage_key`）。
- `db.RegExp` 对**数组字段**（`tags` / `keywords`）的元素级匹配行为需在真实数据库中复核（本地方按 Mongo 语义 Mock）。

### R1-5 前端未完成导致的本轮盲区

`common/utils/selection.js` 的 `domPlainMap` 真实 DOM 路径、`mm-md-viewer` 是否真的用 `plainText.slice()` 生成
`selected_text/prefix/suffix`（R3 强制约定），本轮只验了服务端 4004 防线与工程师的纯函数单测，未验真实浏览器交互。
**这是 C4 / AC-13 / AC-14 的最后一环，建议 T04 完成后补一轮 H5 真机点击验证。**

---

## 6. 建议下一步

1. **不阻塞**：本轮结论为「服务端逻辑全部通过」，T03 可视为源码级验收通过，无需返工。
2. 请架构用一句话确认 R1-1 口径（权限关闭时跨用户是否可读写），T05 写入 `docs/DEPLOY.md` / `AC-CHECKLIST.md`。
3. T04 前端落地后，补第 2 轮测试：R3 真实 DOM 选区（含图片/表格/多段落/纯文本四场景）→ `mm-comment.add` 端到端联调；
   `mm-file.saveContent` 冲突弹窗「放弃不清空编辑器」（AC-12 前端侧）。
4. T05 在 HBuilderX 内跑真实 H5 编译，作为 AC-29 的最终判据；同时执行 AC-01/04/08/26 的部署后验证项。
5. 建议把执行命令固化进 `package.json` scripts（`"test": "node --test \"tests/*.test.js\""`），避免目录模式在 Windows 上失效。
