/**
 * 同目录重名处理测试（AC-02 / R03）。
 *
 * 规则：原名不冲突则原样返回；冲突时追加 -copy1 / -copy2 … 并保留扩展名；
 * 同一输入与同一已有名称集合必然得到同一结果（幂等）；重名作用域是「同目录」。
 * 云侧 lib/name.js 为权威实现，前端 common/utils/name.js 用于上传前预览，两者结果必须一致。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { loadEsm } = require('./helpers/load-esm')

const ROOT = path.resolve(__dirname, '..')
const cloudName = require(path.join(
  ROOT,
  'uniCloud-alipay/cloudfunctions/common/mm-common/lib/name.js'
))

let frontName = null

test.before(async () => {
  frontName = await loadEsm('common/utils/name.js')
})

test('同目录连续上传同名文件：原名 → -copy1 → -copy2（AC-02）', () => {
  const uploaded = []
  const existing = []

  for (let round = 0; round < 3; round++) {
    const finalName = cloudName.genUniqueName('a.md', existing)
    uploaded.push(finalName)
    existing.push(finalName)
  }

  assert.deepEqual(uploaded, ['a.md', 'a-copy1.md', 'a-copy2.md'])
})

test('改名撞名同样追加 -copyN（AC-02）', () => {
  const existing = ['周报.md', '周报-copy1.md']
  assert.equal(cloudName.genUniqueName('周报.md', existing), '周报-copy2.md')
})

test('已有名称不含目标名时原样返回，且不产生多余后缀', () => {
  assert.equal(cloudName.genUniqueName('a.md', []), 'a.md')
  assert.equal(cloudName.genUniqueName('a.md', ['b.md', 'c.md']), 'a.md')
})

test('幂等：同一输入与同一已有名称集合，多次调用结果完全一致', () => {
  const existing = ['a.md', 'a-copy1.md', 'a-copy3.md']
  const first = cloudName.genUniqueName('a.md', existing)
  for (let i = 0; i < 5; i++) {
    assert.equal(cloudName.genUniqueName('a.md', existing), first, '同名输入必须幂等')
  }
  assert.equal(first, 'a-copy2.md', '应填入最小可用序号')
})

test('已是 -copyN 形态时基于其主名继续递增，不产生 -copy1-copy1', () => {
  assert.equal(cloudName.genUniqueName('a-copy1.md', ['a-copy1.md']), 'a-copy2.md')
  assert.equal(cloudName.genUniqueName('a-copy1.md', ['a-copy1.md', 'a-copy2.md']), 'a-copy3.md')
})

test('跨目录同名互不影响（重名作用域为同目录）', () => {
  // 目录 A 内已有 a.md，目录 B 内为空 —— 函数只接收「同目录已有名称」
  const dirA = ['a.md']
  const dirB = []
  assert.equal(cloudName.genUniqueName('a.md', dirA), 'a-copy1.md')
  assert.equal(cloudName.genUniqueName('a.md', dirB), 'a.md', '不同目录不应互相干扰')
})

test('无扩展名、多点扩展名、中文名的拆名规则', () => {
  assert.deepEqual(cloudName.splitName('noext'), { base: 'noext', ext: '' })
  assert.deepEqual(cloudName.splitName('archive.tar.gz'), { base: 'archive.tar', ext: '.gz' })
  assert.deepEqual(cloudName.splitName('说明.md'), { base: '说明', ext: '.md' })
  assert.deepEqual(cloudName.splitName('.hidden'), { base: '.hidden', ext: '' })

  assert.equal(cloudName.genUniqueName('noext', ['noext']), 'noext-copy1')
  assert.equal(cloudName.genUniqueName('说明.md', ['说明.md']), '说明-copy1.md')
})

test('入参容错：非字符串与非法集合不抛错', () => {
  assert.equal(cloudName.genUniqueName(undefined, []), '')
  assert.equal(cloudName.genUniqueName('a.md', null), 'a.md')
  assert.equal(cloudName.genUniqueName('a.md', 'not-an-array'), 'a.md')
})

test('前端 common/utils/name.js 与云侧算法结果逐项一致', () => {
  const cases = [
    ['a.md', []],
    ['a.md', ['a.md']],
    ['a.md', ['a.md', 'a-copy1.md']],
    ['a.md', ['a.md', 'a-copy1.md', 'a-copy2.md', 'a-copy4.md']],
    ['a-copy1.md', ['a-copy1.md']],
    ['noext', ['noext']],
    ['说明.md', ['说明.md', '说明-copy1.md']]
  ]
  for (const [name, existing] of cases) {
    assert.equal(
      frontName.genUniqueName(name, existing),
      cloudName.genUniqueName(name, existing),
      `前后端 genUniqueName 结果不一致：${name} / ${JSON.stringify(existing)}`
    )
  }
  assert.deepEqual(frontName.splitName('archive.tar.gz'), cloudName.splitName('archive.tar.gz'))
})
