/**
 * 云对象加载与调用辅助（仅本地单测使用）。
 *
 * 云对象源码以 `require('mm-common')` 与 `require('uni-id-common')` 引用公共依赖，
 * 且 mm-* 云对象在模块顶层执行 `uniCloud.database()`。因此本辅助做两件事：
 * 1. 重定向 `mm-common` → 项目内公共模块源码，`uni-id-common` → 本地替身；
 * 2. 在 require 前把内存 Mock 挂到 globalThis.uniCloud，并清掉模块缓存以便每个用例隔离。
 */

'use strict'

const path = require('node:path')
const Module = require('node:module')

const ROOT = path.resolve(__dirname, '..', '..')
const CLOUDFUNCTIONS = path.join(ROOT, 'uniCloud-alipay', 'cloudfunctions')
const MM_COMMON_INDEX = path.join(CLOUDFUNCTIONS, 'common', 'mm-common', 'index.js')
const UNI_ID_STUB = path.join(__dirname, 'stubs', 'uni-id-common.js')

let patched = false

/** 打补丁：把云侧模块名解析到本地路径（幂等） */
function patchResolver() {
  if (patched) return
  patched = true
  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request === 'mm-common') return MM_COMMON_INDEX
    if (request === 'uni-id-common') return UNI_ID_STUB
    return originalResolve.call(this, request, parent, isMain, options)
  }
}

/**
 * 加载业务云对象。
 * @param {string} name 云对象目录名，如 'mm-file'
 * @param {object} mock uniCloud Mock 实例
 * @returns {object} 云对象定义（module.exports）
 */
function loadCloudObject(name, mock) {
  patchResolver()
  globalThis.uniCloud = mock
  const entry = path.join(CLOUDFUNCTIONS, name, 'index.obj.js')
  delete require.cache[require.resolve(entry)]
  return require(entry)
}

/**
 * 以云对象运行时语义调用某个方法：先跑 `_before`，再调用目标方法。
 * 注入 getClientInfo 与 token 读取方法，模拟客户端请求上下文。
 * 真实云对象通常提供 getUniversalUniIdToken（uni-id-co 的鉴权中间件亦用它），
 * 旧运行时只有 getUniIdToken；tokenMethods 可指定本次请求暴露哪些方法。
 * @param {object} obj 云对象定义
 * @param {string} method 方法名
 * @param {object} [param] 入参
 * @param {{token?:string, tokenMethods?:string[], clientInfo?:object}} [options] 请求选项
 * @returns {Promise<{errCode:number, errMsg:string, data:*}>}
 */
async function callObject(obj, method, param, options) {
  const opts = options || {}
  const instance = Object.create(obj)
  const token = opts.token || ''
  const tokenMethods = Array.isArray(opts.tokenMethods)
    ? opts.tokenMethods
    : ['getUniversalUniIdToken', 'getUniIdToken']

  instance.getClientInfo = () => opts.clientInfo || {}
  if (tokenMethods.indexOf('getUniversalUniIdToken') >= 0) {
    instance.getUniversalUniIdToken = () => token
  }
  if (tokenMethods.indexOf('getUniIdToken') >= 0) {
    instance.getUniIdToken = () => token
  }

  if (typeof instance._before === 'function') await instance._before()
  return instance[method](param)
}

module.exports = {
  ROOT,
  CLOUDFUNCTIONS,
  MM_COMMON_INDEX,
  loadCloudObject,
  callObject
}
