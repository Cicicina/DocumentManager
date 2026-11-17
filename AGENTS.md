# 全局 Agent 行为基线 (Global Agent Baseline)

> 作用域：用户主目录及未定义本地规则的临时/子目录。若项目内存在本地 `AGENTS.md` 或 `CLAUDE.md`，以项目规则为最高权威。

## 交互偏好
- **语言**：始终使用中文回复，代码注释与文档同步使用中文。
- **行动优先**：用户提出明确操作指令时，默认直接通过工具执行，而非仅列出操作步骤。
- **精炼交付**：回答直接聚焦核心结果与关键决策，避免重复输出无需解释的通用背景。
- **指出问题**：不要盲目附和我，我说错了就指出来
- - **避免无效的否定说明和防御性解释，不刻意补充用户显然知道的常识、无关的例外或不影响结论的限定条件，只保留有实际信息增量的内容。严谨不等于穷尽所有可能的误解；准确不等于解释所有显而易见的例外。**

## 操作与安全底线
- **先读后改**：修改已有文件前，读取完成本次修改所需的文件与上下文；大型文件按需读取相关范围，避免无关全量读取，严禁盲写覆盖。
- **增量安全**：除当前任务授权的目标文件外，保持其他文件与目录原样。
- **删除守卫**：严禁自主推断并执行文件或目录的永久删除（`rm`、清空目录等）；仅在用户当前轮次提示词中明确指定了具体删除对象与路径时方可执行。
- **环境隔离**：Python 优先使用当前激活的环境（Conda base / uv）；Node.js 遵循当前激活的 nvm 版本；严禁全局提权安装可能污染系统的包。

## UI界面要求
- **设计要求**：Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.避免不必要的次要标签和描述，让布局本身来传达信息。把精力放在信息层级、视觉引导和交互逻辑上，而不是靠小字打补丁。必要的错误提示和操作反馈保留，删掉不影响理解的废话即可。

## 微信小程序 UI 核验与热更新(若当前项目技术基于微信小程序读取,否则跳过)

- **优先后台截图**：需要确认微信小程序的布局、元素、字号、间距或还原程度时，优先通过 `miniprogram-automator` 连接微信开发者工具，读取当前路由并调用 `miniProgram.screenshot({path})` 截取模拟器画面；H5 参考页使用 Playwright 无头浏览器截图。默认不使用 computer-use 接管鼠标、键盘或前台窗口。自动化接口不可用时先排查连接原因，说明限制后再选择其他方式。
- **区分端口用途**：先检查实际监听端口与连接结果，不把端口存在视为自动化已就绪。本项目已验证：`9420` 是 IDE HTTP 管理端口，`9421` 是自动化 WebSocket 端口，连接示例为 `automator.connect({wsEndpoint:'ws://127.0.0.1:9421'})`；这些端口可能变化，不得永久硬编码为环境事实。必要时使用开发者工具 CLI 启用目标项目自动化：`& 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat' auto --project 'C:/Users/markJing/Desktop/work/SneakerInventoryManagement/apps/mobile/dist/dev/mp-weixin' --auto-port 9421`，随后重新验证连接和项目身份。
- **先确认页面就绪**：截图前核对目标项目、实际路由和关键元素，等待页面完成渲染与必要数据加载。连接成功但页面栈为空、出现 `rawPath` 错误或截图正文空白时，不能判定 UI 已还原。增量编译可能使模拟器重新回到首页，应重新确认路由；确需跳转时使用自动化导航，并轮询目标路由及元素就绪，不能只固定等待几百毫秒就宣称跳转成功。
- **同状态对照**：以用户已敲定的 H5 页面为视觉来源，统一逻辑视口宽度、主题、账号角色、权限、业务数据、会员状态及滚动位置，再对照截图。保留修改前、修改后和必要的下半屏截图，逐项检查页面结构、组件位置、图标、文字、字号、行高、间距、圆角和颜色。可用元素的 `size()`、`offset()`、样式读数与 H5 的 `getBoundingClientRect()` 辅助量化，不只凭肉眼判断。
- **区分平台差异与还原误差**：记录微信状态栏、原生胶囊、底部安全区和设备缩放取整带来的偏移；对齐内容坐标时明确扣除的偏移及原因。模拟器截图、H5 截图与真机验收分别报告，不能用 H5 图冒充小程序效果，也不能从单页、单主题或单账号截图推断全应用已 1:1 还原。
- **截图不代表工具整体状态**：`miniProgram.screenshot()` 只展示小程序模拟器画面，不能据此判断开发者工具的控制台、编译面板或整个窗口状态。编译结果另查开发监听日志，路由与元素另查自动化接口，运行异常另查日志或异常事件；截图成功、接口成功和业务行为通过分别核验。
- **普通修改使用开发监听**：小程序优先运行 `pnpm --filter @sneaker/mobile dev:mp-weixin`，开发者工具打开 `apps/mobile/dist/dev/mp-weixin`；正式 H5 使用 `pnpm --filter @sneaker/mobile dev:h5`，独立原型使用 `pnpm dev:prototype`。复用已有监听进程，修改后等待增量编译／HMR，再截图验证，不要每次执行完整 `build:mp-weixin` 或 `build:h5`。小程序刷新可能重置页面状态，不承诺与 H5 一样保留状态；仅在发布、构建配置变化或明确需要完整产物验证时执行完整 build。
- **验证真实行为并保留证据**：视觉对齐后，再验证本页真实接口、权限过滤、加载失败及入口跳转，避免把预制数据或模拟通过当成后端完成。优先只读检查，保留现有登录态，不为截图擅自登出、写入真实业务数据或持久化模拟状态；临时诊断钩子用完恢复。截图、测量与脱敏结果放在 `artifacts/ui-current/` 等受控目录，验收结论记入 `docs/ui-refactor/`，不得记录令牌、密码或原始敏感响应。可参考 `docs/ui-refactor/P011-小程序对齐记录-2026-10-27.md`。

## HBuild X CLI 操作云端数据库(若当前项目技术基于Unicloud读取,否则跳过)
- **区分两种运行方式**：在 HBuilderX 的 UniCloud 数据库目录中打开 `.jql` 文件并按 F5，运行的是 JQL 管理器；管理器会注入 `db`，应直接写 `db.collection(...)`，不要调用 `uniCloud.databaseForJQL()`。HBuilderX CLI 的 `unicloud test` 运行 `.itest.js` 集成测试，不是直接执行 `.jql` 文件；目前没有验证到 CLI 直接运行 `.jql` 文件的命令。
- **CLI 集成测试入口**：单个用例可运行 `C:/HBuilderX/cli.exe unicloud test --prj shoecang-cloud --provider aliyun --functionName sneaker-api --file <绝对路径.itest.js> --mode integration --space <服务空间ID>`。先用 `cloud functions --info 1` 确认项目关联的服务空间与目标 ID 一致。测试中用 `uniCloudTest.seed(async db => { ... })` 获取真实服务空间的数据库连接；只有目标云函数加载 `uni-cloud-jql` 扩展库时才可调用 `uniCloud.databaseForJQL()`。本项目 `sneaker-api` 未配置该扩展，已验证直接调用会报扩展库缺失。项目封装入口是 `node scripts/test-cloud.mjs --cases=<用例名> --report=<报告名.json>`；不要不带 `--cases` 执行整组测试来验证单条数据库操作，因为默认集合中包含其他集成用例。
- **CLI 集成结果与日志**：不要只依据 `cli.exe` 外层进程退出码判断测试是否通过；已观察到 Vitest 用例失败时 CLI 外层仍可能返回 `0`，但日志包含 `-1:unicloud test:测试失败，退出码: 1`，并且测试报告会记录失败。必须核对测试报告、用例摘要或内部失败标记。云端集成日志可能带出服务端配置或密钥参数；输出重定向到受控临时文件，只提取不含 URL、fileID 和密钥的计数/状态，完成后清理临时日志，禁止把原始日志粘贴到聊天或提交进仓库。
- **先只读核对**：先按集合、作用域和稳定 `_id` 精确查询目标记录，确认字段类型、当前值和匹配数量；再单独准备写入语句或集成测试。不要把探索查询与写入混在同一段 JQL 中。JQL 管理器绕过 DB Schema 权限限制，F5 可能运行全部代码；运行前检查整个文件，删除空的 `const`、重复顶层 `const`、意外的 `.remove()` / `.update()` / `.set()`，优先只选中并运行已审阅的语句。
- **写入必须窄范围且可核验**：修改现有记录时用稳定 `_id` 或唯一业务键限制范围，并检查 `update()` 返回的更新数；随后重新查询确认结果。批量变更前先统计命中数并输出待变更 ID 清单。需要测试写入时只使用明确标记的合成记录，并在用例中验证和清理这些记录；禁止用无过滤条件的 `update()`、`remove()` 或 `set()` 操作真实业务集合。集成测试会连接所配置的真实阿里云空间，应把其中每条写操作都当作云端真实写入审查。
- **云文件字段**：品牌 Logo 使用 Schema 的原生 `file` 对象，`url` 保存云存储 `fileID`；不要写入旧 `logoFileId` 字段，也不要把临时 URL 持久化到数据库。服务端通过 `getTempFileURL` 生成显示用 URL。已上传但未绑定的文件，应先在 UniCloud 云存储控制台核对并记录 `fileID`，再将对应 ID 与品牌 `_id` 映射后执行精确更新；没有核实的 ID 不得猜测或批量绑定。
- **CLI 云存储核验与写入**：`uniCloud.getTempFileURL` 应在 `uniCloudTest.seed(async db => ...)` 回调中通过 `globalThis.uniCloud` 调用；直接使用未声明的 `uniCloud` 标识符可能触发 `ReferenceError`。先用只读用例批量核验映射文件中的对象，再通过 `CloudRepository` 事务按稳定业务 ID 读取并写入 `logo: { name, extname, url: fileID }`，检查品牌名称、`scope` 和原 Logo 空值，最后复查数据库记录并调用品牌 Logo 服务端显示方法验证临时 URL。批量改动应一并推进 `settings/catalog-maintenance.version`，使公共目录分页游标失效；将绑定数量和复查结果保存为本地审计 JSON。
- **参考文档**：仅在通过CLI写入数据到uniCloud云端遇到问题的时候查阅，[HBuilderX JQL 管理器](https://doc.dcloud.net.cn/uniCloud/jql-runner.html)、[UniCloud JQL](https://doc.dcloud.net.cn/uniCloud/jql.html)、[CLI 集成测试](https://doc.dcloud.net.cn/uniCloud/test.html)、[服务空间关联](https://doc.dcloud.net.cn/uniCloud/concepts/space)。


