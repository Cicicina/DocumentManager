/**
 * 编辑器格式栏（md-editor-v3 工具条）顺序配置。
 *
 * 背景：md-editor-v3 的 `toolbars` prop 是一个「按钮 key 数组」，顺序即渲染顺序；
 * 其中 '-' 是分隔线、'=' 是左右分组分界（之后的元素进右侧组）。数组里放数字 N
 * 则渲染 defToolbars slot 的第 N 个自定义节点——本项目用它放最右侧的「更多」按钮。
 *
 * 本模块是前端（uni-app ESM）与云对象（CommonJS）共用的唯一口径：
 * - DEFAULT_TOOLBAR_ORDER：md-editor-v3@4.21.3 的默认 allToolbar，原样保留；
 * - normalizeToolbarOrder：去重、过滤未知 key、补齐缺失项，防止手改配置或版本升级
 *   后按钮丢失；
 * - buildToolbars：在归一化顺序后追加「更多」按钮的数字索引（MORE_TOOLBAR_INDEX）。
 *
 * 注意：云侧 commonjs 不能 import 本文件，mm-settings/index.obj.js 里有一份等价的
 * 常量与归一化函数；tests 会断言两份清单逐项一致，避免两边漂移。
 */

/** defToolbars slot 中「更多」按钮的索引（slot 里只放这一个节点，故固定为 0） */
export const MORE_TOOLBAR_INDEX = 0

/** 分隔线 token（md-editor-v3 识别） */
export const TOOLBAR_SEPARATOR = '-'
/** 左右分组分界 token（md-editor-v3 识别） */
export const TOOLBAR_SPLIT = '='

/** 默认顺序，与 md-editor-v3 lib 的 allToolbar 完全一致 */
export const DEFAULT_TOOLBAR_ORDER = [
  'bold', 'underline', 'italic', 'strikeThrough', '-',
  'title', 'sub', 'sup', 'quote', 'unorderedList', 'orderedList', 'task', '-',
  'codeRow', 'code', 'link', 'image', 'table', 'mermaid', 'katex', '-',
  'revoke', 'next', 'save', '=',
  'prettier', 'pageFullscreen', 'fullscreen', 'preview', 'previewOnly',
  'htmlPreview', 'catalog', 'github'
]

/** 排序面板里展示的中文名（含分隔线 / 分组） */
export const TOOLBAR_LABELS = {
  bold: '加粗',
  underline: '下划线',
  italic: '斜体',
  strikeThrough: '删除线',
  '-': '分隔线',
  title: '标题',
  sub: '下标',
  sup: '上标',
  quote: '引用',
  unorderedList: '无序列表',
  orderedList: '有序列表',
  task: '任务列表',
  codeRow: '行内代码',
  code: '代码块',
  link: '链接',
  image: '图片',
  table: '表格',
  mermaid: 'Mermaid 图',
  katex: 'KaTeX 公式',
  revoke: '撤销',
  next: '重做',
  save: '保存',
  '=': '右侧分组',
  prettier: '美化',
  pageFullscreen: '页面全屏',
  fullscreen: '全屏',
  preview: '预览',
  previewOnly: '仅预览',
  htmlPreview: 'HTML 预览',
  catalog: '目录',
  github: '源码地址'
}

const ALLOWED = new Set(DEFAULT_TOOLBAR_ORDER)
/** 分隔线与分组标记允许重复出现（md-editor 用它渲染多条分隔线），按钮 key 必须唯一 */
const isSeparator = key => key === TOOLBAR_SEPARATOR || key === TOOLBAR_SPLIT

/**
 * 归一化工具条顺序。
 * @param {*} input 云端保存的顺序
 * @returns {string[]} 合法顺序；非法输入回退默认。
 *
 * 规则：过滤未知 key；按钮去重（保留首次）；分隔符按其原样保留；最后补齐缺失按钮。
 * 这样既不会渲染重复按钮，也不会误删默认顺序里本就存在的多条分隔线。
 */
export function normalizeToolbarOrder(input) {
  const source = Array.isArray(input) && input.length > 0 ? input : DEFAULT_TOOLBAR_ORDER
  const seen = new Set()
  const result = []
  for (const key of source) {
    if (!ALLOWED.has(key)) continue
    if (!isSeparator(key)) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    result.push(key)
  }
  // 补齐缺失按钮：版本升级新增的按钮、或被误删的项都要回到列表里，避免功能丢失
  for (const key of DEFAULT_TOOLBAR_ORDER) {
    if (!isSeparator(key) && !seen.has(key)) {
      seen.add(key)
      result.push(key)
    }
  }
  return result
}

/**
 * 传给 MdEditor 的 toolbars prop：归一化顺序 + 末尾「更多」按钮索引。
 * 「更多」固定追加在最后（右侧分组之后），始终位于格式栏最右端。
 * @param {*} order 云端保存的顺序
 * @returns {Array<string|number>}
 */
export function buildToolbars(order) {
  return normalizeToolbarOrder(order).concat(MORE_TOOLBAR_INDEX)
}

export default {
  MORE_TOOLBAR_INDEX,
  TOOLBAR_SEPARATOR,
  TOOLBAR_SPLIT,
  DEFAULT_TOOLBAR_ORDER,
  TOOLBAR_LABELS,
  normalizeToolbarOrder,
  buildToolbars
}
