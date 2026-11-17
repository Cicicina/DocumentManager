/**
 * 前端登录态运行时测试脚手架（仅供本地 node:test 使用，不参与 H5 编译）。
 *
 * 现有用例大多是「读源码 + 正则断言」，无法覆盖 uniCloud SDK 的运行时分支。
 * 本脚手架做三件事：
 * 1. 把内存 Mock 注入 globalThis（uni / uniCloud / getCurrentPages / setTimeout / 常量），
 *    并记录 Toast、跳转、清态、延时等副作用，供断言「只提示一次 / 只跳一次」；
 * 2. 把前端 ESM 源码（或 .vue 的 <script setup>）里的 import 绑定统一改为从
 *    globalThis.__MM_DEPS__ 解构，剥离 export 后以 data: URL 动态 import；
 *    每次加载都带唯一 nonce，保证模块级状态（loginInvalidHandled / lastToastAt /
 *    objectCache）在用例之间完全隔离；
 * 3. 支持 expose，把模块内部函数挂到 globalThis.__MM_EXPOSED__，便于对
 *    guardLogin / loadIdentity 等页面内部函数做真正的运行时验证。
 *
 * 全程只读源码，不落盘、不修改任何被测文件。
 */

'use strict'

const { loadEsm, readText, toImportableModule } = require('./load-esm.js')

/** 每个用例拿到的模块实例必须不同，避免模块级幂等标记串扰 */
let moduleSeq = 0

/** 需要保存 / 恢复的全局键 */
const GLOBAL_KEYS = [
  'uni',
  'uniCloud',
  'getCurrentPages',
  'setTimeout',
  '__MM_CONSTANTS__',
  '__MM_DEPS__',
  '__MM_EXPOSED__',
  '__MM_REAL_SETTIMEOUT__'
]

/** 匹配单行或多行的 `import { ... } from '...'` 语句 */
const IMPORT_BLOCK_RE = /^[ \t]*import[\s\S]*?from[ \t]*['"][^'"]+['"][ \t]*;?[ \t]*$/gm

/**
 * 从 import 语句里提取具名绑定，转换为解构写法（保留 as 别名）。
 * @param {string[]} blocks import 语句原文
 * @returns {string[]} 形如 ['computed', 'list: listImages']
 */
function parseImportBindings(blocks) {
  const bindings = []
  for (const block of blocks) {
    const named = /\{([\s\S]*?)\}/.exec(block)
    if (!named) continue
    for (const part of named[1].split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const alias = trimmed.split(/\s+as\s+/)
      if (alias.length === 2) bindings.push(`${alias[0].trim()}: ${alias[1].trim()}`)
      else bindings.push(trimmed)
    }
  }
  return Array.from(new Set(bindings))
}

/**
 * 安装全局 Mock。
 *
 * @param {object} [options]
 * @param {object} [options.storage] 初始本地存储（uni.getStorageSync 的数据源）
 * @param {object} [options.objects] 云对象名 → 方法表或工厂函数（供 importObject 返回）
 * @param {boolean} [options.navigateFails] 是否让 uni.navigateTo 触发 fail 回退
 * @param {Function} [options.getCurrentPages] 自定义页面栈
 * @returns {{storage:object, calls:object, flushTimers:Function, restore:Function}}
 */
function installGlobals(options) {
  const opts = options || {}
  const storage = Object.assign({}, opts.storage || {})
  const calls = {
    /** uni.showToast 收到的参数 */
    toasts: [],
    navigateTo: [],
    redirectTo: [],
    switchTab: [],
    reLaunch: [],
    navigateBack: [],
    /** 被 removeStorageSync 清掉的 key */
    removed: [],
    set: [],
    /** importObject 的调用记录（含 options，用于断言 customUI:true） */
    importObject: [],
    /** 被捕获的 setTimeout 回调 */
    timers: [],
    /** uni.$on / $off / $emit：登录成功同步钩子依赖 */
    eventOn: [],
    eventOff: [],
    eventEmit: []
  }
  const objects = opts.objects || {}

  const uni = {
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ''
    },
    setStorageSync(key, value) {
      storage[key] = value
      calls.set.push({ key, value })
    },
    removeStorageSync(key) {
      delete storage[key]
      calls.removed.push(key)
    },
    showToast(param) {
      calls.toasts.push(param || {})
    },
    showModal() {},
    showActionSheet() {},
    navigateTo(param) {
      calls.navigateTo.push(param || {})
      if (opts.navigateFails && typeof (param || {}).fail === 'function') {
        param.fail(new Error('mock navigateTo 失败'))
      }
    },
    redirectTo(param) {
      calls.redirectTo.push(param || {})
    },
    switchTab(param) {
      calls.switchTab.push(param || {})
    },
    reLaunch(param) {
      calls.reLaunch.push(param || {})
    },
    navigateBack(param) {
      calls.navigateBack.push(param || {})
    },
    $on(event, cb) {
      calls.eventOn.push({ event, cb })
    },
    $off(event, cb) {
      calls.eventOff.push({ event, cb })
    },
    $emit(event, payload) {
      calls.eventEmit.push({ event, payload })
    }
  }

  const uniCloud = {
    importObject(name, importOptions) {
      calls.importObject.push({ name, options: importOptions })
      const factory = objects[name]
      if (typeof factory === 'function') return factory(importOptions)
      return factory || {}
    }
  }

  // 保存原有全局，用例结束后逐一恢复，避免污染同文件的其他用例
  const saved = { value: {}, hasOwn: {} }
  for (const key of GLOBAL_KEYS) {
    saved.hasOwn[key] = Object.prototype.hasOwnProperty.call(globalThis, key)
    saved.value[key] = globalThis[key]
  }

  globalThis.uni = uni
  globalThis.uniCloud = uniCloud
  globalThis.getCurrentPages = opts.getCurrentPages || (() => [{ route: 'pages/index/index' }])
  // 捕获 600ms 延时跳转，测试里手动 flush，既不用真等也不依赖框架定时器
  globalThis.setTimeout = (fn, ms) => {
    calls.timers.push({ fn, ms })
    return calls.timers.length
  }
  globalThis.__MM_REAL_SETTIMEOUT__ = saved.value.setTimeout
  delete globalThis.__MM_DEPS__
  delete globalThis.__MM_EXPOSED__

  return {
    storage,
    calls,
    objects,
    /** 执行全部被捕获的延时回调（模拟 600ms 后跳登录页） */
    flushTimers() {
      const pending = calls.timers.splice(0)
      for (const item of pending) item.fn()
    },
    /** 恢复全部被替换的全局 */
    restore() {
      for (const key of GLOBAL_KEYS) {
        if (saved.hasOwn[key]) globalThis[key] = saved.value[key]
        else delete globalThis[key]
      }
    }
  }
}

/**
 * 读取 common/constants.js 的真实导出（ERR / ERR_MESSAGE / ANONYMOUS_USER_ID 等），
 * 注入被测模块与页面替身，避免测试内硬编码错误码与常量。
 * @returns {Promise<object>} constants.js 的模块命名空间
 */
async function loadConstants() {
  return loadEsm('common/constants.js')
}

/**
 * 把含 import 的前端源码改写为隔离的 data: URL 模块并动态 import。
 *
 * @param {string} source 源码文本（ESM 文件或 .vue 的 script setup 内容）
 * @param {object} [options]
 * @param {object} options.deps 注入到 __MM_DEPS__ 的依赖集合
 * @param {string[]} [options.expose] 需要挂到 __MM_EXPOSED__ 的内部名字
 * @returns {Promise<{module:object, exposed:object}>}
 */
async function loadInjectedModule(source, options) {
  const opts = options || {}
  const blocks = []
  const withoutImports = source.replace(IMPORT_BLOCK_RE, (block) => {
    blocks.push(block)
    return ''
  })
  const bindings = parseImportBindings(blocks)

  // 依赖必须齐全：缺名字会在解构时静默变成 undefined，运行时才报错，故先显式校验
  const deps = opts.deps || {}
  for (const binding of bindings) {
    // 形如 `add: addComment` 时，deps 需要提供的是源名 add，而不是本地别名 addComment
    const sourceName = binding.split(':')[0].trim()
    if (!(sourceName in deps)) {
      throw new Error(`缺少测试依赖注入：${sourceName}（源码 import 了但 deps 未提供）`)
    }
  }

  const depsLine = bindings.length
    ? `const { ${bindings.join(', ')} } = globalThis.__MM_DEPS__\n`
    : ''
  let code = toImportableModule(depsLine + withoutImports)
  if (opts.expose && opts.expose.length) {
    code += `\nglobalThis.__MM_EXPOSED__ = { ${opts.expose.join(', ')} }\n`
  }

  moduleSeq += 1
  const encoded = Buffer.from(`${code}\n// module-instance-${moduleSeq}\n`, 'utf8').toString('base64')
  globalThis.__MM_DEPS__ = deps
  delete globalThis.__MM_EXPOSED__
  const module = await import(`data:text/javascript;base64,${encoded}`)
  return { module, exposed: globalThis.__MM_EXPOSED__ || {} }
}

/**
 * 加载 common/api/index.js（注入真实 ERR / ERR_MESSAGE）。
 * @param {object} constants loadConstants() 的返回值
 * @param {string[]} [expose] 额外暴露的内部名字
 * @returns {Promise<{module:object, exposed:object}>}
 */
async function loadApiModule(constants, expose) {
  return loadInjectedModule(readText('common/api/index.js'), {
    deps: { ERR: constants.ERR, ERR_MESSAGE: constants.ERR_MESSAGE },
    expose
  })
}

module.exports = {
  loadConstants,
  installGlobals,
  loadInjectedModule,
  loadApiModule,
  parseImportBindings
}
