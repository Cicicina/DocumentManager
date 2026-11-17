/**
 * mm-comment 云对象前端薄封装：批注增删改查与四级重定位。
 * 锚点信息（selected_text / prefix / suffix / start_offset / end_offset）
 * 由前端 common/utils/selection.js 在阅读态产出，坐标系为提纯纯文本 plainText。
 */
import { call } from '@/common/api/index.js'

/** 取指定文档的全部批注（含 orphaned） */
export const listByFile = (param = {}) => call('mmComment', 'listByFile', param)

/** 新建批注（服务端二次校验锚点与原文一致） */
export const add = (param = {}) => call('mmComment', 'add', param)

/** 修改批注内容：只更新 updated_at，created_at 不变 */
export const update = (param = {}) => call('mmComment', 'update', param)

/** 删除批注 */
export const remove = (param = {}) => call('mmComment', 'remove', param)

/** 手动触发该文档 active 批注的四级重定位（通常由 saveContent 内部调用） */
export const relocate = (param = {}) => call('mmComment', 'relocate', param)
