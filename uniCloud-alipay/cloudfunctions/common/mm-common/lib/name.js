/**
 * 同目录重名处理（纯函数，可被 Node 直接 require 单测）。
 * 前端 common/utils/name.js 的 genUniqueName 与本文件算法一致，仅用于上传前预览；
 * 权威判定始终在云对象服务端串行执行（架构 2.7：不做 (parent_id,name) 唯一索引）。
 * 规则：原名不冲突则原样返回；冲突时追加 -copy1 / -copy2 … 并保留扩展名，幂等。
 */

'use strict'

/**
 * 拆分文件名为主名与扩展名（扩展名含点号）。
 * @param {string} name 文件名
 * @returns {{base:string, ext:string}}
 */
function splitName(name) {
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
 * @param {string[]} existingNames 同目录已有名称
 * @returns {string} 不冲突的名称，形如 原名-copy1.md
 */
function genUniqueName(name, existingNames) {
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

module.exports = { genUniqueName, splitName }
