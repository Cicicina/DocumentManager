/**
 * mm-search 云对象前端薄封装：标签 / 文件名 / 批注 / 正文四维搜索。
 * 正文命中结果含 file_id / heading / start_offset / end_offset / snippet，
 * 供 mm-search-panel 按 start_offset 回跳到文档段落。
 */
import { call } from '@/common/api/index.js'

/**
 * 统一搜索。
 * @param {object} param {keyword, scope, page, pageSize}
 *   scope: all | tag | name | comment | content
 * @returns {Promise<{code:number,data:any,message:string}>}
 */
export const search = (param = {}) => call('mmSearch', 'search', param)
