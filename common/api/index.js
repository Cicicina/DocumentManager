/**
 * 前端统一 API 封装层。
 *
 * 约定（架构 8.6）：
 * 1. 五个业务云对象各实例化一次并缓存，组件内不得反复 importObject；
 * 2. 云侧统一返回 {errCode, errMsg, data}，前端统一使用 {code, data, message}；
 * 3. code === 2001（版本冲突）属正常业务返回：不弹 Toast、不抛异常，
 *    原样交给 mm-conflict-modal 处理，「覆写 / 放弃」两路径都不清空编辑器；
 * 4. 1002（未登录）与 uni-id 的 token 失效错误统一走「登录态失效」处理：
 *    清本地凭据、只提示一次、确保跳到已注册的登录页；
 *    云端 500 / 语法异常 / 网络失败等「校验请求失败」必须与之严格区分，
 *    只归为「服务异常」，绝不再弹「token已过期」；
 * 5. 前端只读云对象，禁止任何客户端直连数据库（clientDB / JQL）及其组件；
 *    云存储上传与临时 URL 由页面直接用 uniCloud.uploadFile / getTempFileURL 完成，
 *    彻底删除必须由云对象服务端 uniCloud.deleteFile 执行。
 *
 * 登录态 Bug 修复要点：
 * - uniCloud.importObject 默认 customUI:false，云对象 errCode 非 0 时会先弹一次
 *   modal/toast 再 throw，业务层 catch 又弹一次；且 SDK 抛出的 uni-id 错误里
 *   errMsg 就是「登录状态失效，token已过期」，旧逻辑在 catch 里原样 toast，
 *   导致首屏并发的多个请求反复弹同一条过期提示。这里统一改为 customUI:true，
 *   由 call() 单一出口分类处理。
 * - 旧 redirectToLogin 只在成功返回的 1002 分支触发，异常路径完全绕过它，
 *   因此「只弹提示、不清态、不跳登录页」。现改为异常路径同样进入失效处理。
 */
import { ERR, ERR_MESSAGE } from '@/common/constants.js'

/** 云对象键 → 云对象名 */
const OBJECT_NAMES = {
  mmFile: 'mm-file',
  mmComment: 'mm-comment',
  mmSearch: 'mm-search',
  mmSettings: 'mm-settings',
  mmImage: 'mm-image',
  mmShare: 'mm-share'
}

/** 云对象实例缓存，保证每个云对象只实例化一次 */
const objectCache = Object.create(null)

/**
 * uni-id 体系里代表「登录态真的失效」的错误码。
 * 这些错误码由云对象 / 云函数或 uniCloud 客户端 SDK 抛出，必须与
 * 「云端服务异常、网络失败、云函数 500」严格区分。
 */
const TOKEN_INVALID_CODES = [
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

/**
 * 可透传具体 errMsg 的业务错误码白名单。
 * SDK 在 errCode!=0 时会 throw 带 code/errMsg 的 Error（customUI:true 只关 UI 不关 throw），
 * 这些明确的业务码必须显示云端文案；500/9999 仍走统一兜底，避免把云端异常原文暴露给用户。
 */
const PASS_THROUGH_CODES = [
  1001, 1003, 1004,
  3001, 3002, 3003,
  4001, 4002, 4003, 4004, 4005, 4006,
  4007, 4008, 4009, 4010, 4011,
  5001, 5002
]

/** 同一条错误提示的节流窗口（毫秒）：并发请求不重复刷同一条 Toast */
const TOAST_THROTTLE_MS = 2000

/** 登录页路径，已在 pages.json 注册（uni_modules/uni-id-pages/pages/login/login-withpwd） */
const LOGIN_PAGE = '/uni_modules/uni-id-pages/pages/login/login-withpwd'

/**
 * 登录页跳转地址：携带回跳地址，由 uni-id-pages 的 login-page.mixin 透传给
 * mutations.loginSuccess → loginBack()，后者在 delta 分支之前直接 redirectTo 首页，
 * 不再依赖 getCurrentPages() 统计 route.split('/')[3] 的 delta（H5 下可能为 0）。
 * LOGIN_PAGE 仍保留为裸路径常量（pages.json 路由校验依赖它），跳转一律用 LOGIN_URL；
 * 「已在登录页」判断读的是页面栈 route，不受常量形态影响。
 */
const LOGIN_URL = `${LOGIN_PAGE}?uniIdRedirectUrl=${encodeURIComponent('/pages/index/index')}`

/** 各文案最近一次弹出时间，实现按文案去重 */
const lastToastAt = Object.create(null)

/**
 * 取得（并缓存）指定云对象实例。
 * customUI:true 关闭 SDK 自带的 loading / modal / toast，避免同一失效被弹两次；
 * SDK 仍会在 errCode 非 0 时抛出带 errCode / errMsg 的错误，交由 call() 分类。
 * @param {string} objKey OBJECT_NAMES 中的键
 * @returns {object} 云对象实例
 */
export function getObject(objKey) {
  if (!Object.prototype.hasOwnProperty.call(OBJECT_NAMES, objKey)) {
    throw new Error('未知云对象：' + objKey)
  }
  if (!objectCache[objKey]) {
    objectCache[objKey] = uniCloud.importObject(OBJECT_NAMES[objKey], { customUI: true })
  }
  return objectCache[objKey]
}

/**
 * 把云对象返回结构归一化为前端统一结构。
 * @param {object} res 云对象返回值 {errCode, errMsg, data}
 * @returns {{code: number, data: any, message: string}}
 */
export function normalize(res) {
  if (!res || typeof res !== 'object') {
    return { code: ERR.INTERNAL_ERROR, data: null, message: ERR_MESSAGE[ERR.INTERNAL_ERROR] }
  }
  const rawCode = typeof res.errCode === 'undefined' ? ERR.OK : Number(res.errCode)
  const code = Number.isFinite(rawCode) ? rawCode : ERR.INTERNAL_ERROR
  const data = Object.prototype.hasOwnProperty.call(res, 'data') ? res.data : null
  const message = res.errMsg || ERR_MESSAGE[code] || ''
  return { code, data, message }
}

/**
 * 统一的中文错误反馈（仅在 uni 运行时可用时调用），并按文案节流去重。
 * 同一失效在 watch / 生命周期 / 并发请求里被多次投递时，只弹一次。
 * @param {string} message 提示文案
 * @returns {void}
 */
function showErrorToast(message) {
  if (typeof uni === 'undefined' || !uni || typeof uni.showToast !== 'function') return
  const text = message || ERR_MESSAGE[ERR.INTERNAL_ERROR]
  const now = Date.now()
  if (now - (lastToastAt[text] || 0) < TOAST_THROTTLE_MS) return
  lastToastAt[text] = now
  uni.showToast({ title: text, icon: 'none' })
}

/**
 * 判断一个错误 / 返回值是否代表「登录态真的失效」。
 * 兼容 uniCloud SDK 抛出的 Error（errCode 落在 code 上，完整结果在 detail 里）
 * 与云对象归一化结果（code / message）。
 * @param {object} source 错误对象或归一化结果
 * @returns {boolean}
 */
export function isTokenInvalid(source) {
  if (!source || typeof source !== 'object') return false
  const detail = source.detail && typeof source.detail === 'object' ? source.detail : null
  const code = source.errCode !== undefined ? source.errCode
    : source.code !== undefined ? source.code
      : detail ? detail.errCode : undefined
  const message = String(source.errMsg || source.message || (detail && detail.errMsg) || '')
  if (Number(code) === ERR.UNAUTHORIZED) return true
  if (typeof code === 'string' && TOKEN_INVALID_CODES.indexOf(code) >= 0) return true
  // 兜底：部分云端只把过期信息放在 errMsg 里，未给标准错误码
  return /token已过期|token expired|TOKEN_INVALID_TOKEN_EXPIRED/i.test(message)
}

/**
 * 判断本地 token 是否真的过期。
 *
 * uniCloud 客户端 SDK 直接把 uni_id_token_expired 与 Date.now()（毫秒）比较；
 * uni-id 标准写入的是毫秒（JWT exp * 1000），但历史遗留 / 手工写入的值可能是
 * 秒级，甚至空串、0、false，这些都会被 SDK 误判为「已过期」。
 * 这里做单位归一化后再判断，供前端守卫使用，不依赖 SDK 的正确性。
 *
 * @returns {boolean} 本地凭据确实过期返回 true；无凭据或未设置过期时间返回 false
 */
export function isLocalTokenExpired() {
  if (typeof uni === 'undefined' || !uni || typeof uni.getStorageSync !== 'function') return false
  let raw = ''
  try {
    raw = uni.getStorageSync('uni_id_token_expired')
  } catch (error) {
    return false
  }
  // 空串 / 0 / false 表示「未设置或已退出」，不擅自判过期，交给云端校验
  if (raw === '' || raw === null || raw === undefined || raw === false) return false
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return false
  // 小于 1e11 视为秒级时间戳，换算成毫秒后再与 Date.now() 比较
  const expiredAt = value < 1e11 ? value * 1000 : value
  return expiredAt <= Date.now()
}

/**
 * 清除本地登录凭据。
 * 只清 token / expired，不删除 uni-id-pages-userInfo 展示缓存：
 * 该缓存由 uni-id-pages 的模块级内存态持有，单清 storage 反而会造成
 * 「本地为空、内存仍有昵称」的新矛盾态；重新登录成功后会被覆盖。
 * @returns {void}
 */
export function clearLoginCredentials() {
  if (typeof uni === 'undefined' || !uni || typeof uni.removeStorageSync !== 'function') return
  try {
    uni.removeStorageSync('uni_id_token')
    uni.removeStorageSync('uni_id_token_expired')
  } catch (error) {
    // 存储不可用时忽略，仍继续提示并跳转登录页
  }
}

/** 一次登录失效只处理一次，直到 resetLoginGuard()（重新登录 / 主动退出）后复位 */
let loginInvalidHandled = false

/**
 * 复位登录失效的一次性标记。登录页返回拿到新 token、或用户主动退出登录时调用。
 * @returns {void}
 */
export function resetLoginGuard() {
  loginInvalidHandled = false
}

/**
 * 登录态真的失效：清本地态 → 只提示一次 → 确保跳到已注册的登录页。
 *
 * 「云端校验请求失败 / 异常」不进入此函数，因此不会再弹「已过期」。
 * 幂等标记保证 watch、onShow、并发的多个云对象请求只处理同一失效一次。
 * @returns {void}
 */
export function handleLoginExpired() {
  if (typeof uni === 'undefined' || !uni) return
  if (loginInvalidHandled) return
  loginInvalidHandled = true

  // 真过期才清本地态：清掉 token 后 SDK 不再抛出 uni-id-token-expired，
  // 反复提示的源头随之消失；展示态昵称缓存保持一致，不引入新矛盾态。
  clearLoginCredentials()

  let alreadyOnLoginPage = false
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    const route = pages.length ? pages[pages.length - 1].route || '' : ''
    alreadyOnLoginPage = route.indexOf('uni-id-pages/pages/login') >= 0
  } catch (error) {
    // 取不到页面栈时按未在登录页处理
  }

  showErrorToast('登录状态已失效，请重新登录')
  if (alreadyOnLoginPage) return
  // 延迟一点再跳转，让提示可见；navigateTo 失败时回退 redirectTo 保证入口可达。
  // 两个出口都用 LOGIN_URL：主动登录与失效引导两条入口都带同一回跳地址。
  setTimeout(() => {
    uni.navigateTo({
      url: LOGIN_URL,
      fail: () => uni.redirectTo({ url: LOGIN_URL })
    })
  }, 600)
}

/**
 * 从 SDK 抛出的错误里解析业务码。
 *
 * uniCloud 客户端 SDK 在不同版本 / 不同场景下把业务码放在三个位置：
 * error.errCode（云对象返回值被包装）、error.code（标准 Error）、
 * error.detail.errCode（importObject 抛出的 detail 包装）。
 * 只读前两个会让 1001/1003 这类业务码漏判，最终统一显示「服务异常，请重试」。
 *
 * @param {object} error 捕获到的错误
 * @returns {number} 可用的业务码，取不到返回 NaN
 */
function resolveErrorCode(error) {
  if (!error || typeof error !== 'object') return NaN
  const detail = error.detail && typeof error.detail === 'object' ? error.detail : null
  const raw = error.errCode !== undefined ? error.errCode
    : error.code !== undefined ? error.code
      : detail ? detail.errCode : undefined
  const code = Number(raw)
  return Number.isFinite(code) ? code : NaN
}

/**
 * 从 SDK 抛出的错误里解析提示文案（同样兼容 detail 包装）。
 * @param {object} error 捕获到的错误
 * @param {number} code 业务码
 * @returns {string} 提示文案
 */
function resolveErrorMessage(error, code) {
  const detail = error && error.detail && typeof error.detail === 'object' ? error.detail : null
  return (error && (error.errMsg || error.message))
    || (detail && detail.errMsg)
    || ERR_MESSAGE[code]
    || ERR_MESSAGE[ERR.INTERNAL_ERROR]
}

/**
 * 从 SDK 抛出的错误里解析结构化明细（如 4011 的引用文档列表）。
 * @param {object} error 捕获到的错误
 * @returns {any} 明细，取不到返回 null
 */
function resolveErrorData(error) {
  if (error && Object.prototype.hasOwnProperty.call(error, 'data')) return error.data
  const detail = error && error.detail && typeof error.detail === 'object' ? error.detail : null
  if (detail && Object.prototype.hasOwnProperty.call(detail, 'data')) return detail.data
  return null
}

/**
 * 调用云对象方法。任何情况下都不抛异常，始终返回归一化结果。
 *
 * @param {string} objKey 云对象键（mmFile / mmComment / mmSearch / mmSettings / mmImage）
 * @param {string} method 云对象方法名
 * @param {object} param 入参，默认空对象
 * @returns {Promise<{code: number, data: any, message: string}>}
 */
export async function call(objKey, method, param = {}) {
  try {
    const target = getObject(objKey)
    if (!target || typeof target[method] !== 'function') {
      return { code: ERR.INTERNAL_ERROR, data: null, message: '云对象方法不存在' }
    }
    const result = normalize(await target[method](param || {}))

    // 版本冲突交由业务层处理；1002（未登录 / token 失效）引导用户重新登录
    if (result.code === ERR.UNAUTHORIZED) {
      handleLoginExpired()
    }
    const silent = result.code === ERR.VERSION_CONFLICT || result.code === ERR.UNAUTHORIZED
    if (result.code !== ERR.OK && !silent) {
      showErrorToast(result.message)
    }
    return result
  } catch (error) {
    // 关键分类：token 真的失效 → 走登录失效处理（清态 + 一次性提示 + 跳登录页）；
    // 云端 500 / 语法或逻辑异常 / 网络失败 → 只归为「服务异常」，
    // 绝不把云端 errMsg（含「登录状态失效，token已过期」）原样 toast 出去。
    if (isTokenInvalid(error)) {
      handleLoginExpired()
      return { code: ERR.UNAUTHORIZED, data: null, message: ERR_MESSAGE[ERR.UNAUTHORIZED] }
    }
    // 明确的业务错误码透传云端文案（如「图标格式不正确」），500/9999 仍统一兜底
    const code = resolveErrorCode(error)
    if (Number.isFinite(code) && PASS_THROUGH_CODES.indexOf(code) >= 0) {
      const message = resolveErrorMessage(error, code)
      showErrorToast(message)
      // 云端业务错误可能带结构化明细（如 4011 的引用文档列表），必须透传否则前端只剩错误码
      return { code, data: resolveErrorData(error), message }
    }
    const message = ERR_MESSAGE[ERR.INTERNAL_ERROR]
    showErrorToast(message)
    return { code: ERR.INTERNAL_ERROR, data: null, message }
  }
}

/**
 * 需要自行处理提示、不弹全局 Toast 的调用（例如设置页的表单校验、首屏 getConfig）。
 * 首屏配置读取不依赖登录态，这里对任何异常都保持静默，不触发跳转。
 * @param {string} objKey 云对象键
 * @param {string} method 云对象方法名
 * @param {object} param 入参
 * @returns {Promise<{code: number, data: any, message: string}>}
 */
export async function callSilent(objKey, method, param = {}) {
  try {
    const target = getObject(objKey)
    if (!target || typeof target[method] !== 'function') {
      return { code: ERR.INTERNAL_ERROR, data: null, message: '云对象方法不存在' }
    }
    return normalize(await target[method](param || {}))
  } catch (error) {
    // 静默只表示不弹全局 Toast，仍需把明确业务码与明细交回调用方（如 4011 引用确认）；
    // 500 / 9999 等非业务码继续统一兜底，避免把云端内部异常当业务提示暴露出去。
    const code = resolveErrorCode(error)
    if (Number.isFinite(code) && PASS_THROUGH_CODES.indexOf(code) >= 0) {
      return { code, data: resolveErrorData(error), message: resolveErrorMessage(error, code) }
    }
    return {
      code: ERR.INTERNAL_ERROR,
      data: null,
      message: (error && error.message) || ERR_MESSAGE[ERR.INTERNAL_ERROR]
    }
  }
}

export default {
  getObject,
  normalize,
  call,
  callSilent,
  isTokenInvalid,
  isLocalTokenExpired,
  clearLoginCredentials,
  handleLoginExpired,
  resetLoginGuard
}
