/**
 * 数据库 Schema 与索引静态校验（AC-01 / AC-20 数据层 / PRD R02、R10、R14）。
 *
 * 校验项：
 * - 6 张表 permission 四项全 false（禁止 clientDB 直连，AC-20 的前置条件）；
 * - 所有 created_at / updated_at / deleted_at 字段均为 bsonType:timestamp；
 * - 字段覆盖 PRD R02 / R10 / R14 与架构 2.1~2.6 的 required 列表；
 * - 索引文件 JSON 合法、索引名与架构 2.7 一致、唯一索引标记正确。
 *
 * 本文件只做静态读盘校验（schema 文件本身不参与 Node 执行）。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { readJson } = require('./helpers/load-esm')

const ROOT = path.resolve(__dirname, '..')
const DB_DIR = path.join(ROOT, 'uniCloud-alipay', 'database')

const TABLES = [
  'mm-files',
  'mm-comments',
  'mm-images',
  'mm-index-chunks',
  'mm-settings',
  'mm-user-permissions'
]

/** 读取 schema（相对项目根路径） */
function schemaOf(table) {
  return readJson(`uniCloud-alipay/database/${table}.schema.json`)
}

/** 读取索引定义 */
function indexOf(table) {
  return readJson(`uniCloud-alipay/database/${table}.index.json`)
}

test('6 张 mm-* 表 schema 文件存在且为合法 JSON', () => {
  for (const table of TABLES) {
    const file = path.join(DB_DIR, `${table}.schema.json`)
    assert.ok(fs.existsSync(file), `缺少 schema 文件：${table}.schema.json`)
    const schema = schemaOf(table)
    assert.equal(schema.bsonType, 'object', `${table} 顶层应为 bsonType:object`)
    assert.equal(typeof schema.properties, 'object', `${table} 缺少 properties`)
    assert.ok(Array.isArray(schema.required), `${table} 缺少 required 数组`)
  }
})

test('6 张表 permission 四项全为 false（AC-20：禁止 clientDB 直连）', () => {
  for (const table of TABLES) {
    const { permission } = schemaOf(table)
    assert.ok(permission, `${table} 缺少 permission`)
    assert.deepEqual(permission, { read: false, create: false, update: false, delete: false },
      `${table} 的 permission 必须四项全 false`)
  }
})

test('所有时间字段一律 bsonType:timestamp（服务器时间兜底）', () => {
  const timeFields = ['created_at', 'updated_at', 'deleted_at']
  for (const table of TABLES) {
    const { properties } = schemaOf(table)
    for (const field of timeFields) {
      if (!Object.prototype.hasOwnProperty.call(properties, field)) continue
      assert.equal(properties[field].bsonType, 'timestamp', `${table}.${field} 必须为 timestamp`)
    }
  }
})

test('每张表的时间字段覆盖与架构 2.1~2.6 一致', () => {
  const expected = {
    'mm-files': ['created_at', 'updated_at', 'deleted_at'],
    'mm-comments': ['created_at', 'updated_at'],
    'mm-images': ['created_at', 'updated_at'],
    'mm-index-chunks': ['created_at'],
    'mm-settings': ['updated_at'],
    'mm-user-permissions': ['created_at', 'updated_at']
  }
  for (const [table, fields] of Object.entries(expected)) {
    const { properties } = schemaOf(table)
    for (const field of fields) {
      assert.ok(Object.prototype.hasOwnProperty.call(properties, field), `${table} 缺少时间字段 ${field}`)
    }
  }
})

test('mm-files 覆盖 PRD R02 全部字段（含扩展字段 type / icon / deleted_at）', () => {
  const { properties } = schemaOf('mm-files')

  // PRD R02 原始 13 字段
  for (const field of [
    '_id', 'user_id', 'parent_id', 'name', 'extension', 'storage_key',
    'size', 'content_hash', 'tags', 'created_at', 'version', 'updated_at', 'is_delete'
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(properties, field), `mm-files 缺少字段 ${field}`)
  }
  // 架构 2.1 扩展字段
  for (const field of ['type', 'icon', 'deleted_at']) {
    assert.ok(Object.prototype.hasOwnProperty.call(properties, field), `mm-files 缺少扩展字段 ${field}`)
  }

  assert.deepEqual(properties.type.enum, ['file', 'folder'])
  assert.deepEqual(properties.icon.properties.type.enum, ['preset', 'wot', 'custom'])
  assert.equal(properties.version.bsonType, 'int')
  assert.equal(properties.version.defaultValue, 0)
  assert.equal(properties.is_delete.bsonType, 'bool')
  assert.equal(properties.tags.bsonType, 'array')
})

test('mm-files required 列表覆盖架构 2.1 规定', () => {
  const { required } = schemaOf('mm-files')
  assert.deepEqual(required.sort(), [
    'type', 'user_id', 'parent_id', 'name', 'extension', 'size', 'content_hash',
    'tags', 'created_at', 'version', 'updated_at', 'is_delete'
  ].sort())
})

test('mm-comments 覆盖 PRD R10 全部字段且 status 枚举正确', () => {
  const { properties, required } = schemaOf('mm-comments')
  for (const field of [
    '_id', 'file_id', 'user_id', 'selected_text', 'prefix', 'suffix',
    'start_offset', 'end_offset', 'comment', 'status', 'created_at', 'updated_at'
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(properties, field), `mm-comments 缺少字段 ${field}`)
  }
  assert.deepEqual(properties.status.enum, ['active', 'orphaned'])
  assert.equal(properties.start_offset.bsonType, 'int')
  assert.equal(properties.end_offset.bsonType, 'int')
  assert.equal(properties.prefix.defaultValue, '')
  assert.equal(properties.suffix.defaultValue, '')

  assert.deepEqual(required.sort(), [
    'file_id', 'user_id', 'selected_text', 'prefix', 'suffix', 'start_offset',
    'end_offset', 'comment', 'status', 'created_at', 'updated_at'
  ].sort())
})

test('mm-index-chunks 覆盖 PRD R14 全部字段', () => {
  const { properties, required } = schemaOf('mm-index-chunks')
  for (const field of [
    'chunk_id', 'file_id', 'user_id', 'heading', 'content',
    'keywords', 'start_offset', 'end_offset', 'revision'
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(properties, field), `mm-index-chunks 缺少字段 ${field}`)
  }
  assert.equal(properties.keywords.bsonType, 'array')
  assert.equal(properties.revision.bsonType, 'int')

  assert.deepEqual(required.sort(), [
    'chunk_id', 'file_id', 'user_id', 'heading', 'content',
    'keywords', 'start_offset', 'end_offset', 'revision', 'created_at'
  ].sort())
})

test('mm-images / mm-settings / mm-user-permissions 字段与架构 2.3/2.5/2.6 一致', () => {
  const images = schemaOf('mm-images')
  assert.deepEqual(images.required.sort(), [
    'file_id', 'user_id', 'name', 'extension', 'size', 'cloud_path',
    'ref_count', 'order', 'created_at', 'updated_at'
  ].sort())
  assert.equal(images.properties.order.defaultValue, 0, '图片顺序权重默认 0，order 越大越靠前')

  const settings = schemaOf('mm-settings')
  assert.deepEqual(settings.required.sort(), [
    'key', 'account_enabled', 'permission_enabled', 'admin_user_id', 'updated_by', 'updated_at'
  ].sort())
  assert.equal(settings.properties.account_enabled.defaultValue, true, '账号功能默认开启（PRD R12）')
  assert.equal(settings.properties.permission_enabled.defaultValue, false, '权限功能默认关闭（PRD R13）')
  assert.equal(settings.properties.key.defaultValue, 'app_config')

  const permissions = schemaOf('mm-user-permissions')
  assert.deepEqual(permissions.required.sort(), [
    'user_id', 'role', 'can_read', 'can_write', 'created_at', 'updated_at'
  ].sort())
  assert.deepEqual(permissions.properties.role.enum, ['admin', 'user'])
})

test('6 张表索引文件 JSON 合法，索引名与架构 2.7 一致', () => {
  const expected = {
    'mm-files': {
      idx_user_parent_del: false,
      idx_parent_name: false,
      idx_name: false,
      idx_tags: false,
      idx_del: false,
      idx_updated: false
    },
    'mm-comments': { idx_file_status: false, idx_user: false, idx_created: false },
    'mm-images': { uidx_file_id: true, idx_user: false },
    'mm-index-chunks': { uidx_chunk_id: true, idx_file_rev: false, idx_file: false, idx_keywords: false },
    'mm-settings': { uidx_key: true },
    'mm-user-permissions': { uidx_user_id: true }
  }

  for (const table of TABLES) {
    const indexes = indexOf(table)
    assert.ok(Array.isArray(indexes), `${table}.index.json 必须是数组`)

    const actual = {}
    for (const item of indexes) {
      assert.equal(typeof item.IndexName, 'string')
      assert.ok(item.MgoKeySchema, `${table} 索引 ${item.IndexName} 缺少 MgoKeySchema`)
      assert.ok(Array.isArray(item.MgoKeySchema.MgoIndexKeys))
      assert.ok(item.MgoKeySchema.MgoIndexKeys.length > 0)
      for (const key of item.MgoKeySchema.MgoIndexKeys) {
        assert.equal(typeof key.Name, 'string')
        assert.ok(['1', '-1'].includes(key.Direction), `索引方向非法：${key.Direction}`)
      }
      actual[item.IndexName] = item.MgoKeySchema.MgoIsUnique === true
    }
    assert.deepEqual(actual, expected[table], `${table} 索引定义与架构 2.7 不一致`)
  }
})

test('mm-settings.init_data.json 预置单条 app_config（账号开启 / 权限关闭）', () => {
  const initData = readJson('uniCloud-alipay/database/mm-settings.init_data.json')
  assert.ok(Array.isArray(initData))
  assert.equal(initData.length, 1)
  const config = initData[0]
  assert.equal(config.key, 'app_config')
  assert.equal(config.account_enabled, true)
  assert.equal(config.permission_enabled, false)
  assert.equal(config.admin_user_id, '')
})
