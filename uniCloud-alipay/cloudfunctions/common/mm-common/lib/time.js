/**
 * 服务器时间唯一出口（架构 8.7）。
 * 所有 created_at / updated_at 以云对象侧服务器时间为准，忽略客户端传入的时间值。
 * 本地单测无 uniCloud 运行时时降级为 new Date()，不影响纯函数验证。
 */

'use strict'

const { serverDate } = require('./db.js')

/**
 * 服务器时间对象，用于写入 timestamp 字段（db.serverDate()）。
 * @returns {object|Date} 服务器时间
 */
function now() {
  try {
    return serverDate()
  } catch (error) {
    return new Date()
  }
}

/**
 * 服务器时间 Date 对象，用于 deleted_at 置空判断、日志等。
 * @returns {Date}
 */
function nowDate() {
  return new Date()
}

module.exports = { now, nowDate }
