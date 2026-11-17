/**
 * uniCloud 运行时的最小内存Mock（仅供本地 node:test 单测使用，不参与 H5 编译）。
 *
 * 覆盖云对象实际用到的全部 API 子集：
 * - uniCloud.database() → collection().where/field/orderBy/skip/limit/get/count/add/doc
 * - db.command.in / db.command.or、db.RegExp、db.serverDate
 * - uniCloud.uploadFile / downloadFile / deleteFile / getTempFileURL
 *
 * 同时记录全部写操作与调用顺序（log.order），用于断言「先删云存储再删记录」等顺序要求。
 */

'use strict'

/** 深拷贝（保留 Date），避免测试读到内部引用 */
function clone(value) {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return new Date(value.getTime())
  if (Array.isArray(value)) return value.map(clone)
  if (typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value)) result[key] = clone(value[key])
    return result
  }
  return value
}

/** 是否为查询操作符标记 */
function isOp(value) {
  return value !== null && typeof value === 'object' && typeof value.__op === 'string'
}

/**
 * 单值匹配。
 * @param {*} actual 文档字段值
 * @param {*} expect 查询条件值
 * @returns {boolean}
 */
function matchesValue(actual, expect) {
  if (isOp(expect)) {
    if (expect.__op === 'in') return (expect.value || []).includes(actual)
    if (expect.__op === 'nin') return !(expect.value || []).includes(actual)
    if (expect.__op === 'regexp') {
      const re = new RegExp(expect.regexp, expect.options || '')
      if (Array.isArray(actual)) return actual.some(item => re.test(String(item)))
      return re.test(actual === undefined || actual === null ? '' : String(actual))
    }
    return false
  }
  if (Array.isArray(actual)) return actual.includes(expect)
  return actual === expect
}

/**
 * 条件匹配（支持顶层 $or / $and 与字段级操作符）。
 * @param {object} doc 文档
 * @param {object} cond 查询条件
 * @returns {boolean}
 */
function matchesWhere(doc, cond) {
  if (!cond || typeof cond !== 'object') return true
  if (isOp(cond)) {
    if (cond.__op === 'or') return (cond.value || []).some(item => matchesWhere(doc, item))
    if (cond.__op === 'and') return (cond.value || []).every(item => matchesWhere(doc, item))
    return false
  }
  return Object.keys(cond).every(key => {
    const expect = cond[key]
    if (isOp(expect) && expect.__op === 'or') return (expect.value || []).some(item => matchesWhere(doc, item))
    if (isOp(expect) && expect.__op === 'and') return (expect.value || []).every(item => matchesWhere(doc, item))
    return matchesValue(doc[key], expect)
  })
}

/**
 * 字段投影（支持 {a:1} 白名单与 {a:0} 黑名单，_id 默认保留）。
 * @param {object} doc 文档
 * @param {object|null} proj 投影
 * @returns {object}
 */
function project(doc, proj) {
    if (!proj) return clone(doc)
    const keys = Object.keys(proj)
    const includeMode = keys.some(key => proj[key] === 1 || proj[key] === true)
    const result = {}
    if (includeMode) {
      result._id = doc._id
      for (const key of keys) {
        if (proj[key] === 1 || proj[key] === true) result[key] = clone(doc[key])
      }
      return result
    }
    for (const key of Object.keys(doc)) {
      if (proj[key] === 0 || proj[key] === false) continue
      result[key] = clone(doc[key])
    }
    return result
}

/** 取排序比较值 */
function sortValue(value) {
  if (value instanceof Date) return value.getTime()
  if (value === null || value === undefined) return ''
  return value
}

/**
 * 创建 uniCloud Mock。
 * @param {object} [options] 初始选项
 * @returns {object} mock 实例（可直接赋给 globalThis.uniCloud）
 */
function createMockUniCloud(options) {
  const config = options || {}

  const tables = new Map()
  const storage = new Map(Object.entries(config.storage || {}))
  const log = {
    /** 按调用顺序记录，如 {type:'deleteFile'} / {type:'remove', table} */
    order: [],
    updates: [],
    adds: [],
    removes: [],
    uploads: [],
    deletes: [],
    downloads: [],
    tempUrls: []
  }
  const behavior = {
    /** uploadFile 是否抛错 */
    uploadThrows: false,
    /** deleteFile 是否抛错 */
    deleteThrows: false,
    /** deleteFile 返回的失败 fileID 集合（status=1） */
    deleteFailed: new Set(),
    /** downloadFile 是否抛错 */
    downloadThrows: false,
    /** getTempFileURL 是否抛错 */
    tempUrlThrows: false
  }

  let idSeq = 0

  function nextId() {
    idSeq += 1
    return `mock_id_${idSeq}`
  }

  function tableOf(name) {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)
  }

  function rowsOf(name) {
    return Array.from(tableOf(name).values())
  }

  /** 写入一条记录（测试预置数据用） */
  function seed(name, doc) {
    const record = clone(doc)
    if (!record._id) record._id = nextId()
    tableOf(name).set(record._id, record)
    return record
  }

  /** 批量预置 */
  function seedMany(name, docs) {
    return (docs || []).map(doc => seed(name, doc))
  }

  /** 查询器 */
  class Query {
    constructor(name, cond) {
      this._name = name
      this._cond = cond || {}
      this._proj = null
      this._sort = null
      this._skipN = 0
      this._limitN = Infinity
    }

    where(cond) {
      return new Query(this._name, cond)
    }

    field(proj) {
      this._proj = proj
      return this
    }

    orderBy(field, direction) {
      this._sort = { field, direction: direction === 'desc' || direction === -1 || direction === '-1' ? -1 : 1 }
      return this
    }

    skip(count) {
      this._skipN = Number(count) || 0
      return this
    }

    limit(count) {
      this._limitN = Number(count) > 0 ? Number(count) : Infinity
      return this
    }

    _matched() {
      return rowsOf(this._name).filter(doc => matchesWhere(doc, this._cond))
    }

    async get() {
      let list = this._matched()
      if (this._sort) {
        const { field, direction } = this._sort
        list = list.slice().sort((left, right) => {
          const a = sortValue(left[field])
          const b = sortValue(right[field])
          if (a === b) return 0
          return (a < b ? -1 : 1) * direction
        })
      }
      if (this._skipN > 0) list = list.slice(this._skipN)
      if (this._limitN !== Infinity) list = list.slice(0, this._limitN)
      return { data: list.map(doc => project(doc, this._proj)) }
    }

    async count() {
      return { total: this._matched().length }
    }

    async update(patch) {
      const targets = this._matched()
      for (const doc of targets) {
        const record = tableOf(this._name).get(doc._id)
        Object.assign(record, clone(patch))
        record._id = doc._id
      }
      log.updates.push({ table: this._name, where: clone(this._cond), patch: clone(patch), count: targets.length })
      log.order.push({ type: 'update', table: this._name })
      return { updated: targets.length }
    }

    async remove() {
      const targets = this._matched()
      for (const doc of targets) tableOf(this._name).delete(doc._id)
      log.removes.push({ table: this._name, where: clone(this._cond), count: targets.length })
      log.order.push({ type: 'remove', table: this._name })
      return { deleted: targets.length }
    }
  }

  /** 集合对象（自身即空条件查询器，另带 add / doc） */
  class Collection extends Query {
    constructor(name) {
      super(name, {})
    }

    async add(doc) {
      const record = clone(doc)
      if (!record._id) record._id = nextId()
      tableOf(this._name).set(record._id, record)
      log.adds.push({ table: this._name, doc: clone(record) })
      log.order.push({ type: 'add', table: this._name })
      return { id: record._id }
    }

    doc(id) {
      const name = this._name
      const targetId = id
      return {
        async get() {
          const record = tableOf(name).get(targetId)
          return { data: record ? [clone(record)] : [] }
        },
        async update(patch) {
          const record = tableOf(name).get(targetId)
          if (!record) {
            log.updates.push({ table: name, id: targetId, patch: clone(patch), count: 0 })
            log.order.push({ type: 'update', table: name })
            return { updated: 0 }
          }
          Object.assign(record, clone(patch))
          record._id = targetId
          log.updates.push({ table: name, id: targetId, patch: clone(patch), count: 1 })
          log.order.push({ type: 'update', table: name })
          return { updated: 1 }
        },
        async remove() {
          const existed = tableOf(name).delete(targetId)
          log.removes.push({ table: name, id: targetId, count: existed ? 1 : 0 })
          log.order.push({ type: 'remove', table: name })
          return { deleted: existed ? 1 : 0 }
        }
      }
    }
  }

  const command = {
    in: value => ({ __op: 'in', value: clone(value) }),
    nin: value => ({ __op: 'nin', value: clone(value) }),
    or: value => ({ __op: 'or', value: clone(value) }),
    and: value => ({ __op: 'and', value: clone(value) })
  }

  const database = () => ({
    command,
    serverDate: () => new Date(),
    RegExp: input => ({ __op: 'regexp', regexp: input.regexp, options: input.options || '' }),
    collection: name => new Collection(name)
  })

  const mock = {
    database,
    /** 直接暴露 db.command，便于测试构造条件 */
    command,

    async uploadFile(param) {
      const payload = param || {}
      log.uploads.push({ cloudPath: payload.cloudPath, size: payload.fileContent ? payload.fileContent.length : 0 })
      log.order.push({ type: 'uploadFile' })
      if (behavior.uploadThrows) throw new Error('mock uploadFile 失败')
      const fileID = `cloud://mock-env/${payload.cloudPath}`
      storage.set(fileID, Buffer.isBuffer(payload.fileContent)
        ? payload.fileContent.toString('utf8')
        : String(payload.fileContent === undefined ? '' : payload.fileContent))
      return { fileID }
    },

    async downloadFile(param) {
      const payload = param || {}
      log.downloads.push({ fileID: payload.fileID })
      log.order.push({ type: 'downloadFile' })
      if (behavior.downloadThrows) throw new Error('mock downloadFile 失败')
      if (!storage.has(payload.fileID)) throw new Error('mock 文件不存在')
      return { fileContent: Buffer.from(storage.get(payload.fileID), 'utf8') }
    },

    async getTempFileURL(param) {
      const payload = param || {}
      const list = Array.isArray(payload.fileList) ? payload.fileList : []
      log.tempUrls.push({ fileList: list.slice() })
      log.order.push({ type: 'getTempFileURL' })
      if (behavior.tempUrlThrows) throw new Error('mock getTempFileURL 失败')
      return {
        fileList: list.map(fileID => ({
          fileID,
          tempFileURL: `https://mock.temp/${encodeURIComponent(fileID)}`
        }))
      }
    },

    async deleteFile(param) {
      const payload = param || {}
      const list = Array.isArray(payload.fileList) ? payload.fileList : []
      log.deletes.push({ fileList: list.slice() })
      log.order.push({ type: 'deleteFile' })
      if (behavior.deleteThrows) throw new Error('mock deleteFile 失败')
      return {
        fileList: list.map(fileID => ({
          fileID,
          status: behavior.deleteFailed.has(fileID) ? 1 : 0
        }))
      }
    },

    // ---- 测试侧工具 ----
    __seed: seed,
    __seedMany: seedMany,
    __rows: rowsOf,
    __storage: storage,
    __log: log,
    __behavior: behavior,
    /** 清空某表 */
    __clear(name) {
      tableOf(name).clear()
    }
  }

  return mock
}

module.exports = { createMockUniCloud, clone }
