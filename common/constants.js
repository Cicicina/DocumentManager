/**
 * MarkdownManager 前端统一常量。
 *
 * 本文件与云侧公共模块 uniCloud-alipay/cloudfunctions/common/mm-common/lib/constants.js
 * 的取值完全一致：六张表名、匿名虚拟用户 ID、系统配置键、云存储路径模板、
 * 算法参数、统一错误码与中文提示。修改任一常量时必须同步修改云侧同名常量。
 * 说明：前端为 ES Module（uni-app Vue3 / Vite），云侧为 CommonJS，故导出语句不同，
 * 但常量取值与键名逐项一致（架构 8.1）。
 */

/** 六张业务表与 uni-id 用户表名称 */
export const TABLE = {
  FILES: 'mm-files',
  COMMENTS: 'mm-comments',
  IMAGES: 'mm-images',
  CHUNKS: 'mm-index-chunks',
  SETTINGS: 'mm-settings',
  USER_PERMISSIONS: 'mm-user-permissions',
  USERS: 'uni-id-users',
  SHARES: 'mm-shares',
  IMAGE_REFS: 'mm-image-refs'
}

/** 账号功能关闭时，所有访客共享的固定虚拟用户 ID（PRD Q3） */
export const ANONYMOUS_USER_ID = '__anonymous__'

/** 系统配置单文档的业务唯一键（PRD Q2） */
export const SETTINGS_KEY = 'app_config'

/**
 * 云存储路径模板。
 * 返回值中的 {uuid} 占位由 common/utils/uuid.js 的 genUuid() 生成后替换；
 * user_id 一律由云对象 _before 从 token 或匿名模式注入，客户端不传。
 */
export const CLOUD_PATH = {
  markdown: uid => `markdown/${uid}/{uuid}.md`,
  image: (uid, ext) => `images/${uid}/{uuid}.${ext}`,
  icon: (uid, ext) => `icons/${uid}/{uuid}.${ext}`
}

/** 批注锚点 prefix / suffix 的上下文长度（字符数） */
export const ANCHOR_CONTEXT_LEN = 32

/** 单个索引分块的最大字符数（PRD Q5） */
export const CHUNK_MAX_LEN = 1000

/** 相邻切片之间的重叠字符数（PRD Q5） */
export const CHUNK_OVERLAP = 100

/** 本期默认扩展名，保留 extension 字段为后续格式预留（PRD Q7） */
export const DEFAULT_EXTENSION = 'md'

/** 统一错误码（架构 3.8）。2001 为版本冲突，属正常业务返回，不是异常。 */
export const ERR = {
  OK: 0,
  PARAM_INVALID: 1001,
  UNAUTHORIZED: 1002,
  PERMISSION_DENIED: 1003,
  NOT_FOUND: 1004,
  VERSION_CONFLICT: 2001,
  STORAGE_UPLOAD_FAILED: 3001,
  STORAGE_DELETE_FAILED: 3002,
  TEMP_URL_FAILED: 3003,
  ACCOUNT_DISABLE_REJECTED: 4001,
  FOLDER_CREATE_FAILED: 4002,
  MOVE_INVALID: 4003,
  ANCHOR_MISMATCH: 4004,
  PERMISSION_NEEDS_ACCOUNT: 4005,
  IMAGE_REGISTER_FAILED: 4006,
  SHARE_TOKEN_INVALID: 4007,
  SHARE_EXPIRED: 4008,
  SHARE_CREATE_FAILED: 4009,
  SHARE_DOC_UNAVAILABLE: 4010,
  IMAGE_IN_USE: 4011,
  INDEX_REBUILD_FAILED: 5001,
  RELOCATE_FAILED: 5002,
  INTERNAL_ERROR: 9999
}

/** 错误码对应的中文提示，界面只保留必要的错误与操作反馈 */
export const ERR_MESSAGE = {
  0: '成功',
  1001: '参数不完整',
  1002: '请先登录',
  1003: '没有操作权限',
  1004: '内容不存在',
  2001: '云端有更新版本',
  3001: '上传失败，请重试',
  3002: '删除失败，请重试',
  3003: '图片加载失败，请重试',
  4001: '请先删除至单用户',
  4002: '文件夹创建失败',
  4003: '不能移入自身目录',
  4004: '批注位置已变化，请重新选择',
  4005: '请先开启账号功能',
  4006: '图片登记失败',
  4007: '分享链接无效',
  4008: '分享链接已过期',
  4009: '分享创建失败，请重试',
  4010: '分享的文档不可用',
  4011: '图片被文档引用',
  5001: '索引重建失败',
  5002: '批注定位失败',
  9999: '服务异常，请重试'
}

/** 分享链接 query 参数名与线上 Web 基址 */
export const SHARE_QUERY_KEY = 'share_token'
export const SHARE_WEB_BASE = 'https://env-__SPACE_ID__-static.normal.cloudstatic.cn/mymarkdown/web/'
