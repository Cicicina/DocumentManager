/**
 * mm-file 云对象前端薄封装：文件 / 文件夹 CRUD、上传落库、内容读写、
 * 保存（版本冲突）、改名移动、标签、回收站、导入导出、索引重建。
 * 所有方法返回前端统一结构 {code, data, message}；code=2001 为版本冲突，
 * 由 mm-conflict-modal 处理，调用方不得在此清空编辑器内容。
 */
import { call } from '@/common/api/index.js'

/** 取当前用户全部未删除的文件夹节点 */
export const listTree = (param = {}) => call('mmFile', 'listTree', param)

/** 取指定目录下的文档列表 */
export const listFiles = (param = {}) => call('mmFile', 'listFiles', param)

/** 新建文件夹 */
export const createFolder = (param = {}) => call('mmFile', 'createFolder', param)

/** 客户端直传云存储后登记文档元数据 */
export const registerUpload = (param = {}) => call('mmFile', 'registerUpload', param)

/** 读取文档记录与 md 原文 */
export const getContent = (param = {}) => call('mmFile', 'getContent', param)

/**
 * 保存文档。force=false 正常保存；force=true 为冲突后的覆写。
 * 返回 code=2001 时携带 {cloudVersion, cloudContent, cloudUpdatedAt}，
 * 「覆写 / 放弃」两路径都必须保持 store.editorContent 不变、不跳转、不刷新。
 */
export const saveContent = (param = {}) => call('mmFile', 'saveContent', param)

/** 改名（同目录撞名由服务端追加 -copyN） */
export const rename = (param = {}) => call('mmFile', 'rename', param)

/** 移动到目标目录 */
export const move = (param = {}) => call('mmFile', 'move', param)

/** 更新文件夹图标 */
export const updateIcon = (param = {}) => call('mmFile', 'updateIcon', param)

/** 设置标签 */
export const setTags = (param = {}) => call('mmFile', 'setTags', param)

/** 普通删除：置 is_delete=true 进回收站，不动云存储 */
export const softDelete = (param = {}) => call('mmFile', 'softDelete', param)

/** 回收站列表 */
export const listTrash = (param = {}) => call('mmFile', 'listTrash', param)

/** 从回收站还原（撞名追加 -copyN） */
export const restore = (param = {}) => call('mmFile', 'restore', param)

/** 彻底删除：由云对象删除云存储源文件并级联清理子记录 */
export const purgeDelete = (param = {}) => call('mmFile', 'purgeDelete', param)

/** 导出 md 原文 */
export const exportFile = (param = {}) => call('mmFile', 'exportFile', param)

/** 导入 md 原文（云对象负责上传云存储并落库） */
export const importFile = (param = {}) => call('mmFile', 'importFile', param)

/** 索引重建失败后的补偿重跑 */
export const rebuildIndex = (param = {}) => call('mmFile', 'rebuildIndex', param)
