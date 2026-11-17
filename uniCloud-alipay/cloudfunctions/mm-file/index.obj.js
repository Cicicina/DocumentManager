/**
 * mm-file 云对象：文件 / 文件夹 CRUD、上传落库、内容读写、保存
 * （C1 版本冲突 + 云存储覆盖写 + C6 索引重建 + C4 批注重定位）、
 * 软删 / 还原 / 彻底删除（C2）、标签、导入导出、索引补偿重建。
 *
 * 统一约定（架构 3.1）：
 * - 客户端传入的 user_id / created_at / updated_at / size / content_hash / version 一律忽略，
 *   身份由 _before 注入的 ctx 决定，元数据由服务端重算（AC-03 / AC-04）；
 * - 所有时间使用 mm-common.now()（服务器时间）；
 * - 六张表 permission 全 false，本云对象内使用 uniCloud.database() 拥有完整权限，属正确做法；
 * - 出参统一 {errCode, errMsg, data}，errCode=2001 为业务返回而非异常。
 */

'use strict'

const mm = require('mm-common')

const { ERR, TABLE, CLOUD_PATH, DEFAULT_EXTENSION } = mm

/** 云对象内直连数据库（云函数环境拥有完整权限，不受 schema permission 限制） */
const db = uniCloud.database()
const dbCommand = db.command

/** 单次批注重定位上限，避免一次保存扫描过多批注 */
const COMMENT_RELOCATE_LIMIT = 1000

/** 递归收集后代的最大深度，防止脏数据形成环导致死循环 */
const SUBTREE_MAX_DEPTH = 20

/** 分页默认值与上限 */
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/** 文件名最大长度 */
const MAX_NAME_LENGTH = 120

/** 标签数量与单个标签长度上限 */
const MAX_TAG_COUNT = 20
const MAX_TAG_LENGTH = 32

// ----------------------------------------------------------------------------
// 本对象内私有工具
// ----------------------------------------------------------------------------

/**
 * 构造带 errCode / data 的业务错误，供 run() 统一转换为 fail 出参。
 * @param {number} code 统一错误码
 * @param {string} msg 中文提示
 * @param {*} data 附带的业务数据（如 2001 冲突包）
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
 * 统一方法包装：确认 _before 鉴权成功，并把所有异常收敛为统一出参。
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
 * 把云存储 fileID 还原成 cloudPath（覆盖写需要）；非 fileID 形态时原样返回。
 * fileID 形如 cloud://服务空间ID/markdown/{uid}/{uuid}.md。
 * @param {string} storageKey 云存储 fileID
 * @returns {string} cloudPath
 */
function resolveCloudPath(storageKey) {
  const key = typeof storageKey === 'string' ? storageKey : ''
  const matched = /^cloud:\/\/[^/]+\/(.+)$/.exec(key)
  return matched ? matched[1] : key
}

/**
 * 保存后回读云存储正文，校验 storage_key 指向的确实是本次写入的内容。
 *
 * 支付宝云「相同 cloudPath 覆盖」在权限/路径异常时可能不生效；若不校验，
 * 数据库 version 已 +1、前端提示「已保存」，重开却读到旧正文，属于静默失败。
 *
 * @param {string} storageKey 云存储 fileID
 * @param {string} expectedHash 本次内容的 sha256
 * @returns {Promise<boolean|null>} true=一致；false=不一致；null=下载不可用无法校验
 */
async function verifyStoredHash(storageKey, expectedHash) {
  if (!storageKey) return false
  try {
    const res = await uniCloud.downloadFile({ fileID: storageKey })
    const buffer = res && res.fileContent ? res.fileContent : null
    if (!buffer) return null
    const content = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer)
    return mm.sha256(content) === expectedHash
  } catch (error) {
    // 下载通道不可用时交回 uploadFile 的成功结果判断，不因校验能力缺失阻断保存
    return null
  }
}

/**
 * 校验并规范化文件名（去掉非法字符与首尾空白）。
 * @param {string} name 原始名称
 * @returns {string} 规范化名称
 */
function normalizeName(name) {
  if (typeof name !== 'string') throw bizError(ERR.PARAM_INVALID, '名称不能为空')
  const value = name.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, MAX_NAME_LENGTH)
  if (!value) throw bizError(ERR.PARAM_INVALID, '名称不能为空')
  return value
}

/**
 * 校验并规范化标签数组（去空白、去重、限长限量）。
 * @param {Array} tags 原始标签
 * @returns {string[]} 规范化标签
 */
function normalizeTags(tags) {
  if (tags === null || tags === undefined) return []
  if (!Array.isArray(tags)) throw bizError(ERR.PARAM_INVALID, '标签格式不正确')
  const seen = new Set()
  const result = []
  for (const item of tags) {
    if (typeof item !== 'string') continue
    const tag = item.trim().slice(0, MAX_TAG_LENGTH)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
    if (result.length >= MAX_TAG_COUNT) break
  }
  return result
}

/**
 * 校验并规范化文件夹图标 {type: preset|custom, value: string}；空值返回 null。
 * @param {object} icon 原始图标
 * @returns {object|null}
 */
function normalizeIcon(icon) {
  if (icon === null || icon === undefined) return null
  if (typeof icon !== 'object') throw bizError(ERR.PARAM_INVALID, '图标格式不正确')
  const type = icon.type === 'custom' ? 'custom' : (icon.type === 'preset' ? 'preset' : '')
  const value = typeof icon.value === 'string' ? icon.value.trim() : ''
  if (!type || !value) throw bizError(ERR.PARAM_INVALID, '图标格式不正确')
  return { type, value }
}

/**
 * 判断当前身份能否访问某文档。
 * 自己的文档始终可访问；管理员全量；权限开启时按可读/可写权限位放行。
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
 * 断言文档可读。
 * @param {object} ctx 鉴权上下文
 * @param {object} doc 文档记录
 * @returns {void}
 */
function assertReadable(ctx, doc) {
  if (!doc || doc.is_delete) throw bizError(ERR.NOT_FOUND, '内容不存在')
  if (!canAccess(ctx, doc, 'read')) throw bizError(ERR.PERMISSION_DENIED, '没有查看权限')
}

/**
 * 断言文档可写：先校验归属，再由 AuthGuard.assertWrite 做权限位二次校验（C5 / AC-20）。
 * @param {object} ctx 鉴权上下文
 * @param {object} doc 文档记录
 * @returns {void}
 */
function assertWritable(ctx, doc) {
  if (!doc || doc.is_delete === undefined) throw bizError(ERR.NOT_FOUND, '内容不存在')
  if (!canAccess(ctx, doc, 'write')) throw bizError(ERR.PERMISSION_DENIED, '没有操作权限')
  mm.AuthGuard.assertWrite(ctx, doc._id)
}

/**
 * 断言目标父目录存在且可写；空 parent_id 表示根目录。
 * @param {object} ctx 鉴权上下文
 * @param {string} parentId 父目录 ID
 * @returns {Promise<void>}
 */
async function assertParentFolder(ctx, parentId) {
  if (!parentId) return
  const parent = await mm.getDoc(TABLE.FILES, parentId)
  if (!parent || parent.is_delete || parent.type !== 'folder') {
    throw bizError(ERR.NOT_FOUND, '目标目录不存在')
  }
  if (!canAccess(ctx, parent, 'write')) throw bizError(ERR.PERMISSION_DENIED, '没有操作权限')
}

/**
 * 取同目录下未被删除的已有名称，用于 genUniqueName 去重。
 * @param {string} parentId 父目录 ID
 * @param {string} userId 所属用户
 * @param {string} excludeId 排除的记录 ID（改名/移动时排除自身）
 * @returns {Promise<string[]>}
 */
async function existingNames(parentId, userId, excludeId) {
  const where = { parent_id: parentId || '', is_delete: false }
  if (userId) where.user_id = userId
  const res = await mm.collection(TABLE.FILES)
    .where(where)
    .field({ _id: 1, name: 1 })
    .limit(1000)
    .get()
  const list = (res && res.data) || []
  return list
    .filter(item => item && item._id !== excludeId && item.name)
    .map(item => item.name)
}

/**
 * 读取文档 md 原文。
 * 优先云函数端 downloadFile；不可用时回退临时 URL（content 为空，由前端自行下载）。
 * @param {object} doc 文档记录
 * @returns {Promise<{content:string, tempUrl:string}>}
 */
async function readDocContent(doc) {
  const key = doc && doc.storage_key ? doc.storage_key : ''
  if (!key) return { content: '', tempUrl: '', source: 'none', error: '文档缺少云存储路径（storage_key 为空）' }

  let downloadError = ''
  try {
    const res = await uniCloud.downloadFile({ fileID: key })
    const buffer = res && res.fileContent ? res.fileContent : null
    if (buffer) {
      const content = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer)
      return {
        content,
        tempUrl: '',
        source: 'download',
        error: content ? '' : '云存储文件内容为空（上传时可能未写入正文）'
      }
    }
    downloadError = 'downloadFile 未返回 fileContent'
  } catch (error) {
    // 下载不可用时降级到临时 URL，并保留失败原因供前端提示
    downloadError = (error && (error.message || error.errMsg)) || 'downloadFile 调用失败'
  }

  try {
    const res = await uniCloud.getTempFileURL({ fileList: [key] })
    const item = res && res.fileList ? res.fileList[0] : null
    const tempUrl = (item && item.tempFileURL) || ''
    return {
      content: '',
      tempUrl,
      source: 'tempUrl',
      error: tempUrl ? '' : downloadError || '临时下载链接为空'
    }
  } catch (error) {
    return {
      content: '',
      tempUrl: '',
      source: 'none',
      error: downloadError || (error && (error.message || error.errMsg)) || '云存储读取失败'
    }
  }
}

/**
 * 递归收集文件夹的全部后代 ID（含传入的根节点本身）。
 * @param {string[]} rootIds 根节点 ID 数组
 * @param {string} userId 用户过滤，空串表示不过滤（匿名/管理员）
 * @returns {Promise<string[]>}
 */
async function collectSubtreeIds(rootIds, userId) {
  const roots = Array.isArray(rootIds) ? rootIds.filter(Boolean) : []
  if (roots.length === 0) return []
  const all = new Set(roots)
  let frontier = roots.slice()
  for (let depth = 0; depth < SUBTREE_MAX_DEPTH && frontier.length > 0; depth++) {
    const where = { parent_id: dbCommand.in(frontier) }
    if (userId) where.user_id = userId
    const res = await mm.collection(TABLE.FILES).where(where).field({ _id: 1 }).limit(1000).get()
    const next = []
    for (const item of (res && res.data) || []) {
      if (!item || !item._id || all.has(item._id)) continue
      all.add(item._id)
      next.push(item._id)
    }
    frontier = next
  }
  return Array.from(all)
}

/**
 * 按 file_id 先删后插重建索引（C6），revision 与文件 version 对齐。
 * @param {string} fileId 文档 ID
 * @param {string} userId 所属用户
 * @param {string} content md 原文
 * @param {number} version 保存后的文件 version
 * @returns {Promise<number>} 新分块数量
 */
async function rebuildChunks(fileId, userId, content, version) {
  try {
    const plainText = mm.stripMarkdown(content)
    await mm.removeByFileId(TABLE.CHUNKS, fileId)
    const chunks = mm.buildChunks(plainText, content, version, fileId, userId)
    await mm.batchAdd(TABLE.CHUNKS, chunks)
    return chunks.length
  } catch (error) {
    throw bizError(ERR.INDEX_REBUILD_FAILED, '索引重建失败', { file_id: fileId })
  }
}

/**
 * 对文档下 status=active 的批注执行四级重定位（C4）：
 * 命中更新 start_offset / end_offset / status，无法定位置 orphaned，禁止误绑。
 * @param {string} fileId 文档 ID
 * @param {string} plainText 最新提纯纯文本
 * @returns {Promise<{active:number, orphaned:number}>}
 */
async function relocateFileComments(fileId, plainText) {
  const res = await mm.collection(TABLE.COMMENTS)
    .where({ file_id: fileId, status: 'active' })
    .limit(COMMENT_RELOCATE_LIMIT)
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
}

// ----------------------------------------------------------------------------
// 云对象
// ----------------------------------------------------------------------------

module.exports = {
  /**
   * 前置拦截：解析 token / 匿名身份 → 注入 ctx。
   * 鉴权失败不在 _before 抛出（云对象抛错会返回 SYS_ERR 而非统一错误码），
   * 改为记录 authError，由 run() 在方法入口统一返回 fail()。
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
   * 取当前用户全部未删除的文件夹节点（含 icon）。
   * 返回扁平数组，由前端按 parent_id 组树；只读，不校验写权限。
   * @param {object} param 空对象
   * @returns {Promise<object>}
   */
  async listTree(param) {
    return run(this, async (ctx) => {
      const where = { type: 'folder', is_delete: false }
      if (!ctx.anonymous && ctx.role !== 'admin') where.user_id = ctx.uid
      const res = await mm.collection(TABLE.FILES)
        .where(where)
        // 必须返回 type：前端 moveTargets 用 `source.type === 'folder'` 判定
        // 「不能移动到自己的子目录」是否置灰；缺该字段会让拦截恒为 false
        //（服务端 4003 仍兜底，但交互与文案失效，QA R3 已锁红灯）
        .field({ _id: 1, type: 1, user_id: 1, parent_id: 1, name: 1, icon: 1, created_at: 1, updated_at: 1 })
        .orderBy('name', 'asc')
        .limit(1000)
        .get()
      return (res && res.data) || []
    })
  },

  /**
   * 取指定目录下的文档列表（不含回收站）。
   * 只读；按 uid + 权限过滤。
   * @param {{parent_id?:string, page?:number, pageSize?:number, orderBy?:string}} param
   * @returns {Promise<object>}
   */
  async listFiles(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const parentId = typeof source.parent_id === 'string' ? source.parent_id : ''
      const { page, pageSize, skip } = pageOf(source)
      const where = { type: 'file', is_delete: false, parent_id: parentId }
      if (!ctx.anonymous && ctx.role !== 'admin') where.user_id = ctx.uid
      const orderField = source.orderBy === 'name' ? 'name' : (source.orderBy === 'size' ? 'size' : 'updated_at')
      const orderDirection = source.orderBy === 'name' ? 'asc' : 'desc'

      const coll = mm.collection(TABLE.FILES)
      const counted = await coll.where(where).count()
      const res = await coll
        .where(where)
        .field({ content_hash: 0 })
        .orderBy(orderField, orderDirection)
        .skip(skip)
        .limit(pageSize)
        .get()
      return {
        list: (res && res.data) || [],
        total: (counted && counted.total) || 0,
        page,
        pageSize
      }
    })
  },

  /**
   * 新建文件夹（同目录重名自动追加 -copyN）。
   * 写操作：assertWrite。
   * @param {{parent_id?:string, name:string, icon?:object}} param
   * @returns {Promise<object>}
   */
  async createFolder(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const name = normalizeName(source.name)
      const parentId = typeof source.parent_id === 'string' ? source.parent_id : ''
      const icon = normalizeIcon(source.icon)
      await assertParentFolder(ctx, parentId)

      const names = await existingNames(parentId, ctx.uid)
      const finalName = mm.genUniqueName(name, names)
      const timestamp = mm.now()

      let addedId = ''
      try {
        const record = {
          type: 'folder',
          user_id: ctx.uid,
          parent_id: parentId,
          name: finalName,
          extension: '',
          storage_key: '',
          size: 0,
          content_hash: '',
          tags: [],
          version: 0,
          is_delete: false,
          created_at: timestamp,
          updated_at: timestamp
        }
        // 未选图标时不落 icon 字段：写入 null 会让后续 updateIcon 报
        // "Cannot create field 'type' in element {icon: null}"（见 updateIcon 注释）
        if (icon) record.icon = icon
        const res = await mm.collection(TABLE.FILES).add(record)
        addedId = (res && (res.id || (res.ids && res.ids[0]))) || ''
      } catch (error) {
        throw bizError(ERR.FOLDER_CREATE_FAILED, '文件夹创建失败')
      }
      if (!addedId) throw bizError(ERR.FOLDER_CREATE_FAILED, '文件夹创建失败')
      return await mm.getDoc(TABLE.FILES, addedId)
    })
  },

  /**
   * 客户端直传云存储后登记文档元数据（version=0），并顺带建立 revision=0 索引。
   * 写操作：assertWrite；size / content_hash / 时间均由服务端重算。
   * @param {{name:string, parent_id?:string, storage_key:string, content:string, tags?:string[]}} param
   * @returns {Promise<object>}
   */
  async registerUpload(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const name = normalizeName(source.name)
      const storageKey = typeof source.storage_key === 'string' ? source.storage_key.trim() : ''
      if (!storageKey) throw bizError(ERR.PARAM_INVALID, '缺少云存储文件标识')
      const content = typeof source.content === 'string' ? source.content : ''
      const parentId = typeof source.parent_id === 'string' ? source.parent_id : ''
      const tags = normalizeTags(source.tags)
      await assertParentFolder(ctx, parentId)

      const names = await existingNames(parentId, ctx.uid)
      const finalName = mm.genUniqueName(name, names)
      const timestamp = mm.now()

      let addedId = ''
      try {
        const res = await mm.collection(TABLE.FILES).add({
          type: 'file',
          user_id: ctx.uid,
          parent_id: parentId,
          name: finalName,
          extension: DEFAULT_EXTENSION,
          storage_key: storageKey,
          size: mm.byteSize(content),
          content_hash: mm.sha256(content),
          tags,
          icon: null,
          version: 0,
          is_delete: false,
          created_at: timestamp,
          updated_at: timestamp
        })
        addedId = (res && (res.id || (res.ids && res.ids[0]))) || ''
      } catch (error) {
        throw bizError(ERR.STORAGE_UPLOAD_FAILED, '登记失败，请重试')
      }
      if (!addedId) throw bizError(ERR.STORAGE_UPLOAD_FAILED, '登记失败，请重试')

      // 索引失败不阻断落库，前端可在需要时调用 rebuildIndex 补偿（R26）
      let indexed = 0
      try {
        indexed = await rebuildChunks(addedId, ctx.uid, content, 0)
      } catch (error) {
        indexed = 0
      }
      const doc = await mm.getDoc(TABLE.FILES, addedId)
      return Object.assign({}, doc, { indexed })
    })
  },

  /**
   * 读取文档记录与 md 原文。只读，需可读权限。
   * 云函数端 downloadFile 不可用时返回 tempUrl 供前端自行下载。
   * @param {{file_id:string}} param
   * @returns {Promise<{doc:object, content:string, tempUrl:string}>}
   */
  async getContent(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertReadable(ctx, doc)
      if (doc.type !== 'file') throw bizError(ERR.PARAM_INVALID, '该记录不是文档')
      const { content, tempUrl, source: readSource, error: readError } = await readDocContent(doc)
      return { doc, content, tempUrl, source: readSource, error: readError }
    })
  },

  /**
   * 保存文档：C1 版本冲突 → 云存储覆盖写 → 元数据重算 → C6 索引重建 → C4 批注重定位。
   * 写操作：assertWrite(file_id)；created_at 绝不出现在 update 字段中。
   * @param {{file_id:string, content:string, base_version:number, force?:boolean}} param
   * @returns {Promise<object>}
   */
  async saveContent(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      if (typeof source.content !== 'string') throw bizError(ERR.PARAM_INVALID, '内容格式不正确')
      const content = source.content

      const doc = await mm.getDoc(TABLE.FILES, fileId)
      if (!doc || doc.is_delete) throw bizError(ERR.NOT_FOUND, '内容不存在')
      if (doc.type !== 'file') throw bizError(ERR.PARAM_INVALID, '该记录不是文档')
      assertWritable(ctx, doc)

      const cloudVersion = Number(doc.version) || 0
      const baseVersion = Number(source.base_version) || 0
      const force = source.force === true

      // C1：cloudVersion > baseVersion 数学上等价于 cloudVersion >= baseVersion + 1（PRD 口径）。
      // 首次保存 cloudVersion=0、baseVersion=0 时 0 > 0 为假，不冲突；
      // 他人已保存使 cloudVersion=1 时 1 > 0 为真，即冲突（AC-10）。
      if (cloudVersion > baseVersion && !force) {
        const conflict = await readDocContent(doc)
        throw bizError(ERR.VERSION_CONFLICT, '云端有更新版本', {
          cloudVersion,
          cloudContent: conflict.content,
          cloudTempUrl: conflict.tempUrl,
          cloudUpdatedAt: doc.updated_at
        })
      }

      // 云存储覆盖写：复用原 cloudPath 覆盖同一对象，fileID 变化时同步 storage_key（U3）。
      // storage_key 缺失时绝不能只更新数据库元数据后返回成功——那样前端提示「已保存」，
      // 重开却从空的 storage_key 读不到正文，属于静默失败，必须显式报错。
      const cloudPath = resolveCloudPath(doc.storage_key)
      if (!cloudPath) {
        throw bizError(ERR.STORAGE_UPLOAD_FAILED, '保存失败，请重试')
      }
      let storageKey = doc.storage_key
      try {
        const uploaded = await uniCloud.uploadFile({
          cloudPath,
          fileContent: Buffer.from(content, 'utf8')
        })
        const nextKey = uploaded && (uploaded.fileID || uploaded.fileId)
        if (nextKey) storageKey = nextKey
      } catch (error) {
        throw bizError(ERR.STORAGE_UPLOAD_FAILED, '保存失败，请重试')
      }

      const contentHash = mm.sha256(content)
      // 覆盖写后回读校验：只有确认新正文真的落到 storage_key 指向的对象，才算保存成功。
      // downloadFile 通道不可用时（返回 null）不改判定，沿用 uploadFile 的成功结果。
      let verified = await verifyStoredHash(storageKey, contentHash)
      // 第一次为 null 表示 downloadFile 通道本身不可用，沿用 uploadFile 结果降级放行；
      // 只有第一次明确为 false（通道可用、内容不一致）才需要换路径重写。
      if (verified === false) {
        // 同一 cloudPath 覆盖未真正生效（如支付宝云无覆盖权限）：改写带版本号的
        // 全新路径并回写 fileID，绕开覆盖限制。这是换写入目标而非延时重试。
        const versionedPath = `${cloudPath}.v${cloudVersion + 1}`
        try {
          const replaced = await uniCloud.uploadFile({
            cloudPath: versionedPath,
            fileContent: Buffer.from(content, 'utf8')
          })
          const replaceKey = replaced && (replaced.fileID || replaced.fileId)
          if (replaceKey) {
            storageKey = replaceKey
            const secondVerified = await verifyStoredHash(storageKey, contentHash)
            // 第一次校验已证明 downloadFile 通道可用，此时第二次的 null 只可能是
            // 新路径文件根本没写进去（假成功）。必须按失败处理，否则会写库推进
            // version、重开却读不到正文——与用户报告的 bug 同源。
            verified = secondVerified === true
          }
        } catch (error) {
          verified = false
        }
      }
      if (verified === false) {
        throw bizError(ERR.STORAGE_UPLOAD_FAILED, '保存失败，请重试')
      }

      const newVersion = cloudVersion + 1
      const size = mm.byteSize(content)

      // created_at 不在更新字段中（C3 / AC-03）
      await mm.collection(TABLE.FILES).doc(fileId).update({
        storage_key: storageKey,
        size,
        content_hash: contentHash,
        version: newVersion,
        updated_at: mm.now()
      })

      // C6：按 file_id 先删后插重建索引，revision = 新 version
      let indexed = 0
      try {
        indexed = await rebuildChunks(fileId, doc.user_id, content, newVersion)
      } catch (error) {
        indexed = 0
      }

      // C4：同一次保存内对 active 批注四级重定位，失败不阻断保存
      let relocated = { active: 0, orphaned: 0 }
      try {
        relocated = await relocateFileComments(fileId, mm.stripMarkdown(content))
      } catch (error) {
        relocated = { active: 0, orphaned: 0 }
      }

      return {
        version: newVersion,
        updated_at: mm.nowDate(),
        size,
        content_hash: contentHash,
        indexed,
        relocated
      }
    })
  },

  /**
   * 改名（同目录撞名追加 -copyN）。写操作：assertWrite(file_id)。
   * @param {{file_id:string, name:string}} param
   * @returns {Promise<object>}
   */
  async rename(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const name = normalizeName(source.name)
      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertWritable(ctx, doc)

      const names = await existingNames(doc.parent_id, doc.user_id, fileId)
      const finalName = mm.genUniqueName(name, names)
      await mm.collection(TABLE.FILES).doc(fileId).update({
        name: finalName,
        updated_at: mm.now()
      })
      return await mm.getDoc(TABLE.FILES, fileId)
    })
  },

  /**
   * 移动到目标目录（禁止移入自身子树，否则 4003）。写操作：assertWrite(file_id)。
   * @param {{file_id:string, parent_id?:string}} param
   * @returns {Promise<object>}
   */
  async move(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const targetParentId = typeof source.parent_id === 'string' ? source.parent_id : ''
      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertWritable(ctx, doc)

      if (targetParentId === fileId) throw bizError(ERR.MOVE_INVALID, '不能移入自身目录')
      if (targetParentId) {
        await assertParentFolder(ctx, targetParentId)
        // 从目标目录向上回溯 parent_id 链，命中自身即为移入子树
        let cursor = targetParentId
        for (let depth = 0; depth < SUBTREE_MAX_DEPTH && cursor; depth++) {
          if (cursor === fileId) throw bizError(ERR.MOVE_INVALID, '不能移入自身目录')
          const parent = await mm.getDoc(TABLE.FILES, cursor)
          cursor = parent ? parent.parent_id : ''
        }
      }

      const names = await existingNames(targetParentId, doc.user_id, fileId)
      const finalName = mm.genUniqueName(doc.name, names)
      await mm.collection(TABLE.FILES).doc(fileId).update({
        parent_id: targetParentId,
        name: finalName,
        updated_at: mm.now()
      })
      return await mm.getDoc(TABLE.FILES, fileId)
    })
  },

  /**
   * 更新文件夹图标（preset 预制 / custom 云存储 fileID）。写操作：assertWrite(folder_id)。
   * @param {{folder_id?:string, file_id?:string, icon:object}} param
   * @returns {Promise<object>}
   */
  async updateIcon(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const folderId = typeof source.folder_id === 'string' && source.folder_id
        ? source.folder_id
        : (typeof source.file_id === 'string' ? source.file_id : '')
      if (!folderId) throw bizError(ERR.PARAM_INVALID, '缺少文件夹 ID')
      const doc = await mm.getDoc(TABLE.FILES, folderId)
      assertWritable(ctx, doc)
      if (doc.type !== 'folder') throw bizError(ERR.PARAM_INVALID, '只有文件夹可设置图标')
      const icon = normalizeIcon(source.icon)
      // 必须用 set / remove 指令整体替换 icon：直接传普通对象会被 uniCloud 展开成
      // icon.type / icon.value 点号路径，而历史文件夹记录里 icon 常为 null（建文件夹时写入），
      // MongoDB 无法在 null 上创建子字段，会抛
      // "Cannot create field 'type' in element {icon: null}"（errCode 100104）。
      const patch = { updated_at: mm.now() }
      if (icon) patch.icon = dbCommand.set(icon)
      else patch.icon = dbCommand.remove()
      await mm.collection(TABLE.FILES).doc(folderId).update(patch)
      return await mm.getDoc(TABLE.FILES, folderId)
    })
  },

  /**
   * 设置标签（去重、限长限量）。写操作：assertWrite(file_id)。
   * @param {{file_id:string, tags:string[]}} param
   * @returns {Promise<object>}
   */
  async setTags(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertWritable(ctx, doc)
      const tags = normalizeTags(source.tags)
      await mm.collection(TABLE.FILES).doc(fileId).update({
        tags,
        updated_at: mm.now()
      })
      return await mm.getDoc(TABLE.FILES, fileId)
    })
  },

  /**
   * 普通删除：递归处理文件夹后代，仅置 is_delete=true 并记录 deleted_at，
   * 不动云存储源文件（C2）。写操作：逐个 assertWrite。
   * @param {{file_ids:string[]}} param
   * @returns {Promise<{count:number}>}
   */
  async softDelete(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const ids = Array.isArray(source.file_ids) ? source.file_ids.filter(Boolean) : []
      if (ids.length === 0) throw bizError(ERR.PARAM_INVALID, '请选择要删除的内容')

      const scopeUserId = ctx.anonymous || ctx.role === 'admin' ? '' : ctx.uid
      const allIds = await collectSubtreeIds(ids, scopeUserId)
      const res = await mm.collection(TABLE.FILES).where({ _id: dbCommand.in(allIds) }).get()
      const docs = (res && res.data) || []
      for (const doc of docs) assertWritable(ctx, doc)

      const timestamp = mm.now()
      await mm.collection(TABLE.FILES).where({ _id: dbCommand.in(allIds) }).update({
        is_delete: true,
        deleted_at: timestamp,
        updated_at: timestamp
      })
      return { count: allIds.length }
    })
  },

  /**
   * 回收站列表（is_delete=true），按 deleted_at 倒序。只读。
   * @param {{page?:number, pageSize?:number}} param
   * @returns {Promise<object>}
   */
  async listTrash(param) {
    return run(this, async (ctx) => {
      const { page, pageSize, skip } = pageOf(param)
      const where = { is_delete: true }
      if (!ctx.anonymous && ctx.role !== 'admin') where.user_id = ctx.uid

      const coll = mm.collection(TABLE.FILES)
      const counted = await coll.where(where).count()
      const res = await coll
        .where(where)
        .field({ content_hash: 0 })
        .orderBy('deleted_at', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get()
      return {
        list: (res && res.data) || [],
        total: (counted && counted.total) || 0,
        page,
        pageSize
      }
    })
  },

  /**
   * 从回收站还原（递归还原文件夹后代；撞名追加 -copyN）。
   * 写操作：逐个 assertWrite；deleted_at 显式置 null。
   * @param {{file_ids:string[]}} param
   * @returns {Promise<{count:number, renamed:object[]}>}
   */
  async restore(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const ids = Array.isArray(source.file_ids) ? source.file_ids.filter(Boolean) : []
      if (ids.length === 0) throw bizError(ERR.PARAM_INVALID, '请选择要还原的内容')

      const scopeUserId = ctx.anonymous || ctx.role === 'admin' ? '' : ctx.uid
      const allIds = await collectSubtreeIds(ids, scopeUserId)
      const res = await mm.collection(TABLE.FILES).where({ _id: dbCommand.in(allIds) }).get()
      const docs = (res && res.data) || []

      const renamed = []
      for (const doc of docs) {
        assertWritable(ctx, doc)
        const names = await existingNames(doc.parent_id, doc.user_id, doc._id)
        const finalName = mm.genUniqueName(doc.name, names)
        await mm.collection(TABLE.FILES).doc(doc._id).update({
          is_delete: false,
          deleted_at: null,
          name: finalName,
          updated_at: mm.now()
        })
        if (finalName !== doc.name) renamed.push({ _id: doc._id, name: finalName })
      }
      return { count: docs.length, renamed }
    })
  },

  /**
   * 彻底删除（C2）：递归收集后代 → 先删云存储 → 失败整单报错且不删记录
   * → 级联删批注与索引分块 → 删文件记录。图片资源不级联删除（Q6）。
   * 写操作：逐个 assertWrite；非管理员不得彻底删除他人文档。
   * @param {{file_ids:string[]}} param
   * @returns {Promise<{deletedFiles:number, deletedKeys:number}>}
   */
  async purgeDelete(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const ids = Array.isArray(source.file_ids) ? source.file_ids.filter(Boolean) : []
      if (ids.length === 0) throw bizError(ERR.PARAM_INVALID, '请选择要彻底删除的内容')

      const scopeUserId = ctx.anonymous || ctx.role === 'admin' ? '' : ctx.uid
      const allIds = await collectSubtreeIds(ids, scopeUserId)
      const res = await mm.collection(TABLE.FILES).where({ _id: dbCommand.in(allIds) }).get()
      const docs = (res && res.data) || []

      for (const doc of docs) {
        assertWritable(ctx, doc)
        if (!ctx.anonymous && ctx.role !== 'admin' && doc.user_id !== ctx.uid) {
          throw bizError(ERR.PERMISSION_DENIED, '没有操作权限')
        }
      }

      // 文件夹没有 storage_key，仅文档需要删云存储
      const keys = docs
        .map(doc => doc.storage_key)
        .filter(key => typeof key === 'string' && key !== '')

      // 先删云存储：任一步失败整体报错，记录一律不删，避免孤儿记录 / 孤儿文件
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

      // 级联删除子记录（按 file_id 精确范围）
      for (const id of allIds) {
        await mm.collection(TABLE.COMMENTS).where({ file_id: id }).remove()
        await mm.collection(TABLE.CHUNKS).where({ file_id: id }).remove()
      }
      // 回收图片引用：文档彻底删除后，它名下的引用记录不应继续占用其它文档的图片
      await mm.collection(TABLE.IMAGE_REFS).where({ doc_id: dbCommand.in(allIds) }).remove()
      await mm.collection(TABLE.FILES).where({ _id: dbCommand.in(allIds) }).remove()

      return { deletedFiles: allIds.length, deletedKeys: keys.length }
    })
  },

  /**
   * 导出 md 原文。只读，需可读权限。
   * @param {{file_id:string}} param
   * @returns {Promise<{name:string, content:string, content_hash:string, tempUrl:string}>}
   */
  async exportFile(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertReadable(ctx, doc)
      if (doc.type !== 'file') throw bizError(ERR.PARAM_INVALID, '该记录不是文档')
      const { content, tempUrl } = await readDocContent(doc)
      return {
        name: doc.name,
        content,
        content_hash: doc.content_hash,
        tempUrl
      }
    })
  },

  /**
   * 导入 md 原文：由云对象上传云存储后落库，并建立 revision=0 索引。
   * 写操作：assertWrite；重名追加 -copyN。
   * @param {{name:string, parent_id?:string, content:string, tags?:string[]}} param
   * @returns {Promise<object>}
   */
  async importFile(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const name = normalizeName(source.name || '未命名.md')
      const content = typeof source.content === 'string' ? source.content : ''
      const parentId = typeof source.parent_id === 'string' ? source.parent_id : ''
      const tags = normalizeTags(source.tags)
      await assertParentFolder(ctx, parentId)

      const names = await existingNames(parentId, ctx.uid)
      const finalName = mm.genUniqueName(name, names)

      const cloudPath = CLOUD_PATH.markdown(ctx.uid).replace('{uuid}', mm.genUuid())
      let storageKey = ''
      try {
        const uploaded = await uniCloud.uploadFile({
          cloudPath,
          fileContent: Buffer.from(content, 'utf8')
        })
        storageKey = (uploaded && uploaded.fileID) || ''
      } catch (error) {
        throw bizError(ERR.STORAGE_UPLOAD_FAILED, '导入失败，请重试')
      }
      if (!storageKey) throw bizError(ERR.STORAGE_UPLOAD_FAILED, '导入失败，请重试')

      const timestamp = mm.now()
      let addedId = ''
      try {
        const res = await mm.collection(TABLE.FILES).add({
          type: 'file',
          user_id: ctx.uid,
          parent_id: parentId,
          name: finalName,
          extension: DEFAULT_EXTENSION,
          storage_key: storageKey,
          size: mm.byteSize(content),
          content_hash: mm.sha256(content),
          tags,
          icon: null,
          version: 0,
          is_delete: false,
          created_at: timestamp,
          updated_at: timestamp
        })
        addedId = (res && (res.id || (res.ids && res.ids[0]))) || ''
      } catch (error) {
        // 云存储已上传但落库失败时会产生孤立文件，由用户在云存储控制台清理
        throw bizError(ERR.INTERNAL_ERROR, '导入失败，请重试')
      }
      if (!addedId) throw bizError(ERR.INTERNAL_ERROR, '导入失败，请重试')

      let indexed = 0
      try {
        indexed = await rebuildChunks(addedId, ctx.uid, content, 0)
      } catch (error) {
        indexed = 0
      }
      const doc = await mm.getDoc(TABLE.FILES, addedId)
      return Object.assign({}, doc, { indexed })
    })
  },

  /**
   * 索引补偿重建（R26：保存时索引失败可重跑）。写操作：assertWrite(file_id)。
   * @param {{file_id:string}} param
   * @returns {Promise<{chunks:number}>}
   */
  async rebuildIndex(param) {
    return run(this, async (ctx) => {
      const source = param || {}
      const fileId = typeof source.file_id === 'string' ? source.file_id : ''
      if (!fileId) throw bizError(ERR.PARAM_INVALID, '缺少文档 ID')
      const doc = await mm.getDoc(TABLE.FILES, fileId)
      assertWritable(ctx, doc)
      if (doc.type !== 'file') throw bizError(ERR.PARAM_INVALID, '该记录不是文档')

      const { content, tempUrl } = await readDocContent(doc)
      if (!content) {
        throw bizError(ERR.INDEX_REBUILD_FAILED, '索引重建失败', { file_id: fileId, tempUrl })
      }
      const chunks = await rebuildChunks(fileId, doc.user_id, content, Number(doc.version) || 0)
      return { chunks }
    })
  }
}
