/**
 * mm-settings 云对象：系统配置读取与开关、用户数校验、首个管理员、用户权限分配。
 *
 * 关键业务规则（C5 / Q2 / 架构 3.5）：
 * - getConfig 无需登录态：应用启动时据此决定渲染登录页还是匿名直入；
 * - updateConfig：权限开启时仅管理员可改；账号 true→false 时若用户数 >1 拒绝（4001）；
 *   权限开启必须账号也开启（4005）；权限 false→true 时自动确立首个注册用户为管理员；
 * - 匿名模式下设置入口保留（assertAdmin 对匿名放行），updated_by 强制记 __anonymous__。
 */

'use strict'

const mm = require('mm-common')

const { ERR, TABLE, SETTINGS_KEY, ANONYMOUS_USER_ID } = mm

/** 云对象内直连数据库 */
const db = uniCloud.database()
const dbCommand = db.command

/** 分页默认值与上限 */
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/**
 * 编辑器格式栏默认顺序（与前端 common/utils/editor-toolbar.js 逐项一致）。
 * 云侧是 CommonJS，无法 import 前端 ESM，故在此保留同构副本；
 * tests/editor-toolbar.test.js 会断言两份清单一致，防止漂移。
 */
const DEFAULT_TOOLBAR_ORDER = [
  'bold', 'underline', 'italic', 'strikeThrough', '-',
  'title', 'sub', 'sup', 'quote', 'unorderedList', 'orderedList', 'task', '-',
  'codeRow', 'code', 'link', 'image', 'table', 'mermaid', 'katex', '-',
  'revoke', 'next', 'save', '=',
  'prettier', 'pageFullscreen', 'fullscreen', 'preview', 'previewOnly',
  'htmlPreview', 'catalog', 'github'
]
const TOOLBAR_KEY_SET = new Set(DEFAULT_TOOLBAR_ORDER)
const isToolbarSeparator = key => key === '-' || key === '='

/**
 * 归一化工具条顺序：过滤未知 key、按钮去重（分隔符可重复）、补齐缺失按钮；
 * 非法输入回退默认。与前端 normalizeToolbarOrder 行为一致。
 * @param {*} input
 * @returns {string[]}
 */
function normalizeToolbarOrder(input) {
  const source = Array.isArray(input) && input.length > 0 ? input : DEFAULT_TOOLBAR_ORDER
  const seen = new Set()
  const result = []
  for (const key of source) {
    if (!TOOLBAR_KEY_SET.has(key)) continue
    if (!isToolbarSeparator(key)) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    result.push(key)
  }
  for (const key of DEFAULT_TOOLBAR_ORDER) {
    if (!isToolbarSeparator(key) && !seen.has(key)) {
      seen.add(key)
      result.push(key)
    }
  }
  return result
}

// ----------------------------------------------------------------------------
// 本对象内私有工具
// ----------------------------------------------------------------------------

/**
 * 构造带 errCode 的业务错误。
 * @param {number} code 统一错误码
 * @param {string} msg 中文提示
 * @returns {Error}
 */
function bizError(code, msg) {
  const error = new Error(msg || '操作失败')
  error.errCode = Number(code) || ERR.INTERNAL_ERROR
  error.errMsg = error.message
  return error
}

/**
 * 统一方法包装：确认 _before 鉴权成功，并把异常收敛为统一出参。
 * @param {object} obj 云对象实例 this
 * @param {(ctx:object)=>Promise<*>} handler 业务处理函数
 * @returns {Promise<{errCode:number, errMsg:string, data:*}>}
 */
async function run(obj, handler) {
  if (obj.authError) {
    return mm.fail(
      obj.authError.errCode || ERR.UNAUTHORIZED,
      obj.authError.errMsg || obj.authError.message || '请先登录'
    )
  }
  if (!obj.ctx) {
    return mm.fail(ERR.UNAUTHORIZED, '请先登录')
  }
  try {
    return mm.ok(await handler(obj.ctx))
  } catch (error) {
    const code = error && error.errCode ? error.errCode : ERR.INTERNAL_ERROR
    const message = (error && (error.errMsg || error.message)) || '服务异常，请重试'
    return { errCode: Number(code) || ERR.INTERNAL_ERROR, errMsg: message, data: null }
  }
}

/**
 * 解析分页参数。
 * @param {object} param 入参
 * @returns {{page:number, pageSize:number, skip:number}}
 */
function pageOf(param) {
  const source = param || {}
  const page = Math.max(1, Number(source.page) || 1)
  const rawSize = Number(source.pageSize) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize))
  return { page, pageSize, skip: (page - 1) * pageSize }
}

/**
 * 统计 uni-id 用户数，用于关闭账号功能前的校验（C5）。
 * @returns {Promise<number>}
 */
async function countUsers() {
  const res = await mm.collection(TABLE.USERS).count()
  return (res && res.total) || 0
}

/**
 * 读取单条配置文档（按业务唯一键）。
 * @returns {Promise<object|null>}
 */
async function findConfigDoc() {
  const res = await mm.collection(TABLE.SETTINGS).where({ key: SETTINGS_KEY }).limit(1).get()
  return (res && res.data && res.data[0]) || null
}

/**
 * 幂等写入 / 更新某用户的权限记录。
 * @param {string} userId 用户 ID
 * @param {{role?:string, can_read?:boolean, can_write?:boolean}} patch 待更新字段
 * @returns {Promise<object>} 权限记录
 */
async function upsertPermission(userId, patch) {
  const res = await mm.collection(TABLE.USER_PERMISSIONS).where({ user_id: userId }).limit(1).get()
  const existing = (res && res.data && res.data[0]) || null
  const timestamp = mm.now()

  if (existing) {
    await mm.collection(TABLE.USER_PERMISSIONS).doc(existing._id).update(
      Object.assign({}, patch, { updated_at: timestamp })
    )
    return await mm.getDoc(TABLE.USER_PERMISSIONS, existing._id)
  }

  const addRes = await mm.collection(TABLE.USER_PERMISSIONS).add(Object.assign({
    user_id: userId,
    role: 'user',
    can_read: true,
    can_write: true,
    created_at: timestamp,
    updated_at: timestamp
  }, patch || {}))
  const addedId = (addRes && (addRes.id || (addRes.ids && addRes.ids[0]))) || ''
  return addedId ? await mm.getDoc(TABLE.USER_PERMISSIONS, addedId) : null
}

/**
 * 确立首个注册用户为管理员，并给其余已存在用户补默认可读可写记录（C5）。
 * @param {string} operatorUid 操作者（用于审计）
 * @returns {Promise<{admin_user_id:string}>}
 */
async function ensureAdminInternal(operatorUid) {
  const config = await mm.readConfig()
  if (config.admin_user_id) return { admin_user_id: config.admin_user_id }

  const res = await mm.collection(TABLE.USERS)
    .field({ _id: 1, register_date: 1 })
    .orderBy('register_date', 'asc')
    .limit(1000)
    .get()
  const users = (res && res.data) || []
  if (users.length === 0) return { admin_user_id: '' }

  const first = users[0]
  const timestamp = mm.now()
  const configDoc = await findConfigDoc()
  if (configDoc) {
    await mm.collection(TABLE.SETTINGS).doc(configDoc._id).update({
      admin_user_id: first._id,
      updated_by: operatorUid || '',
      updated_at: timestamp
    })
  }

  for (const user of users) {
    const isAdmin = user._id === first._id
    await upsertPermission(user._id, {
      role: isAdmin ? 'admin' : 'user',
      can_read: true,
      can_write: true
    })
  }
  return { admin_user_id: first._id }
}

/**
 * 组装对外返回的配置结构。
 * @param {object} config 配置文档
 * @returns {object}
 */
function toConfigView(config) {
  return {
    account_enabled: config.account_enabled !== false,
    permission_enabled: config.permission_enabled === true,
    admin_user_id: config.admin_user_id || '',
    // 目录树根节点的显示名称与图标（根节点不是真实文件夹记录，因此存系统配置）
    root_name: typeof config.root_name === 'string' ? config.root_name : '',
    root_icon: normalizeIcon(config.root_icon),
    // 编辑器格式栏顺序：非法/缺失时回退默认，前端拿到即可直接喂给 MdEditor
    toolbar_order: normalizeToolbarOrder(config.toolbar_order),
    anonymous: config.account_enabled === false
  }
}

/**
 * 归一化根节点图标：只接受 {type:'preset'|'wot'|'custom', value:string}，其余一律 null。
 * 与 mm-file 的 normalizeIcon 保持同一形状，前端可直接复用同一套渲染逻辑。
 * @param {object|null} icon
 * @returns {{type:string,value:string}|null}
 */
function normalizeIcon(icon) {
  if (!icon || typeof icon !== 'object') return null
  const type = ['preset', 'wot', 'custom'].indexOf(icon.type) !== -1 ? icon.type : ''
  const value = typeof icon.value === 'string' ? icon.value.trim() : ''
  if (!type || !value) return null
  return { type, value }
}

// ----------------------------------------------------------------------------
// 云对象
// ----------------------------------------------------------------------------

module.exports = {
  /**
   * 前置拦截：注入 ctx；鉴权失败记 authError，由 run() 统一返回 fail()。
   * 注意 getConfig 不走 run()，因此即便未登录也能正常返回配置。
   */
  async _before() {
    try {
      this.ctx = await mm.AuthGuard.resolve(this)
      this.authError = null
    } catch (error) {
      this.ctx = null
      this.authError = error
    }
  },

  /**
   * 读取系统配置（**无需登录**，应用启动时调用）。
   * 配置文档缺失时返回默认值（账号开启 / 权限关闭）。
   * @returns {Promise<object>}
   */
  async getConfig() {
    try {
      const config = await mm.readConfig()
      // readConfig() 只返回三项核心字段；格式栏顺序从原始配置文档补齐，
      // 否则每次 getConfig 都会丢失用户已保存的自定义顺序。
      const raw = await findConfigDoc()
      if (raw && Object.prototype.hasOwnProperty.call(raw, 'toolbar_order')) {
        config.toolbar_order = raw.toolbar_order
      }
      return mm.ok(toConfigView(config))
    } catch (error) {
      return mm.fail(ERR.INTERNAL_ERROR, '配置读取失败')
    }
  },

  /**
   * 幂等创建 / 补齐配置单文档（部署初始化与兜底使用）。
   * @returns {Promise<object>}
   */
  async ensureConfig() {
    return run(this, async () => {
      const existing = await findConfigDoc()
      if (existing) {
        const patch = {}
        if (typeof existing.account_enabled !== 'boolean') patch.account_enabled = true
        if (typeof existing.permission_enabled !== 'boolean') patch.permission_enabled = false
        if (typeof existing.admin_user_id !== 'string') patch.admin_user_id = ''
        if (typeof existing.updated_by !== 'string') patch.updated_by = ''
        if (Object.keys(patch).length > 0) {
          patch.updated_at = mm.now()
          await mm.collection(TABLE.SETTINGS).doc(existing._id).update(patch)
        }
        return await mm.getDoc(TABLE.SETTINGS, existing._id)
      }

      const timestamp = mm.now()
      const addRes = await mm.collection(TABLE.SETTINGS).add({
        key: SETTINGS_KEY,
        account_enabled: true,
        permission_enabled: false,
        admin_user_id: '',
        updated_by: '',
        updated_at: timestamp
      })
      const addedId = (addRes && (addRes.id || (addRes.ids && addRes.ids[0]))) || ''
      return addedId ? await mm.getDoc(TABLE.SETTINGS, addedId) : null
    })
  },

  /**
   * 更新账号 / 权限开关（C5）。
   * 权限开启时仅管理员；账号 true→false 时用户数 >1 拒绝（4001）；
   * 权限开启必须账号也开启（4005）；权限 false→true 时自动确立首个管理员。
   * @param {{account_enabled?:boolean, permission_enabled?:boolean}} param
   * @returns {Promise<object>}
   */
  async updateConfig(param) {
    return run(this, async (ctx) => {
      // 权限开启时仅管理员可改；匿名模式由 assertAdmin 放行（架构 9.2）
      mm.AuthGuard.assertAdmin(ctx)

      const source = param || {}
      if (typeof source.account_enabled !== 'boolean' && typeof source.permission_enabled !== 'boolean') {
        throw bizError(ERR.PARAM_INVALID, '请提供要修改的配置项')
      }
      const current = await mm.readConfig()
      const nextAccount = typeof source.account_enabled === 'boolean'
        ? source.account_enabled
        : current.account_enabled
      const nextPermission = typeof source.permission_enabled === 'boolean'
        ? source.permission_enabled
        : current.permission_enabled

      // 权限功能依赖账号功能
      if (nextPermission === true && nextAccount === false) {
        throw bizError(ERR.PERMISSION_NEEDS_ACCOUNT, '请先开启账号功能')
      }
      // 关闭账号功能前校验：存在多个用户时拒绝，须先删除至单用户
      if (current.account_enabled === true && nextAccount === false) {
        const total = await countUsers()
        if (total > 1) {
          throw bizError(ERR.ACCOUNT_DISABLE_REJECTED, '请先删除至单用户')
        }
      }

      const timestamp = mm.now()
      const updatedBy = ctx.anonymous ? ANONYMOUS_USER_ID : ctx.uid
      const existing = await findConfigDoc()
      if (existing) {
        await mm.collection(TABLE.SETTINGS).doc(existing._id).update({
          account_enabled: nextAccount,
          permission_enabled: nextPermission,
          updated_by: updatedBy,
          updated_at: timestamp
        })
      } else {
        await mm.collection(TABLE.SETTINGS).add({
          key: SETTINGS_KEY,
          account_enabled: nextAccount,
          permission_enabled: nextPermission,
          admin_user_id: '',
          updated_by: updatedBy,
          updated_at: timestamp
        })
      }

      // 权限由关→开：确立注册时间最早的用户为管理员
      if (current.permission_enabled === false && nextPermission === true) {
        await ensureAdminInternal(updatedBy)
      }

      const config = await mm.readConfig()
      return toConfigView(config)
    })
  },

  /**
   * 更新目录树根节点的显示名称 / 图标。
   * 根节点不是 mm-files 里的真实记录（parent_id 为空只会被当作「根目录」），
   * 所以它的名称与图标存在系统配置里，多端一致。
   * @param {{name?:string, icon?:object|null}} param
   * @returns {Promise<object>} 最新配置视图
   */
  async updateRoot(param) {
    return run(this, async (ctx) => {
      mm.AuthGuard.assertAdmin(ctx)

      const source = param || {}
      const hasName = typeof source.name === 'string'
      const hasIcon = Object.prototype.hasOwnProperty.call(source, 'icon')
      if (!hasName && !hasIcon) {
        throw bizError(ERR.PARAM_INVALID, '请提供要修改的根节点信息')
      }

      const patch = {}
      if (hasName) {
        const name = source.name.trim()
        if (name.length > 60) throw bizError(ERR.PARAM_INVALID, '名称过长')
        patch.root_name = name
      }
      if (hasIcon) {
        // null / 非法结构都表示「清空，回退默认图标」
        patch.root_icon = normalizeIcon(source.icon)
      }
      patch.updated_by = ctx.anonymous ? ANONYMOUS_USER_ID : ctx.uid
      patch.updated_at = mm.now()

      const existing = await findConfigDoc()
      if (existing) {
        await mm.collection(TABLE.SETTINGS).doc(existing._id).update(patch)
      } else {
        await mm.collection(TABLE.SETTINGS).add(Object.assign({
          key: SETTINGS_KEY,
          account_enabled: true,
          permission_enabled: false,
          admin_user_id: '',
          root_name: '',
          root_icon: null
        }, patch))
      }

      const config = await mm.readConfig()
      return toConfigView(config)
    })
  },

  /**
   * 保存编辑器格式栏的按钮顺序。
   * 与 updateRoot 同属全局 UI 偏好：权限开启时仅管理员可改，匿名模式开放。
   * 顺序在服务端归一化（去重 / 过滤未知 / 补齐缺失），避免前端被绕过时写入脏数据。
   * @param {{order:Array<string|number>}} param
   * @returns {Promise<object>} 最新配置视图
   */
  async setToolbarOrder(param) {
    return run(this, async (ctx) => {
      mm.AuthGuard.assertAdmin(ctx)

      const source = param || {}
      if (!Array.isArray(source.order)) {
        throw bizError(ERR.PARAM_INVALID, '工具栏顺序格式不正确')
      }
      const order = normalizeToolbarOrder(source.order)
      const patch = {
        toolbar_order: order,
        updated_by: ctx.anonymous ? ANONYMOUS_USER_ID : ctx.uid,
        updated_at: mm.now()
      }

      const existing = await findConfigDoc()
      if (existing) {
        await mm.collection(TABLE.SETTINGS).doc(existing._id).update(patch)
      } else {
        await mm.collection(TABLE.SETTINGS).add(Object.assign({
          key: SETTINGS_KEY,
          account_enabled: true,
          permission_enabled: false,
          admin_user_id: '',
          root_name: '',
          root_icon: null
        }, patch))
      }

      const config = await mm.readConfig()
      config.toolbar_order = order
      return toConfigView(config)
    })
  },

  /**
   * 用户列表（权限开启时仅管理员可调用），附带角色与可读可写权限位。
   * @param {{page?:number, pageSize?:number}} param
   * @returns {Promise<object>}
   */
  async listUsers(param) {
    return run(this, async (ctx) => {
      mm.AuthGuard.assertAdmin(ctx)
      const { page, pageSize, skip } = pageOf(param)
      const coll = mm.collection(TABLE.USERS)
      const counted = await coll.count()
      const res = await coll
        .field({ _id: 1, username: 1, nickname: 1, register_date: 1 })
        .orderBy('register_date', 'asc')
        .skip(skip)
        .limit(pageSize)
        .get()
      const users = (res && res.data) || []

      const permMap = new Map()
      const userIds = users.map(item => item._id).filter(Boolean)
      if (userIds.length > 0) {
        const permRes = await mm.collection(TABLE.USER_PERMISSIONS)
          .where({ user_id: dbCommand.in(userIds) })
          .limit(1000)
          .get()
        for (const record of (permRes && permRes.data) || []) {
          permMap.set(record.user_id, record)
        }
      }

      const list = users.map(item => {
        const record = permMap.get(item._id)
        const isAdmin = ctx.config && ctx.config.admin_user_id === item._id
        return {
          user_id: item._id,
          username: item.username || item.nickname || '',
          register_date: item.register_date,
          role: record ? record.role : (isAdmin ? 'admin' : 'user'),
          can_read: record ? record.can_read !== false : true,
          can_write: record ? record.can_write !== false : true
        }
      })
      return { list, total: (counted && counted.total) || 0, page, pageSize }
    })
  },

  /**
   * 分配某用户的可读 / 可写权限位（仅管理员）；管理员自身权限不可修改。
   * @param {{user_id:string, can_read?:boolean, can_write?:boolean}} param
   * @returns {Promise<object>}
   */
  async setUserPermission(param) {
    return run(this, async (ctx) => {
      mm.AuthGuard.assertAdmin(ctx)
      const source = param || {}
      const userId = typeof source.user_id === 'string' ? source.user_id : ''
      if (!userId) throw bizError(ERR.PARAM_INVALID, '缺少用户 ID')

      const user = await mm.getDoc(TABLE.USERS, userId)
      if (!user) throw bizError(ERR.NOT_FOUND, '用户不存在')

      const config = await mm.readConfig()
      if (config.admin_user_id && config.admin_user_id === userId) {
        throw bizError(ERR.PERMISSION_DENIED, '不能修改管理员权限')
      }

      return await upsertPermission(userId, {
        can_read: source.can_read !== false,
        can_write: source.can_write !== false
      })
    })
  },

  /**
   * 确立首个注册用户为管理员（权限由关→开时自动执行，也可手动补偿）。
   * @returns {Promise<{admin_user_id:string}>}
   */
  async ensureAdmin() {
    return run(this, async (ctx) => {
      mm.AuthGuard.assertAdmin(ctx)
      return await ensureAdminInternal(ctx.anonymous ? ANONYMOUS_USER_ID : ctx.uid)
    })
  }
}
