/**
 * MarkdownManager 云侧公共模块统一出口。
 * 各业务云对象统一 `require('mm-common')` 复用常量、错误、鉴权、时间、哈希、
 * 重名、提纯、分块、批注定位与数据库助手；纯函数不依赖 uniCloud 运行时，
 * 与云运行时相关的能力集中在 auth.js / db.js / time.js。
 *
 * 同时提供「命名空间导出」与「扁平函数导出」两种用法，便于云对象按需取用。
 */

'use strict'

const constants = require('./lib/constants.js')
const error = require('./lib/error.js')
const auth = require('./lib/auth.js')
const time = require('./lib/time.js')
const hash = require('./lib/hash.js')
const name = require('./lib/name.js')
const mmText = require('./lib/mm-text.js')
const chunk = require('./lib/chunk.js')
const anchor = require('./lib/anchor.js')
const db = require('./lib/db.js')

module.exports = {
  // 子模块命名空间
  constants,
  error,
  auth,
  time,
  hash,
  name,
  mmText,
  chunk,
  anchor,
  db,

  // 常量扁平导出（与前端 common/constants.js 取值一致）
  TABLE: constants.TABLE,
  ANONYMOUS_USER_ID: constants.ANONYMOUS_USER_ID,
  SETTINGS_KEY: constants.SETTINGS_KEY,
  CLOUD_PATH: constants.CLOUD_PATH,
  ANCHOR_CONTEXT_LEN: constants.ANCHOR_CONTEXT_LEN,
  CHUNK_MAX_LEN: constants.CHUNK_MAX_LEN,
  CHUNK_OVERLAP: constants.CHUNK_OVERLAP,
  DEFAULT_EXTENSION: constants.DEFAULT_EXTENSION,
  ERR: constants.ERR,
  ERR_MESSAGE: constants.ERR_MESSAGE,

  // 出参与断言
  ok: error.ok,
  fail: error.fail,
  assert: error.assert,

  // 身份与权限
  AuthGuard: auth.AuthGuard,
  resolve: auth.resolve,
  assertWrite: auth.assertWrite,
  assertAdmin: auth.assertAdmin,
  readConfig: auth.readConfig,

  // 服务器时间
  now: time.now,
  nowDate: time.nowDate,

  // 随机 ID、哈希、字节数、重名
  genUuid: hash.genUuid,
  genShareToken: hash.genShareToken,
  sha256: hash.sha256,
  byteSize: hash.byteSize,
  genUniqueName: name.genUniqueName,
  splitName: name.splitName,

  // 提纯与 offset 双向映射（与前端逐字一致的同构副本）
  stripMarkdown: mmText.stripMarkdown,
  buildOffsetMap: mmText.buildOffsetMap,

  // 索引分块与关键词
  buildChunks: chunk.buildChunks,
  extractKeywords: chunk.extractKeywords,

  // 批注四级定位
  relocateComments: anchor.relocateComments,
  findAll: anchor.findAll,

  // 数据库助手
  collection: db.collection,
  removeByFileId: db.removeByFileId,
  batchAdd: db.batchAdd,
  getDoc: db.getDoc
}
