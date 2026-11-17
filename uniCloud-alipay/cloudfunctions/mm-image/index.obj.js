/**
 * mm-image 云对象：图片登记（幂等）、图片空间列表、临时 URL、图片清理。
 *
 * 关键约定（C7 / Q6 / 架构 3.6）：
 * - 库中只保存云存储 fileID（file_id 唯一索引），展示用临时 URL 由 getTempUrls 现场换取、绝不落库；
 * - register 幂等：同一 fileID 重复登记直接返回已有记录，实现「从已有图片空间插入」不重复上传；
 * - 图片不随文档彻底删除级联清理，需在图片空间单独 remove（先删云存储再删记录）。
 */

'use strict'

const mm = require('mm-common')

const { ERR, TABLE, ANONYMOUS_USER_ID } = mm

/** 云对象内直连数据库 */
const db = uniCloud.database()
const dbCommand = db.command

/** 分页默认值与上限 */
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/** 单次换取临时 URL 的最大数量 */
const TEMP_URL_BATCH = 50

// ----------------------------------------------------------------------------
// 本对象内私有工具
// ----------------------------------------------------------------------------

/**
 * 构造带 errCode 的业务错误。
 * @param {number} code 统一错误码
 * @param {string} msg 中文提示
 * @returns {Error}
 */
function bizError(code, msg, data) {
  const error = new Error(msg || '操作失败')
  error.errCode = Number(code) || ERR.INTERNAL_ERROR
  error.errMsg = error.message
  // 可选的结构化明细（如 4011 被引用图片的文档列表），由 run() 透传给前端
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
    // bizError 可能携带结构化明细（如 4011 的 refs）；不透传的话前端只能拿到错误码
    const data = error && Object.prototype.hasOwnProperty.call(error, 'data') ? error.data : null
    return { errCode: Number(code) || ERR.INTERNAL_ERROR, errMsg: message, data }
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
 * 判断当前身份能否管理该图片记录：匿名 / 管理员 / 上传者本人。
 * @param {object} ctx 鉴权上下文
 * @param {object} record 图片记录
 * @returns {boolean}
 */
function canManage(ctx, record) {
  if (!record) return false
  if (ctx.anonymous) return true
  if (ctx.role === 'admin') return true
  if (record.user_id === ctx.uid) return true
  if (ctx.config && ctx.config.permission_enabled === true) return ctx.canWrite === true
  return false
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
   * 登记图片：客户端 uniCloud.uploadFile 成功后调用；同一 fileID 幂等返回已有记录。
   * 写操作：assertWrite。
   * @param {{file_id:string, name:string, extension:string, size:number, cloud_path:string}} param
   * @returns {Promise<object>}
   */
  async register(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id.trim() : ''
      const name = typeof source.name === 'string' ? source.name.trim() : ''
      const extension = typeof source.extension === 'string' ? source.extension.trim().toLowerCase() : ''
      const cloudPath = typeof source.cloud_path === 'string' ? source.cloud_path.trim() : ''
      const size = Number(source.size)

      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少云存储文件标识')
      if (!name) throw bizError(ERR.PARAM_INVALID, '缺少图片名称')
      if (!extension) throw bizError(ERR.PARAM_INVALID, '缺少图片扩展名')
      if (!cloudPath) throw bizError(ERR.PARAM_INVALID, '缺少云存储路径')

      mm.AuthGuard.assertWrite(ctx, fileId)

      // 幂等：同一 fileID 已登记则直接复用，不重复写入（C7）
      const existingRes = await mm.collection(TABLE.IMAGES).where({ file_id: fileId }).limit(1).get()
      const existing = (existingRes && existingRes.data && existingRes.data[0]) || null
      if (existing) return existing

      const timestamp = mm.now()
      // 新图排最前：取当前最大 order + 1，避免与既有图片并列后掉到末尾。
      // 用户拖动排序后写回的是显式 order，这里只负责「新上传的总在最前」。
      let nextOrder = 0
      try {
        const maxRes = await mm.collection(TABLE.IMAGES)
          .where({ user_id: ctx.uid })
          .orderBy('order', 'desc')
          .limit(1)
          .field({ order: 1 })
          .get()
        const top = (maxRes && maxRes.data && maxRes.data[0]) || null
        nextOrder = (top && Number.isFinite(Number(top.order)) ? Number(top.order) : 0) + 1
      } catch (error) {
        // order 字段尚未建立索引/历史数据缺失时退化为 0，不影响登记
        nextOrder = 0
      }
      const baseDoc = {
        file_id: fileId,
        user_id: ctx.uid,
        name,
        extension,
        size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
        cloud_path: cloudPath,
        ref_count: 0,
        created_at: timestamp,
        updated_at: timestamp
      }
      let addedId = ''
      try {
        let res
        try {
          res = await mm.collection(TABLE.IMAGES).add(Object.assign({ order: nextOrder }, baseDoc))
        } catch (error) {
          // 云端 schema 尚未同步 order 字段时降级写入，图片上传不能被排序字段卡住
          res = await mm.collection(TABLE.IMAGES).add(baseDoc)
        }
        addedId = (res && (res.id || (res.ids && res.ids[0]))) || ''
      } catch (error) {
        throw bizError(ERR.IMAGE_REGISTER_FAILED, '图片登记失败')
      }
      if (!addedId) throw bizError(ERR.IMAGE_REGISTER_FAILED, '图片登记失败')
      return await mm.getDoc(TABLE.IMAGES, addedId)
    })
  },

  /**
   * 图片空间列表（只含 fileID 等元数据，不含临时 URL）。只读。
   * @param {{page?:number, pageSize?:number}} param
   * @returns {Promise<object>}
   */
  async list(param) {
    return run(this, async (ctx) => {
      const { page, pageSize, skip } = pageOf(param)
      const where = {}
      if (!ctx.anonymous && ctx.role !== 'admin') where.user_id = ctx.uid

      const coll = mm.collection(TABLE.IMAGES)
      const counted = await coll.where(where).count()
      // order 越大越靠前；同权重（历史数据 order 均为 0）时按上传时间倒序，保持原观感
      const res = await coll
        .where(where)
        .orderBy('order', 'desc')
        .orderBy('created_at', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get()
      const rows = (res && res.data) || []

      // 引用次数：一次批量取当前页的 refs 再在内存计数，避免逐图 count
      const fileIds = rows.map(item => item && item.file_id).filter(Boolean)
      const refMap = Object.create(null)
      if (fileIds.length > 0) {
        try {
          const refRes = await mm.collection(TABLE.IMAGE_REFS)
            .where({ image_file_id: dbCommand.in(fileIds) })
            .field({ image_file_id: 1 })
            .limit(2000)
            .get()
          for (const ref of (refRes && refRes.data) || []) {
            refMap[ref.image_file_id] = (refMap[ref.image_file_id] || 0) + 1
          }
        } catch (error) {
          // 引用表暂不可用时不阻断图片列表
        }
      }

      // 上传者昵称：一次 in 查询，匿名统一显示「访客」，失败不阻断
      const userIds = Array.from(new Set(rows.map(item => item && item.user_id).filter(Boolean)))
      const nickMap = Object.create(null)
      if (userIds.length > 0) {
        try {
          const userRes = await mm.collection(TABLE.USERS)
            .where({ _id: dbCommand.in(userIds) })
            .field({ _id: 1, nickname: 1, username: 1 })
            .limit(1000)
            .get()
          for (const user of (userRes && userRes.data) || []) {
            nickMap[user._id] = user.nickname || user.username || ''
          }
        } catch (error) {
          // 昵称查询失败不影响列表
        }
      }

      const list = rows.map(item => Object.assign({}, item, {
        ref_count: refMap[item.file_id] || 0,
        uploader_nickname: item.user_id === ANONYMOUS_USER_ID ? '访客' : (nickMap[item.user_id] || '')
      }))

      return {
        list,
        total: (counted && counted.total) || 0,
        page,
        pageSize
      }
    })
  },

  /**
   * 批量写入图片展示顺序（拖动排序后调用）。
   * order 越大越靠前；前端只需把目标页内每张图的新 order 一并提交，
   * 服务端逐条校验归属后写库，避免跨用户篡改。
   * @param {{items:Array<{image_id:string, order:number}>}} param
   * @returns {Promise<{updated:number}>}
   */
  async reorder(param) {
    return run(this, async (ctx) => {
      mm.AuthGuard.assertWrite(ctx, '')

      const source = param || {}
      const raw = Array.isArray(source.items) ? source.items : []
      const items = []
      const seen = new Set()
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const imageId = typeof item.image_id === 'string' ? item.image_id.trim() : ''
        const order = Number(item.order)
        if (!imageId || !Number.isFinite(order) || seen.has(imageId)) continue
        seen.add(imageId)
        items.push({ image_id: imageId, order: Math.trunc(order) })
      }
      if (items.length === 0) throw bizError(ERR.PARAM_INVALID, '缺少图片顺序')
      if (items.length > 200) throw bizError(ERR.PARAM_INVALID, '一次最多调整 200 张图片')

      const ids = items.map(item => item.image_id)
      const found = await mm.collection(TABLE.IMAGES)
        .where({ _id: dbCommand.in(ids) })
        .limit(200)
        .get()
      const recordMap = new Map(((found && found.data) || []).map(row => [row._id, row]))
      for (const id of ids) {
        const record = recordMap.get(id)
        if (!record) throw bizError(ERR.NOT_FOUND, '图片不存在')
        if (!canManage(ctx, record)) throw bizError(ERR.PERMISSION_DENIED, '没有操作权限')
      }

      const timestamp = mm.now()
      let updated = 0
      let lastError = null
      for (const item of items) {
        try {
          const writeRes = await mm.collection(TABLE.IMAGES)
            .doc(item.image_id)
            .update({ order: item.order, updated_at: timestamp })
          updated += Number(writeRes && (writeRes.updated || writeRes.affectedDocs)) || 0
        } catch (error) {
          lastError = error
        }
      }
      // 一条都没写进去说明排序能力不可用（例如云端 schema 未包含 order），
      // 明确报错让前端回滚顺序，不要假装成功。
      if (updated === 0 && lastError) {
        throw bizError(ERR.INTERNAL_ERROR, '排序保存失败，请稍后重试')
      }
      return { updated }
    })
  },

  /**
   * 批量换取临时展示 URL（临时 URL 不落库）。只读；换取失败返回 3003。
   * @param {{file_ids:string[]}} param
   * @returns {Promise<Object<string, string>>} fileID → tempUrl 映射
   */
  async getTempUrls(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileIds = Array.isArray(source.file_ids)
        ? source.file_ids.filter(item => typeof item === 'string' && item).slice(0, TEMP_URL_BATCH)
        : []
      if (fileIds.length === 0) throw bizError(ERR.PARAM_INVALID, '缺少图片标识')

      try {
        const res = await uniCloud.getTempFileURL({ fileList: fileIds })
        const list = (res && res.fileList) || []
        const map = {}
        for (const item of list) {
          if (!item) continue
          const key = item.fileID || item.fileId
          const url = item.tempFileURL || item.tempFileUrl
          if (key && url) map[key] = url
        }
        return map
      } catch (error) {
        throw bizError(ERR.TEMP_URL_FAILED, '图片加载失败，请重试')
      }
    })
  },

  /**
   * 按文档全量对齐图片引用（幂等）：提取正文里的 mm-image://<fileID> 并与引用表做差集。
   * 前端在保存成功后调用；失败静默，下次保存即自愈。
   * @param {{doc_id:string, content?:string, rebuild?:boolean}} param
   * @returns {Promise<{added:number, removed:number, total:number, skipped?:boolean}>}
   */
  async syncRefs(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const docId = typeof source.doc_id === 'string' ? source.doc_id : ''
      if (!docId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')

      const doc = await mm.getDoc(TABLE.FILES, docId)
      if (!doc || doc.is_delete) throw bizError(ERR.NOT_FOUND, '文档不存在')
      if (!canManage(ctx, doc)) throw bizError(ERR.PERMISSION_DENIED, '没有操作权限')

      // 生效正文：优先用调用方传入且与库中 content_hash 一致的内容；
      // 不一致或 rebuild 时回读云存储，避免拿过期内容当引用来源。
      let text = typeof source.content === 'string' ? source.content : ''
      const hashMatched = text && mm.sha256(text) === doc.content_hash
      if (!hashMatched || source.rebuild === true) {
        text = ''
        if (doc.storage_key) {
          try {
            const res = await uniCloud.downloadFile({ fileID: doc.storage_key })
            const buffer = res && res.fileContent ? res.fileContent : null
            if (buffer) text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer)
          } catch (error) {
            // 读不到正文时不做任何删除：宁可保留旧引用，也不要误删
            return { added: 0, removed: 0, total: 0, skipped: true }
          }
        }
        if (!text) return { added: 0, removed: 0, total: 0, skipped: true }
      }

      // 与全项目统一的图片 token 正则保持一致
      const nextSet = new Set()
      const pattern = /mm-image:\/\/([^\s)'"]+)/g
      let matched = pattern.exec(text)
      while (matched) {
        if (matched[1]) nextSet.add(matched[1])
        matched = pattern.exec(text)
      }

      const oldRes = await mm.collection(TABLE.IMAGE_REFS)
        .where({ doc_id: docId })
        .field({ image_file_id: 1 })
        .limit(2000)
        .get()
      const oldSet = new Set(
        ((oldRes && oldRes.data) || []).map(item => item && item.image_file_id).filter(Boolean)
      )

      let added = 0
      for (const fileId of nextSet) {
        if (oldSet.has(fileId)) continue
        try {
          await mm.collection(TABLE.IMAGE_REFS).add({
            image_file_id: fileId,
            doc_id: docId,
            created_at: mm.now()
          })
          added += 1
        } catch (error) {
          // 组合唯一索引兜底重复，单条失败不影响其余
        }
      }

      const toRemove = Array.from(oldSet).filter(fileId => !nextSet.has(fileId))
      let removed = 0
      if (toRemove.length > 0) {
        const res = await mm.collection(TABLE.IMAGE_REFS)
          .where({ doc_id: docId, image_file_id: dbCommand.in(toRemove) })
          .remove()
        removed = (res && res.deleted) || toRemove.length
      }

      return { added, removed, total: nextSet.size }
    })
  },

  /**
   * 清理图片：先在图片空间单独删除云存储文件，再删记录（不随文档级联，Q6）。
   * 写操作：逐条校验归属与写权限；云存储删除失败整单返回 3002 且不删记录。
   * @param {{image_ids:string[]}} param
   * @returns {Promise<{deleted:number, deletedKeys:number}>}
   */
  async remove(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const ids = Array.isArray(source.image_ids) ? source.image_ids.filter(Boolean) : []
      if (ids.length === 0) throw bizError(ERR.PARAM_INVALID, '请选择要清理的图片')

      const res = await mm.collection(TABLE.IMAGES).where({ _id: dbCommand.in(ids) }).get()
      const records = (res && res.data) || []
      if (records.length === 0) throw bizError(ERR.NOT_FOUND, '图片不存在')

      const keys = []
      for (const record of records) {
        if (!canManage(ctx, record)) throw bizError(ERR.PERMISSION_DENIED, '没有操作权限')
        // 权限位二次校验（C5）：权限开启时按 can_write 判定
        mm.AuthGuard.assertWrite(ctx, record.file_id)
        if (record.file_id) keys.push(record.file_id)
      }

      // 被文档引用的图片才提示：未带 force 时返回 4011 与引用明细，
      // 由前端确认后带 force 重试；把「检查 + 删除」收敛在同一方法内避免竞态。
      if (keys.length > 0 && source.force !== true) {
        const refRes = await mm.collection(TABLE.IMAGE_REFS)
          .where({ image_file_id: dbCommand.in(keys) })
          .field({ image_file_id: 1, doc_id: 1 })
          .limit(2000)
          .get()
        const refs = (refRes && refRes.data) || []
        if (refs.length > 0) {
          const refsByImage = Object.create(null)
          const docIds = []
          for (const ref of refs) {
            if (!refsByImage[ref.image_file_id]) refsByImage[ref.image_file_id] = []
            refsByImage[ref.image_file_id].push(ref.doc_id)
            if (docIds.indexOf(ref.doc_id) === -1) docIds.push(ref.doc_id)
          }
          const docNameMap = Object.create(null)
          if (docIds.length > 0) {
            const docRes = await mm.collection(TABLE.FILES)
              .where({ _id: dbCommand.in(docIds) })
              .field({ _id: 1, name: 1 })
              .limit(1000)
              .get()
            for (const doc of (docRes && docRes.data) || []) {
              docNameMap[doc._id] = doc.name || ''
            }
          }
          const detail = records
            .filter(record => refsByImage[record.file_id])
            .map(record => ({
              image_id: record._id,
              file_id: record.file_id,
              ref_count: refsByImage[record.file_id].length,
              // 文档名最多返回 3 篇，前端配「等 N 篇」展示
              docs: refsByImage[record.file_id].slice(0, 3).map(id => ({ name: docNameMap[id] || '未命名文档' }))
            }))
          throw bizError(ERR.IMAGE_IN_USE, '图片被文档引用', { refs: detail })
        }
      }

      // 先删云存储，失败整体报错，记录一律不删
      if (keys.length > 0) {
        let fileList = []
        try {
          const removed = await uniCloud.deleteFile({ fileList: keys })
          fileList = (removed && removed.fileList) || []
        } catch (error) {
          throw bizError(ERR.STORAGE_DELETE_FAILED, '删除失败，请重试')
        }
        const failed = fileList.filter(item => item && item.status !== undefined && item.status !== 0)
        if (failed.length > 0) {
          throw bizError(ERR.STORAGE_DELETE_FAILED, '删除失败，请重试')
        }
      }

      // force 删除时级联清理引用记录：放在云存储删除成功之后，避免半途失败先丢引用
      if (keys.length > 0) {
        await mm.collection(TABLE.IMAGE_REFS).where({ image_file_id: dbCommand.in(keys) }).remove()
      }

      await mm.collection(TABLE.IMAGES).where({ _id: dbCommand.in(ids) }).remove()
      return { deleted: records.length, deletedKeys: keys.length }
    })
  }
}
