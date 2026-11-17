/**
 * mm-comment 云对象：批注增删改查与四级重定位。
 *
 * 关键约定：
 * - 锚点坐标系为「提纯纯文本 plainText」（架构 1.5）；R3 之后前端用 domPlainMap 计算 offset，
 *   但本对象仍必须做服务端二次校验（`selected_text === plainText.slice(start,end)`，
 *   prefix / suffix 同源），不一致返回 4004 ANCHOR_MISMATCH —— 这是 R3 的最后防线，
 *   防止前端把 DOM 序列文本当选中原文传入；
 * - status 只由云侧 relocateComments 决定（active / orphaned），不得在前端改写；
 * - 时间一律服务器时间；created_at 仅在新建时写入，update 只改 updated_at（AC-16）。
 */

'use strict'

const mm = require('mm-common')

const { ERR, TABLE, ANONYMOUS_USER_ID } = mm

/** 云对象内直连数据库（云函数环境拥有完整权限） */
const db = uniCloud.database()
const dbCommand = db.command

/** 单次重定位处理的批注上限 */
const RELOCATE_LIMIT = 1000

// ----------------------------------------------------------------------------
// 本对象内私有工具
// ----------------------------------------------------------------------------

/**
 * 构造带 errCode / data 的业务错误。
 * @param {number} code 统一错误码
 * @param {string} msg 中文提示
 * @param {*} data 附带数据
 * @returns {Error}
 */
function bizError(code, msg, data) {
  const error = new Error(msg || '操作失败')
  error.errCode = Number(code) || ERR.INTERNAL_ERROR
  error.errMsg = error.message
  if (data !== undefined) error.data = data
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
    const data = error && Object.prototype.hasOwnProperty.call(error, 'data') ? error.data : null
    return { errCode: Number(code) || ERR.INTERNAL_ERROR, errMsg: message, data }
  }
}

/**
 * 判断当前身份能否访问某文档；与 mm-file 保持一致。
 * @param {object} ctx 鉴权上下文
 * @param {object} doc 文档记录
 * @param {'read'|'write'} mode 访问模式
 * @returns {boolean}
 */
function canAccess(ctx, doc, mode) {
  if (!doc) return false
  if (ctx.anonymous) return true
  if (ctx.role === 'admin') return true
  if (doc.user_id === ctx.uid) return true
  if (ctx.config && ctx.config.permission_enabled === true) {
    return mode === 'write' ? ctx.canWrite === true : ctx.canRead === true
  }
  return false
}

/**
 * 断言文档可读 / 可写。
 * @param {object} ctx 鉴权上下文
 * @param {object} doc 文档记录
 * @param {'read'|'write'} mode 访问模式
 * @returns {void}
 */
function assertDocAccess(ctx, doc, mode) {
  if (!doc || doc.is_delete) throw bizError(ERR.NOT_FOUND, '内容不存在')
  if (!canAccess(ctx, doc, mode)) throw bizError(ERR.PERMISSION_DENIED, '没有操作权限')
  if (mode === 'write') mm.AuthGuard.assertWrite(ctx, doc._id)
}

/**
 * 读取文档 md 原文：优先云函数端 downloadFile，失败回退临时 URL。
 * @param {object} doc 文档记录
 * @returns {Promise<{content:string, tempUrl:string}>}
 */
async function readDocContent(doc) {
  const key = doc && doc.storage_key ? doc.storage_key : ''
  if (!key) return { content: '', tempUrl: '' }
  try {
    const res = await uniCloud.downloadFile({ fileID: key })
    const buffer = res && res.fileContent ? res.fileContent : null
    if (buffer) {
      return {
        content: Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer),
        tempUrl: ''
      }
    }
  } catch (error) {
    // 降级到临时 URL
  }
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [key] })
    const item = res && res.fileList ? res.fileList[0] : null
    return { content: '', tempUrl: (item && item.tempFileURL) || '' }
  } catch (error) {
    return { content: '', tempUrl: '' }
  }
}

/**
 * 取文档提纯纯文本；内容读不到时抛 5002，避免在空文本上做锚点校验。
 * @param {object} doc 文档记录
 * @returns {Promise<string>} plainText
 */
async function loadPlainText(doc) {
  const { content } = await readDocContent(doc)
  if (typeof content !== 'string' || content === '') {
    throw bizError(ERR.RELOCATE_FAILED, '批注定位失败')
  }
  return mm.stripMarkdown(content)
}

// ----------------------------------------------------------------------------
// 云对象
// ----------------------------------------------------------------------------

module.exports = {
  /**
   * 前置拦截：注入 ctx；鉴权失败记 authError，由 run() 统一返回 fail()。
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
   * 取指定文档的批注列表（含 orphaned）。只读，需可读权限。
   * @param {{file_id:string, status?:string}} param
   * @returns {Promise<object[]>}
   */
  async listByFile(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertDocAccess(ctx, doc, 'read')

      const where = { file_id: fileId }
      if (source.status === 'active' || source.status === 'orphaned') where.status = source.status
      const res = await mm.collection(TABLE.COMMENTS)
        .where(where)
        .orderBy('created_at', 'asc')
        .limit(1000)
        .get()
      const comments = (res && res.data) || []

      // 批注记录只存 user_id，展示层需要昵称。批量查一次用户表补齐 nickname，
      // 查询失败不阻断批注列表；匿名模式统一显示「访客」。
      const userIds = Array.from(new Set(comments.map(item => item && item.user_id).filter(Boolean)))
      const nicknameMap = new Map()
      if (userIds.length > 0) {
        try {
          const userRes = await mm.collection(TABLE.USERS)
            .where({ _id: dbCommand.in(userIds) })
            .field({ _id: 1, nickname: 1, username: 1 })
            .limit(1000)
            .get()
          for (const user of (userRes && userRes.data) || []) {
            nicknameMap.set(user._id, user.nickname || user.username || '')
          }
        } catch (error) {
          // 昵称查询失败不影响批注本体
        }
      }
      return comments.map(item => Object.assign({}, item, {
        nickname: item.user_id === ANONYMOUS_USER_ID ? '访客' : (nicknameMap.get(item.user_id) || '')
      }))
    })
  },

  /**
   * 新建批注：服务端二次校验锚点与 plainText 一致（4004），一致才写入且 status=active。
   * 写操作：assertWrite(file_id)。
   * @param {{file_id:string, selected_text:string, prefix?:string, suffix?:string,
   *   start_offset:number, end_offset:number, comment:string}} param
   * @returns {Promise<object>}
   */
  async add(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const selectedText = typeof source.selected_text === 'string' ? source.selected_text : ''
      const comment = typeof source.comment === 'string' ? source.comment.trim() : ''
      const start = Number(source.start_offset)
      const end = Number(source.end_offset)
      if (!selectedText) throw bizError(ERR.PARAM_INVALID, '请先选择要批注的文本')
      if (!comment) throw bizError(ERR.PARAM_INVALID, '批注内容不能为空')
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw bizError(ERR.PARAM_INVALID, '批注位置不正确')
      }

      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertDocAccess(ctx, doc, 'write')

      // R3 最后防线：选中原文必须与 plainText 在 offset 处逐字一致
      const plainText = await loadPlainText(doc)
      if (plainText.slice(start, end) !== selectedText) {
        throw bizError(ERR.ANCHOR_MISMATCH, '批注位置已变化，请重新选择')
      }
      const prefix = typeof source.prefix === 'string' ? source.prefix : ''
      const suffix = typeof source.suffix === 'string' ? source.suffix : ''
      if (prefix && plainText.slice(Math.max(0, start - prefix.length), start) !== prefix) {
        throw bizError(ERR.ANCHOR_MISMATCH, '批注位置已变化，请重新选择')
      }
      if (suffix && plainText.slice(end, end + suffix.length) !== suffix) {
        throw bizError(ERR.ANCHOR_MISMATCH, '批注位置已变化，请重新选择')
      }

      const timestamp = mm.now()
      let addedId = ''
      try {
        const res = await mm.collection(TABLE.COMMENTS).add({
          file_id: fileId,
          user_id: ctx.uid,
          selected_text: selectedText,
          prefix,
          suffix,
          start_offset: start,
          end_offset: end,
          comment,
          status: 'active',
          created_at: timestamp,
          updated_at: timestamp
        })
        addedId = (res && (res.id || (res.ids && res.ids[0]))) || ''
      } catch (error) {
        throw bizError(ERR.INTERNAL_ERROR, '批注保存失败')
      }
      if (!addedId) throw bizError(ERR.INTERNAL_ERROR, '批注保存失败')
      return await mm.getDoc(TABLE.COMMENTS, addedId)
    })
  },

  /**
   * 修改批注内容：只更新 comment 与 updated_at，created_at 不动（AC-16）。
   * 写操作：按批注所属文档 assertWrite。
   * 说明：架构 3.3 的 update 错误码不含 4004，锚点校验集中在 add 与 relocate；
   * 若原文已变更，改文案本身不应被拒绝，status 由 relocate 决定。
   * @param {{comment_id:string, comment:string}} param
   * @returns {Promise<object>}
   */
  async update(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const commentId = typeof source.comment_id === 'string' ? source.comment_id : ''
      if (!commentId) throw bizError(ERR.PARAM_INVALID, '缺少批注 ID')
      const comment = typeof source.comment === 'string' ? source.comment.trim() : ''
      if (!comment) throw bizError(ERR.PARAM_INVALID, '批注内容不能为空')

      const record = await mm.getDoc(TABLE.COMMENTS, commentId)
      if (!record) throw bizError(ERR.NOT_FOUND, '批注不存在')
      const doc = await mm.getDoc(TABLE.FILES, record.file_id)
      assertDocAccess(ctx, doc, 'write')

      await mm.collection(TABLE.COMMENTS).doc(commentId).update({
        comment,
        updated_at: mm.now()
      })
      return await mm.getDoc(TABLE.COMMENTS, commentId)
    })
  },

  /**
   * 删除批注。写操作：按批注所属文档 assertWrite。
   * @param {{comment_id:string}} param
   * @returns {Promise<{deleted:number}>}
   */
  async remove(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const commentId = typeof source.comment_id === 'string' ? source.comment_id : ''
      if (!commentId) throw bizError(ERR.PARAM_INVALID, '缺少批注 ID')

      const record = await mm.getDoc(TABLE.COMMENTS, commentId)
      if (!record) throw bizError(ERR.NOT_FOUND, '批注不存在')
      const doc = await mm.getDoc(TABLE.FILES, record.file_id)
      assertDocAccess(ctx, doc, 'write')

      const res = await mm.collection(TABLE.COMMENTS).doc(commentId).remove()
      return { deleted: (res && res.deleted) || 0 }
    })
  },

  /**
   * 对文档下 status=active 的批注执行四级重定位（C4）。
   * 命中更新 start_offset / end_offset / status；无法定位置 orphaned，禁止误绑。
   * 写操作：assertWrite(file_id)；由 mm-file.saveContent 内部调用，也暴露供补偿。
   * @param {{file_id:string}} param
   * @returns {Promise<{active:number, orphaned:number}>}
   */
  async relocate(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertDocAccess(ctx, doc, 'write')

      const plainText = await loadPlainText(doc)
      const res = await mm.collection(TABLE.COMMENTS)
        .where({ file_id: fileId, status: 'active' })
        .limit(RELOCATE_LIMIT)
        .get()
      const list = (res && res.data) || []
      if (list.length === 0) return { active: 0, orphaned: 0 }

      const result = mm.relocateComments(plainText, list)
      for (const item of result.results) {
        await mm.collection(TABLE.COMMENTS).doc(item._id).update({
          start_offset: item.start_offset,
          end_offset: item.end_offset,
          status: item.status,
          updated_at: mm.now()
        })
      }
      return { active: result.active, orphaned: result.orphaned }
    })
  }
}
