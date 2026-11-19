/**
 * 全局 toast 命令总线的运行时回归。
 *
 * toast.js 是零依赖 ESM，直接加载真实模块执行，验证：
 * - 各便捷方法（show/success/error/warning/info/loading/close）发出的命令类型；
 * - 订阅者能收到命令，多个订阅者都收到；
 * - 无订阅者时回退到 uni.showToast（测试/非 H5 环境不丢提示），且格式兼容 title 断言；
 * - close 是一条独立命令（由组件判断是否关 loading），loading 会被缓存供晚挂载补渲染；
 * - 取消订阅后不再收到命令。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { loadEsm } = require('./helpers/load-esm.js')

/** 每个用例加载全新模块实例，隔离模块级 subscribers / pendingLoading */
async function freshToast() {
  return loadEsm('common/utils/toast.js')
}

/** 安装一个记录 uni.showToast 的全局 uni，返回记录数组与还原函数 */
function installUni() {
  const calls = []
  const saved = Object.prototype.hasOwnProperty.call(globalThis, 'uni')
  const prev = globalThis.uni
  globalThis.uni = { showToast: param => calls.push(param || {}) }
  return {
    calls,
    restore() {
      if (saved) globalThis.uni = prev
      else delete globalThis.uni
    }
  }
}

test('各便捷方法发出正确 type 与文案（字符串 / 对象两种入参）', async () => {
  const mod = await freshToast()
  const received = []
  const off = mod.subscribe(cmd => received.push(cmd))

  mod.toast.show('常规')
  mod.toast.success('成功')
  mod.toast.error('失败')
  mod.toast.warning('警告')
  mod.toast.info('信息')
  mod.toast.loading('加载中')
  mod.toast.close()
  mod.toast.success({ msg: '对象入参', duration: 3000 })

  assert.deepEqual(received.map(c => c.type),
    ['show', 'success', 'error', 'warning', 'info', 'loading', 'close', 'success'])
  assert.equal(received[0].options.msg, '常规')
  assert.equal(received[7].options.msg, '对象入参')
  assert.equal(received[7].options.duration, 3000)
  off()
})

test('多个订阅者都收到同一命令', async () => {
  const mod = await freshToast()
  const a = []
  const b = []
  const offA = mod.subscribe(cmd => a.push(cmd))
  const offB = mod.subscribe(cmd => b.push(cmd))

  mod.toast.success('广播')

  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  assert.equal(a[0].options.msg, b[0].options.msg)
  offA()
  offB()
})

test('无订阅者时回退到 uni.showToast，格式含 title 兼容既有断言', async () => {
  const uni = installUni()
  try {
    const mod = await freshToast()
    mod.toast.error('服务异常，请重试')
    assert.equal(uni.calls.length, 1)
    assert.equal(uni.calls[0].title, '服务异常，请重试')
    assert.equal(uni.calls[0].icon, 'none')
  } finally {
    uni.restore()
  }
})

test('有订阅者时不再回退到 uni.showToast', async () => {
  const uni = installUni()
  try {
    const mod = await freshToast()
    const off = mod.subscribe(() => {})
    mod.toast.error('只走 wot')
    assert.equal(uni.calls.length, 0, '有 wot 组件订阅时不该再弹 uni.toast')
    off()
  } finally {
    uni.restore()
  }
})

test('loading 被缓存供晚挂载补渲染；close 清除缓存', async () => {
  const mod = await freshToast()
  mod.toast.loading('正在加载…')

  // 晚挂载的订阅者应立刻收到尚未关闭的 loading
  const late = []
  const off = mod.subscribe(cmd => late.push(cmd))
  assert.equal(late.length, 1)
  assert.equal(late[0].type, 'loading')
  assert.equal(late[0].options.msg, '正在加载…')

  late.length = 0
  mod.toast.close()
  // close 后再订阅，不应收到缓存的 loading（证明 close 清了缓存）
  const afterClose = []
  const off2 = mod.subscribe(cmd => afterClose.push(cmd))
  assert.equal(afterClose.length, 0, 'close 后不应残留 loading 缓存')
  off2()
  off()
})

test('close 不会缓存、也不会被晚挂载重放（避免误弹一次性提示）', async () => {
  const mod = await freshToast()
  mod.toast.success('一次性提示')
  const late = []
  const off = mod.subscribe(cmd => late.push(cmd))
  assert.equal(late.length, 0, 'success 是一次性提示，晚挂载不应重放')
  off()
})

test('取消订阅后不再收到命令', async () => {
  const mod = await freshToast()
  const seen = []
  const off = mod.subscribe(cmd => seen.push(cmd))
  mod.toast.show('第一条')
  off()
  mod.toast.show('第二条')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].options.msg, '第一条')
})
