/**
 * 批注四级定位（纯函数，不依赖 uniCloud 运行时，可被 Node 直接 require 单测）。
 *
 * 优先级（业务规则 C4 / 架构 5.3）：
 * ① start_offset + selected_text 检查原位置，命中即绑定；
 * ② 失败则全文搜索 selected_text，唯一命中即绑定；
 * ③ 多命中时用 prefix + selected_text + suffix 上下文消歧，唯一确定才绑定；
 * ④ 仍无法确定 → status=orphaned，保持原 offset，**绝不把批注绑定到其他文字**。
 * 所有坐标均相对全文提纯文本 plainText。
 */

'use strict'

/**
 * 找出 needle 在 text 中的全部起始下标（含重叠命中）。
 * @param {string} text 被搜索文本
 * @param {string} needle 目标片段
 * @returns {number[]} 全部命中起始下标
 */
function findAll(text, needle) {
  const source = typeof text === 'string' ? text : ''
  const target = typeof needle === 'string' ? needle : ''
  const positions = []
  if (!target) return positions
  let position = source.indexOf(target, 0)
  while (position !== -1) {
    positions.push(position)
    position = source.indexOf(target, position + 1)
  }
  return positions
}

/**
 * 对一组 active 批注执行四级重定位。
 * @param {string} plainText 最新全文提纯文本
 * @param {object[]} comments 批注数组，每条含 _id / selected_text / prefix / suffix / start_offset / end_offset
 * @returns {{results: object[], active: number, orphaned: number}}
 *   results 每项为 {_id, start_offset, end_offset, status}，供云对象批量写回
 *   （命中时更新 offset，orphaned 时更新 status；created_at 不动，updated_at 由云对象更新）
 */
function relocateComments(plainText, comments) {
  const plain = typeof plainText === 'string' ? plainText : ''
  const list = Array.isArray(comments) ? comments : []
  const results = []
  let active = 0
  let orphaned = 0

  for (const raw of list) {
    const comment = raw || {}
    const selected = typeof comment.selected_text === 'string' ? comment.selected_text : ''
    const prefix = typeof comment.prefix === 'string' ? comment.prefix : ''
    const suffix = typeof comment.suffix === 'string' ? comment.suffix : ''
    const start = Number.isFinite(Number(comment.start_offset)) ? Number(comment.start_offset) : 0
    const end = Number.isFinite(Number(comment.end_offset)) ? Number(comment.end_offset) : 0
    const id = comment._id

    // ① 原位置命中：保持原 offset 不变
    if (selected && start >= 0 && end > start && plain.slice(start, end) === selected) {
      results.push({ _id: id, start_offset: start, end_offset: end, status: 'active' })
      active += 1
      continue
    }

    const matches = findAll(plain, selected)

    // ② 全文唯一命中
    if (selected && matches.length === 1) {
      const position = matches[0]
      results.push({
        _id: id,
        start_offset: position,
        end_offset: position + selected.length,
        status: 'active'
      })
      active += 1
      continue
    }

    // ③ 上下文消歧：逐个候选校验前后文，恰好一个匹配才绑定
    if (selected && matches.length > 1) {
      const candidates = matches.filter(position => {
        const before = plain.slice(Math.max(0, position - prefix.length), position)
        const after = plain.slice(position + selected.length, position + selected.length + suffix.length)
        const prefixOk = !prefix || before === prefix
        const suffixOk = !suffix || after === suffix
        return prefixOk && suffixOk
      })
      if (candidates.length === 1) {
        const position = candidates[0]
        results.push({
          _id: id,
          start_offset: position,
          end_offset: position + selected.length,
          status: 'active'
        })
        active += 1
        continue
      }
    }

    // ④ 无法确定位置：置 orphaned，保持原 offset，不误绑其他文字
    results.push({ _id: id, start_offset: start, end_offset: end, status: 'orphaned' })
    orphaned += 1
  }

  return { results, active, orphaned }
}

module.exports = { relocateComments, findAll }
