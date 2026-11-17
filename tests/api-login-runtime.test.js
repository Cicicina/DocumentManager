/**
 * common/api/index.js 登录态修复的「运行时行为」回归测试。
 *
 * 与既有源码静态断言互补：这里用内存 Mock 注入 uni / uniCloud / getCurrentPages /
 * setTimeout，把源码改写为隔离的 data: URL 模块后真正执行，验证：
 * - uni_id_token_expired 秒 / 毫秒单位归一化与空值边界；
 * - 云端 500 与 token 失效的严格分类（不再误弹「已过期」）；
 * - 1002 / uni-id 失效错误码的识别；
 * - 并发异常只弹一次 Toast、真过期只跳一次登录页（幂等标记 + 文案节流）；
 * - callSilent 首屏 getConfig 路径保持静默，匿名模式不受影响。
 *
 * 每个用例都拿到全新模块实例，模块级 loginInvalidHandled / lastToastAt /
 * objectCache 不会在用例间串扰。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { readText } = require('./helpers/load-esm.js')
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
const SERVICE_TOAST = '服务异常，请重试'

/**
 * 构造一套独立运行时：真实常量 + Mock 全局 + 全新 api 模块实例。
 * @param {object} options installGlobals 的选项
 * @param {(ctx:{env:object, api:object, constants:object})=>Promise<void>} fn 用例主体
 */
async function withEnv(options, fn) {
  const constants = await loadConstants()
  const env = installGlobals(options)
  try {
    const { module: api } = await loadApiModule(constants)
    await fn({ env, api, constants })
  } finally {
    env.restore()
  }
}

/** 构造一个 uni-id token 失效错误（模拟 SDK 抛出的 Error 结构） */
function tokenInvalidError(code = 'uni-id-token-expired') {
  return Object.assign(new Error('登录状态失效，token已过期'), {
    errCode: code,
    errMsg: '登录状态失效，token已过期'
  })
}

/** 构造一个云端 500 / 语法异常错误 */
function cloudError() {
  return Object.assign(new Error('用户函数代码语法或逻辑异常'), {
    errCode: 500,
    errMsg: '用户函数代码语法或逻辑异常'
  })
}

// ---------------------------------------------------------------------------
// 一、isLocalTokenExpired：秒 / 毫秒归一化与空值边界
// ---------------------------------------------------------------------------

test('秒级未来过期时间不误判为过期（<1e11 需 ×1000 归一化）', async () => {
  await withEnv({
    storage: {
      uni_id_token: 'token-1',
      uni_id_token_expired: Math.floor(Date.now() / 1000) + 3600
    }
  }, ({ api }) => {
    assert.equal(api.isLocalTokenExpired(), false)
  })
})

test('毫秒级未来过期时间不误判为过期', async () => {
  await withEnv({
    storage: { uni_id_token: 'token-1', uni_id_token_expired: Date.now() + 60000 }
  }, ({ api }) => {
    assert.equal(api.isLocalTokenExpired(), false)
  })
})

test('毫秒级过去过期时间判定为过期', async () => {
  await withEnv({
    storage: { uni_id_token: 'token-1', uni_id_token_expired: Date.now() - 1000 }
  }, ({ api }) => {
    assert.equal(api.isLocalTokenExpired(), true)
  })
})

test('秒级过去过期时间经归一化后判定为过期', async () => {
  await withEnv({
    storage: {
      uni_id_token: 'token-1',
      uni_id_token_expired: Math.floor(Date.now() / 1000) - 10
    }
  }, ({ api }) => {
    assert.equal(api.isLocalTokenExpired(), true)
  })
})

test('空串 / 0 / false / null / undefined / 非法值都不擅自判过期', async () => {
  await withEnv({}, ({ env, api }) => {
    const values = ['', 0, false, null, undefined, 'abc', -1, NaN, '', ' ']
    for (const raw of values) {
      env.storage.uni_id_token_expired = raw
      assert.equal(api.isLocalTokenExpired(), false,
        `uni_id_token_expired = ${String(raw)} 不应被判过期`)
    }
  })
})

test('uni 存储不可用（无 getStorageSync）时安全返回 false', async () => {
  const constants = await loadConstants()
  const env = installGlobals({})
  try {
    globalThis.uni = {}
    const { module: api } = await loadApiModule(constants)
    assert.equal(api.isLocalTokenExpired(), false)
  } finally {
    env.restore()
  }
})

// ---------------------------------------------------------------------------
// 二、isTokenInvalid：云端异常与真失效的严格分类
// ---------------------------------------------------------------------------

test('云端 500「用户函数代码语法或逻辑异常」不被识别为 token 失效', async () => {
  await withEnv({}, ({ api }) => {
    const variants = [
      { errCode: 500, errMsg: '用户函数代码语法或逻辑异常' },
      { code: 500, message: '用户函数代码语法或逻辑异常' },
      Object.assign(new Error('用户函数代码语法或逻辑异常'), { errCode: 500 }),
      { detail: { errCode: 500, errMsg: '用户函数代码语法或逻辑异常' } },
      { errCode: 'SYSTEM_ERROR', errMsg: '云函数执行失败：用户函数代码语法或逻辑异常' },
      { message: '网络请求失败' },
      {}
    ]
    for (const variant of variants) {
      assert.equal(api.isTokenInvalid(variant), false,
        `误判为 token 失效：${JSON.stringify(variant)}`)
    }
  })
})

test('1002 与 uni-id 失效错误码被识别（含 SDK Error 的 code / detail.errCode）', async () => {
  await withEnv({}, ({ api }) => {
    // 说明：isTokenInvalid 的入参契约是「错误对象或归一化结果」，
    // 裸错误码（1002 / '1002' / 'uni-id-...'）不是合法输入，应返回 false（见下一个用例）。
    // SDK 实际交付形态是错误码落在 errCode / code / detail.errCode 上，故逐种形态覆盖。
    const invalidCodes = [
      'uni-id-token-expired',
      'uni-id-token-not-exist',
      'uni-id-check-token-failed',
      'uni-id-check-device-feature-failed',
      'TOKEN_INVALID_TOKEN_EXPIRED',
      'TOKEN_INVALID',
      'TOKEN_INVALID_WRONG_TOKEN',
      'TOKEN_INVALID_ANONYMOUS_USER',
      'TOKEN_INVALID_INVALID_CLIENTID'
    ]
    const invalid = [
      { errCode: 1002, errMsg: '请先登录' },
      { code: 1002, message: '请先登录' },
      { errCode: '1002', errMsg: '请先登录' },
      ...invalidCodes.map(errCode => ({ errCode })),
      ...invalidCodes.map(code => ({ code })),
      ...invalidCodes.map(errCode => ({ detail: { errCode } })),
      Object.assign(new Error('x'), { errCode: 'uni-id-token-expired' }),
      Object.assign(new Error('x'), { detail: { errCode: 'TOKEN_INVALID' } })
    ]
    for (const item of invalid) {
      assert.equal(api.isTokenInvalid(item), true,
        `未识别为 token 失效：${JSON.stringify(item)}`)
    }
  })
})

test('errMsg 兜底：只把过期信息放在文案里时仍能识别', async () => {
  await withEnv({}, ({ api }) => {
    assert.equal(api.isTokenInvalid({ errMsg: '登录状态失效，token已过期' }), true)
    assert.equal(api.isTokenInvalid({ message: 'TOKEN_INVALID_TOKEN_EXPIRED' }), true)
    assert.equal(api.isTokenInvalid({ message: 'token expired, please relogin' }), true)
  })
})

test('普通业务错误码（1001/1003/2001/9999）与非对象输入不被误判', async () => {
  await withEnv({}, ({ api }) => {
    const normal = [
      1001, 1003, 2001, 9999, 500, 0, null, undefined,
      'abc', '请先登录', 42,
      1002, '1002' // 裸错误码不在对象入参契约内，不应被当成失效错误
    ]
    for (const item of normal) {
      assert.equal(api.isTokenInvalid(item), false,
        `误判为 token 失效：${String(item)}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 三、call()：异常分类、单一提示出口、一次性跳转
// ---------------------------------------------------------------------------

test('云端 500 异常统一提示「服务异常，请重试」，不清态、不跳转、不透传 errMsg', async () => {
  await withEnv({
    storage: {
      uni_id_token: 'token-1',
      uni_id_token_expired: Date.now() + 60000,
      'uni-id-pages-userInfo': { nickname: '甲' }
    },
    objects: {
      'mm-file': { listTree: async () => { throw cloudError() } }
    }
  }, async ({ env, api }) => {
    const res = await api.call('mmFile', 'listTree')
    assert.equal(res.code, 9999)
    assert.equal(res.message, SERVICE_TOAST)
    assert.equal(env.calls.toasts.length, 1, '只弹一次提示')
    assert.equal(env.calls.toasts[0].title, SERVICE_TOAST)
    assert.ok(!env.calls.toasts.some(item => /过期|失效/.test(item.title)),
      '不得把云端 errMsg（含「token已过期」）原样透传出去')
    assert.equal(env.calls.navigateTo.length, 0, '500 不得跳登录页')
    assert.equal(env.calls.redirectTo.length, 0)
    assert.equal(env.calls.timers.length, 0)
    assert.equal(env.calls.removed.length, 0, '500 不得清本地凭据')
    assert.equal(env.storage.uni_id_token, 'token-1')
  })
})

test('result.code === 1002 触发一次性失效处理：清态 + 一次提示 + 600ms 后跳一次登录页', async () => {
  await withEnv({
    storage: {
      uni_id_token: 'token-1',
      uni_id_token_expired: Date.now() - 1000,
      'uni-id-pages-userInfo': { nickname: '甲' }
    },
    objects: {
      'mm-file': { listTree: async () => ({ errCode: 1002, errMsg: '请先登录' }) }
    }
  }, async ({ env, api }) => {
    const res = await api.call('mmFile', 'listTree')
    assert.equal(res.code, 1002)

    // 只清 token / expired，保留展示缓存（与 uni-id-pages 模块内存态一致）
    assert.deepEqual(env.calls.removed, ['uni_id_token', 'uni_id_token_expired'])
    assert.equal(env.storage.uni_id_token, undefined)
    assert.equal(env.storage.uni_id_token_expired, undefined)
    assert.deepEqual(env.storage['uni-id-pages-userInfo'], { nickname: '甲' })

    assert.equal(env.calls.toasts.length, 1)
    assert.equal(env.calls.toasts[0].title, LOGIN_TOAST)
    assert.equal(env.calls.timers.length, 1)
    assert.equal(env.calls.timers[0].ms, 600, '延迟 600ms 让提示可见')
    assert.equal(env.calls.navigateTo.length, 0, 'flush 前不应已跳转')

    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)
    assert.equal(env.calls.navigateTo[0].url, LOGIN_URL)
    assert.equal(env.calls.redirectTo.length, 0)
  })
})

test('catch 中的 uni-id token 失效错误同样进入失效处理并返回 1002', async () => {
  await withEnv({
    storage: { uni_id_token: 'token-1', uni_id_token_expired: Date.now() - 1000 },
    objects: {
      'mm-comment': { listByFile: async () => { throw tokenInvalidError() } }
    }
  }, async ({ env, api }) => {
    const res = await api.call('mmComment', 'listByFile', { file_id: 'f1' })
    assert.equal(res.code, 1002)
    assert.equal(env.calls.toasts.length, 1)
    assert.equal(env.calls.toasts[0].title, LOGIN_TOAST)
    assert.deepEqual(env.calls.removed, ['uni_id_token', 'uni_id_token_expired'])
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)
  })
})

test('并发多次 token 失效异常：只弹一次 Toast、只跳一次登录页、只清一次态', async () => {
  let invoked = 0
  await withEnv({
    storage: { uni_id_token: 'token-1', uni_id_token_expired: Date.now() - 1000 },
    objects: {
      'mm-file': {
        listTree: async () => {
          invoked += 1
          throw tokenInvalidError()
        }
      }
    }
  }, async ({ env, api }) => {
    const results = await Promise.all([
      api.call('mmFile', 'listTree'),
      api.call('mmFile', 'listTree'),
      api.call('mmFile', 'listTree'),
      api.call('mmFile', 'listTree')
    ])
    assert.equal(invoked, 4, '4 个并发请求都真实发出')
    assert.ok(results.every(item => item.code === 1002))
    assert.equal(env.calls.toasts.length, 1, '幂等标记 + 文案节流：只弹一次')
    assert.equal(env.calls.removed.filter(key => key === 'uni_id_token').length, 1,
      '清态只发生一次')
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1, '登录页只跳一次')
  })
})

test('并发多次 500 异常：按文案节流只弹一次「服务异常，请重试」', async () => {
  await withEnv({
    objects: {
      'mm-search': { search: async () => { throw cloudError() } }
    }
  }, async ({ env, api }) => {
    const results = await Promise.all([
      api.call('mmSearch', 'search', { keyword: 'a' }),
      api.call('mmSearch', 'search', { keyword: 'b' }),
      api.call('mmSearch', 'search', { keyword: 'c' })
    ])
    assert.ok(results.every(item => item.code === 9999))
    assert.equal(env.calls.toasts.length, 1)
    assert.equal(env.calls.toasts[0].title, SERVICE_TOAST)
    assert.equal(env.calls.navigateTo.length, 0)
  })
})

test('navigateTo 失败时回退 redirectTo，保证登录入口可达', async () => {
  await withEnv({
    navigateFails: true,
    storage: { uni_id_token: 'token-1', uni_id_token_expired: Date.now() - 1000 },
    objects: {
      'mm-file': { listTree: async () => ({ errCode: 1002, errMsg: '请先登录' }) }
    }
  }, async ({ env, api }) => {
    await api.call('mmFile', 'listTree')
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)
    assert.equal(env.calls.redirectTo.length, 1, 'navigateTo 失败必须回退 redirectTo')
    assert.equal(env.calls.redirectTo[0].url, LOGIN_URL)
  })
})

test('已在登录页时不重复跳转，但仍给出一次失效提示', async () => {
  await withEnv({
    getCurrentPages: () => [{ route: 'uni_modules/uni-id-pages/pages/login/login-withpwd' }],
    storage: { uni_id_token: 'token-1' },
    objects: {
      'mm-file': { listTree: async () => ({ errCode: 1002, errMsg: '请先登录' }) }
    }
  }, async ({ env, api }) => {
    await api.call('mmFile', 'listTree')
    assert.equal(env.calls.toasts.length, 1)
    assert.equal(env.calls.timers.length, 0, '已在登录页不应再注册跳转')
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 0)
    assert.equal(env.calls.redirectTo.length, 0)
  })
})

test('resetLoginGuard() 复位后可再次引导重新登录，且同一文案仍被节流', async () => {
  await withEnv({
    storage: { uni_id_token: 'token-1', uni_id_token_expired: Date.now() - 1000 },
    objects: {
      'mm-file': { listTree: async () => ({ errCode: 1002, errMsg: '请先登录' }) }
    }
  }, async ({ env, api }) => {
    await api.call('mmFile', 'listTree')
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 1)

    api.resetLoginGuard()
    await api.call('mmFile', 'listTree')
    env.flushTimers()
    assert.equal(env.calls.navigateTo.length, 2, '复位后新的一轮失效仍应引导登录')
    assert.equal(env.calls.toasts.length, 1, '同一文案 2s 内节流，不重复刷屏')
  })
})

test('getObject 使用 customUI:true 关闭 SDK 自带提示，且每个云对象只实例化一次', async () => {
  await withEnv({
    objects: {
      'mm-file': () => ({ listTree: async () => ({ errCode: 0, data: [] }) })
    }
  }, async ({ env, api }) => {
    await api.call('mmFile', 'listTree')
    await api.call('mmFile', 'listTree')
    assert.equal(env.calls.importObject.length, 1, '云对象实例应被缓存')
    assert.equal(env.calls.importObject[0].name, 'mm-file')
    assert.deepEqual(env.calls.importObject[0].options, { customUI: true },
      'customUI:true 才能关掉 SDK 自带 modal/toast，消除双份提示')
    assert.equal(env.calls.toasts.length, 0, '成功路径不得弹错误提示')
    assert.equal(env.calls.navigateTo.length, 0)
  })
})

// ---------------------------------------------------------------------------
// 四、callSilent：首屏 getConfig / 匿名模式不受影响
// ---------------------------------------------------------------------------

test('callSilent 正常返回：不弹 Toast、不跳转、不注册延时任务', async () => {
  await withEnv({
    objects: {
      'mm-settings': {
        getConfig: async () => ({ errCode: 0, data: { account_enabled: false } })
      }
    }
  }, async ({ env, api }) => {
    const res = await api.callSilent('mmSettings', 'getConfig')
    assert.equal(res.code, 0)
    assert.deepEqual(res.data, { account_enabled: false })
    assert.equal(env.calls.toasts.length, 0)
    assert.equal(env.calls.navigateTo.length, 0)
    assert.equal(env.calls.timers.length, 0)
    assert.equal(env.calls.removed.length, 0)
  })
})

test('callSilent 遇到 token 失效异常也保持静默，不触发 handleLoginExpired', async () => {
  await withEnv({
    storage: { uni_id_token: 'token-1', uni_id_token_expired: Date.now() - 1000 },
    objects: {
      'mm-settings': { getConfig: async () => { throw tokenInvalidError() } }
    }
  }, async ({ env, api }) => {
    const res = await api.callSilent('mmSettings', 'getConfig')
    assert.equal(res.code, 9999)
    assert.equal(env.calls.toasts.length, 0, '静默路径不得弹任何提示')
    assert.equal(env.calls.navigateTo.length, 0)
    assert.equal(env.calls.redirectTo.length, 0)
    assert.equal(env.calls.timers.length, 0, '不得注册跳登录页的延时任务')
    assert.equal(env.calls.removed.length, 0, '不得清本地凭据')
    assert.equal(env.storage.uni_id_token, 'token-1')
  })
})

test('首屏 mm-settings.getConfig 真实封装路径：匿名模式（账号关闭）静默返回配置', async () => {
  await withEnv({
    objects: {
      'mm-settings': {
        getConfig: async () => ({
          errCode: 0,
          data: { account_enabled: false, permission_enabled: false, anonymous: true }
        })
      }
    }
  }, async ({ env, api }) => {
    // 动态加载前端薄封装，注入真实的 call / callSilent，验证 getConfig 确实走静默通道
    const { module: settingsApi } = await loadInjectedModule(
      readText('common/api/mm-settings.js'),
      { deps: { call: api.call, callSilent: api.callSilent } }
    )
    const res = await settingsApi.getConfig()
    assert.equal(res.code, 0)
    assert.equal(res.data.account_enabled, false)
    assert.equal(res.data.anonymous, true)
    assert.deepEqual(env.calls.importObject[0].options, { customUI: true })
    assert.equal(env.calls.toasts.length, 0, '首屏不得弹出任何错误提示')
    assert.equal(env.calls.navigateTo.length, 0, '匿名模式不得跳登录页')
    assert.equal(env.calls.timers.length, 0)
  })
})

test('首屏 getConfig 失败（云端 500）也保持静默，不阻塞加载动画淡出', async () => {
  await withEnv({
    objects: {
      'mm-settings': { getConfig: async () => { throw cloudError() } }
    }
  }, async ({ env, api }) => {
    const { module: settingsApi } = await loadInjectedModule(
      readText('common/api/mm-settings.js'),
      { deps: { call: api.call, callSilent: api.callSilent } }
    )
    const res = await settingsApi.getConfig()
    assert.equal(res.code, 9999)
    assert.equal(env.calls.toasts.length, 0)
    assert.equal(env.calls.navigateTo.length, 0)
    assert.equal(env.calls.timers.length, 0)
  })
})
