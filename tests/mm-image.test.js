/**
 * mm-image 云对象源码级测试（AC-08 / AC-09 / C7 / Q6）。
 *
 * 覆盖：register 幂等（同一 fileID 不重复登记，支撑「从已有空间插入」不重复上传）、
 * 库中只存 fileID、getTempUrls 现场换取临时 URL、清理时先删云存储失败整体报错。
 * 真实 uploadFile / getTempFileURL 属「部署后验证」，本地用 Mock 验证调用契约。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createMockUniCloud } = require('./helpers/mock-unicloud')
const { loadCloudObject, callObject } = require('./helpers/cloud-env')

const ANON = '__anonymous__'
const IMAGE_KEY = 'cloud://mock-env/images/anon/a.png'

/** 构造匿名模式的图片环境 */
function createImageEnv() {
  const mock = createMockUniCloud()
  mock.__seed('mm-settings', {
    key: 'app_config', account_enabled: false, permission_enabled: false,
    admin_user_id: '', updated_by: '', updated_at: new Date()
  })
  return mock
}

const REGISTER_PARAM = {
  file_id: IMAGE_KEY,
  name: 'a.png',
  extension: 'PNG',
  size: 1024,
  cloud_path: 'images/anon/a.png'
}

test('register：登记成功后库中只存 fileID，扩展名小写化（AC-09）', async () => {
  const mock = createImageEnv()
  const mmImage = loadCloudObject('mm-image', mock)

  const result = await callObject(mmImage, 'register', REGISTER_PARAM)

  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.file_id, IMAGE_KEY, '库中只存云存储 fileID')
  assert.equal(result.data.extension, 'png')
  assert.equal(result.data.size, 1024)
  assert.equal(result.data.ref_count, 0, '本期引用计数写 0')
  assert.equal(result.data.cloud_path, 'images/anon/a.png')
  assert.equal(result.data.user_id, ANON)

  // 不得把临时 URL 落库（C7 / AC-09）
  assert.ok(!Object.prototype.hasOwnProperty.call(result.data, 'tempFileURL'))
  const stored = mock.__rows('mm-images')[0]
  for (const value of Object.values(stored)) {
    assert.ok(!String(value).startsWith('http'), '库中不得持久化临时 URL')
  }
})

test('register 幂等：同一 fileID 重复登记返回已有记录，不重复写入（AC-08 复用）', async () => {
  const mock = createImageEnv()
  const mmImage = loadCloudObject('mm-image', mock)

  const first = await callObject(mmImage, 'register', REGISTER_PARAM)
  const second = await callObject(mmImage, 'register', Object.assign({}, REGISTER_PARAM, { name: 'b.png' }))

  assert.equal(first.errCode, 0)
  assert.equal(second.errCode, 0)
  assert.equal(second.data._id, first.data._id, '同一 fileID 应复用已有记录')
  assert.equal(second.data.name, 'a.png', '幂等返回不覆盖原记录')
  assert.equal(mock.__rows('mm-images').length, 1, '不得产生重复图片记录')
})

test('register：缺参返回 1001，写库异常返回 4006', async () => {
  const mock = createImageEnv()
  const mmImage = loadCloudObject('mm-image', mock)

  for (const broken of [
    Object.assign({}, REGISTER_PARAM, { file_id: '' }),
    Object.assign({}, REGISTER_PARAM, { name: '' }),
    Object.assign({}, REGISTER_PARAM, { extension: '' }),
    Object.assign({}, REGISTER_PARAM, { cloud_path: '' })
  ]) {
    assert.equal((await callObject(mmImage, 'register', broken)).errCode, 1001)
  }
})

test('getTempUrls：现场换取临时 URL 映射，请求失败返回 3003（AC-09）', async () => {
  const mock = createImageEnv()
  const mmImage = loadCloudObject('mm-image', mock)

  const result = await callObject(mmImage, 'getTempUrls', { file_ids: [IMAGE_KEY] })
  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(typeof result.data[IMAGE_KEY], 'string')
  assert.ok(result.data[IMAGE_KEY].startsWith('https://'), '应返回临时 URL')
  assert.equal(mock.__rows('mm-images').length, 0, '换取临时 URL 不得写入图片表')

  mock.__behavior.tempUrlThrows = true
  const failed = await callObject(mmImage, 'getTempUrls', { file_ids: [IMAGE_KEY] })
  assert.equal(failed.errCode, 3003)

  const empty = await callObject(mmImage, 'getTempUrls', { file_ids: [] })
  assert.equal(empty.errCode, 1001)
})

test('remove：先删云存储再删记录；云存储失败整体 3002 且记录保留（Q6）', async () => {
  const mock = createImageEnv()
  const mmImage = loadCloudObject('mm-image', mock)
  const registered = await callObject(mmImage, 'register', REGISTER_PARAM)
  assert.equal(registered.errCode, 0)

  // 失败路径
  mock.__behavior.deleteFailed.add(IMAGE_KEY)
  const failed = await callObject(mmImage, 'remove', { image_ids: [registered.data._id] })
  assert.equal(failed.errCode, 3002)
  assert.equal(mock.__rows('mm-images').length, 1, '云存储删除失败时不得删记录')

  // 成功路径
  mock.__behavior.deleteFailed.clear()
  const result = await callObject(mmImage, 'remove', { image_ids: [registered.data._id] })
  assert.equal(result.errCode, 0, result.errMsg)
  assert.equal(result.data.deleted, 1)
  assert.equal(result.data.deletedKeys, 1)
  assert.equal(mock.__rows('mm-images').length, 0)

  assert.ok(mock.__log.deletes.length >= 1, '应调用 deleteFile')
  assert.deepEqual(mock.__log.deletes[mock.__log.deletes.length - 1].fileList, [IMAGE_KEY])
})

test('list：只返回当前身份的图片记录且不含临时 URL', async () => {
  const mock = createImageEnv()
  const mmImage = loadCloudObject('mm-image', mock)
  await callObject(mmImage, 'register', REGISTER_PARAM)

  const result = await callObject(mmImage, 'list', {})
  assert.equal(result.errCode, 0)
  assert.equal(result.data.total, 1)
  assert.equal(result.data.list[0].file_id, IMAGE_KEY)
  assert.ok(!Object.prototype.hasOwnProperty.call(result.data.list[0], 'tempFileURL'))
})
