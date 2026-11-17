/**
 * 云存储统一上传契约单测（H-7）。
 *
 * 目的：固化「客户端 uploadFile 只认 filePath」这一官方契约，
 * 防止后续又出现 `{ cloudPath, file }` 与 `{ cloudPath, filePath }` 两种形态并存。
 * 通过 mock globalThis.uniCloud 与 globalThis.URL 验证参数归一逻辑，不触网。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { uploadCloudFile } from '../../common/utils/upload.js'

/** 记录最近一次传给 uniCloud.uploadFile 的参数 */
let lastPayload = null

function installMocks() {
  const originalURL = globalThis.URL
  const originalUniCloud = globalThis.uniCloud
  globalThis.URL = {
    createObjectURL: () => 'blob:mock/created-1',
    revokeObjectURL: () => {}
  }
  globalThis.uniCloud = {
    uploadFile: async (payload) => {
      lastPayload = payload
      return { fileID: 'cloud://mock/file.md', requestId: 'req-1' }
    }
  }
  return () => {
    globalThis.URL = originalURL
    globalThis.uniCloud = originalUniCloud
    lastPayload = null
  }
}

test('缺少 cloudPath 直接抛错', async () => {
  const restore = installMocks()
  try {
    assert.throws(() => uploadCloudFile({ filePath: 'blob:x' }), /cloudPath/)
  } finally {
    restore()
  }
})

test('file 与 filePath 都没有时抛错', async () => {
  const restore = installMocks()
  try {
    assert.throws(() => uploadCloudFile({ cloudPath: 'a/b.md' }), /file/)
  } finally {
    restore()
  }
})

test('传 filePath 时原样透传（不创建 blob URL）', async () => {
  const restore = installMocks()
  try {
    const res = await uploadCloudFile({ cloudPath: 'markdown/u/1.md', filePath: 'blob:http://localhost/abc' })
    assert.equal(lastPayload.cloudPath, 'markdown/u/1.md')
    assert.equal(lastPayload.filePath, 'blob:http://localhost/abc')
    assert.equal(res.fileID, 'cloud://mock/file.md')
  } finally {
    restore()
  }
})

test('只有 File/Blob 时转成 blob URL 后以 filePath 提交', async () => {
  const restore = installMocks()
  try {
    const fakeFile = { name: 'a.md', size: 10 }
    await uploadCloudFile({ cloudPath: 'markdown/u/2.md', file: fakeFile })
    assert.equal(lastPayload.filePath, 'blob:mock/created-1')
    assert.equal(Object.prototype.hasOwnProperty.call(lastPayload, 'file'), false)
  } finally {
    restore()
  }
})

test('fileType 与 onUploadProgress 透传', async () => {
  const restore = installMocks()
  try {
    const progress = () => {}
    await uploadCloudFile({
      cloudPath: 'images/u/3.png',
      filePath: 'blob:x',
      fileType: 'image',
      onUploadProgress: progress
    })
    assert.equal(lastPayload.fileType, 'image')
    assert.equal(typeof lastPayload.onUploadProgress, 'function')
  } finally {
    restore()
  }
})
