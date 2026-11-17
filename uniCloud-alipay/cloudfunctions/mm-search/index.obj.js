/**
 * mm-search 云对象：标签 / 文件名 / 批注 / 正文四维搜索。
 *
 * 实现要点（架构 3.4）：
 * - 标签走 mm-files.tags、文件名走 mm-files.name、批注走 mm-comments.comment / selected_text、
 *   正文走 mm-index-chunks.content / keywords；
 * - 用 db.RegExp 做包含匹配（用户输入先转义，避免 .* 之类被当作正则）；
 * - 正文命中按 revision 与文件 version 对齐，过滤陈旧索引（C6）；
 * - 结果按 uid + 权限过滤，只返回当前身份可读的文档。
 */

'use strict'

const mm = require('mm-common')

const { ERR, TABLE } = mm

/** 云对象内直连数据库 */
const db = uniCloud.database()
const dbCommand = db.command

/** 单维度最多返回的命中条数，避免一次搜索拉取过多数据 */
const SEARCH_LIMIT = 200

/** 摘要片段命中位置前后的字符数 */
const SNIPPET_PADDING = 30

/** 摘要片段最大长度 */
const SNIPPET_MAX_LENGTH = 120

/** 允许的搜索维度 */
const SCOPES = ['all', 'tag', 'name', 'comment', 'content']

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
 * 转义正则特殊字符，防止用户输入被当作正则表达式执行。
 * @param {string} text 原始输入
 * @returns {string} 转义后的字面量
 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 构造包含匹配用的正则（忽略大小写）。
 * @param {string} keyword 关键词
 * @returns {object} db.RegExp 实例
 */
function keywordRegExp(keyword) {
  return db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
}

/**
 * 生成命中摘要片段。
 * @param {string} content 分块提纯文本
 * @param {string} keyword 关键词
 * @returns {string} 摘要
 */
function buildSnippet(content, keyword) {
  const text = typeof content === 'string' ? content : ''
  const index = text.toLowerCase().indexOf(String(keyword).toLowerCase())
  if (index < 0) return text.slice(0, SNIPPET_MAX_LENGTH)
  const start = Math.max(0, index - SNIPPET_PADDING)
  const end = Math.min(text.length, index + String(keyword).length + SNIPPET_PADDING)
  return text.slice(start, end)
}

/**
 * 分批加载当前身份可见的文档（未删除），返回 Map<fileId, doc>。
 * @param {object} ctx 鉴权上下文
 * @param {string[]} fileIds 文档 ID 数组
 * @returns {Promise<Map<string, object>>}
 */
async function loadVisibleFiles(ctx, fileIds) {
  const map = new Map()
  const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : []
  if (ids.length === 0) return map
  const where = { _id: dbCommand.in(ids), is_delete: false }
  if (!ctx.anonymous && ctx.role !== 'admin') where.user_id = ctx.uid
  const res = await mm.collection(TABLE.FILES).where(where).limit(1000).get()
  for (const doc of (res && res.data) || []) {
    if (doc && doc._id) map.set(doc._id, doc)
  }
  return map
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
   * 四维搜索：scope = all | tag | name | comment | content。
   * 只读，结果按 uid + 权限过滤；正文命中随 start_offset / end_offset 供回跳（AC-23）。
   * @param {{keyword:string, scope?:string, page?:number, pageSize?:number}} param
   * @returns {Promise<object>}
   */
  async search(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const keyword = typeof source.keyword === 'string' ? source.keyword.trim() : ''
      if (!keyword) throw bizError(ERR.PARAM_INVALID, '请输入关键词')

      const scope = SCOPES.indexOf(source.scope) !== -1 ? source.scope : 'all'
      const wantAll = scope === 'all'
      const regex = keywordRegExp(keyword)

      const groups = { tag: [], name: [], comment: [], content: [] }

      // 可见文档范围：匿名与管理员不限，普通用户只搜自己名下文档
      const fileWhere = { is_delete: false, type: 'file' }
      if (!ctx.anonymous && ctx.role !== 'admin') fileWhere.user_id = ctx.uid

      // ① 标签
      if (wantAll || scope === 'tag') {
        const res = await mm.collection(TABLE.FILES)
          .where(Object.assign({}, fileWhere, { tags: regex }))
          .field({ content_hash: 0 })
          .limit(SEARCH_LIMIT)
          .get()
        groups.tag = (res && res.data) || []
      }

      // ② 文件名
      if (wantAll || scope === 'name') {
        const res = await mm.collection(TABLE.FILES)
          .where(Object.assign({}, fileWhere, { name: regex }))
          .field({ content_hash: 0 })
          .limit(SEARCH_LIMIT)
          .get()
        groups.name = (res && res.data) || []
      }

      // ③ 批注内容 / 选中原文
      if (wantAll || scope === 'comment') {
        const res = await mm.collection(TABLE.COMMENTS)
          .where(dbCommand.or([{ comment: regex }, { selected_text: regex }]))
          .limit(SEARCH_LIMIT)
          .get()
        const list = (res && res.data) || []
        const visible = await loadVisibleFiles(ctx, list.map(item => item.file_id))
        groups.comment = list
          .filter(item => visible.has(item.file_id))
          .map(item => {
            const doc = visible.get(item.file_id)
            return {
              comment_id: item._id,
              file_id: item.file_id,
              file_name: doc ? doc.name : '',
              comment: item.comment,
              selected_text: item.selected_text,
              status: item.status,
              updated_at: item.updated_at
            }
          })
      }

      // ④ 正文分块（keywords 为数组字段，正则同样可命中元素）
      if (wantAll || scope === 'content') {
        const res = await mm.collection(TABLE.CHUNKS)
          .where(dbCommand.or([{ content: regex }, { keywords: regex }]))
          .limit(SEARCH_LIMIT)
          .get()
        const list = (res && res.data) || []
        const visible = await loadVisibleFiles(ctx, list.map(item => item.file_id))
        const hits = []
        for (const item of list) {
          const doc = visible.get(item.file_id)
          if (!doc) continue
          // 过滤陈旧索引：分块 revision 必须与文件当前 version 一致（C6）
          if (Number(item.revision) !== Number(doc.version)) continue
          hits.push({
            file_id: item.file_id,
            file_name: doc.name,
            chunk_id: item.chunk_id,
            heading: item.heading,
            start_offset: item.start_offset,
            end_offset: item.end_offset,
            revision: item.revision,
            snippet: buildSnippet(item.content, keyword)
          })
        }
        groups.content = hits
      }

      const total = groups.tag.length + groups.name.length + groups.comment.length + groups.content.length
      return { keyword, scope, groups, total }
    })
  }
}
