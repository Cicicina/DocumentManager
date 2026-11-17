/**
 * 同目录重名处理（前端预览用）。
 * 权威判定在云对象：mm-common/lib/name.js 的 genUniqueName 与本文件算法一致。
 * 规则：原名不冲突则原样返回；冲突时追加 -copy1 / -copy2 … 并保留扩展名。
 * 同一输入与同一份已有名称集合必然得到同一结果（幂等）。
 */

/**
 * 拆分文件名为主名与扩展名（扩展名含点号）。
 * @param {string} name 文件名
 * @returns {{base: string, ext: string}}
 */
export function splitName(name) {
  const fileName = typeof name === 'string' ? name : ''
  const dot = fileName.lastIndexOf('.')
  if (dot > 0) {
    return { base: fileName.slice(0, dot), ext: fileName.slice(dot) }
  }
  return { base: fileName, ext: '' }
}

/**
 * 生成同目录内的唯一名称。
 * @param {string} name 期望名称
 * @param {string[]} existingNames 同目录已有名称（含回收站外的有效名称）
 * @returns {string} 不冲突的名称，形如 原名-copy1.md
 */
export function genUniqueName(name, existingNames) {
  const expected = typeof name === 'string' ? name : ''
  const existing = new Set(Array.isArray(existingNames) ? existingNames : [])
  if (!existing.has(expected)) return expected

  const { base, ext } = splitName(expected)
  const copied = /^(.*)-copy(\d+)$/.exec(base)
  const stem = copied ? copied[1] : base
  let index = copied ? Number(copied[2]) + 1 : 1

  let candidate = `${stem}-copy${index}${ext}`
  while (existing.has(candidate)) {
    index += 1
    candidate = `${stem}-copy${index}${ext}`
  }
  return candidate
}

export default genUniqueName
