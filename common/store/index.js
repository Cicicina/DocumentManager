/**
 * MarkdownManager 全局状态（模块级 reactive 单例，不引入 vuex / pinia）。
 *
 * 设计约定（架构 8.4、业务规则 C1、验收 AC-12）：
 * 1. state.editorContent 是**全应用唯一的编辑内容源**，编辑器 v-model 必须直接绑定它；
 *    任何组件都不得再各自持有第二份可编辑正文。
 * 2. 版本冲突弹窗的「覆写 / 放弃」两条路径，以及保存失败、接口异常、主题切换、
 *    打开设置、切换侧栏等任何非「主动打开另一篇文档」的操作，都**不得**对
 *    editorContent 赋空串、不得切回阅读态、不得 uni.reLaunch / 刷新页面。
 *    放弃后用户仍停留在编辑态，可继续编辑或再次保存。
 * 3. baseVersion 只在「打开文档」与「保存成功后」更新；冲突放弃时保持不变。
 * 4. canWrite 仅用于前端隐藏入口，真正的安全边界在云对象 AuthGuard.assertWrite。
 */
import { reactive, computed } from 'vue'

/** 全局单一状态对象，import 即共享 */
const state = reactive({
  /** 系统配置：账号 / 权限开关、管理员 ID */
  config: {
    account_enabled: true,
    permission_enabled: false,
    admin_user_id: '',
    // 编辑器格式栏顺序；App.vue 启动 getConfig 后由 setConfig 覆盖为云端值
    toolbar_order: []
  },
  /** 当前身份；账号关闭时为固定匿名身份 */
  user: {
    uid: '',
    role: 'user',
    anonymous: false,
    canRead: true,
    canWrite: true
  },
  /** 目录树（folder 节点） */
  tree: [],
  /** 当前目录下的文档列表 */
  files: [],
  /** 当前打开的文档记录 */
  currentFile: null,
  /** 编辑器受控内容：唯一编辑内容源，冲突「放弃」时不清空 */
  editorContent: '',
  /** 打开文档时记录的基准版本 */
  baseVersion: 0,
  /** 当前文档的批注列表（含 orphaned） */
  comments: [],
  /** 主题模式：auto | light | dark */
  theme: 'auto',
  /** 首屏配置 / 登录态 / 目录树是否就绪，控制加载动画淡出 */
  ready: false
})

/**
 * 获取全局状态与操作方法。
 * @returns {{state: object, isAnonymous: object, canWrite: object, setConfig: Function,
 *   setUser: Function, setTheme: Function, setTree: Function, setFiles: Function,
 *   openFile: Function, setEditor: Function, resetBaseVersion: Function,
 *   setComments: Function, setReady: Function}}
 */
export function useAppStore() {
  /** 是否匿名模式 */
  const isAnonymous = computed(() => state.user.anonymous === true)

  /** 前端写权限展示态，仅用于隐藏入口，不作安全边界 */
  const canWrite = computed(() => {
    if (state.user.anonymous) return true
    if (!state.config.permission_enabled) return true
    return state.user.role === 'admin' || state.user.canWrite === true
  })

  /** 合并系统配置 */
  function setConfig(config) {
    if (config && typeof config === 'object') {
      Object.assign(state.config, config)
    }
  }

  /** 合并当前身份 */
  function setUser(user) {
    if (user && typeof user === 'object') {
      Object.assign(state.user, user)
    }
  }

  /** 设置主题模式 */
  function setTheme(mode) {
    state.theme = mode === 'light' || mode === 'dark' ? mode : 'auto'
  }

  /** 替换目录树 */
  function setTree(tree) {
    state.tree = Array.isArray(tree) ? tree : []
  }

  /** 替换当前目录文档列表 */
  function setFiles(files) {
    state.files = Array.isArray(files) ? files : []
  }

  /**
   * 主动打开另一篇文档：这是唯一允许替换 editorContent 的入口。
   * @param {object} doc 文档记录
   * @param {string} content 文档 md 原文
   * @param {Array} comments 该文档批注
   */
  function openFile(doc, content, comments) {
    state.currentFile = doc || null
    state.editorContent = typeof content === 'string' ? content : ''
    state.baseVersion = doc && typeof doc.version === 'number' ? doc.version : 0
    state.comments = Array.isArray(comments) ? comments : []
  }

  /**
   * 编辑器受控内容写入。
   * 约定：只在用户真实输入时调用；冲突弹窗、保存失败、主题切换等路径禁止
   * 传入空串来「重置」编辑器（C1 / AC-12）。
   * @param {string} text md 原文
   */
  function setEditor(text) {
    if (typeof text === 'string') {
      state.editorContent = text
    }
  }

  /** 保存成功后刷新基准版本（冲突放弃时不调用） */
  function resetBaseVersion(version) {
    if (typeof version === 'number' && version >= 0) {
      state.baseVersion = version
    }
  }

  /** 替换当前文档批注列表 */
  function setComments(comments) {
    state.comments = Array.isArray(comments) ? comments : []
  }

  /** 标记首屏是否就绪 */
  function setReady(value) {
    state.ready = value === true
  }

  return {
    state,
    isAnonymous,
    canWrite,
    setConfig,
    setUser,
    setTheme,
    setTree,
    setFiles,
    openFile,
    setEditor,
    resetBaseVersion,
    setComments,
    setReady
  }
}

export default useAppStore
