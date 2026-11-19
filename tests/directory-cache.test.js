/**
 * 合并目录本地缓存：只存目录结构与文档元数据，不存正文；云端一致时不覆盖。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadEsm } = require('./helpers/load-esm.js')

class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(Object.fromEntries(this.map), key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    this.map.set(String(key), String(value))
  }
  removeItem(key) {
    this.map.delete(String(key))
  }
}

function withStorage(storage, fn) {
  const previous = globalThis.localStorage
  globalThis.localStorage = storage
  try {
    return fn()
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
}

test('buildDirectoryCache：剔除正文与临时图标 URL，只保留元数据', async () => {
  const cache = await loadEsm('common/utils/directory-cache.js')
  const built = cache.buildDirectoryCache({
    owner: 'u1',
    expanded: { f1: true, f2: false },
    folders: [{
      _id: 'f1', name: 'A', parent_id: '',
      icon: { type: 'custom', value: 'file-id', url: 'https://temp' }
    }],
    files: {
      f1: [{
        _id: 'd1', name: 'doc.md', size: 12, updated_at: '2026-11-20',
        content: '机密正文', content_text: '正文', tempUrl: 'https://temp-doc',
        icon: { type: 'custom', value: 'icon-id', url: 'https://temp-icon' }
      }]
    },
    sort: { key: 'name', dir: 'asc' }
  })

  assert.equal(built.owner, 'u1')
  assert.deepEqual(built.expanded, { f1: true })
  assert.equal(built.folders[0].icon.url, undefined)
  assert.equal(built.files.f1[0].content, undefined)
  assert.equal(built.files.f1[0].content_text, undefined)
  assert.equal(built.files.f1[0].tempUrl, undefined)
  assert.equal(built.files.f1[0].icon.url, undefined)
  assert.equal(built.files.f1[0].name, 'doc.md')
  assert.deepEqual(built.sort, { key: 'name', dir: 'asc' })
})

test('saveDirectoryCache / loadDirectoryCache：owner 或版本不符一律不载入', async () => {
  const cache = await loadEsm('common/utils/directory-cache.js')
  const storage = new MemoryStorage()
  withStorage(storage, () => {
    assert.equal(cache.saveDirectoryCache({
      owner: 'u1',
      expanded: { f1: true },
      folders: [{ _id: 'f1', name: 'A', parent_id: '' }],
      files: { f1: [{ _id: 'd1', name: 'doc.md', size: 1 }] }
    }), true)
    assert.equal(cache.loadDirectoryCache('u1').folders[0]._id, 'f1')
    assert.equal(cache.loadDirectoryCache('other'), null)
  })

  storage.setItem(cache.DIRECTORY_CACHE_KEY, JSON.stringify({ version: 999, owner: 'u1' }))
  withStorage(storage, () => assert.equal(cache.loadDirectoryCache('u1'), null))
  storage.setItem(cache.DIRECTORY_CACHE_KEY, '{broken')
  withStorage(storage, () => assert.equal(cache.loadDirectoryCache('u1'), null))
})

test('folderListsEqual / fileListsEqual：忽略临时字段但能识别真实变更', async () => {
  const cache = await loadEsm('common/utils/directory-cache.js')
  const folderA = [{ _id: 'f1', name: 'A', parent_id: '', icon: { type: 'custom', value: 'x', url: 'url-1' } }]
  const folderB = [{ _id: 'f1', name: 'A', parent_id: '', icon: { type: 'custom', value: 'x', url: 'url-2' } }]
  assert.equal(cache.folderListsEqual(folderA, folderB), true)
  assert.equal(cache.folderListsEqual(folderA, [{ ...folderA[0], name: 'B' }]), false)

  const fileA = [{ _id: 'd1', name: 'doc.md', size: 12, updated_at: 't1', content: 'old' }]
  const fileB = [{ _id: 'd1', name: 'doc.md', size: 12, updated_at: 't1', content: 'new', tempUrl: 'u' }]
  assert.equal(cache.fileListsEqual(fileA, fileB), true)
  assert.equal(cache.fileListsEqual(fileA, [{ ...fileA[0], size: 13 }]), false)
  assert.equal(cache.fileListsEqual(fileA, [{ ...fileA[0], version: 5 }]), false)
})
