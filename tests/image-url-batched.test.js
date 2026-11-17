/**
 * getTempUrlsBatched 回归测试：云端单次上限 50，前端每页 60。
 * 验证分批拉取 + 合并映射，确保第 51~60 张图片也能拿到 URL（不再显示占位图）。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readText } = require('./helpers/load-esm.js')
const { loadInjectedModule } = require('./helpers/api-runtime.js')

async function loadApi(impl) {
  const source = readText('common/api/mm-image.js')
  const { module } = await loadInjectedModule(source, {
    deps: {
      call: impl,
      callSilent: async () => ({ code: 0, data: null })
    }
  })
  return module
}

test('60 个 fileID 分成 50 + 10 两批，合并后全部有 URL', async () => {
  const batches = []
  const impl = async (obj, method, param) => {
    batches.push(param.file_ids.slice())
    const data = {}
    for (const id of param.file_ids) data[id] = 'https://temp/' + id
    return { code: 0, data, message: '' }
  }
  const api = await loadApi(impl)
  const ids = Array.from({ length: 60 }, (_, i) => 'cloud://img/' + i)

  const res = await api.getTempUrlsBatched(ids)
  assert.equal(res.code, 0)
  assert.equal(batches.length, 2, '应分两批调用云端')
  assert.equal(batches[0].length, 50, '第一批 50 个')
  assert.equal(batches[1].length, 10, '第二批 10 个')
  assert.equal(Object.keys(res.data).length, 60, '60 个 URL 全部合并返回')
  assert.equal(res.data['cloud://img/59'], 'https://temp/cloud://img/59', '最后一张也有 URL')
})

test('部分批次失败但已有 URL 时仍返回成功映射', async () => {
  let n = 0
  const impl = async (obj, method, param) => {
    n += 1
    if (n === 2) return { code: 3003, data: null, message: '图片加载失败' }
    const data = {}
    for (const id of param.file_ids) data[id] = 'https://temp/' + id
    return { code: 0, data, message: '' }
  }
  const api = await loadApi(impl)
  const ids = Array.from({ length: 60 }, (_, i) => 'cloud://img/' + i)

  const res = await api.getTempUrlsBatched(ids)
  assert.equal(res.code, 0, '已有部分 URL 应按成功处理')
  assert.equal(Object.keys(res.data).length, 50, '成功批次的 50 个 URL 仍返回')
})

test('全部批次失败时返回失败码，交调用方提示', async () => {
  const impl = async () => ({ code: 3003, data: null, message: '图片加载失败，请重试' })
  const api = await loadApi(impl)
  const res = await api.getTempUrlsBatched(['cloud://img/a'])
  assert.equal(res.code, 3003)
  assert.equal(res.data, null)
})

test('空列表直接返回空映射，不调用云端', async () => {
  let called = 0
  const impl = async () => { called += 1; return { code: 0, data: {} } }
  const api = await loadApi(impl)
  const res = await api.getTempUrlsBatched([])
  assert.equal(res.code, 0)
  assert.deepEqual(res.data, {})
  assert.equal(called, 0)
})
