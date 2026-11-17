/**
 * 随机 UUID 生成（纯函数，无第三方依赖）。
 * 用于云存储 cloudPath 中的 {uuid} 占位替换、分块 ID 等场景。
 * 优先使用 H5 / Node 内置 crypto.randomUUID()，降级为时间戳 + 随机串。
 */

/**
 * 生成随机 UUID。
 * @returns {string} 随机字符串
 */
export function genUuid() {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
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

export default genUuid
