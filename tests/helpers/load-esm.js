/**
 * 源码加载辅助（仅本地单测使用）。
 *
 * 前端公共层部分文件是 ES Module（`export const` / `export function`），而项目根
 * package.json 未声明 `type: module`，Node 会按 CommonJS 解析 `.js`，直接 import 会失败。
 * 本辅助把 ESM 语法就地改写为「无 import/export 的普通脚本」并以 data: URL 动态导入，
 * 全程只读源码、不落盘、不改动被测试的业务文件。
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')

/**
 * 把 ESM 源码改写为可被 data: URL 导入的模块代码。
 * @param {string} source 原始源码
 * @returns {string} 改写后的代码（末尾统一 export 全部具名声明）
 */
function toImportableModule(source) {
  const names = new Set()
  let code = source

  // 去掉 `export default xxx`（默认导出由具名导出覆盖，避免重复声明）
  code = code.replace(/^[ \t]*export\s+default\s+[A-Za-z_$][\w$]*[ \t]*;?[ \t]*$/gm, '')
  // export const / let / var / function / class → 去掉 export
  code = code.replace(/\bexport\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
    (matched, keyword, name) => {
      names.add(name)
      return `${keyword} ${name}`
    })
  // export { a, b as c } → 收集后删除该语句
  code = code.replace(/\bexport\s*\{([^}]*)\}/g, (matched, inner) => {
    inner.split(',').forEach(part => {
      const alias = part.trim().split(/\s+as\s+/).pop()
      if (alias) names.add(alias.trim())
    })
    return ''
  })

  return `${code}\n\nexport { ${Array.from(names).join(', ')} }\n`
}

/**
 * 加载项目内的 ES Module 文件。
 * @param {string} relativePath 相对项目根目录的路径
 * @returns {Promise<object>} 模块命名空间
 */
async function loadEsm(relativePath) {
  const absolute = path.join(ROOT, relativePath)
  const source = fs.readFileSync(absolute, 'utf8')
  const code = toImportableModule(source)
  const encoded = Buffer.from(code, 'utf8').toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

/**
 * 读取项目内文件文本（统一换行符，便于逐字比对）。
 * @param {string} relativePath 相对项目根目录的路径
 * @returns {string}
 */
function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

/**
 * 读取项目内 JSON 文件。
 * @param {string} relativePath 相对项目根目录的路径
 * @returns {*}
 */
function readJson(relativePath) {
  return JSON.parse(readText(relativePath))
}

module.exports = { ROOT, loadEsm, readText, readJson, toImportableModule }
