/**
 * 哈希 / 字节数 / 随机 ID 测试（AC-03 元数据重算基础）。
 *
 * sha256 与 byteSize 是 content_hash / size 的唯一算法来源（C3），
 * 必须与标准 SHA-256 一致、中文按 UTF-8 字节计数。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { loadEsm } = require('./helpers/load-esm')

const ROOT = path.resolve(__dirname, '..')
const hash = require(path.join(
  ROOT,
  'uniCloud-alipay/cloudfunctions/common/mm-common/lib/hash.js'
))

/** UUID v4 形态 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

test('sha256 与标准 SHA-256 值一致（固定向量）', () => {
  assert.equal(hash.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(hash.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(hash.sha256('中文'), '72726d8818f693066ceb69afa364218b692e62ea92b385782363780f47529c21')
  assert.equal(hash.sha256('# 新标题\n\n新内容'), 'ef67d8c1d56dbb493e2fc17ebff7b9815d7e8cba920fb4d8dd3ac69a735bf243')
})

test('sha256 输出恒为 64 位小写十六进制', () => {
  for (const sample of ['', 'a', '中文内容', '# 标题\n\n段落']) {
    const digest = hash.sha256(sample)
    assert.equal(digest.length, 64)
    assert.match(digest, /^[0-9a-f]{64}$/)
  }
})

test('sha256 区分不同内容（内容变化即 hash 变化，支撑 AC-03）', () => {
  assert.notEqual(hash.sha256('内容甲'), hash.sha256('内容乙'))
  assert.notEqual(hash.sha256('内容甲'), hash.sha256('内容甲 '))
})

test('byteSize 按 UTF-8 字节计数（中文与 emoji 正确）', () => {
  assert.equal(hash.byteSize(''), 0)
  assert.equal(hash.byteSize('abc'), 3)
  assert.equal(hash.byteSize('中文'), 6, '中文按 UTF-8 每字 3 字节')
  assert.equal(hash.byteSize('中文abc'), 9)
  assert.equal(hash.byteSize('😀'), 4, 'emoji 按 4 字节计')
  assert.equal(hash.byteSize('# 标题'), 8, '"#" 1 字节 + 空格 1 字节 + 中文 6 字节')
})

test('sha256 / byteSize 对非字符串入参安全降级', () => {
  assert.equal(hash.sha256(undefined), hash.sha256(''))
  assert.equal(hash.sha256(null), hash.sha256(''))
  assert.equal(hash.sha256(123), hash.sha256('123'))
  assert.equal(hash.byteSize(undefined), 0)
  assert.equal(hash.byteSize(null), 0)
  assert.equal(hash.byteSize(123), 3)
})

test('云侧 genUuid 生成合法 UUID 且不重复', () => {
  const seen = new Set()
  for (let i = 0; i < 50; i++) {
    const value = hash.genUuid()
    assert.match(value, UUID_V4, `genUuid 结果不是 UUID v4：${value}`)
    seen.add(value)
  }
  assert.equal(seen.size, 50, 'genUuid 不应产生重复值')
})

test('前端 common/utils/uuid.js 与云侧同规则（合法 UUID v4）', async () => {
  const frontUuid = await loadEsm('common/utils/uuid.js')
  for (let i = 0; i < 20; i++) {
    const value = frontUuid.genUuid()
    assert.match(value, UUID_V4, `前端 genUuid 结果不是 UUID v4：${value}`)
  }
  assert.notEqual(frontUuid.genUuid(), frontUuid.genUuid(), '前端 genUuid 不应连续重复')
})
