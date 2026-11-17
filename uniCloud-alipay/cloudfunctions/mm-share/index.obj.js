/**
 * mm-share 云对象：文档只读分享。
 *
 * - create：仅文档所有者 / 有写权限者可创建，生成 base64url 令牌写入 mm-shares；
 * - verify：免登录，只校验令牌状态，不读正文；
 * - open：凭令牌返回正文快照，**只读，绝不返回任何写授权**；
 *   账号模式开启且未登录仍返回 1002，由前端引导登录后重试。
 *
 * 出参统一 {errCode, errMsg, data}，与 mm-file 保持同一约定。
 */

'use strict'

const mm = require('mm-common')

const { ERR, TABLE } = mm

const db = uniCloud.database()
const dbCommand = db.command

/** 令牌形态：base64url，18 字节 → 24 字符 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/

/** 有效期范围（秒）：5 分钟 ~ 30 天 */
const MIN_EXPIRE = 300
const MAX_EXPIRE = 2592000

/** 令牌查重最大重试次数 */
const MAX_TOKEN_RETRY = 3

/**
 * 构造带 errCode / data 的业务错误。
 * @param {number} code 统一错误码
 * @param {string} message 中文提示
 * @param {*} data 附带数据
 * @returns {Error}
 */
function bizError(code, message, data) {
  const error = new Error(message || '操作失败')
  error.errCode = Number(code) || ERR.INTERNAL_ERROR
  error.errMsg = error.message
  if (data !== undefined) error.data = data
  return error
}

/**
 * 统一方法包装：确认 _before 鉴权成功，收敛所有异常。
 * @param {object} obj 云对象实例 this
 * @param {(ctx:object)=>Promise<*>} handler 业务处理函数
 * @returns {Promise<object>}
 */
async function run(obj, handler) {
  if (obj.authError) {
    return mm.fail(
      obj.authError.errCode || ERR.UNAUTHORIZED,
      obj.authError.errMsg || obj.authError.message || '请先登录'
    )
  }
  if (!obj.ctx) return mm.fail(ERR.UNAUTHORIZED, '请先登录')
  try {
    return mm.ok(await handler(obj.ctx))
  } catch (error) {
    const code = error && error.errCode ? error.errCode : ERR.INTERNAL_ERROR
    const message = (error && (error.errMsg || error.message)) || '服务异常，请重试'
    const data = error && Object.prototype.hasOwnProperty.call(error, 'data') ? error.data : null
    return { errCode: Number(code) || ERR.INTERNAL_ERROR, errMsg: message, data }
  }
}

/**
 * 判断当前身份能否写某文档（与 mm-file.canAccess 同口径）。
 * @param {object} ctx 鉴权上下文
 * @param {object} doc 文档记录
 * @returns {boolean}
 */
function canWrite(ctx, doc) {
  if (!doc) return false
  if (ctx.anonymous) return true
  if (ctx.role === 'admin') return true
  if (doc.user_id === ctx.uid) return true
  return !!(ctx.config && ctx.config.permission_enabled === true && ctx.canWrite === true)
}

/**
 * 读取文档正文：优先 downloadFile，失败降级 getTempFileURL（与 mm-file.readDocContent 同口径）。
 * @param {object} doc 文档记录
 * @returns {Promise<{content:string,tempUrl:string,source:string,error:string}>}
 */
async function readDocContent(doc) {
  const key = doc && doc.storage_key ? doc.storage_key : ''
  if (!key) return { content: '', tempUrl: '', source: 'none', error: '文档缺少云存储路径' }
  let downloadError = ''
  try {
    const res = await uniCloud.downloadFile({ fileID: key })
    const buffer = res && res.fileContent ? res.fileContent : null
    if (buffer) {
      const content = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer)
      return { content, tempUrl: '', source: 'download', error: '' }
    }
    downloadError = 'downloadFile 未返回 fileContent'
  } catch (error) {
    downloadError = (error && (error.message || error.errMsg)) || 'downloadFile 调用失败'
  }
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [key] })
    const item = res && res.fileList ? res.fileList[0] : null
    const tempUrl = (item && item.tempFileURL) || ''
    return { content: '', tempUrl, source: 'tempUrl', error: tempUrl ? '' : downloadError }
  } catch (error) {
    return { content: '', tempUrl: '', source: 'none', error: downloadError || '云存储读取失败' }
  }
}

/**
 * 生成唯一令牌：查重重生，最多 MAX_TOKEN_RETRY 次。
 * @returns {Promise<string>}
 */
async function createUniqueToken() {
  for (let attempt = 0; attempt < MAX_TOKEN_RETRY; attempt++) {
    const token = mm.genShareToken(18)
    const found = await mm.collection(TABLE.SHARES).where({ token }).limit(1).get()
    if (!found || !found.data || found.data.length === 0) return token
  }
  throw bizError(ERR.SHARE_CREATE_FAILED, '分享创建失败，请重试')
}

module.exports = {
  /**
   * 前置拦截：解析身份；鉴权失败只记录，由 run 统一返回。
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
   * 创建只读分享。
   * @param {{file_id:string, expire_seconds:number}} param
   */
  async create(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const expireSeconds = Number(source.expire_seconds)
      if (!Number.isFinite(expireSeconds) || expireSeconds < MIN_EXPIRE || expireSeconds > MAX_EXPIRE) {
        throw bizError(ERR.PARAM_INVALID, '有效期不合法')
      }

      const doc = await mm.getDoc(TABLE.FILES, fileId)
      if (!doc || doc.is_delete) throw bizError(ERR.SHARE_DOC_UNAVAILABLE, '分享的文档不可用')
      if (doc.type !== 'file') throw bizError(ERR.PARAM_INVALID, '只能分享文档')
      if (!canWrite(ctx, doc)) throw bizError(ERR.PERMISSION_DENIED, '没有操作权限')
      mm.AuthGuard.assertWrite(ctx, doc._id)

      const token = await createUniqueToken()
      const createdAt = mm.now()
      // mm.now() 返回 Date 对象，必须先取毫秒再加有效期，否则会变成字符串拼接
      const expireAt = createdAt.getTime() + expireSeconds * 1000
      try {
        await mm.collection(TABLE.SHARES).add({
          token,
          doc_id: fileId,
          creator_uid: ctx.uid,
          expire_at: new Date(expireAt),
          created_at: new Date(createdAt),
          revoked: false,
          access_count: 0
        })
      } catch (error) {
        throw bizError(ERR.SHARE_CREATE_FAILED, '分享创建失败，请重试')
      }
      return { token, expire_at: expireAt, file_id: fileId }
    })
  },

  /**
   * 校验令牌（免登录、不读正文）。
   * @param {{token:string}} param
   */
  async verify(param) {
    try {
      const source = param || {}
      const token = typeof source.token === 'string' ? source.token.trim() : ''
      if (!TOKEN_RE.test(token)) throw bizError(ERR.SHARE_TOKEN_INVALID, '分享链接无效')
      const res = await mm.collection(TABLE.SHARES).where({ token }).limit(1).get()
      const share = res && res.data && res.data[0]
      if (!share || share.revoked) throw bizError(ERR.SHARE_TOKEN_INVALID, '分享链接无效')
      if (new Date(share.expire_at).getTime() <= Date.now()) {
        throw bizError(ERR.SHARE_EXPIRED, '分享链接已过期')
      }
      const doc = await mm.getDoc(TABLE.FILES, share.doc_id)
      if (!doc || doc.is_delete || doc.type !== 'file') {
        throw bizError(ERR.SHARE_DOC_UNAVAILABLE, '分享的文档不可用')
      }
      return mm.ok({ valid: true, file_id: share.doc_id, expire_at: share.expire_at, doc_name: doc.name || '' })
    } catch (error) {
      const code = error && error.errCode ? error.errCode : ERR.SHARE_TOKEN_INVALID
      return mm.fail(code, (error && error.errMsg) || '分享链接无效')
    }
  },

  /**
   * 凭令牌只读打开文档（不返回写授权）。
   * @param {{token:string}} param
   */
  async open(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const token = typeof source.token === 'string' ? source.token.trim() : ''
      if (!TOKEN_RE.test(token)) throw bizError(ERR.SHARE_TOKEN_INVALID, '分享链接无效')

      const res = await mm.collection(TABLE.SHARES).where({ token }).limit(1).get()
      const share = res && res.data && res.data[0]
      if (!share || share.revoked) throw bizError(ERR.SHARE_TOKEN_INVALID, '分享链接无效')
      if (new Date(share.expire_at).getTime() <= Date.now()) {
        throw bizError(ERR.SHARE_EXPIRED, '分享链接已过期')
      }

      const doc = await mm.getDoc(TABLE.FILES, share.doc_id)
      if (!doc || doc.is_delete || doc.type !== 'file') {
        throw bizError(ERR.SHARE_DOC_UNAVAILABLE, '分享的文档不可用')
      }
      const { content, tempUrl, source: readSource, error: readError } = await readDocContent(doc)

      // 访问计数自增失败不阻断读取
      try {
        await mm.collection(TABLE.SHARES).doc(share._id).update({
          access_count: dbCommand.inc(1)
        })
      } catch (error) {
        // 计数失败不影响只读正文
      }

      return {
        file_id: share.doc_id,
        doc,
        content,
        tempUrl,
        source: readSource,
        error: readError,
        expire_at: share.expire_at
      }
    })
  }
}
