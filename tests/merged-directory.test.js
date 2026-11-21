/**
 * 移动端左侧目录：上下两个视口合并为一个层级视口，并带本地缓存 + 云端核对。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readText } = require('./helpers/load-esm.js')
const { parse, compileTemplate } = require('@vue/compiler-sfc')

function compile(path) {
  const src = readText(path)
  const { descriptor, errors } = parse(src)
  assert.equal(errors.length, 0, path + ' SFC 解析无错误')
  const out = compileTemplate({ source: descriptor.template.content, filename: path, id: 'x' })
  assert.equal(out.errors.length, 0, path + ' 模板编译无错误')
  return { src, out }
}

test('mm-directory：文件夹与文件在同一视口按层级展开，文件显示时间/大小', () => {
  const { src, out } = compile('components/mm-directory/mm-directory.vue')
  assert.match(src, /filesByFolder: \{ type: Object/, '组件接收各目录文件索引')
  assert.match(src, /v-for="node in visibleNodes"/, '文件夹与文件共用一条层级列表')
  assert.match(src, /node\.kind === 'folder'/, '文件夹行分支')
  assert.match(src, /@click="emit\('open', node\.data\)"/, '文件行分支')
  assert.match(src, /formatTime\(node\.data\.updated_at\)/, '文件显示修改时间')
  assert.match(src, /formatSize\(node\.data\.size\)/, '文件显示大小')
  assert.match(src, /mm-dir__folder-label/, '文件夹仍按原来的方式显示（只标文件夹）')
  assert.match(src, /class="mm-dir__check"/, '文件保留左侧复选框')
  assert.match(src, /folder-default\.svg/, '文件夹保留默认图标回退')
})

test('mm-directory：排序作用于所有展开层级，未展开目录也使用同一比较器', () => {
  const { src } = compile('components/mm-directory/mm-directory.vue')
  assert.match(src, /function sortedEntries\(parentId\)/, '统一比较器按父级生成条目')
  assert.match(src, /for \(const folder of foldersByParent\.value\[parentId\]/, '文件夹参与排序')
  assert.match(src, /for \(const file of filesOf\(parentId\)\)/, '文件参与排序')
  assert.match(src, /if \(entry\.kind === 'folder' && isExpanded\(id\)\) walk\(id, depth \+ 1\)/,
    '展开时递归到子层级，子层级同样走 sortedEntries')
  assert.match(src, /emit\('sort-change', \{ key: nextKey, dir: nextDir \}\)/, '排序变化上报页面')
})

test('mm-directory：文件夹/文件更多菜单功能项与需求逐项一致', () => {
  const { src } = compile('components/mm-directory/mm-directory.vue')
  const folderMenu = src.slice(src.indexOf('function openFolderMenu'), src.indexOf('function openFileMenu'))
  const fileMenu = src.slice(src.indexOf('function openFileMenu'), src.indexOf('function formatTime'))
  assert.match(folderMenu, /\['新建子文件夹', '重命名', '移动到…', '更换图标', '删除'\]/)
  assert.match(fileMenu, /\['重命名', '移动到…', '分享…', '导出 md', '删除'\]/)
  assert.match(folderMenu, /emit\('folder-rename', folder\)/)
  assert.match(folderMenu, /emit\('folder-move', folder\)/)
  assert.match(folderMenu, /emit\('folder-remove', folder\)/)
  assert.match(fileMenu, /emit\('rename', file\)/)
  assert.match(fileMenu, /emit\('move', file\)/)
})

test('index.vue 抽屉：只保留一个合并目录视口，不再上下拆分', () => {
  const { src } = compile('pages/index/index.vue')
  const drawer = src.slice(src.indexOf('<wd-popup v-model="drawerVisible"'), src.indexOf('<!-- 通用输入弹层'))
  assert.equal((drawer.match(/<mm-directory/g) || []).length, 1, '抽屉里只有一个合并目录组件')
  assert.doesNotMatch(drawer, /<mm-folder-tree/, '不再渲染独立的目录树视口')
  assert.doesNotMatch(drawer, /<mm-file-list/, '不再渲染独立的文件列表视口')
  assert.doesNotMatch(drawer, /mm-drawer__tree|mm-drawer__list/, '旧的两个视口容器已移除')
  assert.match(drawer, /:files-by-folder="directoryFiles"/)
  assert.match(drawer, /:expanded="directoryExpanded"/)
  assert.match(drawer, /:sort="directorySort"/)
  assert.match(drawer, /@toggle-folder="handleToggleDirectoryFolder"/)
})

test('mm-directory：末级文件夹也有展开按钮（文件按需加载，不能按当前子项数隐藏箭头）', () => {
  const { src } = compile('components/mm-directory/mm-directory.vue')
  assert.doesNotMatch(src, /hasChildren/, '不再用“当前是否已有子项”控制展开箭头')
  assert.match(src, /<uni-icons\s+class="mm-dir__chevron"/, '文件夹展开箭头无条件渲染')

  const toggle = src.slice(src.indexOf('function toggleFolder'), src.indexOf('function changeSort'))
  assert.doesNotMatch(toggle, /hasChildren/, 'toggleFolder 不再拦截末级文件夹')
  assert.match(toggle, /emit\('toggle-folder', folderId\)/, '点击箭头照常上报，由页面按需加载该目录文件')
})

test('index.vue：展开先用 loading 阻塞，列表返回后才展开并旋转箭头', () => {
  const { src } = compile('pages/index/index.vue')
  const handler = src.slice(
    src.indexOf('async function handleToggleDirectoryFolder'),
    src.indexOf('function handleDirectorySort')
  )
  const loadingAt = handler.indexOf('toast.loading(')
  const awaitAt = handler.indexOf('await loadFolderFiles(folderId)')
  const closeAt = handler.indexOf('toast.close()')
  const expandedAt = handler.indexOf('directoryExpanded.value = expanded')
  assert.ok(loadingAt > -1 && awaitAt > loadingAt && closeAt > awaitAt && expandedAt > closeAt,
    '顺序：loading 遮罩 → 拉取文件 → 关闭 loading → 写入展开态（组件据此渲染列表并旋转箭头）')
  assert.match(handler, /if \(directoryExpanded\.value\[folderId\]\)/, '收起是本地操作，不弹 loading 立即生效')
  assert.doesNotMatch(handler, /next\[folderId\] = true/, '不再提前写入展开态')
})

test('mm-directory：文件与文件夹行背景统一为白色', () => {
  const { src } = compile('components/mm-directory/mm-directory.vue')
  const style = src.slice(src.indexOf('<style scoped>'), src.indexOf('</style>'))
  const row = /\.mm-dir__row\s*\{([\s\S]*?)\}/.exec(style)
  assert.ok(row, '存在统一的行样式')
  assert.match(row[1], /background-color:\s*var\(--mm-surface\)/, '文件与文件夹共用白色背景')
  assert.doesNotMatch(style, /\.mm-dir__row--folder\s*\{[\s\S]*?background-color/,
    '文件夹不再单独使用 --mm-surface-2 灰底')
})

test('index.vue：启动先载入缓存，再拉云端目录，最后逐一核对已展开目录', () => {
  const { src } = compile('pages/index/index.vue')
  const bootstrap = src.slice(src.indexOf('async function bootstrap()'), src.indexOf('/** 把当前目录状态写入 localStorage'))
  const restoreAt = bootstrap.indexOf('await restoreDirectoryCache()')
  const treeAt = bootstrap.indexOf('loadTree()')
  const reconcileAt = bootstrap.indexOf('await reconcileExpandedFolders()')
  assert.ok(restoreAt > -1 && treeAt > restoreAt && reconcileAt > treeAt,
    '顺序：缓存恢复 → 云端目录 → 展开目录核对')

  assert.match(src, /from '@\/common\/utils\/directory-cache\.js'/, '引入缓存工具')
  assert.match(src, /loadDirectoryCache\(store\.state\.user\.uid \|\| ''\)/, '按账号读取缓存')
  assert.match(src, /saveDirectoryCache\(\{/, '目录变化写回本地')
  assert.match(src, /for \(const folderId of ids\)[\s\S]{0,320}listFiles\(\{ parent_id: folderId/,
    '逐一用云端 listFiles 核对已展开目录')
  assert.match(src, /fileListsEqual\(directoryFiles\.value\[folderId\] \|\| \[\], cloudList\)/,
    '一致则跳过，不一致才更新')
  assert.match(src, /handleToggleDirectoryFolder[\s\S]{0,300}persistDirectoryCache\(\)/,
    '展开状态立即持久化')
})

test('mm-directory：文件行名字/修改时间/大小同一行，标签另起一行且无标签不渲染', () => {
  const { src } = compile('components/mm-directory/mm-directory.vue')
  const fileRow = src.slice(src.indexOf('v-else'), src.indexOf('</template>'))

  // 首行容器把名字、时间、大小放在同一行
  const firstLine = fileRow.slice(
    fileRow.indexOf('class="mm-dir__file-line"'),
    fileRow.indexOf('<!-- 标签另起一行')
  )
  assert.match(firstLine, /class="mm-dir__name"/, '首行含文件名')
  assert.match(firstLine, /formatTime\(node\.data\.updated_at\)/, '首行含修改时间')
  assert.match(firstLine, /formatSize\(node\.data\.size\)/, '首行含文件大小')
  assert.doesNotMatch(firstLine, /mm-dir__tags/, '标签不在首行内')

  // 标签在首行容器之外，且有无标签守卫，无标签时整行不渲染
  const tagsLine = fileRow.slice(fileRow.indexOf('<!-- 标签另起一行'))
  assert.match(tagsLine, /v-if="node\.data\.tags && node\.data\.tags\.length"/, '标签行有非空守卫')
  assert.match(tagsLine, /class="mm-dir__tags"/, '标签独立成行')
  assert.doesNotMatch(tagsLine, /formatTime\(|formatSize\(|class="mm-dir__name"/, '标签行不含名字/时间/大小')
})

test('mm-directory：文件行纵向布局，基础行高低于通用行，标签缩进对齐名字', () => {
  const { src } = compile('components/mm-directory/mm-directory.vue')
  const style = src.slice(src.indexOf('<style scoped>'), src.indexOf('</style>'))

  assert.match(src, /class="mm-dir__row mm-dir__row--file"/, '文件行带独立修饰类')
  const fileRow = /\.mm-dir__row--file\s*\{([\s\S]*?)\}/.exec(style)
  assert.ok(fileRow, '存在文件行样式块')
  assert.match(fileRow[1], /flex-direction:\s*column/, '文件行改为纵向容器')
  assert.match(fileRow[1], /min-height:\s*0/, '不再继承通用行的最小高度')

  const fileLine = /\.mm-dir__file-line\s*\{([\s\S]*?)\}/.exec(style)
  assert.ok(fileLine, '存在首行样式块')
  assert.match(fileLine[1], /display:\s*flex/, '首行是横向 flex，容纳名字/时间/大小')

  // 文件行 32px < 通用行 40px：无标签时整行更紧凑
  const baseRow = /\.mm-dir__row\s*\{([\s\S]*?)\}/.exec(style)
  assert.ok(baseRow && /min-height:\s*calc\(40px/.test(baseRow[1]), '通用行仍为 40px')
  assert.match(fileLine[1], /min-height:\s*calc\(32px/, '文件首行降到 32px')

  assert.doesNotMatch(style, /\.mm-dir__main/, '旧的 main 包装样式已移除')
  const tags = /\.mm-dir__tags\s*\{([\s\S]*?)\}/.exec(style)
  assert.ok(tags, '存在标签行样式块')
  assert.match(tags[1], /padding-left:\s*calc\(41px \* var\(--mm-ui-scale, 1\)\)/,
    '标签缩进到与文件名对齐（14 箭头 + 6 间距 + 15 复选框 + 6 间距）')
})
