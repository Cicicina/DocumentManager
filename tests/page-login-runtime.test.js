/**
 * pages/index/index.vue 登录守卫的「运行时集成」测试 + 源码契约复核。
 *
 * 与静态断言不同，这里把 .vue 的 <script setup> 抽出来，注入最小 Vue / uni-app /
 * 业务 API 替身，但把 common/api/index.js 的 isLocalTokenExpired / handleLoginExpired /
 * resetLoginGuard 用「真实实现」注入，从而真正执行 guardLogin / watch(ready) / onShow /
 * loadIdentity / logout 的分支，验证：
 * - guardLogin() 的 boolean 契约与所有调用点；
 * - 返回 false 时 watch(ready) 不再 bootstrap（避免失效后继续发请求）；
 * - 匿名模式（账号开关关闭）直入、不弹登录、不清态；
 * - 失效后 store.user.uid 归零，顶栏「登录」入口重新可见；
 * - onShow 只有拿到新的未过期 token 才复位守卫并同步身份；
 * - loadIdentity 对云端 500 只吞掉、对明确 uni-id 失效才引导重新登录。
 *
 * 末段附源码契约的静态断言（导出对齐 / 无循环依赖 / 无重复实现 / 登录页路由）。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { readText, ROOT } = require('./helpers/load-esm.js')
const {
  loadConstants,
  installGlobals,
  loadInjectedModule,
  loadApiModule
} = require('./helpers/api-runtime.js')

const LOGIN_PAGE = '/uni_modules/uni-id-pages/pages/login/login-withpwd'
// 跳转地址必须带回收跳参数：uni-id-pages 的 loginBack() 在 delta=0 时不会跳转，会停在登录页
const LOGIN_URL = `${LOGIN_PAGE}?uniIdRedirectUrl=${encodeURIComponent('/pages/index/index')}`
const LOGIN_TOAST = '登录状态已失效，请重新登录'

/** 构造 uni / uniCloud 侧替身，同时提供页面所需的全部 import 依赖 */
function createPageDeps(options) {
  const opts = options || {}
  const calls = {
    /** 页面发起的业务云对象调用 */
    api: [],
    watchers: [],
    lifecycles: {},
    toasts: []
  }

  const state = {
    ready: opts.ready === undefined ? true : opts.ready,
    config: Object.assign({}, opts.config || {}),
    user: Object.assign({ uid: '', anonymous: false }, opts.user || {}),
    editorContent: '',
    tree: [],
    files: [],
    comments: [],
    theme: 'auto',
    currentFile: null,
    baseVersion: 0
  }

  const store = {
    state,
    setUser(patch) { Object.assign(state.user, patch) },
    setConfig(config) { state.config = Object.assign({}, config) },
    setReady(value) { state.ready = value },
    setTree(value) { state.tree = value },
    setFiles(value) { state.files = value },
    setComments(value) { state.comments = value },
    setEditor(value) { state.editorContent = value },
    setTheme(value) { state.theme = value },
    openFile(doc, content) { state.currentFile = doc; state.editorContent = content },
    resetBaseVersion(value) { state.baseVersion = value }
  }

  /** 业务 API 替身：记录调用并返回不会让页面逻辑抛错的成功结果 */
  const apiStub = name => async (...args) => {
    calls.api.push({ name, args })
    if (name === 'listTree') return { code: 0, data: [] }
    if (name === 'listFiles') return { code: 0, data: { list: [] } }
    return { code: 0, data: {} }
  }

  const apiNames = [
    'listTree', 'listFiles', 'createFolder', 'registerUpload', 'importFile',
    'getContent', 'saveContent', 'rename', 'move', 'updateIcon', 'softDelete',
    'exportFile', 'listByFile', 'add', 'update', 'remove', 'getTempUrls', 'syncRefs'
  ]
  const apiStubs = {}
  for (const name of apiNames) apiStubs[name] = apiStub(name)

  const deps = {
    // vue / uni-app / UI 最小替身
    ref: value => ({ value }),
    computed: input => {
      if (typeof input === 'function') return { get value() { return input() } }
      return {
        get value() { return input.get() },
        set value(next) { input.set(next) }
      }
    },
    watch: (getter, cb, options) => calls.watchers.push({ getter, cb, options }),
    onLoad: cb => { calls.lifecycles.onLoad = cb },
    onShow: cb => { calls.lifecycles.onShow = cb },
    onMounted: cb => { calls.lifecycles.onMounted = cb },
    onUnmounted: cb => { calls.lifecycles.onUnmounted = cb },
    useToast: () => ({ show: text => calls.toasts.push(text) }),
    useAppStore: () => store,
    // 真实常量
    ANONYMOUS_USER_ID: opts.constants.ANONYMOUS_USER_ID,
    CLOUD_PATH: opts.constants.CLOUD_PATH,
    // 工具替身
    genUuid: () => 'uuid',
    setStoredTheme: () => {},
    getMmText: () => null,
    downloadMarkdown: () => {},
    uploadCloudFile: async () => ({ fileID: 'cloud://mock/x.md' }),
    // 业务 API 替身
    ...apiStubs,
    // 关键：注入 common/api/index.js 的真实登录态函数，形成真正的集成验证
    isTokenInvalid: opts.api.isTokenInvalid,
    isLocalTokenExpired: opts.api.isLocalTokenExpired,
    handleLoginExpired: opts.api.handleLoginExpired,
    resetLoginGuard: opts.api.resetLoginGuard
  }

  return { deps, calls, state, store }
}

/**
 * 构造独立页面运行时：Mock 全局 + 真实 api 模块 + 执行 .vue script setup。
 * @param {object} options
 * @param {(ctx:{env:object, api:object, deps:object, calls:object, state:object, page:object})=>Promise<void>} fn
 */
async function withPage(options, fn) {
  const opts = options || {}
  const constants = await loadConstants()

  const env = installGlobals({
    storage: Object.assign({}, opts.storage || {}),
    navigateFails: opts.navigateFails,
    objects: {
      // loadIdentity 会调用 uni-id-co.getUserInfo
      'uni-id-co': {
        getUserInfo: async () => {
          if (opts.getUserInfoThrows) throw opts.getUserInfoThrows
          return opts.userInfo || { userInfo: { _id: 'u1' } }
        }
      }
    }
  })

  try {
    const { module: api } = await loadApiModule(constants)
    const built = createPageDeps({ constants, api, config: opts.config, user: opts.user, ready: opts.ready })
    const vueSource = readText('pages/index/index.vue')
    const scriptMatched = /<script setup>([\s\S]*?)<\/script>/.exec(vueSource)
    assert.ok(scriptMatched, '未找到 pages/index/index.vue 的 <script setup> 块')

    const { exposed: page } = await loadInjectedModule(scriptMatched[1], {
      deps: built.deps,
      expose: [
        'guardLogin', 'loadIdentity', 'logout', 'goLogin', 'handleLoginSuccessSync',
        'bootstrap', 'store', 'isLoggedIn', 'handleUserMenu',
        // 抽屉 / 预览开关（三点交互）
        'drawerVisible', 'handleDrawerFolderSelect', 'handleDrawerOpenFile',
        'editorPreview', 'toggleEditorPreview', 'currentFolderId', 'loadFiles',
        // 移动到：层级浏览相关（三点交互）
        'moveVisible', 'moveSource', 'moveCurrentId', 'moveTargets', 'moveTargetIndex',
        'moveCurrentTarget', 'moveRootTarget', 'moveHereDisabled', 'moveBreadcrumb',
        'moveBrowseTargets', 'browseMoveTarget', 'moveToLevel', 'moveUpOneLevel',
        'confirmMoveHere', 'chooseMoveTarget',
        'handleMoveFile', 'handleMoveFolder'
      ]
    })
    await fn({
      env,
      api,
      constants,
      deps: built.deps,
      calls: built.calls,
      state: built.state,
      page
    })
  } finally {
    env.restore()
  }
}

/** 找到 watch(() => store.state.ready, ..., { immediate: true }) */
function readyWatcher(calls) {
  return calls.watchers.find(item => item.options && item.options.immediate === true)
}

/** 等待页面内 loadIdentity().then(bootstrap) 这类微任务链完成 */
function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve))
}

// ---------------------------------------------------------------------------
// 一、guardLogin() 的 boolean 契约（参数化覆盖四个分支）
// ---------------------------------------------------------------------------

const guardCases = [
  {
    name: '匿名模式（账号开关关闭）返回 true，直入且不弹登录',
    options: { config: { account_enabled: false }, storage: {} },
    expected: true,
    assertExtra: ({ env, state, constants }) => {
      assert.equal(state.user.anonymous, true)
      assert.equal(state.user.uid, constants.ANONYMOUS_USER_ID)
      assert.equal(env.calls.toasts.length, 0)
      assert.equal(env.calls.navigateTo.length, 0)
      assert.equal(env.calls.removed.length, 0)
    }
  },
  {
    name: '账号开启且无 token 返回 false，清态并把 uid 置空（登录入口可见）',
    options: { config: { account_enabled: true }, storage: {} },
    expected: false,
    assertExtra: ({ env, state, page }) => {
      assert.equal(state.user.uid, '')
      assert.equal(page.isLoggedIn.value, false, '顶栏 v-else 的「登录」入口必须可见')
      assert.equal(env.calls.toasts.length, 1)
      assert.equal(env.calls.toasts[0].title, LOGIN_TOAST)
      env.flushTimers()
      assert.equal(env.calls.navigateTo.length, 1)
      assert.equal(env.calls.navigateTo[0].url, LOGIN_URL)
    }
  },
  {
    name: '账号开启且本地凭据已过期返回 false（毫秒级过去值）',
    options: {
      config: { account_enabled: true },
      storage: { uni_id_token: 'old-token', uni_id_token_expired: Date.now() - 1000 }
    },
    expected: false,
    assertExtra: ({ env, state }) => {
      assert.equal(state.user.uid, '')
      assert.equal(env.storage.uni_id_token, undefined, '真过期必须清掉 token')
      assert.equal(env.calls.toasts.length, 1)
      env.flushTimers()
      assert.equal(env.calls.navigateTo.length, 1)
    }
  },
  {
    name: '账号开启且本地凭据未过期返回 true（秒级未来值不误判）',
    options: {
      config: { account_enabled: true },
      storage: {
        uni_id_token: 'valid-token',
        uni_id_token_expired: Math.floor(Date.now() / 1000) + 3600
      }
    },
    expected: true,
    assertExtra: ({ env, state }) => {
      assert.equal(env.calls.toasts.length, 0)
      assert.equal(env.calls.navigateTo.length, 0)
      assert.equal(env.calls.removed.length, 0, '未过期不得清凭据')
      assert.equal(state.user.uid, 'u1', 'loadIdentity 应同步出真实身份')
      assert.ok(env.calls.importObject.some(item => item.name === 'uni-id-co'),
        '未过期时应走 uni-id-co.getUserInfo 同步身份')
    }
  }
]

for (const item of guardCases) {
  test(`guardLogin() 契约：${item.name}`, async () => {
    await withPage(item.options, async ctx => {
      const result = ctx.page.guardLogin()
      assert.equal(result, item.expected, 'guardLogin 必须返回 boolean')
      // 未过期分支里 loadIdentity 是异步调用，需等微任务完成后再断言身份
      await flushMicrotasks()
      item.assertExtra(ctx)
    })
  })
}

// ---------------------------------------------------------------------------
// 二、watch(ready) 正确消费 boolean：false 时不再 bootstrap
// ---------------------------------------------------------------------------

test('watch(ready)：guardLogin 返回 false 时不执行 bootstrap，不再发一批请求', async () => {
  await withPage({ config: { account_enabled: true }, storage: {} }, async ({ env, calls, page }) => {
    const watcher = readyWatcher(calls)
    assert.ok(watcher, '缺少 watch(ready) 注册')
    assert.equal(watcher.getter(), true)

    await watcher.cb(true)
    assert.deepEqual(calls.api.map(item => item.name), [],
      '登录态失效时不得再拉目录 / 文件，避免并发请求再触发一轮提示')
    assert.equal(page.isLoggedIn.value, false)
    assert.equal(env.calls.toasts.length, 1)
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)
  })
})

test('watch(ready)：匿名模式返回 true 时正常 bootstrap，且不触发任何登录引导', async () => {
  await withPage({ config: { account_enabled: false }, storage: {} }, async ({ env, calls, state }) => {
    const watcher = readyWatcher(calls)
    await watcher.cb(true)
    assert.ok(calls.api.some(item => item.name === 'listTree'), '应拉取目录树')
    assert.ok(calls.api.some(item => item.name === 'listFiles'), '应拉取文件列表')
    assert.equal(state.user.anonymous, true)
    assert.equal(env.calls.toasts.length, 0, '匿名模式不得弹失效提示')
    assert.equal(env.calls.navigateTo.length, 0, '匿名模式不得跳登录页')
    assert.equal(env.calls.removed.length, 0)
  })
})

test('watch(ready) 重复触发同一失效：loginGuardDone 保证只引导一次', async () => {
  await withPage({ config: { account_enabled: true }, storage: {} }, async ({ env, calls }) => {
    const watcher = readyWatcher(calls)
    await watcher.cb(true)
    await watcher.cb(true)
    await watcher.cb(true)
    assert.equal(env.calls.toasts.length, 1, '同一失效只提示一次')
    assert.equal(env.calls.removed.filter(key => key === 'uni_id_token').length, 1)
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1, '登录页只跳一次')
    assert.deepEqual(calls.api.map(item => item.name), [], '三次都不应 bootstrap')
  })
})

// ---------------------------------------------------------------------------
// 三、onShow / loadIdentity / logout 的边界
// ---------------------------------------------------------------------------

test('onShow：无 token 时直接返回，不再重复发请求或引导', async () => {
  await withPage({ config: { account_enabled: true }, storage: {} }, async ({ env, calls, page }) => {
    await calls.lifecycles.onShow()
    assert.equal(calls.api.length, 0)
    assert.equal(env.calls.importObject.filter(item => item.name === 'uni-id-co').length, 0)
    assert.equal(env.calls.toasts.length, 0)
    assert.equal(env.calls.navigateTo.length, 0)
  })
})

test('onShow：本地凭据已过期时不再重置守卫、不再发请求', async () => {
  await withPage({
    config: { account_enabled: true },
    storage: { uni_id_token: 'old', uni_id_token_expired: Date.now() - 1000 }
  }, async ({ env, calls, page }) => {
    await calls.lifecycles.onShow()
    assert.equal(calls.api.length, 0)
    assert.equal(env.calls.toasts.length, 0)
    assert.equal(env.calls.navigateTo.length, 0)
  })
})

test('onShow：拿到新的未过期 token 时复位守卫并同步身份，之后可再次引导', async () => {
  await withPage({
    config: { account_enabled: true },
    storage: {},
    userInfo: { userInfo: { _id: 'u2' } }
  }, async ({ env, calls, state, page, api }) => {
    // 先制造一次失效，让模块级 loginInvalidHandled 置位
    api.handleLoginExpired()
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)

    // 模拟登录页返回后写入「新的、本地未过期」token
    env.storage.uni_id_token = 'new-token'
    env.storage.uni_id_token_expired = Math.floor(Date.now() / 1000) + 3600
    await calls.lifecycles.onShow()
    await flushMicrotasks()
    assert.equal(state.user.uid, 'u2', '应重新同步身份')
    assert.ok(calls.api.some(item => item.name === 'listTree'), '应补拉数据')

    // resetLoginGuard 已复位：新一轮失效仍能被引导
    api.handleLoginExpired()
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 2, '复位后失效处理必须重新生效')
  })
})

test('loadIdentity：uni-id-co 返回 500「用户函数代码语法或逻辑异常」只吞掉，不判过期', async () => {
  const error = Object.assign(new Error('用户函数代码语法或逻辑异常'), {
    errCode: 500,
    errMsg: '用户函数代码语法或逻辑异常'
  })
  await withPage({
    config: { account_enabled: true },
    storage: { uni_id_token: 'valid-token', uni_id_token_expired: Date.now() + 60000 },
    getUserInfoThrows: error
  }, async ({ env, state, page }) => {
    await page.loadIdentity()
    assert.equal(env.calls.toasts.length, 0, '500 不得弹「已过期」')
    assert.equal(env.calls.navigateTo.length, 0, '500 不得跳登录页')
    assert.equal(env.calls.removed.length, 0, '500 不得清凭据')
    assert.equal(state.user.uid, '', '不无条件把界面恢复成已登录')
    assert.equal(page.isLoggedIn.value, false)
  })
})

test('loadIdentity：明确 uni-id 失效错误才走 handleLoginExpired 并置空 uid', async () => {
  const error = Object.assign(new Error('登录状态失效，token已过期'), {
    errCode: 'uni-id-token-expired',
    errMsg: '登录状态失效，token已过期'
  })
  await withPage({
    config: { account_enabled: true },
    storage: { uni_id_token: 'old-token', uni_id_token_expired: Date.now() - 1000 },
    getUserInfoThrows: error
  }, async ({ env, state, page }) => {
    await page.loadIdentity()
    assert.equal(state.user.uid, '')
    assert.equal(page.isLoggedIn.value, false)
    assert.equal(env.calls.toasts.length, 1)
    assert.equal(env.calls.toasts[0].title, LOGIN_TOAST)
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)
  })
})

test('logout()：清本地凭据、置空身份并复位守卫标记', async () => {
  await withPage({
    config: { account_enabled: true },
    storage: { uni_id_token: 'token-1', uni_id_token_expired: Date.now() + 60000 },
    user: { uid: 'u1' }
  }, async ({ env, state, page, api }) => {
    // 先置位幂等标记
    api.handleLoginExpired()
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)

    await page.logout()
    assert.equal(state.user.uid, '')
    assert.equal(page.isLoggedIn.value, false)
    assert.ok(env.calls.removed.includes('uni_id_token'))
    assert.ok(env.calls.removed.includes('uni_id_token_expired'))
    assert.ok(env.calls.toasts.some(item => item.title === '已退出登录'))
    env.flushTimers() // logout 内部 400ms 后 goLogin

    // 复位后新一轮失效仍能被引导（证明 resetLoginGuard 被调用）
    api.handleLoginExpired()
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 3,
      '1 次失效 + 1 次主动退出 goLogin + 1 次复位后失效引导')
  })
})

// ---------------------------------------------------------------------------
// 四、源码契约静态复核（导出对齐 / 依赖方向 / 重复实现 / 路由）
// ---------------------------------------------------------------------------

test('源码复核：api/index.js 的导出与全项目所有 import 点逐项对齐，无遗漏导出', () => {
  const source = readText('common/api/index.js')
  const exported = Array.from(
    source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)
  ).map(item => item[1])

  const consumers = [
    'common/api/mm-file.js',
    'common/api/mm-comment.js',
    'common/api/mm-search.js',
    'common/api/mm-settings.js',
    'common/api/mm-image.js',
    'pages/index/index.vue',
    'pages/settings/settings.vue',
    'App.vue'
  ]
  for (const file of consumers) {
    const text = readText(file)
    // 用 [^}]* 限定单条 import 的花括号内容，避免跨过前面若干条 import 语句
    const re = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*common\/api\/index\.js['"]/g
    for (const matched of text.matchAll(re)) {
      for (const part of matched[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim()
        if (!name) continue
        assert.ok(exported.includes(name), `${file} 引用了 index.js 未导出的 ${name}`)
      }
    }
  }
  // default 导出对象也必须与具名导出保持一致
  assert.match(source, /export default \{[\s\S]*?\n\}/, 'default 导出应保留全部公共 API')
})

test('源码复核：无循环依赖、无重复实现，callSilent / clearLoginCredentials 边界正确', () => {
  const source = readText('common/api/index.js')

  // index.js 只依赖 constants.js，业务封装只依赖 index.js：单向，无环
  const imports = Array.from(
    source.matchAll(/^[ \t]*import[\s\S]*?from\s*['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm)
  ).map(item => item[1])
  assert.deepEqual(imports, ['@/common/constants.js'], 'index.js 不应反向依赖任何业务封装')

  const apiDir = path.join(ROOT, 'common', 'api')
  const files = fs.readdirSync(apiDir)
    .filter(name => name.endsWith('.js'))
    .map(name => `common/api/${name}`)
    .concat(['pages/index/index.vue', 'pages/settings/settings.vue', 'App.vue'])

  for (const fn of [
    'isTokenInvalid', 'isLocalTokenExpired', 'clearLoginCredentials',
    'handleLoginExpired', 'resetLoginGuard'
  ]) {
    const definitions = files.filter(file =>
      new RegExp(`(?:function|const)\\s+${fn}\\b`).test(readText(file))
    )
    assert.deepEqual(definitions, ['common/api/index.js'], `${fn} 不得在别处重复实现`)
  }

  // callSilent 函数体不得触碰提示 / 跳转 / 失效处理（运行时测试已验证）
  const silentBody = /export async function callSilent[\s\S]*?\n\}/.exec(source)[0]
  assert.ok(!/handleLoginExpired|showErrorToast|showToast|navigateTo|redirectTo/.test(silentBody),
    'callSilent 必须全程静默')

  // clearLoginCredentials 只清两个 key，保留 uni-id-pages 展示缓存
  const clearBody = /export function clearLoginCredentials[\s\S]*?\n\}/.exec(source)[0]
  assert.equal((clearBody.match(/removeStorageSync\(/g) || []).length, 2)
  assert.match(clearBody, /removeStorageSync\('uni_id_token'\)/)
  assert.match(clearBody, /removeStorageSync\('uni_id_token_expired'\)/)
  assert.ok(!/uni-id-pages-userInfo/.test(clearBody), '不得删除展示缓存，避免与模块内存态产生矛盾')
})

test('源码复核：guardLogin 返回 boolean，且唯一调用点 watch(ready) 按返回值决定是否 bootstrap', () => {
  const page = readText('pages/index/index.vue')

  const body = /function guardLogin\(\)[\s\S]*?\n\}/.exec(page)[0]
  assert.match(body, /return true/, 'guardLogin 应有可继续浏览的 true 分支')
  assert.match(body, /return false/, 'guardLogin 应有失效的 false 分支')
  assert.match(body, /isLocalTokenExpired\(\)/, '守卫必须同时判断本地凭据是否过期')
  assert.match(body, /store\.setUser\(\{ uid: '', anonymous: false \}\)/,
    '失效必须置空 uid，顶栏「登录」入口才可见')

  // 定义 1 处 + 调用 1 处，无遗留的旧「无返回」调用点
  assert.equal(Array.from(page.matchAll(/\bguardLogin\(\)/g)).length, 2)
  assert.match(page, /const canBrowse = guardLogin\(\)\s*\n\s*if \(canBrowse\) bootstrap\(\)/,
    'watch(ready) 必须消费 boolean 返回值')

  const onShowBody = /onShow\(\(\) => \{[\s\S]*?\n\}\)/.exec(page)[0]
  assert.ok(!/guardLogin\(\)/.test(onShowBody), 'onShow 不应再调用 guardLogin')
  assert.match(onShowBody, /resetLoginGuard\(\)/, 'onShow 拿到新 token 时应复位守卫')
  assert.match(onShowBody, /if \(!token \|\| isLocalTokenExpired\(\)\) return/)
})

test('源码复核：LOGIN_PAGE 与 pages.json 中已注册的登录页一致（登录入口可达）', () => {
  const api = readText('common/api/index.js')
  const loginPage = /const LOGIN_PAGE = '([^']+)'/.exec(api)[1]
  const pages = JSON.parse(readText('pages.json'))
  const route = loginPage.replace(/^\//, '')
  assert.ok(pages.pages.some(item => item.path === route),
    `登录页 ${route} 未在 pages.json 注册，跳转会失败`)
  assert.equal(loginPage, LOGIN_PAGE)
})

test('源码复核：clearLoginCredentials 保留 userInfo 与 uni-id-pages 模块内存态一致', () => {
  const store = readText('uni_modules/uni-id-pages/common/store.js')
  // uni-id-pages 的模块级内存态在加载时从 uni-id-pages-userInfo 初始化；
  // 只有 mutations.setUserInfo({}, {cover:true}) 才会同时清内存态与 storage。
  assert.match(store, /let hostUserInfo = uni\.getStorageSync\('uni-id-pages-userInfo'\)/,
    '内存态来自展示缓存 storage')
  assert.match(store, /setStorageSync\('uni-id-pages-userInfo'/, 'setUserInfo 会写回同一 key')
  const api = readText('common/api/index.js')
  const clearBody = /export function clearLoginCredentials[\s\S]*?\n\}/.exec(api)[0]
  assert.ok(!/setUserInfo|uni-id-pages-userInfo/.test(clearBody),
    'clearLoginCredentials 不动展示缓存，storage 与模块内存态保持一致，不引入新矛盾态')
})

// ---------------------------------------------------------------------------
// 五、点 3 登录回跳：两条入口 + 真实 loginBack 的三种页面栈形态
// ---------------------------------------------------------------------------

/**
 * 从 uni-id-pages 源码抽取真实 loginBack 函数体，注入依赖后执行。
 * 只读源码、不改写；这样验证的是线上实际会跑的 delta 计算与回跳分支。
 */
function buildRealLoginBack(uniMock, pages) {
  const source = readText('uni_modules/uni-id-pages/common/store.js')
  const matched = /loginBack\s*\(e = \{\}\)\s*\{([\s\S]*?)\n[\t ]*\},\n[\t ]*loginSuccess/.exec(source)
  assert.ok(matched, '未从 store.js 提取到真实 loginBack 函数体')
  const factory = new Function('uni', 'getCurrentPages', 'pagesJson', 'window', 'console',
    `return function loginBack(e = {}) {\n${matched[1]}\n}`)
  return factory(
    uniMock,
    () => pages,
    { pages: [{ path: 'pages/index/index' }] },
    {},
    console
  )
}

test('登录回跳：goLogin 与 handleLoginExpired 两条入口 URL 精确一致且都带 redirect', async () => {
  await withPage({
    config: { account_enabled: true },
    storage: { uni_id_token: 't', uni_id_token_expired: Date.now() - 1000 }
  }, async ({ env, api, page }) => {
    // 入口一：顶栏主动登录
    page.goLogin()
    assert.equal(env.calls.navigateTo.length, 1)
    assert.equal(env.calls.navigateTo[0].url, LOGIN_URL)

    // 入口二：token 失效引导（延时跳转后）
    env.calls.navigateTo.length = 0
    api.handleLoginExpired()
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)
    assert.equal(env.calls.navigateTo[0].url, LOGIN_URL)
  })
})

const loginBackStacks = [
  {
    name: '标准 route（不带前导斜杠）',
    pages: [
      { route: 'pages/index/index' },
      { route: 'uni_modules/uni-id-pages/pages/login/login-withpwd' }
    ]
  },
  {
    name: 'route 带前导斜杠（旧逻辑 delta=0 会卡住）',
    pages: [
      { route: '/pages/index/index' },
      { route: '/uni_modules/uni-id-pages/pages/login/login-withpwd' }
    ]
  },
  {
    name: '页面栈仅剩登录页',
    pages: [{ route: 'uni_modules/uni-id-pages/pages/login/login-withpwd' }]
  }
]

for (const stack of loginBackStacks) {
  test(`登录回跳：${stack.name} 时真实 loginBack 走 redirectTo 首页，不再 navigateBack({delta:0})`, async () => {
    await withPage({ config: { account_enabled: true }, storage: {} }, async ({ env, page }) => {
      // 取真实入口产出的 URL，解码出回跳地址
      page.goLogin()
      const parsed = new URL(env.calls.navigateTo[0].url, 'https://mock.local')
      assert.equal(parsed.pathname, '/uni_modules/uni-id-pages/pages/login/login-withpwd')
      const redirect = parsed.searchParams.get('uniIdRedirectUrl')
      assert.equal(redirect, '/pages/index/index', 'redirect 解码后应为首页路径')

      const loginBack = buildRealLoginBack(globalThis.uni, stack.pages)
      loginBack({ uniIdRedirectUrl: redirect })

      assert.equal(env.calls.redirectTo.length, 1, '三种页面栈都应直接 redirectTo 首页')
      assert.equal(env.calls.redirectTo[0].url, '/pages/index/index')
      assert.equal(env.calls.navigateBack.length, 0, '不得再出现 navigateBack({delta:0}) 卡在登录页')
      assert.equal(env.calls.reLaunch.length, 0)
      assert.equal(env.calls.switchTab.length, 0)
    })
  })
}

test('登录回跳：失效引导在 navigateTo 失败时回退 redirectTo 到带 redirect 的登录页', async () => {
  await withPage({
    navigateFails: true,
    config: { account_enabled: true },
    storage: { uni_id_token: 't', uni_id_token_expired: Date.now() - 1000 }
  }, async ({ env, api, page }) => {
    // 主动登录入口源码只传 url、未带 fail 回退，这里只核对 URL
    page.goLogin()
    assert.equal(env.calls.navigateTo[0].url, LOGIN_URL)
    assert.equal(env.calls.redirectTo.length, 0)

    // 失效引导入口带 fail 回退，必须保证登录页可达
    env.calls.navigateTo.length = 0
    api.handleLoginExpired()
    env.flushTimers()
    assert.equal(env.calls.redirectTo.length, 1)
    assert.equal(env.calls.redirectTo[0].url, LOGIN_URL)
  })
})

test('登录成功同步：uni.$on/$off 注册与注销 handleLoginSuccessSync 且能复位守卫', async () => {
  await withPage({ config: { account_enabled: false } }, async ({ env, calls, page, api }) => {
    // $on 注册在 onLoad 里，harness 只记录生命周期，这里手动触发一次
    const savedWindow = globalThis.window
    globalThis.window = { innerWidth: 1024, addEventListener() {}, removeEventListener() {} }
    try {
      calls.lifecycles.onLoad()
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
    const registered = env.calls.eventOn.filter(item => item.event === 'uni-id-pages-login-success')
    assert.equal(registered.length, 1, '应通过 uni.$on 注册一次登录成功同步')
    assert.equal(typeof registered[0].cb, 'function')

    // 先置位幂等标记，再模拟登录成功事件复位它
    api.handleLoginExpired()
    env.flushTimers()
    const before = env.calls.navigateTo.length
    registered[0].cb()
    api.handleLoginExpired()
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, before + 1, '登录成功回调必须复位幂等标记')

    // onUnmounted 应注销同一回调，且 $off 调用有 typeof 保护
    assert.ok(calls.lifecycles.onUnmounted, '缺少 onUnmounted 注册')
    calls.lifecycles.onUnmounted()
    assert.equal(env.calls.eventOff.length, 1)
    assert.equal(env.calls.eventOff[0].event, 'uni-id-pages-login-success')
    assert.match(readText('pages/index/index.vue'),
      /typeof uni !== 'undefined' && uni && typeof uni\.\$off === 'function'/,
      '$off 必须有 typeof 保护，避免宿主无 $off 时报错')
    assert.equal(page.isLoggedIn.value, false)
  })
})

// ---------------------------------------------------------------------------
// 六、点 1A 移动端抽屉：点文件夹保持展开、打开文档仍收起、关闭入口存在
// ---------------------------------------------------------------------------

test('1A 抽屉：点文件夹后抽屉保持展开且加载文件，打开文档仍收起', async () => {
  await withPage({ config: { account_enabled: false } }, async ({ calls, page }) => {
    page.drawerVisible.value = true
    page.handleDrawerFolderSelect({ _id: 'f1', type: 'folder', name: '目录1' })
    assert.equal(page.drawerVisible.value, true, '点文件夹后不得收起抽屉')
    assert.equal(page.currentFolderId.value, 'f1')
    await flushMicrotasks()
    assert.ok(calls.api.some(item => item.name === 'listFiles'), '点文件夹应刷新文件列表')

    page.drawerVisible.value = true
    page.handleDrawerOpenFile({ _id: 'd1', type: 'file', name: 'a.md' })
    assert.equal(page.drawerVisible.value, false, '打开文档仍应收起抽屉')
    await flushMicrotasks()
  })
})

test('1A 抽屉：标题与关闭按钮确实存在，不会变成关不掉', () => {
  const source = readText('pages/index/index.vue')
  assert.match(source,
    /class="mm-drawer__head"[\s\S]{0,200}class="mm-drawer__title">目录<\/text>[\s\S]{0,200}class="mm-drawer__close" @click="drawerVisible = false"/,
    '抽屉顶部应有「目录」标题与可点击的关闭按钮')
})

// ---------------------------------------------------------------------------
// 七、点 1B「移动到」：层级浏览 + 独立确认（最高优先级）
// ---------------------------------------------------------------------------

/** 预置两层目录树：根 → A → A1，另有同级 B */
function seedMoveTree(state) {
  state.tree = [
    { _id: 'a', name: 'A', type: 'folder', parent_id: '' },
    { _id: 'a1', name: 'A1', type: 'folder', parent_id: 'a' },
    { _id: 'b', name: 'B', type: 'folder', parent_id: '' }
  ]
}

test('1B 移动到：点目录仅切换浏览层级，不调用 move、不关闭弹窗；面包屑/返回/回根可用', async () => {
  await withPage({ config: { account_enabled: false } }, async ({ calls, state, page }) => {
    seedMoveTree(state)
    page.handleMoveFile({ _id: 'f1', type: 'file', parent_id: 'a', name: 'doc.md' })
    assert.equal(page.moveVisible.value, true)
    assert.equal(page.moveCurrentId.value, '')

    const before = calls.api.filter(item => item.name === 'move').length
    page.browseMoveTarget({ _id: 'b' })
    assert.equal(page.moveCurrentId.value, 'b')
    assert.equal(page.moveVisible.value, true, '点目录不得关闭弹窗')
    assert.equal(calls.api.filter(item => item.name === 'move').length, before, '点目录不得执行移动')

    page.moveToLevel('a1')
    assert.deepEqual(page.moveBreadcrumb.value.map(item => item._id), ['a', 'a1'])
    page.moveUpOneLevel()
    assert.equal(page.moveCurrentId.value, 'a', '返回上一级应到父目录')
    page.moveToLevel('')
    assert.equal(page.moveCurrentId.value, '', '根目录入口应可随时回根')
    assert.equal(page.moveRootTarget.value._id, '')
    assert.equal(page.moveVisible.value, true)
  })
})

test('1B 移动到：非法层级确认按钮禁用且不发 move；合法层级确认恰好一次并刷新目录', async () => {
  await withPage({ config: { account_enabled: false } }, async ({ calls, state, page }) => {
    seedMoveTree(state)
    page.handleMoveFile({ _id: 'f1', type: 'file', parent_id: 'a', name: 'doc.md' })

    // 当前所在目录 A 是非法目标
    page.moveToLevel('a')
    assert.equal(page.moveHereDisabled.value, true, '已在此目录时确认按钮应禁用')
    await page.confirmMoveHere()
    assert.equal(calls.api.filter(item => item.name === 'move').length, 0, '禁用时不得发 move')

    // 合法目标 B
    const treeBefore = calls.api.filter(item => item.name === 'listTree').length
    const filesBefore = calls.api.filter(item => item.name === 'listFiles').length
    page.moveToLevel('b')
    assert.equal(page.moveHereDisabled.value, false)
    await page.confirmMoveHere()
    await flushMicrotasks()

    const moves = calls.api.filter(item => item.name === 'move')
    assert.equal(moves.length, 1, '确认后应恰好调用一次 move')
    assert.deepEqual(moves[0].args[0], { file_id: 'f1', parent_id: 'b' }, 'file_id/parent_id 必须正确')
    assert.equal(page.moveVisible.value, false, '成功后应关闭弹窗')
    assert.equal(page.moveSource.value, null)
    assert.ok(calls.api.filter(item => item.name === 'listTree').length > treeBefore, '应刷新目录树')
    assert.ok(calls.api.filter(item => item.name === 'listFiles').length > filesBefore, '应刷新文件列表')
  })
})

test('1B 移动到：全量候选置灰与 reason 保留，层级浏览沿用禁用判定且置灰项仍可进入；重开重置到根', async () => {
  await withPage({ config: { account_enabled: false } }, async ({ calls, state, page }) => {
    seedMoveTree(state)
    // 移动文件夹 A：自身 / 后代 / 已在此目录 三类置灰都要保留
    page.handleMoveFolder({ _id: 'a', type: 'folder', parent_id: '', name: 'A' })
    const targets = page.moveTargets.value
    assert.ok(targets.some(item => item._id === 'a' && item.disabled === true && item.reason === '不能移动到自身'))
    assert.ok(targets.some(item => item._id === 'a1' && item.disabled === true && item.reason === '不能移动到自己的子目录'))
    assert.ok(targets.some(item => item._id === '' && item.disabled === true && item.reason === '已在此目录'))

    // 层级展示层必须沿用同一套 disabled / reason，不能绕过 chooseMoveTarget 的早退
    page.moveToLevel('')
    const browse = page.moveBrowseTargets.value
    const aItem = browse.find(item => item._id === 'a')
    assert.equal(aItem.disabled, true)
    assert.equal(aItem.reason, '不能移动到自身')
    page.browseMoveTarget(aItem) // 置灰项仍可点击进入浏览
    assert.equal(page.moveCurrentId.value, 'a')
    assert.equal(page.moveHereDisabled.value, true, '进入非法层级后确认仍禁用')
    assert.equal(page.moveVisible.value, true)
    const movesBefore = calls.api.filter(item => item.name === 'move').length
    await page.confirmMoveHere()
    assert.equal(calls.api.filter(item => item.name === 'move').length, movesBefore,
      '层级展示不得绕过 disabled 早退')

    // watch(moveVisible) + handleMoveFile 双重重置到根
    const watcher = calls.watchers.find(item => item.getter === page.moveVisible)
    assert.ok(watcher, '缺少 watch(moveVisible)')
    page.moveCurrentId.value = 'a1'
    page.moveVisible.value = false
    watcher.cb()
    assert.equal(page.moveCurrentId.value, '', '关闭弹窗应重置层级到根')
    page.handleMoveFile({ _id: 'f2', type: 'file', parent_id: 'b' })
    assert.equal(page.moveCurrentId.value, '', '重新打开也应重置层级到根')
  })
})

// ---------------------------------------------------------------------------
// 八、点 2 编辑器预览开关
// ---------------------------------------------------------------------------

test('点 2 预览开关：默认 true、可反复切换，:preview 确已绑到 MdEditor', async () => {
  const pageSource = readText('pages/index/index.vue')
  const editorSource = readText('components/mm-md-editor/mm-md-editor.vue')
  const sdkProps = readText('node_modules/md-editor-v3/lib/types/MdEditor/props.d.ts')

  assert.match(editorSource, /showPreview: \{ type: Boolean, default: true \}/)
  assert.match(editorSource, /:preview="showPreview"/, 'MdEditor 必须绑定 :preview')
  assert.match(pageSource, /const editorPreview = ref\(true\)/)
  assert.match(pageSource, /:show-preview="editorPreview"/)
  assert.match(pageSource, /editor\.togglePreview\(editorPreview\.value\)/,
    '4.x 的 preview 只在初始化生效，运行时切换须调用实例 togglePreview')
  assert.match(sdkProps, /preview:\s*\{[\s\S]{0,140}default: boolean/,
    'SDK 应声明 preview 为默认 true 的 boolean prop')

  await withPage({ config: { account_enabled: false } }, async ({ page }) => {
    assert.equal(page.editorPreview.value, true)
    page.toggleEditorPreview()
    assert.equal(page.editorPreview.value, false)
    page.toggleEditorPreview()
    assert.equal(page.editorPreview.value, true, '开关应可反复切换')
  })
})
