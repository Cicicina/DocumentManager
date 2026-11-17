/**
 * mm-share 云对象前端薄封装：创建 / 校验 / 只读打开分享链接。
 * 所有方法返回前端统一结构 {code, data, message}。
 */
import { call } from '@/common/api/index.js'

/** 云对象键统一走常量，避免在多处重复字面量 */
const OBJECT_KEY = 'mmShare'

/** 创建分享令牌（仅文档所有者/有写权限者可调用） */
export const createShare = (param = {}) => call(OBJECT_KEY, 'create', param)

/** 校验令牌是否有效（不要求登录，不读正文） */
export const verifyShare = (param = {}) => call(OBJECT_KEY, 'verify', param)

/** 凭令牌只读打开文档内容快照 */
export const openShare = (param = {}) => call(OBJECT_KEY, 'open', param)
