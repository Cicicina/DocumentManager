/**
 * 移动端合并目录的本地缓存。
 *
 * 只缓存目录结构、展开状态和文档「元数据」，不缓存正文内容本身。
 * localStorage 在测试 / 非 H5 环境可能不存在，所有读写都做静默降级。
 */

export const DIRECTORY_CACHE_KEY = 'mm_directory_cache_v1'
export const DIRECTORY_CACHE_VERSION = 1

/** 正文大字段：绝不写进 localStorage */
const CONTENT_KEYS = new Set(['content', 'content_text', 'tempUrl', 'cloudContent', 'localContent'])

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 去掉临时 URL 与正文：自定义图标只保留 type/value，打开应用时再换临时 URL */
export function stripTransient(item) {
  if (!isObject(item)) return item
  const next = {}
  for (const key of Object.keys(item)) {
    if (CONTENT_KEYS.has(key)) continue
    if (key === 'icon' && isObject(item.icon)) {
      const icon = { ...item.icon }
      delete icon.url
      next.icon = icon
      continue
    }
    next[key] = item[key]
  }
  return next
}

function normalizeIdMap(value) {
  const next = {}
  if (!isObject(value)) return next
  for (const key of Object.keys(value)) {
    if (value[key] === true) next[key] = true
  }
  return next
}

function normalizeFolders(value) {
  if (!Array.isArray(value)) return []
  return value.filter(item => isObject(item) && item._id).map(stripTransient)
}

function normalizeFiles(value) {
  const next = {}
  if (!isObject(value)) return next
  for (const parentId of Object.keys(value)) {
    const list = value[parentId]
    next[parentId] = (Array.isArray(list) ? list : [])
      .filter(item => isObject(item) && item._id)
      .map(stripTransient)
  }
  return next
}

function normalizeSort(value) {
  if (!isObject(value)) return null
  const key = value.key === 'name' || value.key === 'size' ? value.key : 'updated_at'
  const dir = value.dir === 'asc' ? 'asc' : 'desc'
  return { key, dir }
}

/** 构造可写入 localStorage 的数据；owner 用于区分不同账号的缓存 */
export function buildDirectoryCache(input) {
  const source = isObject(input) ? input : {}
  return {
    version: DIRECTORY_CACHE_VERSION,
    savedAt: Date.now(),
    owner: typeof source.owner === 'string' ? source.owner : '',
    expanded: normalizeIdMap(source.expanded),
    folders: normalizeFolders(source.folders),
    files: normalizeFiles(source.files),
    sort: normalizeSort(source.sort) || { key: 'updated_at', dir: 'desc' }
  }
}

function storage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage
  } catch (error) {
    /* 隐私模式下访问 localStorage 可能抛错 */
  }
  return null
}

/** 读取缓存；version 或 owner 不匹配时返回 null */
export function loadDirectoryCache(expectedOwner) {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(DIRECTORY_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isObject(parsed) || parsed.version !== DIRECTORY_CACHE_VERSION) return null
    if (typeof expectedOwner === 'string' && parsed.owner !== expectedOwner) return null
    return buildDirectoryCache(parsed)
  } catch (error) {
    return null
  }
}

export function saveDirectoryCache(input) {
  const store = storage()
  if (!store) return false
  try {
    store.setItem(DIRECTORY_CACHE_KEY, JSON.stringify(buildDirectoryCache(input)))
    return true
  } catch (error) {
    // 超额 / 禁用存储时静默失败，不影响目录使用
    return false
  }
}

export function clearDirectoryCache() {
  const store = storage()
  if (!store) return false
  try {
    store.removeItem(DIRECTORY_CACHE_KEY)
    return true
  } catch (error) {
    return false
  }
}

function folderSignature(folder) {
  const icon = isObject(folder.icon) ? folder.icon : {}
  return JSON.stringify([
    folder._id, folder.parent_id || '', folder.name || '',
    icon.type || '', icon.value || '', folder.updated_at || ''
  ])
}

function fileSignature(file) {
  const icon = isObject(file.icon) ? file.icon : {}
  return JSON.stringify([
    file._id, file.parent_id || '', file.name || '', Number(file.size) || 0,
    file.updated_at || '', file.created_at || '', file.version || 0,
    file.content_hash || '', icon.type || '', icon.value || '',
    JSON.stringify(file.tags || [])
  ])
}

function sameList(left, right, signature) {
  const a = (Array.isArray(left) ? left : []).map(signature).sort()
  const b = (Array.isArray(right) ? right : []).map(signature).sort()
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** 文件夹元数据是否一致（忽略临时图标 URL） */
export function folderListsEqual(left, right) {
  return sameList(left, right, folderSignature)
}

/** 目录内文档元数据是否一致（忽略正文与临时 URL） */
export function fileListsEqual(left, right) {
  return sameList(left, right, fileSignature)
}
