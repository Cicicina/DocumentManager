/**
 * 数据库访问助手（uniCloud 云函数运行时专用，依赖放在本文件，不污染纯函数模块）。
 * 六张 mm-* 表的 schema permission 四项全为 false，但云函数内 uniCloud.database()
 * 拥有完整权限，故所有业务读写都经由云对象使用本助手完成。
 */

'use strict'

/** 取数据库连接（惰性，避免模块加载时依赖云运行时） */
function getDatabase() {
  if (typeof uniCloud === 'undefined' || !uniCloud || typeof uniCloud.database !== 'function') {
    throw new Error('当前环境不是 uniCloud 云函数运行时')
  }
  return uniCloud.database()
}

/**
 * 取集合。
 * @param {string} name 表名
 * @returns {object} 集合对象
 */
function collection(name) {
  return getDatabase().collection(name)
}

/** 服务器时间对象（db.serverDate()），供 time.now() 使用 */
function serverDate() {
  return getDatabase().serverDate()
}

/**
 * 按 _id 取单条记录。
 * @param {string} table 表名
 * @param {string} id 记录 ID
 * @returns {Promise<object|null>}
 */
async function getDoc(table, id) {
  const res = await collection(table).doc(id).get()
  return res && res.data && res.data[0] ? res.data[0] : null
}

/**
 * 按 file_id 精确范围删除（索引先删后插、彻底删除级联清理时使用）。
 * @param {string} table 表名
 * @param {string} fileId 文档 ID
 * @returns {Promise<object>} 删除结果
 */
async function removeByFileId(table, fileId) {
  return collection(table).where({ file_id: fileId }).remove()
}

/**
 * 批量插入（逐条写入，避免不同云厂商对数组 add 的差异）。
 * @param {string} table 表名
 * @param {object[]} docs 记录数组
 * @returns {Promise<{inserted:number}>}
 */
async function batchAdd(table, docs) {
  const list = Array.isArray(docs) ? docs : []
  let inserted = 0
  for (const doc of list) {
    await collection(table).add(doc)
    inserted += 1
  }
  return { inserted }
}

module.exports = { getDatabase, collection, serverDate, getDoc, removeByFileId, batchAdd }
