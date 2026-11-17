/**
 * 身份与权限守卫（依赖 uniCloud 运行时，单独成文件，不污染纯函数模块）。
 *
 * 各云对象 _before 统一调用 AuthGuard.resolve(this) 注入
 * {uid, role, canRead, canWrite, config, anonymous}；写方法再调用
 * assertWrite / assertAdmin 做服务端二次校验（C5 / AC-20）。
 *
 * 身份规则：
 * - 账号功能关闭：所有访客共享固定虚拟用户 __anonymous__，无需登录、可读可写；
 * - 账号开启：用 uni-id-common.checkToken 校验 token，客户端不传 user_id；
 * - 权限关闭：所有登录用户默认全部可读可写；
 * - 权限开启：首个注册用户（mm-settings.admin_user_id）为管理员，
 *   其余用户按 mm-user-permissions 的 can_read / can_write 判定。
 *
 * 部署前核对项（架构 U2）：uni-id-common 的 createInstance / checkToken 签名
 * 与 uni-config-center/uni-id/config.json 的 tokenSecret 配置，按本地源码微调。
 */

'use strict'

const { ANONYMOUS_USER_ID, SETTINGS_KEY, TABLE, ERR } = require('./constants.js')
const { assert } = require('./error.js')
const { collection } = require('./db.js')

/** 配置文档缺失或服务空间未初始化时使用的默认配置 */
const DEFAULT_CONFIG = {
  account_enabled: true,
  permission_enabled: false,
  admin_user_id: ''
}

/** uni-id-common 惰性缓存，避免模块加载阶段就依赖云运行时 */
let uniIdCommonCache = null

function getUniIdCommon() {
  if (!uniIdCommonCache) {
    uniIdCommonCache = require('uni-id-common')
  }
  return uniIdCommonCache
}

/**
 * 读取客户端登录 token。
 *
 * 云对象上通用的方法是 getUniversalUniIdToken（uni-id-co 的鉴权中间件同样使用它），
 * 部分运行环境只提供旧的 getUniIdToken；两者都取不到时再回退 clientInfo。
 * 早期实现只判断 getUniIdToken，在只提供 getUniversalUniIdToken 的环境里会取到空串，
 * 导致已登录用户的所有请求都被判为未登录（1002）。
 *
 * @param {object} objCtx 云对象 this
 * @param {object} clientInfo 客户端信息
 * @returns {string}
 */
function readToken(objCtx, clientInfo) {
  const getters = ['getUniversalUniIdToken', 'getUniIdToken']
  for (const name of getters) {
    if (typeof objCtx[name] === 'function') {
      try {
        const value = objCtx[name]()
        if (value) return value
      } catch (error) {
        // 该环境不支持此方法时继续尝试下一种
      }
    }
  }
  const info = clientInfo || {}
  return info.uniIdToken || info.token || ''
}

/** 读取系统配置单文档；异常时回退默认配置，保证首屏 getConfig 可用 */
async function readConfig() {
  try {
    const res = await collection(TABLE.SETTINGS).where({ key: SETTINGS_KEY }).limit(1).get()
    const doc = res && res.data && res.data[0]
    if (!doc) return Object.assign({}, DEFAULT_CONFIG)
    return {
      account_enabled: doc.account_enabled !== false,
      permission_enabled: doc.permission_enabled === true,
      admin_user_id: doc.admin_user_id || ''
    }
  } catch (error) {
    return Object.assign({}, DEFAULT_CONFIG)
  }
}

/**
 * 解析当前请求的身份与权限，注入云对象上下文。
 * @param {object} cloudObjCtx 云对象 this（需提供 getClientInfo / getUniversalUniIdToken）
 * @returns {Promise<{uid:string, role:string, canRead:boolean, canWrite:boolean,
 *   config:object, anonymous:boolean}>}
 */
async function resolve(cloudObjCtx) {
  const objCtx = cloudObjCtx || {}
  const config = await readConfig()

  // 账号功能关闭：匿名共享身份，无需 token
  if (config.account_enabled === false) {
    return {
      uid: ANONYMOUS_USER_ID,
      role: 'user',
      canRead: true,
      canWrite: true,
      config,
      anonymous: true
    }
  }

  const clientInfo = typeof objCtx.getClientInfo === 'function' ? objCtx.getClientInfo() : {}
  const token = readToken(objCtx, clientInfo)

  // 账号开启：用 uni-id-common 校验 token，客户端不得伪造 user_id
  let uid = ''
  try {
    const uniIdCommon = getUniIdCommon()
    const instance = uniIdCommon.createInstance({ clientInfo })
    const payload = await instance.checkToken(token)
    if (payload && !payload.errCode) {
      uid = payload.uid || payload.user_id || ''
    }
  } catch (error) {
    uid = ''
  }
  assert(uid !== '', ERR.UNAUTHORIZED, '请先登录')

  // 权限关闭：默认全部可读可写
  if (config.permission_enabled === false) {
    return { uid, role: 'user', canRead: true, canWrite: true, config, anonymous: false }
  }

  // 权限开启：管理员直通
  if (config.admin_user_id && config.admin_user_id === uid) {
    return { uid, role: 'admin', canRead: true, canWrite: true, config, anonymous: false }
  }

  // 权限开启：按权限表判定；无记录时按默认可读可写
  let role = 'user'
  let canRead = true
  let canWrite = true
  try {
    const res = await collection(TABLE.USER_PERMISSIONS).where({ user_id: uid }).limit(1).get()
    const doc = res && res.data && res.data[0]
    if (doc) {
      role = doc.role === 'admin' ? 'admin' : 'user'
      canRead = doc.can_read !== false
      canWrite = doc.can_write !== false
      if (role === 'admin') {
        canRead = true
        canWrite = true
      }
    }
  } catch (error) {
    // 权限表读取失败时按默认可读写，由云对象写方法继续兜底
  }
  return { uid, role, canRead, canWrite, config, anonymous: false }
}

/**
 * 写操作二次校验：无写权限抛 1003。
 * @param {object} guardCtx resolve 返回的上下文
 * @param {string} fileId 目标文档 ID（预留给 T03 按文档归属做更细校验）
 * @returns {void}
 */
function assertWrite(guardCtx, fileId) {
  const ctx = guardCtx || {}
  // fileId 参数保留在签名中，供云对象按文档归属扩展校验
  if (ctx.canWrite === false) {
    assert(false, ERR.PERMISSION_DENIED, '没有操作权限')
  }
}

/**
 * 管理员校验：权限开启时仅 admin 可操作；匿名模式开放设置入口（架构 9.2）。
 * @param {object} guardCtx resolve 返回的上下文
 * @returns {void}
 */
function assertAdmin(guardCtx) {
  const ctx = guardCtx || {}
  if (ctx.anonymous === true) return
  if (ctx.config && ctx.config.permission_enabled === true && ctx.role !== 'admin') {
    assert(false, ERR.PERMISSION_DENIED, '仅管理员可操作')
  }
}

const AuthGuard = { resolve, assertWrite, assertAdmin, readConfig }

module.exports = { AuthGuard, resolve, assertWrite, assertAdmin, readConfig }
