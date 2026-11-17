/**
 * mm-settings 云对象前端薄封装：系统配置读取、账号 / 权限开关、
 * 用户列表与可读可写授权、首个管理员初始化。
 * getConfig 无需登录态，App.vue 的 onLaunch 在首屏直接调用。
 */
import { call, callSilent } from '@/common/api/index.js'

/**
 * 读取系统配置（无需登录）。
 * 首屏调用失败时不得抛异常、不得阻塞加载动画淡出，由调用方兜底默认配置。
 */
export const getConfig = (param = {}) => callSilent('mmSettings', 'getConfig', param)

/** 幂等创建 / 补齐单条配置文档（部署初始化使用） */
export const ensureConfig = (param = {}) => call('mmSettings', 'ensureConfig', param)

/** 更新账号 / 权限开关（服务端校验用户数与管理员身份） */
export const updateConfig = (param = {}) => call('mmSettings', 'updateConfig', param)

/** 用户列表（权限开启时仅管理员） */
export const listUsers = (param = {}) => call('mmSettings', 'listUsers', param)

/** 分配某用户的可读 / 可写权限位（仅管理员） */
export const setUserPermission = (param = {}) => call('mmSettings', 'setUserPermission', param)

/** 权限由关→开时确立首个注册用户为管理员 */
export const ensureAdmin = (param = {}) => call('mmSettings', 'ensureAdmin', param)
