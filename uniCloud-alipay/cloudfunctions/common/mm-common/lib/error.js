/**
 * 云对象统一出参与错误工具（纯函数，可被 Node 直接 require 单测）。
 * 云侧统一返回 {errCode, errMsg, data}；前端 common/api 归一化为 {code, data, message}。
 */

'use strict'

const { ERR, ERR_MESSAGE } = require('./constants.js')

/**
 * 构造成功出参。
 * @param {*} data 业务数据
 * @returns {{errCode:number, errMsg:string, data:*}}
 */
function ok(data) {
  return { errCode: ERR.OK, errMsg: 'ok', data: data === undefined ? null : data }
}

/**
 * 构造失败出参。
 * @param {number} code 统一错误码
 * @param {string} msg 中文提示，缺省时取错误码默认文案
 * @returns {{errCode:number, errMsg:string, data:null}}
 */
function fail(code, msg) {
  const errCode = Number.isFinite(Number(code)) ? Number(code) : ERR.INTERNAL_ERROR
  return {
    errCode,
    errMsg: msg || ERR_MESSAGE[errCode] || '操作失败',
    data: null
  }
}

/**
 * 断言：条件不成立时抛出带 errCode 的错误，由云对象 _before / 方法捕获转为 fail。
 * @param {boolean} condition 条件
 * @param {number} code 统一错误码
 * @param {string} msg 中文提示
 * @returns {void}
 */
function assert(condition, code, msg) {
  if (condition) return
  const errCode = Number.isFinite(Number(code)) ? Number(code) : ERR.INTERNAL_ERROR
  const message = msg || ERR_MESSAGE[errCode] || '操作失败'
  const error = new Error(message)
  error.errCode = errCode
  error.errMsg = message
  throw error
}

module.exports = { ok, fail, assert }
