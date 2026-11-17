/**
 * uni-id-common 的最小替身（仅本地单测使用）。
 *
 * 真机上 AuthGuard.resolve 通过 `require('uni-id-common')` 的
 * createInstance().checkToken(token) 解析 uid；本地无 uni_modules 依赖安装，
 * 故由 tests/helpers/cloud-env.js 把该模块名重定向到本文件。
 * 只实现 checkToken 一个能力，token → uid 映射由测试用例显式登记。
 */

'use strict'

const tokenMap = new Map()

/**
 * 模拟登录：登记一个 token 对应的用户 ID。
 * @param {string} token token 字符串
 * @param {string} uid 用户 ID
 * @returns {string} token
 */
function login(token, uid) {
  tokenMap.set(token, uid)
  return token
}

/** 清空全部 token（每个用例前调用） */
function reset() {
  tokenMap.clear()
}

module.exports = {
  createInstance() {
    return {
      async checkToken(token) {
        if (token && tokenMap.has(token)) {
          return { uid: tokenMap.get(token) }
        }
        return { errCode: 'uni-id-token-invalid', errMsg: 'token 无效' }
      }
    }
  },
  __login: login,
  __reset: reset
}
