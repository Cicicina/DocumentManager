/**
 * 内容哈希、字节数与随机 ID（纯函数，使用 Node 内置 crypto，可被 Node 直接 require 单测）。
 * 每次编辑保存成功后由云对象重算 size / content_hash，忽略客户端同名入参（C3）；
 * genUuid() 供云对象生成 cloudPath 中的 {uuid} 占位，与前端 common/utils/uuid.js 算法一致。
 */

'use strict'

const crypto = require('crypto')

/**
 * 生成随机 UUID：优先 crypto.randomUUID()，降级为时间戳 + 随机串。
 * @returns {string} 随机字符串
 */
function genUuid() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const timePart = Date.now().toString(36)
  let randomPart = ''
  for (let i = 0; i < 4; i++) {
    randomPart += Math.floor(Math.random() * 0x100000000)
      .toString(36)
      .padStart(7, '0')
  }
  return `${timePart}-${randomPart}`
}

/**
 * 计算文本的 SHA-256。
 * @param {string} text 文本内容
 * @returns {string} 64 位小写十六进制字符串
 */
function sha256(text) {
  const content = typeof text === 'string' ? text : (text === null || text === undefined ? '' : String(text))
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * 计算文本的 UTF-8 字节数。
 * @param {string} text 文本内容
 * @returns {number} 字节数
 */
function byteSize(text) {
  const content = typeof text === 'string' ? text : (text === null || text === undefined ? '' : String(text))
  return Buffer.byteLength(content, 'utf8')
}

/**
 * 生成分享令牌：默认 18 字节 → 24 字符 base64url，URL 安全且无需转义。
 * @param {number} bytes 随机字节数
 * @returns {string}
 */
function genShareToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url')
}

module.exports = { genUuid, sha256, byteSize, genShareToken }
