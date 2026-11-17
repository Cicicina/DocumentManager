/**
 * mm-share 云对象前端薄封装：创建 / 校验 / 只读打开 / 管理分享。
 * 所有方法返回前端统一结构 {code, data, message}。
 */
import { call } from '@/common/api/index.js'

/** 云对象键统一走常量，避免在多处重复字面量 */
const OBJECT_KEY = 'mmShare'

/** 创建分享令牌（仅文档所有者/有写权限者可调用；expire_seconds 传 0 表示无限期） */
export const createShare = (param = {}) => call(OBJECT_KEY, 'create', param)

/** 校验令牌是否有效（不要求登录，不读正文） */
export const verifyShare = (param = {}) => call(OBJECT_KEY, 'verify', param)

/** 凭令牌只读打开文档内容快照 */
export const openShare = (param = {}) => call(OBJECT_KEY, 'open', param)

/** 列出自己创建的分享（设置页「分享管理」） */
export const listShares = (param = {}) => call(OBJECT_KEY, 'list', param)

/** 作废分享（提前失效，可传 share_id 或 token） */
export const revokeShare = (param = {}) => call(OBJECT_KEY, 'revoke', param)
