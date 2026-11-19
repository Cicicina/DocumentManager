<template>
  <view class="mm-app">
    <!-- 首屏加载动画：store.ready 就绪后淡出 -->
    <mm-loading :visible="!store.state.ready" :min-duration="300" />

    <!-- 顶部工具栏 -->
    <view class="mm-topbar">
      <view class="mm-topbar__left">
        <view v-if="isMobile" class="mm-topbar__icon-btn" @click="drawerVisible = true">
          <uni-icons type="bars" size="18" color="var(--mm-text)" />
        </view>
        <text class="mm-topbar__title">{{ currentTitle }}</text>
        <view
          v-if="store.state.currentFile"
          class="mm-topbar__status"
          :class="'is-' + saveStatus"
          :title="saveStatusText"
          :aria-label="saveStatusText"
        />
      </view>
      <view class="mm-topbar__right">
        <view
          v-if="isLoggedIn"
          class="mm-topbar__icon-btn"
          title="账号"
          aria-label="账号"
          @click="handleUserMenu"
        >
          <uni-icons type="person-filled" size="17" color="var(--mm-text)" />
        </view>
        <view
          v-else-if="accountEnabled"
          class="mm-topbar__icon-btn"
          title="登录"
          aria-label="登录"
          @click="goLogin"
        >
          <uni-icons type="person" size="17" color="var(--mm-text)" />
        </view>
        <view class="mm-topbar__icon-btn" title="搜索" aria-label="搜索" @click="searchVisible = true">
          <uni-icons type="search" size="17" color="var(--mm-text)" />
        </view>
        <view
          class="mm-topbar__icon-btn"
          :title="themeLabel"
          :aria-label="'主题：' + themeLabel"
          @click="cycleTheme"
        >
          <!-- 用静态 SVG：wd-icon / uni-icons 都没有 sun、moon 字形，之前是空渲染 -->
          <image class="mm-topbar__icon-img" :src="themeIcon" mode="aspectFit" />
        </view>
        <view class="mm-topbar__icon-btn" title="设置" aria-label="设置" @click="goSettings">
          <uni-icons type="gear" size="17" color="var(--mm-text)" />
        </view>
        <wd-button
          v-if="!isMobile"
          size="small"
          type="primary"
          :disabled="!store.state.currentFile || saveStatus === 'saving'"
          @click="handleSave"
        >保存</wd-button>
      </view>
    </view>

    <!--
      回到顶部 / 回到底部：按滚动位置互斥显示，不与底部保存、添加批注浮钮重叠
      （两个浮钮在 bottom:24px，这里上移到 76px 起竖排）。
    -->
    <view v-if="store.state.currentFile" class="mm-scroll-fabs">
      <view
        v-if="showBackTop"
        class="mm-scroll-fab"
        title="回到顶部"
        aria-label="回到顶部"
        @click="scrollToEdge('top')"
      >
        <uni-icons type="arrow-up" size="16" color="var(--mm-text)" />
      </view>
      <view
        v-if="showBackBottom"
        class="mm-scroll-fab"
        title="回到底部"
        aria-label="回到底部"
        @click="scrollToEdge('bottom')"
      >
        <uni-icons type="arrow-down" size="16" color="var(--mm-text)" />
      </view>
    </view>

    <!-- 手机端未保存时底部悬浮保存按钮：opacity 淡入淡出，仅 dirty 可见可点 -->
    <view
      v-if="isMobile"
      class="mm-save-fab"
      :class="{ 'is-visible': saveStatus === 'dirty' }"
    >
      <wd-button
        size="small"
        type="primary"
        :disabled="saveStatus === 'saving'"
        @click="handleSave"
      >保存</wd-button>
    </view>

    <!-- 正文有活动选区时浮动「添加批注」，与底部保存按钮分区放置不重叠 -->
    <view
      class="mm-add-annotation-fab"
      :class="{ 'is-visible': hasActiveSelection && !!store.state.currentFile }"
      title="添加批注"
      aria-label="添加批注"
      @click="openShellComment"
    >
      <wd-button size="small" plain>添加批注</wd-button>
    </view>

    <!--
      批注详情：点正文里的高亮文字或它旁边的气泡打开。
      底部「全部批注」是列表视图，这里是单条全文（原文 / 批注 / 时间 / 批注人）。
    -->
    <wd-popup v-model="commentDetailVisible" position="center" custom-style="width:min(440px,90vw);border-radius:12px;">
      <view class="mm-dialog">
        <text class="mm-dialog__title">批注详情</text>
        <text class="mm-dialog__quote">{{ commentDetail.selected_text }}</text>
        <text class="mm-dialog__text">{{ commentDetail.comment }}</text>
        <view class="mm-dialog__meta">
          <text>{{ formatCommentTime(commentDetail.created_at) }}</text>
          <text v-if="store.state.config.account_enabled !== false">{{ commentDetail.nickname || '访客' }}</text>
        </view>
        <view class="mm-dialog__actions">
          <wd-button size="small" type="primary" @click="commentDetailVisible = false">关闭</wd-button>
        </view>
      </view>
    </wd-popup>

    <!--
      全部批注：点正文气泡上的「查看全部」打开。
      这里必须展示每条批注的全文（气泡与侧栏都会截断），
      否则用户点了「查看全部」却仍只看到省略号。
    -->
    <wd-popup v-model="allCommentsVisible" position="center" custom-style="width:min(560px,92vw);border-radius:12px;">
      <view class="mm-dialog">
        <text class="mm-dialog__title">批注详情（{{ commentsWithParagraph.length }}）</text>
        <view v-if="!commentsWithParagraph.length" class="mm-all-comments__empty">还没有批注</view>
        <view
          v-for="item in commentsWithParagraph"
          :key="item._id"
          class="mm-comment-card"
          :class="{ 'is-active': item._id === activeCommentId }"
        >
          <view class="mm-comment-card__para">
            <text class="mm-comment-card__quote">{{ paragraphOf(item) ? paragraphOf(item).before : '' }}</text>
            <text class="mm-comment-card__hit">{{ paragraphOf(item) ? paragraphOf(item).selected : item.selected_text }}</text>
            <text class="mm-comment-card__quote">{{ paragraphOf(item) ? paragraphOf(item).after : '' }}</text>
          </view>
          <text class="mm-comment-card__text">{{ item.comment }}</text>
          <text class="mm-comment-card__meta">
            {{ formatCommentTime(item.created_at) }}
            <text v-if="store.state.config.account_enabled !== false"> · {{ item.nickname || '访客' }}</text>
          </text>
        </view>
        <view class="mm-dialog__actions">
          <wd-button size="small" type="primary" @click="allCommentsVisible = false">关闭</wd-button>
        </view>
      </view>
    </wd-popup>

    <!-- 主体 -->
    <view class="mm-body">
      <!-- PC 左栏：目录树 -->
      <view v-if="!isMobile" class="mm-pane mm-pane--tree">
        <mm-folder-tree
          :folders="store.state.tree"
          :current-id="currentFolderId"
          :loading="treeLoading"
          :root-name="rootName"
          :root-icon="rootIcon"
          @select="handleFolderSelect"
          @create="handleCreateFolder"
          @rename="handleRenameFolder"
          @move="handleMoveFolder"
          @remove="handleRemoveFolder"
          @change-icon="handleChangeIcon"
          @rename-root="handleRenameRoot"
          @change-icon-root="handleChangeIconRoot"
        />
        <view class="mm-pane__foot">
          <view class="mm-pane__link mm-pane__link--inset" @click="goTrash">
            <uni-icons type="trash" size="14" color="var(--mm-text-weak)" />
            <text>回收站</text>
          </view>
        </view>
      </view>

      <!-- PC 中栏：文件列表 -->
      <view v-if="!isMobile" class="mm-pane mm-pane--list">
        <mm-file-list
          :files="store.state.files"
          :folders="currentChildFolders"
          :loading="fileLoading"
            @open="handleOpenFile"
            @open-folder="handleFolderSelect"
            @create-file="handleCreateFile"
            @upload="handleUpload"
            @import="handleImport"
            @rename="handleRenameFile"
            @move="handleMoveFile"
            @export="handleExport"
            @share="handleShare"
            @batch-delete="handleBatchDelete"
        />
      </view>

      <!-- 右栏：阅读 / 编辑 -->
      <view class="mm-pane mm-pane--main" :class="{ 'is-split': !!store.state.currentFile && annotationVisible }">
        <template v-if="store.state.currentFile">
          <!-- 文档区独占一列：批注栏带 height:100% 且 flex-basis:auto，
               若与本列同级上下排列会吃光高度，把 .mm-content 压成 0。 -->
          <view class="mm-doc">
            <view class="mm-mode">
              <view class="mm-mode__item" :class="{ 'is-active': mode === 'read' }" @click="mode = 'read'">阅读</view>
              <view v-if="!shareReadOnly" class="mm-mode__item" :class="{ 'is-active': mode === 'edit' }" @click="mode = 'edit'">编辑</view>
              <view class="mm-mode__spacer" />
              <!-- 大纲开关：与阅读 / 编辑同一行，默认关闭 -->
              <view
                class="mm-mode__action mm-mode__action--outline"
                :class="{ 'is-active': outlineVisible }"
                :title="outlineVisible ? '隐藏大纲' : '显示大纲'"
                :aria-label="outlineVisible ? '隐藏大纲' : '显示大纲'"
                @click="toggleOutline"
              >
                <uni-icons type="list" size="15" color="var(--mm-text-weak)" />
                <text class="mm-mode__action-label">大纲</text>
              </view>
              <!-- 分享：紧挨大纲；分享打开的只读文档不允许再分享 -->
              <view
                v-if="!shareReadOnly"
                class="mm-mode__action"
                title="分享文档"
                aria-label="分享文档"
                @click="handleShare(store.state.currentFile)"
              >
                <uni-icons type="redo" size="15" color="var(--mm-text-weak)" />
                <text class="mm-mode__action-label">分享</text>
              </view>
              <view
                v-if="mode === 'edit' && !shareReadOnly"
                class="mm-mode__action"
                title="插入图片"
                aria-label="插入图片"
                @click="imagePickerVisible = true"
              >
                <uni-icons type="image" size="15" color="var(--mm-text-weak)" />
                <text class="mm-mode__action-label">插入图片</text>
              </view>
              <view
                v-if="mode === 'edit' && !shareReadOnly"
                class="mm-mode__action"
                :class="{ 'is-active': editorPreview }"
                title="预览"
                aria-label="预览"
                @click="toggleEditorPreview"
              >
                <uni-icons type="eye" size="15" color="var(--mm-text-weak)" />
                <text class="mm-mode__action-label">预览</text>
              </view>
              <!-- 批注列表只在阅读视图有意义；编辑视图不显示该入口 -->
              <view
                v-if="mode === 'read' && store.state.comments.length"
                class="mm-mode__action"
                :class="{ 'is-active': annotationVisible }"
                :title="annotationVisible ? '隐藏批注列表' : '显示批注列表'"
                :aria-label="annotationVisible ? '隐藏批注列表' : '显示批注列表'"
                @click="annotationVisible = !annotationVisible"
              >
                <uni-icons type="chat" size="15" color="var(--mm-text-weak)" />
                <text class="mm-mode__action-label">批注列表</text>
              </view>
            </view>

            <view class="mm-content">
              <mm-md-viewer
                v-if="mode === 'read'"
                ref="viewerRef"
                :md-source="store.state.editorContent"
                :plain-text="plainText"
                :comments="store.state.comments"
                :active-comment-id="activeCommentId"
                :image-url-map="imageUrlMap"
                @select-comment="handleCommentClick"
                @view-all-comments="handleViewAllComments"
              />
              <mm-md-editor
                v-else
                ref="editorRef"
                v-model="editorContentProxy"
                :file-id="store.state.currentFile._id"
                :image-url-map="imageUrlMap"
                :show-preview="editorPreview"
                :read-only="shareReadOnly"
              />
            </view>
          </view>

          <mm-annotation
            v-if="annotationVisible && store.state.comments.length"
            class="mm-annotation-pane"
            :comments="store.state.comments"
            :plain-text="plainText"
            :active-comment-id="activeCommentId"
            @add="handleCreateComment"
            @update="handleUpdateComment"
            @remove="handleRemoveComment"
            @locate="handleLocateComment"
          />
        </template>

        <view v-else class="mm-empty" title="打开目录" aria-label="打开目录" @click="handleEmptyTap">
          <text>从左侧选择一篇文档</text>
        </view>

        <!-- 大纲浮层：覆盖在正文右侧，不参与 flex 计算，避免像批注栏那样压塌正文高度 -->
        <mm-outline
          v-if="outlineVisible && store.state.currentFile"
          class="mm-outline-pane"
          :items="outlineItems"
          :active-index="activeOutlineIndex"
          @select="handleOutlineSelect"
          @close="outlineVisible = false"
        />
      </view>
    </view>

    <!-- 移动端抽屉 -->
    <wd-popup v-model="drawerVisible" position="left" custom-style="width:88vw;height:100%;">
      <view class="mm-drawer">
        <view class="mm-drawer__head">
          <text class="mm-drawer__title">目录</text>
          <view class="mm-drawer__close" @click="drawerVisible = false">
            <uni-icons type="close" size="16" color="var(--mm-text-weak)" />
          </view>
        </view>
        <view class="mm-drawer__tree">
          <mm-folder-tree
            :folders="store.state.tree"
            :current-id="currentFolderId"
            :loading="treeLoading"
            :root-name="rootName"
            :root-icon="rootIcon"
            @select="handleDrawerFolderSelect"
            @create="handleCreateFolder"
            @rename="handleRenameFolder"
            @move="handleMoveFolder"
            @remove="handleRemoveFolder"
            @change-icon="handleChangeIcon"
            @rename-root="handleRenameRoot"
            @change-icon-root="handleChangeIconRoot"
          />
          <view class="mm-pane__link mm-pane__link--inset" @click="drawerVisible = false; goTrash()">
            <uni-icons type="trash" size="14" color="var(--mm-text-weak)" />
            <text>回收站</text>
          </view>
        </view>
        <view class="mm-drawer__list">
          <mm-file-list
            :files="store.state.files"
            :folders="currentChildFolders"
            :loading="fileLoading"
            @open="handleDrawerOpenFile"
            @open-folder="handleDrawerFolderSelect"
            @create-file="handleCreateFile"
            @upload="handleUpload"
            @import="handleImport"
            @rename="handleRenameFile"
            @move="handleMoveFile"
            @export="handleExport"
            @share="handleShare"
            @batch-delete="handleBatchDelete"
          />
        </view>
      </view>
    </wd-popup>

    <!-- 通用输入弹层：新建文件夹 / 重命名 -->
    <wd-popup v-model="inputVisible" position="center" custom-style="width:min(360px,86vw);border-radius:12px;">
      <view class="mm-dialog">
        <text class="mm-dialog__title">{{ inputTitle }}</text>
        <wd-input v-model="inputValue" :placeholder="inputPlaceholder" />
        <view class="mm-dialog__actions">
          <wd-button size="small" plain @click="cancelInput">取消</wd-button>
          <wd-button size="small" type="primary" @click="confirmInput">确定</wd-button>
        </view>
      </view>
    </wd-popup>

    <!-- 移动到：先浏览目录层级，再确认「移动到此处」；非法目标沿用置灰与原因 -->
    <wd-popup v-model="moveVisible" position="center" custom-style="width:min(420px,90vw);border-radius:12px;">
      <view class="mm-move">
        <text class="mm-move__title">移动到</text>
        <view class="mm-move__path">
          <text class="mm-move__crumb" @click="moveToLevel('')">全部文档</text>
          <template v-for="(crumb, index) in moveBreadcrumb" :key="crumb._id">
            <text class="mm-move__sep">/</text>
            <text
              class="mm-move__crumb"
              :class="{ 'is-active': index === moveBreadcrumb.length - 1 }"
              @click="moveToLevel(crumb._id)"
            >{{ crumb.name }}</text>
          </template>
          <view class="mm-move__spacer" />
          <view v-if="moveBreadcrumb.length" class="mm-move__up" @click="moveUpOneLevel">
            <uni-icons type="arrow-left" size="13" color="var(--mm-text-weak)" />
            <text>返回上一级</text>
          </view>
        </view>
        <scroll-view class="mm-move__body" scroll-y>
          <view
            class="mm-move__item"
            :class="{ 'is-disabled': moveRootTarget.disabled, 'is-current': moveRootTarget.current }"
            @click="moveToLevel('')"
          >
            <uni-icons type="folder-add" size="14" color="var(--mm-text-weak)" />
            <text class="mm-move__name">全部文档</text>
            <text v-if="moveRootTarget.reason" class="mm-move__reason">{{ moveRootTarget.reason }}</text>
          </view>
          <view
            v-for="item in moveBrowseTargets"
            :key="item._id"
            class="mm-move__item"
            :class="{ 'is-disabled': item.disabled, 'is-current': item.current }"
            @click="browseMoveTarget(item)"
          >
            <uni-icons type="folder-add" size="14" color="var(--mm-text-weak)" />
            <text class="mm-move__name">{{ item.name }}</text>
            <text v-if="item.reason" class="mm-move__reason">{{ item.reason }}</text>
            <uni-icons v-if="item.hasChildren" type="arrow-right" size="12" color="var(--mm-text-weak)" />
          </view>
        </scroll-view>
        <view class="mm-move__actions">
          <wd-button size="small" plain @click="moveVisible = false">取消</wd-button>
          <wd-button size="small" type="primary" :disabled="moveHereDisabled" @click="confirmMoveHere">移动到此处</wd-button>
        </view>
      </view>
    </wd-popup>

    <!-- 功能浮层 -->
    <mm-icon-picker
      v-model:visible="iconPickerVisible"
      :current="iconPickerCurrent"
      @confirm="handleIconConfirm"
    />
    <mm-search-panel v-model:visible="searchVisible" @select="handleSearchSelect" />
    <mm-conflict-modal
      v-model:visible="conflictVisible"
      :cloud-version="conflict.cloudVersion"
      :local-version="store.state.baseVersion"
      :cloud-preview="conflict.cloudPreview"
      :cloud-updated-at="conflict.cloudUpdatedAt"
      @overwrite="handleConflictOverwrite"
      @discard="handleConflictDiscard"
    />
    <mm-image-picker
      v-model:visible="imagePickerVisible"
      :uid="store.state.user.uid"
      @select="handleImageSelect"
    />

    <!-- 分享：选择有效期档位（含无限期） -->
    <wd-popup v-model="shareVisible" position="center" custom-style="width:min(380px,88vw);border-radius:12px;">
      <view class="mm-dialog">
        <text class="mm-dialog__title">分享文档</text>
        <text class="mm-share__sub">{{ shareTargetName || '当前文档' }}</text>
        <view class="mm-share__options">
          <view
            v-for="option in shareOptions"
            :key="option.value"
            class="mm-share__option"
            :class="{ 'is-active': shareExpire === option.value }"
            @click="shareExpire = option.value"
          >{{ option.label }}</view>
        </view>
        <text class="mm-share__tip">{{ shareExpire === 0 ? '无限期分享不会自动失效，可在设置的「分享管理」里随时作废。' : '到期后链接自动失效，也可在设置的「分享管理」里提前作废。' }}</text>
        <view class="mm-dialog__actions">
          <wd-button size="small" plain @click="shareVisible = false">取消</wd-button>
          <wd-button size="small" type="primary" :disabled="shareCreating" @click="confirmShare">创建并复制</wd-button>
        </view>
      </view>
    </wd-popup>

    <!-- 浮动批注按钮触发的新建输入 -->
    <wd-popup v-model="commentDialogVisible" position="center" custom-style="width:min(420px,88vw);border-radius:12px;">
      <view class="mm-dialog">
        <text class="mm-dialog__title">添加批注</text>
        <text v-if="annotationSelection" class="mm-dialog__quote">{{ truncateBubble(annotationSelection.selectedText) }}</text>
        <wd-input v-model="commentDialogText" placeholder="写下你的批注" />
        <view class="mm-dialog__actions">
          <wd-button size="small" plain @click="commentDialogVisible = false">取消</wd-button>
          <wd-button size="small" type="primary" @click="submitShellComment">确定</wd-button>
        </view>
      </view>
    </wd-popup>

    <!-- 轻提示 / 确认框挂载点（必需） -->
    <mm-global-toast />
    <wd-message-box selector="mm-index" />
  </view>
</template>

<script setup>
/**
 * 应用主壳：首屏加载 → 登录守卫 → PC 三栏 / 移动单栏抽屉，
 * 承担目录树、文件列表、阅读编辑、搜索、回收站、冲突弹窗的全链路接线。
 *
 * 红线：
 * - 版本冲突（code=2001）不弹 Toast、不跳转、不清空 store.editorContent；
 * - 所有云对象调用集中在 common/api，不出现客户端直连数据库；
 * - 布局尺寸一律 px / rem，禁止 rpx。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { toast } from '@/common/utils/toast.js'
import { useConfirm } from '@/common/utils/confirm.js'
import { useAppStore } from '@/common/store/index.js'
import { ANONYMOUS_USER_ID, CLOUD_PATH } from '@/common/constants.js'
import { genUuid } from '@/common/utils/uuid.js'
import { setStoredTheme } from '@/common/utils/theme.js'
import { getMmText } from '@/common/utils/selection.js'
// 副作用导入：把批注段落提取函数挂到 globalThis.CommentParagraph。
// 注意：该文件采用同构双挂载、没有 export，不能写成命名导入，否则模块加载失败。
import '@/common/utils/comment-paragraph.js'
import { downloadMarkdown } from '@/common/utils/download.js'
// 分享与剪贴板工具按需动态导入：既有登录态运行时探针只注入固定依赖，
// 顶层新增 import 会破坏其装载契约；动态 import 不影响真实 H5 构建。
import { uploadCloudFile } from '@/common/utils/upload.js'
import {
  listTree,
  listFiles,
  createFolder,
  registerUpload,
  importFile,
  getContent,
  saveContent,
  rename,
  move,
  updateIcon,
  softDelete,
  exportFile
} from '@/common/api/mm-file.js'
import {
  listByFile,
  add as addComment,
  update as updateComment,
  remove as removeComment
} from '@/common/api/mm-comment.js'
import { getTempUrls, syncRefs } from '@/common/api/mm-image.js'
import { updateRoot } from '@/common/api/mm-settings.js'
import {
  isTokenInvalid,
  isLocalTokenExpired,
  handleLoginExpired,
  resetLoginGuard
} from '@/common/api/index.js'

const store = useAppStore()
const { confirm } = useConfirm('mm-index')

/**
 * 本页是否已完成一次登录态判定 / 失效引导。
 * watch(ready) 与 onShow 都会触发守卫，此标记保证同一失效只引导一次，
 * 不再反复 loadIdentity + bootstrap 造成提示与请求抖动。
 */
let loginGuardDone = false

/** 同构提纯函数单例（由 selection.js 副作用导入完成挂载） */
const mmText = getMmText()

// ---------------- 视图状态 ----------------
const isMobile = ref(false)
const mode = ref('read')
/** 编辑态是否显示右侧实时预览分栏；仅编辑模式生效，切换阅读/编辑不重置用户选择 */
const editorPreview = ref(true)
const drawerVisible = ref(false)

/** 批注列表是否展开；默认收起，避开批注组件 height:100% 把正文压成 0 的历史坑 */
const annotationVisible = ref(false)
/**
 * 正文锚点缓存 与 按钮显隐标记必须分离：
 * 点击「添加批注」按钮会让浏览器折叠选区并触发 selectionchange，
 * 若把缓存一起清空，弹层就再也拿不到被选中的段落（曾经的 bug）。
 * 折叠只影响可见性，锚点只在「换文档」或「提交成功」时清。
 */
const annotationSelection = ref(null)
const hasActiveSelection = ref(false)
/** 单条批注详情弹层 */
const commentDetailVisible = ref(false)
const commentDetail = ref({})
/** 点气泡「查看全部」打开的全文列表 */
const allCommentsVisible = ref(false)
/** 新建批注输入弹层 */
const commentDialogVisible = ref(false)
const commentDialogText = ref('')
/** 分享只读标记：通过分享链接打开的文档不允许编辑 */
const shareReadOnly = ref(false)

/**
 * 分享有效期档位。
 * value 是秒数，0 表示无限期（服务端用远期哨兵时间表示，不落 null）。
 */
const shareOptions = [
  { label: '1 小时', value: 3600 },
  { label: '1 天', value: 86400 },
  { label: '7 天', value: 604800 },
  { label: '30 天', value: 2592000 },
  { label: '无限期', value: 0 }
]
const shareVisible = ref(false)
const shareTarget = ref(null)
const shareExpire = ref(86400)
const shareCreating = ref(false)
/** 弹层里显示的文档名，避免只写「当前文档」让人不确定分享的是谁 */
const shareTargetName = computed(() => {
  const target = shareTarget.value
  return target && target.name ? target.name : ''
})

/** 待处理分享令牌：onLoad query + storage 双保险 */
const pendingShareToken = ref('')
const shareHandled = new Set()
let navigating = false

/**
 * 切换预览：md-editor-v3 4.x 的 preview prop 只在初始化生效，
 * 必须同时调用子组件暴露的 togglePreview 实例方法才能即时开合分栏。
 */
function toggleEditorPreview() {
  editorPreview.value = !editorPreview.value
  const editor = editorRef.value
  if (editor && typeof editor.togglePreview === 'function') {
    editor.togglePreview(editorPreview.value)
  }
}
const searchVisible = ref(false)
const imagePickerVisible = ref(false)
const iconPickerVisible = ref(false)
const iconPickerCurrent = ref(null)
const iconPickerTarget = ref(null)

/** 当前选中的目录（'' 表示全部文档） */
const currentFolderId = ref('')
const treeLoading = ref(false)
const fileLoading = ref(false)

/** 保存状态：dirty / saving / saved / conflict */
const saveStatus = ref('saved')

/** 冲突弹窗数据 */
const conflictVisible = ref(false)
const conflict = ref({ cloudVersion: 0, cloudPreview: '', cloudUpdatedAt: '' })

/** 当前高亮批注 */
const activeCommentId = ref('')

/** 当前文档引用的图片：fileID → 临时 URL（显示态），供阅读器与编辑器渲染 */
const imageUrlMap = ref({})

/** 编辑器实例（用于 insertImage） */
const editorRef = ref(null)

// ---------------- 计算属性 ----------------
const currentTitle = computed(() => {
  const file = store.state.currentFile
  return file ? file.name : 'Markdown 文档库'
})

const saveStatusText = computed(() => {
  const map = { dirty: '未保存', saving: '保存中', saved: '已保存', conflict: '有冲突' }
  return map[saveStatus.value] || ''
})

const themeLabel = computed(() => {
  const map = { auto: '自动', light: '浅色', dark: '深色' }
  return map[store.state.theme] || '自动'
})

/** 当前实际生效的明暗（auto 跟随系统），用于选择顶栏主题图标 */
const isDarkTheme = computed(() => {
  if (store.state.theme === 'dark') return true
  if (store.state.theme === 'light') return false
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
})

/**
 * 主题图标：静态 SVG，不依赖图标字体。
 * 「自动」必须用独立图标 —— 跟随系统时若复用 sun/moon，
 * 用户会误以为当前就是「浅色」或「深色」，分不清是哪种模式。
 */
const themeIcon = computed(() => {
  if (store.state.theme === 'auto') return '/static/icons/theme-auto.svg'
  return isDarkTheme.value ? '/static/icons/theme-moon.svg' : '/static/icons/theme-sun.svg'
})

/**
 * 账号功能是否开启。
 * 必须等配置就绪再判定：store 里 account_enabled 默认 true，
 * 若在配置回来之前渲染，关闭账号功能时顶栏会先闪一下登录按钮。
 */
const accountEnabled = computed(() => store.state.ready && store.state.config.account_enabled !== false)

/** 当前目录下的子文件夹：listFiles 只返回文档，子目录从完整目录树里派生 */
const currentChildFolders = computed(() => {
  const tree = Array.isArray(store.state.tree) ? store.state.tree : []
  return tree.filter(node => node && (node.parent_id || '') === currentFolderId.value)
})

/** 提纯纯文本：唯一 offset 坐标系，供阅读器与批注使用 */
const plainText = computed(() => {
  if (!mmText) return ''
  return mmText.stripMarkdown(store.state.editorContent)
})

/**
 * 批注 + 标记段落：按 start/end offset 从 plainText 里取出批注所在的完整段落，
 * 拆成 before / selected / after 三段，弹出层里对选中片段高亮。
 * orphaned 或 offset 失效时 _para 为 null，模板回退只显示 selected_text。
 */
const commentsWithParagraph = computed(() => {
  // 副作用导入把纯函数挂在 globalThis.CommentParagraph；测试/SSR 下可能未挂载，
  // 此时跳过段落提取、_para 为 null，模板回退只显示 selected_text，不影响主流程。
  const helper = (typeof globalThis !== 'undefined' && globalThis.CommentParagraph) || {}
  const extractAnnotatedParagraph = helper.extractAnnotatedParagraph
  const text = plainText.value || ''
  return (store.state.comments || []).map(item => {
    let para = null
    if (typeof extractAnnotatedParagraph === 'function' && item &&
        typeof item.start_offset === 'number' && typeof item.end_offset === 'number') {
      try {
        para = extractAnnotatedParagraph(text, item.start_offset, item.end_offset)
      } catch (error) {
        para = null
      }
    }
    return { ...item, _para: para }
  })
})

/**
 * 去掉标题里的行内 Markdown 标记，用于大纲展示与标题比对。
 * 与渲染后 DOM 的 textContent 保持等价（`**重点**` → `重点`，链接只留文字）。
 * 注意：不能无脑删掉所有 `_`，`snake_case` 这类标识符要保留。
 */
function stripInlineMarkdown(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)([^*_]+)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 大纲条目：从 markdown 原文按 ATX 标题（# ~ ######）解析，跳过围栏代码块。
 * index 是「第几个标题」的全局序号，阅读态按 data-mm-h 命中，
 * 编辑态按 line 定位 CodeMirror 行。
 */
const outlineItems = computed(() => {
  const source = typeof store.state.editorContent === 'string' ? store.state.editorContent : ''
  const lines = source.split('\n')
  const items = []
  let inFence = false
  let fenceMarker = ''
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line]
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(text)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (fence[1][0] === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }
    if (inFence) continue
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(text)
    if (!heading) continue
    const title = stripInlineMarkdown(heading[2].replace(/\s+#+\s*$/, ''))
    if (!title) continue
    items.push({ level: heading[1].length, text: title, line, index: items.length })
  }
  return items
})

/** 当前命中的大纲项（按滚动位置粗略取最后一个已滚过的标题） */
const activeOutlineIndex = ref(-1)

/** 是否显示大纲浮层：默认关闭 */
const outlineVisible = ref(false)

function toggleOutline() {
  outlineVisible.value = !outlineVisible.value
}

/**
 * 点击大纲以外的区域收起大纲。
 * 大纲是贴在正文右侧的浮层，没有遮罩层（加遮罩会挡住正文滚动），
 * 所以用 document 级 pointerdown 判断落点。
 * 排除大纲自身与工具栏上的大纲开关：点开关交给 toggleOutline，
 * 否则会「关掉又被自己打开」。
 * @param {object} event 原生 pointerdown 事件
 * @returns {void}
 */
function handleOutlineOutside(event) {
  if (!outlineVisible.value) return
  const target = event && event.target
  if (!target || typeof target.closest !== 'function') return
  if (target.closest('.mm-outline')) return
  if (target.closest('.mm-mode__action--outline')) return
  outlineVisible.value = false
}

/** 大纲跳转：阅读态滚到第 index 个标题，编辑态把光标定位到对应行 */
function handleOutlineSelect(item) {
  if (!item) return
  activeOutlineIndex.value = item.index
  if (mode.value === 'edit') {
    const editor = editorRef.value
    if (editor && typeof editor.scrollToLine === 'function') editor.scrollToLine(item.line)
    return
  }
  const viewer = viewerRef.value
  if (viewer && typeof viewer.scrollToHeading === 'function') viewer.scrollToHeading(item.index, item.text)
}

/** 编辑器受控内容代理：读写都落到 store.editorContent */
const editorContentProxy = computed({
  get: () => store.state.editorContent,
  set: (value) => store.setEditor(value)
})

// ---------------- 回到顶部 / 回到底部 ----------------
/**
 * 正文滚动容器随模式变化：
 * 阅读态是 mm-md-viewer 根节点（.mm-viewer，自带 overflow:auto），
 * 编辑态是 CodeMirror 的 .cm-scroller。这里按「谁真的能滚」动态取，
 * 不写死某一个选择器，切换模式后重新解析。
 */
let scrollHost = null

const scrollState = ref({ scrollable: false, atTop: true, atBottom: true })

/** 滚动到顶时只显示「回到底部」，到底时只显示「回到顶部」，中间两个都显示 */
const showBackTop = computed(() => scrollState.value.scrollable && !scrollState.value.atTop)
const showBackBottom = computed(() => scrollState.value.scrollable && !scrollState.value.atBottom)

function resolveScrollHost() {
  if (typeof document === 'undefined') return null
  const root = document.querySelector('.mm-content')
  if (!root) return null
  if (scrollHost && root.contains(scrollHost) && scrollHost.scrollHeight > scrollHost.clientHeight + 8) {
    return scrollHost
  }
  const candidates = root.querySelectorAll('.mm-viewer, .cm-scroller, .md-editor-content')
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]
    if (el && el.scrollHeight > el.clientHeight + 8) return el
  }
  return root
}

function measureScroll() {
  const el = resolveScrollHost()
  if (!el) {
    scrollState.value = { scrollable: false, atTop: true, atBottom: true }
    return
  }
  scrollHost = el
  const max = el.scrollHeight - el.clientHeight
  const scrollable = max > 8
  const top = Math.max(0, el.scrollTop || 0)
  scrollState.value = {
    scrollable,
    atTop: top <= 4,
    atBottom: top >= max - 4
  }
}

/** 捕获阶段的 scroll 不冒泡，用 capture 才能同时接住阅读器与编辑器内部的滚动 */
function handleContentScroll(event) {
  if (typeof document === 'undefined') return
  const root = document.querySelector('.mm-content')
  const target = event && event.target
  if (!root || !target || target.nodeType !== 1) return
  if (!(target === root || root.contains(target))) return
  scrollHost = target
  measureScroll()
}

function scrollToEdge(edge) {
  const el = scrollHost || resolveScrollHost()
  if (!el) return
  const top = edge === 'bottom' ? el.scrollHeight : 0
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top, behavior: 'smooth' })
    return
  }
  el.scrollTop = top
}

// ---------------- 生命周期 ----------------
/**
 * 直接从地址栏取 share_token。
 * uni-app H5 的 onLoad options 在部分路由重建场景会漏掉 hash 里的 query，
 * 这里补一条兜底读取，保证首次打开带令牌的链接就能跳转。
 * @returns {string} 令牌，取不到返回空串
 */
function readShareTokenFromLocation() {
  if (typeof window === 'undefined' || !window.location) return ''
  try {
    const url = new URL(window.location.href)
    const direct = url.searchParams.get('share_token')
    if (direct) return direct
    const hash = url.hash || ''
    const queryIndex = hash.indexOf('?')
    if (queryIndex === -1) return ''
    return new URLSearchParams(hash.slice(queryIndex + 1)).get('share_token') || ''
  } catch (error) {
    return ''
  }
}

onLoad((options) => {
  updateViewport()
  // 分享链接可能藏在 hash 的 query 里，也可能因路由重建丢失；storage 兜底
  const fromQuery = (options && typeof options.share_token === 'string' ? options.share_token : '')
    || readShareTokenFromLocation()
  const fromStorage = String(uni.getStorageSync('mm_pending_share_token') || '')
  pendingShareToken.value = fromQuery || fromStorage
  if (fromQuery) {
    try { uni.setStorageSync('mm_pending_share_token', fromQuery) } catch (error) { /* 存储不可用忽略 */ }
  }
  // uni-id-pages 登录成功会全局广播；这里只复位失效幂等标记，
  // 保证 reLaunch / 页面重建后组件内标记与模块级标记保持一致。
  if (typeof uni !== 'undefined' && uni && typeof uni.$on === 'function') {
    uni.$on('uni-id-pages-login-success', handleLoginSuccessSync)
  }
})

// 登录页返回时重新同步身份并补拉数据（守卫只在配置就绪后执行一次）
let libraryListenerBound = false
onShow(() => {
  // 回收站独立页在页面栈中 emit，首页虽不在前台但实例仍在，注册一次即可持续接收
  if (!libraryListenerBound && typeof uni.$on === 'function') {
    uni.$on('mm-library-changed', handleTrashChanged)
    libraryListenerBound = true
  }
  if (!store.state.ready) return
  const token = uni.getStorageSync('uni_id_token')
  // 分享链接与剪贴板不依赖登录态，先处理（匿名分享也能打开）
  resolveShare()
  inspectClipboard()
  // 只有拿到「新的、本地未过期」的 token 时，才复位失效标记并重新同步身份；
  // 已失效 / 无 token 的情况由 guardLogin 引导过一次，此处不再重复发请求。
  if (!token || isLocalTokenExpired()) return
  resetLoginGuard()
  loginGuardDone = false
  if (!store.state.user.uid) {
    loadIdentity().then(() => bootstrap())
  }
})

onMounted(() => {
  updateViewport()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateViewport)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('selectionchange', captureShellSelection)
    document.addEventListener('scroll', handleContentScroll, true)
    document.addEventListener('pointerdown', handleOutlineOutside, true)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', measureScroll)
  }
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateViewport)
    window.removeEventListener('resize', measureScroll)
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('selectionchange', captureShellSelection)
    document.removeEventListener('scroll', handleContentScroll, true)
    document.removeEventListener('pointerdown', handleOutlineOutside, true)
  }
  if (shellSelectionTimer) {
    clearTimeout(shellSelectionTimer)
    shellSelectionTimer = null
  }
  if (typeof uni !== 'undefined' && uni && typeof uni.$off === 'function') {
    uni.$off('uni-id-pages-login-success', handleLoginSuccessSync)
  }
})

// 首屏就绪后加载目录树与文件列表
watch(() => store.state.ready, async (value) => {
  if (!value) return
  // 配置就绪后再做登录守卫，避免用默认配置误跳登录页；
  // 守卫判定登录态已失效时不拉数据，避免并发请求再触发一轮失效提示。
  const canBrowse = guardLogin()
  if (canBrowse) {
    await bootstrap()
    // 关键：onShow 首次触发时 ready 往往还是 false，会被提前 return 掉。
    // 分享令牌必须在这里补一次解析，否则首次带 share_token 打开不会跳转，
    // 只有第二次进入（storage 里还留着令牌、ready 已就绪）才生效。
    await resolveShare()
  }
}, { immediate: true })

// 编辑内容变化即视为未保存
watch(() => store.state.editorContent, () => {
  if (saveStatus.value === 'saved') saveStatus.value = 'dirty'
})

// 切到编辑态就没有「正文选区」这个概念了，浮动添加批注按钮必须收起；
// 滚动容器同时换人（阅读器 → CodeMirror），滚动按钮状态要重新量一次。
// 视图切换必须先把所有浮层关掉：编辑态下还挂着阅读态打开的批注详情/大纲会很怪。
watch(mode, () => {
  closeAllPopups()
  hasActiveSelection.value = false
  scrollHost = null
  activeOutlineIndex.value = -1
  nextTick(measureScroll)
})

function updateViewport() {
  // #ifdef H5
  isMobile.value = window.innerWidth < 768
  // #endif
  // #ifndef H5
  isMobile.value = true
  // #endif
}

/**
 * 空态点击：移动端直接拉起左侧目录抽屉；
 * 桌面端目录树本就常驻，给一句提示指向左侧即可，不强行走高亮。
 */
function handleEmptyTap() {
  if (isMobile.value) {
    drawerVisible.value = true
    return
  }
  toast.show('请在左侧目录中选择文档')
}

// ---------------- 登录态与账号入口 ----------------
/** 是否已登录（匿名共享模式不算登录） */
const isLoggedIn = computed(() => {
  const user = store.state.user || {}
  return !!user.uid && user.anonymous !== true
})

function goLogin() {
  // 携带回跳地址：login-page.mixin 在 onLoad 里透传给 mutations.loginSuccess，
  // loginBack 据此直接 redirectTo 首页，不再依赖 getCurrentPages() 统计
  // route.split('/')[3] 的 delta（H5 下可能为 0，navigateBack({delta:0}) 不跳转）。
  const redirect = encodeURIComponent('/pages/index/index')
  uni.navigateTo({
    url: `/uni_modules/uni-id-pages/pages/login/login-withpwd?uniIdRedirectUrl=${redirect}`
  })
}

/** 登录成功后复位失效幂等标记，避免页面重建后新旧标记不一致 */
function handleLoginSuccessSync() {
  resetLoginGuard()
  loginGuardDone = false
}

function handleUserMenu() {
  uni.showActionSheet({
    itemList: ['个人资料', '退出登录'],
    success: (res) => {
      if (res.tapIndex === 0) {
        uni.navigateTo({ url: '/uni_modules/uni-id-pages/pages/userinfo/userinfo' })
      } else if (res.tapIndex === 1) {
        logout()
      }
    }
  })
}

/** 退出登录：清本地 token 与内存身份，回到登录页 */
function logout() {
  ;['uni_id_token', 'uni_id_token_expired'].forEach((key) => uni.removeStorageSync(key))
  store.setUser({ uid: '', anonymous: false })
  // 主动退出后复位守卫，保证本页后续仍能正常引导重新登录
  resetLoginGuard()
  loginGuardDone = false
  toast.success('已退出登录')
  setTimeout(goLogin, 400)
}

/**
 * 从 JWT payload 解析 uid，仅用于前端展示登录态（不替代服务端验签）。
 * 仅在本地凭据未过期、但 uni-id-co 暂时不可用时兜底，避免「已登录却显示未登录」；
 * 凭据已过期时不再兜底，确保顶栏「登录」入口可见。
 */
function decodeUidFromToken(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length < 2 || typeof atob !== 'function') return ''
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((char) => '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    const payload = JSON.parse(json)
    return payload.uid || payload.user_id || ''
  } catch (error) {
    return ''
  }
}

// ---------------- 登录守卫 ----------------
/**
 * 首屏登录守卫。
 * @returns {boolean} 是否可以继续拉取目录 / 文件数据
 */
function guardLogin() {
  const config = store.state.config || {}
  if (config.account_enabled === false) {
    // 账号功能关闭：匿名直入，不弹登录（PRD Q3）
    store.setUser({ anonymous: true, uid: ANONYMOUS_USER_ID })
    loginGuardDone = true
    return true
  }
  const token = uni.getStorageSync('uni_id_token')
  // 无凭据或本地凭据确实过期：只在首次进入时清态 + 提示 + 跳登录页，
  // 避免 watch(ready) / onShow / 并发请求把同一失效重复处理。
  if (!token || isLocalTokenExpired()) {
    if (!loginGuardDone) {
      loginGuardDone = true
      // 有待处理的分享链接时带 share_token 回跳，登录回来后仍能打开；
      // 否则沿用原失效引导，不改动已锁定的全局契约。
      const pending = pendingShareToken.value || String(uni.getStorageSync('mm_pending_share_token') || '')
      if (pending) goLoginWithShare(pending)
      else handleLoginExpired()
    }
    // 置为未登录，顶栏 v-else 的「登录」入口随之可见
    store.setUser({ uid: '', anonymous: false })
    return false
  }
  loginGuardDone = true
  loadIdentity()
  return true
}

/**
 * 同步身份。云端 getUserInfo 失败只代表「校验请求失败」，
 * 不能据此判定 token 过期，也不能无条件用本地 token 把界面恢复成「已登录」：
 * 否则会出现「提示登录失效，却仍显示账号菜单、登录入口被隐藏」的矛盾态。
 */
async function loadIdentity() {
  try {
    const uniIdCo = uniCloud.importObject('uni-id-co', { customUI: true })
    const res = await uniIdCo.getUserInfo()
    const info = res && res.userInfo
    if (info && info._id) {
      store.setUser({ uid: info._id, anonymous: false })
      return
    }
  } catch (error) {
    // uni-id-co 未部署、返回 500 或调用失败：属于云端服务异常，不弹「已过期」；
    // 只有明确携带 uni-id token 失效错误码 / 文案时才判定为真过期并引导重新登录。
    if (isTokenInvalid(error)) {
      handleLoginExpired()
      store.setUser({ uid: '', anonymous: false })
      return
    }
  }
  if (isLocalTokenExpired()) {
    store.setUser({ uid: '', anonymous: false })
    return
  }
  // 本地 token 未过期时才用 JWT 兜底展示登录态（不替代服务端验签）
  const uid = decodeUidFromToken(uni.getStorageSync('uni_id_token'))
  if (uid) store.setUser({ uid, anonymous: false })
}

// ---------------- 数据加载 ----------------
async function bootstrap() {
  await Promise.all([loadTree(), loadFiles(currentFolderId.value)])
}

/** 自定义图标的临时 URL 由页面批量换取后回填到 icon.url */
async function attachIconUrls(folders) {
  const ids = (folders || [])
    .filter(item => item.icon && item.icon.type === 'custom' && item.icon.value)
    .map(item => item.icon.value)
  if (ids.length === 0) return folders || []
  const res = await getTempUrls({ file_ids: ids })
  const map = res.code === 0 && res.data ? res.data : {}
  return (folders || []).map(item => {
    if (item.icon && item.icon.type === 'custom') {
      return { ...item, icon: { ...item.icon, url: map[item.icon.value] || '' } }
    }
    return item
  })
}

async function loadTree() {
  treeLoading.value = true
  const res = await listTree()
  treeLoading.value = false
  if (res.code === 0) store.setTree(await attachIconUrls(res.data || []))
  await loadRootIconUrl()
}

async function loadFiles(parentId) {
  fileLoading.value = true
  const res = await listFiles({ parent_id: parentId || '', page: 1, pageSize: 100 })
  fileLoading.value = false
  if (res.code === 0 && res.data) store.setFiles(res.data.list || [])
}

async function reloadComments(fileId) {
  if (!fileId) return
  const res = await listByFile({ file_id: fileId })
  if (res.code === 0) store.setComments(res.data || [])
}

// ---------------- 目录树交互 ----------------
async function handleFolderSelect(node) {
  currentFolderId.value = node ? node._id : ''
  // 切换文件夹要重新拉取该目录的文档列表；等待期间用 wot loading，
  // 列表加载完成后 close（独立实例，不影响其它短提示）。
  toast.loading('正在加载文件夹…')
  try {
    await loadFiles(currentFolderId.value)
  } finally {
    toast.close()
  }
}

function handleDrawerFolderSelect(node) {
  // 点击文件夹只刷新右侧文档列表，抽屉保持展开，便于继续浏览并点开该目录下的文档；
  // 关闭入口见抽屉右上角关闭按钮 / 遮罩，打开文档时仍由 handleDrawerOpenFile 收起。
  handleFolderSelect(node)
}

async function handleCreateFolder({ parent_id }) {
  const name = await openInput({ title: '新建文件夹', placeholder: '文件夹名称' })
  if (!name) return
  const res = await createFolder({ parent_id: parent_id || '', name })
  if (res.code === 0) {
    toast.success('已创建')
    await loadTree()
  }
}

async function handleRenameFolder(node) {
  if (!node) return
  const name = await openInput({ title: '重命名', placeholder: '名称', value: node.name })
  if (!name) return
  const res = await rename({ file_id: node._id, name })
  if (res.code === 0) {
    toast.success('已重命名')
    await loadTree()
    await loadFiles(currentFolderId.value)
  }
}

function handleRemoveFolder(node) {
  if (!node) return
  confirm({ title: '删除文件夹', content: '文件夹及其内容将移入回收站' }).then(async ok => {
    if (!ok) return
    const result = await softDelete({ file_ids: [node._id] })
    if (result.code === 0) {
      toast.success('已移入回收站')
      await loadTree()
      await loadFiles(currentFolderId.value)
    }
  })
}

function handleChangeIcon(node) {
  if (!node) return
  iconPickerTarget.value = node
  iconPickerCurrent.value = node.icon || null
  iconPickerVisible.value = true
}

// ---------------- 目录树根节点（全部文档） ----------------
/**
 * 根节点不是 mm-files 里的真实记录，名称与图标存在系统配置里（mm-settings.updateRoot），
 * 这样才能多设备一致；前端只负责渲染与把改动写回配置。
 */
const ROOT_ICON_TARGET = '__mm_root__'
const rootIconUrl = ref('')

const rootName = computed(() => store.state.config.root_name || '')

const rootIcon = computed(() => {
  const icon = store.state.config.root_icon
  if (!icon || !icon.value) return null
  if (icon.type === 'preset') return icon
  return { ...icon, url: rootIconUrl.value }
})

/** 自定义根图标要换成临时 URL 才能显示，预设图标直接用 static 资源 */
async function loadRootIconUrl() {
  const icon = store.state.config.root_icon
  if (!icon || icon.type !== 'custom' || !icon.value) {
    rootIconUrl.value = ''
    return
  }
  const res = await getTempUrls({ file_ids: [icon.value] })
  const map = res.code === 0 && res.data ? res.data : {}
  rootIconUrl.value = map[icon.value] || ''
}

async function handleRenameRoot() {
  const name = await openInput({
    title: '重命名',
    placeholder: '名称',
    value: rootName.value || '全部文档'
  })
  if (!name) return
  const res = await updateRoot({ name })
  if (res.code === 0 && res.data) {
    store.setConfig(res.data)
    toast.success('已重命名')
  }
}

function handleChangeIconRoot() {
  iconPickerTarget.value = { _id: ROOT_ICON_TARGET }
  iconPickerCurrent.value = rootIcon.value || null
  iconPickerVisible.value = true
}

/**
 * 归一化图标结构：云端 normalizeIcon 接受 {type:'preset'|'wot'|'custom', value:string}，
 * 而本地草稿的 custom 图标还带 url（本地预览用）。这里剥掉前端专用字段，
 * 同时把结构非法的图标拦在本地，避免发出必然失败的请求让用户只看到笼统提示。
 * @param {object|null} icon 选择器草稿
 * @returns {object|null} 云对象可接受的图标结构
 */
function toCloudIcon(icon) {
  if (!icon) return null
  const type = ['preset', 'wot', 'custom'].indexOf(icon.type) !== -1 ? icon.type : ''
  const value = typeof icon.value === 'string' ? icon.value.trim() : ''
  if (!type || !value) return null
  return { type, value }
}

async function handleIconConfirm(icon) {
  const target = iconPickerTarget.value
  if (!target) return
  const cloudIcon = toCloudIcon(icon)
  // 结构非法时给出具体原因；合法请求失败时 call() 已弹出云端文案，不重复提示
  if (icon && !cloudIcon) {
    toast.error('图标格式不正确，请重新选择')
    iconPickerTarget.value = null
    return
  }
  // 根节点图标写系统配置，普通文件夹写 mm-files
  if (target._id === ROOT_ICON_TARGET) {
    const rootRes = await updateRoot({ icon: cloudIcon })
    if (rootRes.code === 0 && rootRes.data) {
      store.setConfig(rootRes.data)
      await loadRootIconUrl()
      toast.success('图标已更新')
    }
    iconPickerTarget.value = null
    return
  }
  const res = await updateIcon({ folder_id: target._id, icon: cloudIcon })
  if (res.code === 0) {
    toast.success('图标已更新')
    await loadTree()
  }
  iconPickerTarget.value = null
}

// ---------------- 文件交互 ----------------
async function openDocument(file) {
  if (!file) return
  // 打开文档要拉取正文、批注与图片链接，期间用 wot loading 遮罩；
  // 无论成功失败都在 finally 关闭，避免转圈卡死。
  toast.loading('正在打开文档…')
  let pendingError = ''
  try {
    // 本地正常打开的文档恢复可编辑；分享只读标记只由 resolveShare 设置
    shareReadOnly.value = false
    const res = await getContent({ file_id: file._id })
    if (res.code !== 0 || !res.data) return
    let content = res.data.content || ''
    let readError = res.data.error || ''
    if (!content && res.data.tempUrl && typeof fetch === 'function') {
      try {
        const response = await fetch(res.data.tempUrl)
        content = await response.text()
      } catch (error) {
        readError = '内容下载失败：' + ((error && error.message) || '可能是云存储跨域限制')
        content = ''
      }
    }
    store.openFile(res.data.doc, content, [])
    await Promise.all([reloadComments(file._id), loadImageUrlMap(content)])
    mode.value = 'read'
    activeCommentId.value = ''
    // 换文档后旧锚点坐标系失效，必须清空
    annotationSelection.value = null
    hasActiveSelection.value = false
    commentDetailVisible.value = false
    saveStatus.value = 'saved'
    // 新正文的滚动位置与可用标题都变了：重新量一次并回到顶部
    activeOutlineIndex.value = -1
    scrollHost = null
    nextTick(() => {
      measureScroll()
      if (scrollHost) scrollHost.scrollTop = 0
      measureScroll()
    })
    if (!content) pendingError = readError || '未读取到文档内容'
  } catch (error) {
    pendingError = (error && (error.message || error.errMsg)) || '打开文档失败，请重试'
  } finally {
    toast.close()
  }
  // loading 的 close 会关掉当前 toast，错误提示必须在 close 之后再发
  if (pendingError) toast.error(pendingError)
}

function handleOpenFile(file) {
  openDocument(file)
}

function handleDrawerOpenFile(file) {
  drawerVisible.value = false
  openDocument(file)
}

function handleBatchDelete(ids) {
  if (!ids || ids.length === 0) return
  confirm({ title: '删除', content: '所选内容将移入回收站' }).then(async ok => {
    if (!ok) return
    const result = await softDelete({ file_ids: ids })
    if (result.code === 0) {
      toast.success('已移入回收站')
      await loadFiles(currentFolderId.value)
      await loadTree()
    }
  })
}

// ---------------- 重命名 / 移动 / 导出 ----------------

/** 文档重命名：重名由服务端 genUniqueName 统一处理，前端不拼 -copyN */
async function handleRenameFile(file) {
  if (!file) return
  const name = await openInput({ title: '重命名', placeholder: '名称', value: file.name })
  if (!name || name === file.name) return
  const res = await rename({ file_id: file._id, name })
  if (res.code === 0) {
    toast.success('已重命名')
    await loadFiles(currentFolderId.value)
    if (store.state.currentFile && store.state.currentFile._id === file._id && res.data) {
      store.openFile(
        { ...store.state.currentFile, name: res.data.name },
        store.state.editorContent,
        store.state.comments
      )
    }
  }
}

const moveVisible = ref(false)
const moveSource = ref(null)
/** 当前浏览到的父级目录（'' 表示根目录）；只决定展示层级，不代表已选目标 */
const moveCurrentId = ref('')

// 关闭或重新打开弹层都回到根目录，避免下次停留在上次的深层目录
watch(moveVisible, () => {
  moveCurrentId.value = ''
})

/** 文档「移动到…」 */
function handleMoveFile(file) {
  if (!file) return
  moveSource.value = file
  moveCurrentId.value = ''
  moveVisible.value = true
}

/** 文件夹「移动到…」 */
function handleMoveFolder(node) {
  if (!node) return
  // 防御：不依赖 listTree 的字段投影是否完整，显式标注为文件夹。
  // 否则 moveTargets 的「不能移动到自己的子目录」判定会恒为 false。
  moveSource.value = Object.assign({}, node, { type: 'folder' })
  moveCurrentId.value = ''
  moveVisible.value = true
}

/** 判断 folderId 是否为 ancestorId 的后代（用于禁止移入自身子树） */
function isDescendantOf(folderId, ancestorId, folders) {
  const map = new Map()
  for (const folder of folders || []) map.set(folder._id, folder)
  let cursor = folderId
  for (let depth = 0; depth < 50 && cursor; depth++) {
    const node = map.get(cursor)
    if (!node) return false
    if (node.parent_id === ancestorId) return true
    cursor = node.parent_id
  }
  return false
}

/** 目标文件夹候选：根节点 + 全部文件夹；非法目标置灰并给出原因 */
const moveTargets = computed(() => {
  const source = moveSource.value
  if (!source) return []
  const folders = store.state.tree || []
  const rootIsCurrent = (source.parent_id || '') === ''
  const list = [{
    _id: '',
    name: '全部文档',
    depth: 0,
    // 目标就是当前所在目录时同样置灰，避免发出无效 move 后弹出「已移动」的假成功提示
    disabled: rootIsCurrent,
    current: rootIsCurrent,
    reason: rootIsCurrent ? '已在此目录' : ''
  }]

  const childrenMap = {}
  for (const folder of folders) {
    if (!folder || !folder._id) continue
    const parentId = folder.parent_id || ''
    if (!childrenMap[parentId]) childrenMap[parentId] = []
    childrenMap[parentId].push(folder)
  }

  const walk = (parentId, depth) => {
    const children = (childrenMap[parentId] || []).slice().sort((left, right) =>
      String(left.name || '').localeCompare(String(right.name || ''))
    )
    for (const folder of children) {
      let disabled = false
      let reason = ''
      if (folder._id === source._id) {
        disabled = true
        reason = '不能移动到自身'
      } else if (source.type === 'folder' && isDescendantOf(folder._id, source._id, folders)) {
        disabled = true
        reason = '不能移动到自己的子目录'
      }
      const isCurrent = (source.parent_id || '') === folder._id
      if (!disabled && isCurrent) {
        disabled = true
        reason = '已在此目录'
      }
      list.push({ _id: folder._id, name: folder.name, depth, disabled, current: isCurrent, reason })
      walk(folder._id, depth + 1)
    }
  }
  walk('', 1)
  return list
})

/** 全量候选按 _id 建索引，供层级浏览复用同一套 disabled / current / reason 判定 */
const moveTargetIndex = computed(() => {
  const index = new Map()
  for (const item of moveTargets.value) index.set(item._id || '', item)
  return index
})

/** 当前浏览目录在候选表里的合法性标记（作为「移动到此处」的目标） */
const moveCurrentTarget = computed(() =>
  moveTargetIndex.value.get(moveCurrentId.value || '') ||
  { _id: moveCurrentId.value || '', disabled: false, reason: '' }
)

/** 根目录项始终可选，沿用候选表里的根节点判定 */
const moveRootTarget = computed(() =>
  moveTargetIndex.value.get('') || { _id: '', disabled: false, reason: '' }
)

/** 「移动到此处」在当前层级为非法目标时禁用 */
const moveHereDisabled = computed(() => !!moveCurrentTarget.value.disabled)

/** 当前浏览路径的面包屑（不含根，根由模板固定渲染） */
const moveBreadcrumb = computed(() => {
  const folders = store.state.tree || []
  const map = new Map()
  for (const folder of folders) {
    if (folder && folder._id) map.set(folder._id, folder)
  }
  const path = []
  let cursor = moveCurrentId.value || ''
  for (let depth = 0; depth < 50 && cursor; depth++) {
    const node = map.get(cursor)
    if (!node) break
    path.unshift({ _id: node._id, name: node.name })
    cursor = node.parent_id || ''
  }
  return path
})

/** 当前父级的直接子目录：点击只进入浏览，不执行移动；置灰与原因沿用候选表 */
const moveBrowseTargets = computed(() => {
  const folders = store.state.tree || []
  const parentId = moveCurrentId.value || ''
  return folders
    .filter(folder => folder && folder._id && (folder.parent_id || '') === parentId)
    .slice()
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
    .map(folder => {
      const flag = moveTargetIndex.value.get(folder._id) || {}
      return {
        _id: folder._id,
        name: folder.name,
        disabled: !!flag.disabled,
        current: !!flag.current,
        reason: flag.reason || '',
        hasChildren: folders.some(child => child && (child.parent_id || '') === folder._id)
      }
    })
})

/**
 * 点击目录项：仅切换浏览层级，不移动、不关闭弹层。
 * 浏览与「作为移动目标」解耦：置灰项（自身 / 后代 / 已在此目录）仍可进入继续浏览，
 * 但确认时由 moveHereDisabled 与 chooseMoveTarget 的 disabled 早退禁止移动，
 * 这样文档当前所在目录的子目录依然可达。
 */
function browseMoveTarget(item) {
  if (!item) return
  moveCurrentId.value = item._id || ''
}

/** 面包屑 / 根目录项：跳到指定层级继续浏览（合法性在确认环节判定） */
function moveToLevel(folderId) {
  moveCurrentId.value = folderId || ''
}

/** 返回上一级 */
function moveUpOneLevel() {
  const crumbs = moveBreadcrumb.value
  moveCurrentId.value = crumbs.length >= 2 ? crumbs[crumbs.length - 2]._id : ''
}

/** 确认「移动到此处」：以当前浏览层级为目标，沿用原有合法性早退与刷新链路 */
async function confirmMoveHere() {
  if (!moveSource.value) return
  await chooseMoveTarget(moveCurrentTarget.value)
}

/** 选中目标目录后执行移动，成功后刷新目录树与当前目录列表 */
async function chooseMoveTarget(target) {
  const source = moveSource.value
  if (!source || !target || target.disabled) return
  const res = await move({ file_id: source._id, parent_id: target._id || '' })
  if (res.code === 0) {
    toast.success('已移动')
    moveVisible.value = false
    moveSource.value = null
    await Promise.all([loadTree(), loadFiles(currentFolderId.value)])
  }
}

/** 扫描存储态 token，批量换取临时 URL（不写 imageUrlMap，供导出等场景复用） */
async function resolveImageUrlsForText(content) {
  const ids = Array.from(new Set(
    (String(content || '').match(/mm-image:\/\/([^\s)'"]+)/g) || [])
      .map(token => token.replace('mm-image://', ''))
  ))
  if (ids.length === 0) return {}
  const res = await getTempUrls({ file_ids: ids })
  return res.code === 0 && res.data ? res.data : {}
}

/**
 * 导出单篇 md（R15 / AC-24）：
 * exportFile → content 为空时用 tempUrl 兜底 fetch → 存储态转显示态 → downloadMarkdown。
 * 全程只读，不触发任何写接口。
 */
async function handleExport(file) {
  if (!file) return
  const res = await exportFile({ file_id: file._id })
  if (res.code !== 0 || !res.data) return

  let content = res.data.content || ''
  if (!content && res.data.tempUrl && typeof fetch === 'function') {
    try {
      const response = await fetch(res.data.tempUrl)
      content = await response.text()
    } catch (error) {
      content = ''
    }
  }
  if (!content) {
    toast.error('导出失败，请重试')
    return
  }

  const urlMap = await resolveImageUrlsForText(content)
  const displayContent = content.replace(/mm-image:\/\/([^\s)'"]+)/g, (matched, fileId) => urlMap[fileId] || matched)
  downloadMarkdown(res.data.name || file.name, displayContent)
  toast.success('已导出')
}

// ---------------- 上传 / 导入 ----------------
function readFileText(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('当前环境不支持读取文件'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsText(file)
  })
}

/**
 * 在当前文件夹内新建一篇 md 文档。
 * 复用现有上传链路（uploadCloudFile + registerUpload），不新增云对象方法；
 * 服务端 genUniqueName 会自动处理同名去重。创建后直接打开并进入编辑态。
 */
async function handleCreateFile() {
  // #ifdef H5
  const content = '# 未命名文档\n'
  const uid = (store.state.user && store.state.user.uid) || 'anonymous'
  try {
    const cloudPath = CLOUD_PATH.markdown(uid).replace('{uuid}', genUuid())
    const blob = new Blob([content], { type: 'text/markdown' })
    const uploaded = await uploadCloudFile({ cloudPath, file: blob })
    const storageKey = uploaded && uploaded.fileID
    if (!storageKey) throw new Error('创建失败')
    const res = await registerUpload({
      name: '未命名文档.md',
      parent_id: currentFolderId.value,
      storage_key: storageKey,
      content
    })
    if (res.code !== 0 || !res.data) throw new Error('创建失败')
    await Promise.all([loadFiles(currentFolderId.value), loadTree()])
    await openDocument(res.data)
    mode.value = 'edit'
  } catch (error) {
    toast.error('新建失败，请重试')
  }
  // #endif
  // #ifndef H5
  toast.show('当前仅支持网页端新建')
  // #endif
}

function handleUpload() {
  // #ifdef H5
  uni.chooseFile({
    count: 9,
    extension: ['.md'],
    success: async (chooseRes) => {
      const tempFiles = (chooseRes && chooseRes.tempFiles) || []
      const tempPaths = (chooseRes && chooseRes.tempFilePaths) || []
      const tasks = tempFiles
        .map((file, index) => ({ file, filePath: tempPaths[index] }))
        .filter(item => item.file && item.filePath)
      if (tasks.length === 0) return

      const uid = (store.state.user && store.state.user.uid) || 'anonymous'
      let uploadedCount = 0
      let failedCount = 0

      const uploadOne = async ({ file, filePath }) => {
        try {
          const content = await readFileText(file)
          const cloudPath = CLOUD_PATH.markdown(uid).replace('{uuid}', genUuid())
          const uploaded = await uploadCloudFile({ cloudPath, filePath })
          const storageKey = uploaded && uploaded.fileID
          if (!storageKey) throw new Error('上传失败')
          const res = await registerUpload({
            name: file.name || '未命名.md',
            parent_id: currentFolderId.value,
            storage_key: storageKey,
            content
          })
          if (res.code === 0) uploadedCount += 1
          else failedCount += 1
        } catch (error) {
          failedCount += 1
        }
      }

      // 限并发 3：多选上传时避免一次性占满云存储并发与带宽
      for (let i = 0; i < tasks.length; i += 3) {
        await Promise.all(tasks.slice(i, i + 3).map(uploadOne))
      }

      if (uploadedCount > 0) {
        toast.show(failedCount > 0 ? `成功 ${uploadedCount} 篇，失败 ${failedCount} 篇` : `已上传 ${uploadedCount} 篇`)
        await loadFiles(currentFolderId.value)
        await loadTree()
      } else {
        toast.error('上传失败，请重试')
      }
    }
  })
  // #endif
  // #ifndef H5
  toast.show('当前仅支持网页端上传')
  // #endif
}

function handleImport() {
  // #ifdef H5
  uni.chooseFile({
    count: 1,
    extension: ['.md'],
    success: async (chooseRes) => {
      const file = chooseRes.tempFiles && chooseRes.tempFiles[0]
      if (!file) return
      try {
        const content = await readFileText(file)
        const res = await importFile({
          name: file.name || '未命名.md',
          parent_id: currentFolderId.value,
          content
        })
        if (res.code === 0) {
          toast.success('导入成功')
          await loadFiles(currentFolderId.value)
          await loadTree()
        }
      } catch (error) {
        toast.error('导入失败，请重试')
      }
    }
  })
  // #endif
  // #ifndef H5
  toast.show('当前仅支持网页端导入')
  // #endif
}

// ---------------- 保存与版本冲突 ----------------
async function handleSave() {
  const file = store.state.currentFile
  if (!file || saveStatus.value === 'saving') return
  saveStatus.value = 'saving'

  const res = await saveContent({
    file_id: file._id,
    content: store.state.editorContent,
    base_version: store.state.baseVersion
  })

  if (res.code === 0) {
    applySaveSuccess(file, res.data)
    return
  }
  if (res.code === 2001) {
    // 冲突：不弹 Toast、不清空编辑器、不跳转，交给冲突弹窗
    saveStatus.value = 'conflict'
    conflict.value = {
      cloudVersion: (res.data && res.data.cloudVersion) || 0,
      cloudPreview: (res.data && res.data.cloudContent) || '',
      cloudUpdatedAt: (res.data && res.data.cloudUpdatedAt) || ''
    }
    conflictVisible.value = true
    return
  }
  saveStatus.value = 'dirty'
  toast.error(res.message || '保存失败，请重试')
}

async function applySaveSuccess(file, data) {
  saveStatus.value = 'saved'
  store.resetBaseVersion(data.version)
  // 只刷新元数据与版本，editorContent 仍是当前内容
  store.openFile(
    {
      ...file,
      version: data.version,
      size: data.size,
      content_hash: data.content_hash,
      updated_at: data.updated_at
    },
    store.state.editorContent,
    store.state.comments
  )
  await reloadComments(file._id)
  toast.success('已保存')
  // 图片引用追踪：以刚保存的正文对齐引用表。静默失败不干扰保存成功提示，
  // 且该方法幂等——下次保存成功时会自动补正。
  syncRefs({ doc_id: file._id, content: store.state.editorContent }).catch(() => {})
}

async function handleConflictOverwrite() {
  const file = store.state.currentFile
  if (!file) return
  conflictVisible.value = false
  saveStatus.value = 'saving'
  const res = await saveContent({
    file_id: file._id,
    content: store.state.editorContent,
    base_version: conflict.value.cloudVersion,
    force: true
  })
  if (res.code === 0) applySaveSuccess(file, res.data)
  else {
    saveStatus.value = 'dirty'
    toast.error(res.message || '保存失败，请重试')
  }
}

function handleConflictDiscard() {
  // 放弃：不提交任何写操作，编辑器内容原样保留，停留编辑态
  conflictVisible.value = false
  saveStatus.value = 'dirty'
}

// ---------------- 批注 ----------------
function handleSelectText(payload) {
  // 阅读态选区由 mm-annotation 新建批注时使用
  pendingSelection.value = payload
}

const pendingSelection = ref(null)

async function handleCreateComment(payload) {
  const file = store.state.currentFile
  // 优先用内联传入的选区，缺失时回退到阅读态选区缓存
  const selection = payload || pendingSelection.value
  if (!file || !selection) return
  const res = await addComment({
    file_id: file._id,
    selected_text: selection.selectedText,
    prefix: selection.prefix,
    suffix: selection.suffix,
    start_offset: selection.start,
    end_offset: selection.end,
    comment: selection.comment
  })
  if (res.code === 0) {
    toast.success('批注已添加')
    await reloadComments(file._id)
  }
}

async function handleUpdateComment({ comment_id, comment }) {
  const file = store.state.currentFile
  if (!file) return
  const res = await updateComment({ comment_id, comment })
  if (res.code === 0) await reloadComments(file._id)
}

async function handleRemoveComment({ comment_id }) {
  const file = store.state.currentFile
  if (!file) return
  const res = await removeComment({ comment_id })
  if (res.code === 0) {
    toast.success('批注已删除')
    await reloadComments(file._id)
  }
}

/**
 * 点击正文高亮（或其右侧气泡）：打开单条批注详情。
 * 详情里给的是**原文全文**与**批注全文**，列表视图里才是截断态。
 */
function handleCommentClick(payload) {
  const comment = payload && payload.comment ? payload.comment : payload
  if (!comment) return
  activeCommentId.value = comment._id || ''
  commentDetail.value = comment
  commentDetailVisible.value = true
}

/**
 * 点批注气泡上的「查看全部」：打开批注详情弹层。
 * 携带了具体批注时定位到那一条并高亮，未携带则展示列表第一条。
 * 弹层里每条都显示「标记段落（含选中高亮）/ 完整批注内容 / 批注时间」。
 */
function handleViewAllComments(comment) {
  if (comment && comment._id) activeCommentId.value = comment._id
  allCommentsVisible.value = true
}

/** 取某条批注的段落三段式，供弹层高亮渲染；失效时返回 null */
function paragraphOf(comment) {
  if (!comment || !comment._para) return null
  return comment._para
}

/** 气泡与列表统一截断规则 */
function truncateBubble(text) {
  const value = typeof text === 'string' ? text : ''
  return value.length > 60 ? `${value.slice(0, 60)}…` : value
}

function formatCommentTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = num => String(num).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 主壳自己监听选区：批注列表收起时 mm-annotation 不渲染，
 * 浮动「添加批注」按钮仍需正确出现/隐藏。
 *
 * 关键：折叠态只关闭按钮，**不清空锚点**。用户点按钮的瞬间浏览器会折叠选区，
 * 若这里把 annotationSelection 置空，一次性弹层就再也拿不到被批注的段落。
 */
let shellSelectionTimer = null

/**
 * 选区是否完整落在「正文原文」上。
 *
 * 批注气泡（data-mm-ignore）里展示的是批注内容，批注详情弹层里展示的是标记段落与批注全文，
 * 它们都不是文档原文本身。浏览器对选中这些文字同样给出非折叠选区，
 * 旧逻辑只看 isCollapsed 就把「添加批注」浮钮放出来，还保留上一次的正文锚点，
 * 于是「选批注文字也弹按钮」，点下去甚至会把批注挂到旧位置。
 * 这里对选区两端点做硬校验：任一落在忽略子树或正文容器外，都视为不可批注。
 */
function isBodyTextSelection(container) {
  const selection = typeof window !== 'undefined' ? window.getSelection() : null
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false
  let range
  try { range = selection.getRangeAt(0) } catch (e) { return false }
  if (!range || !container || !container.contains(range.commonAncestorContainer)) return false

  function insideIgnored(node) {
    let el = node && node.nodeType === 1 ? node : (node && node.parentElement)
    for (let depth = 0; el && depth < 8; depth++) {
      if (el === container) return false
      if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-mm-ignore')) return true
      el = el.parentElement
    }
    return false
  }

  return !insideIgnored(range.startContainer)
    && !insideIgnored(range.endContainer)
    && !insideIgnored(range.commonAncestorContainer)
}

function captureShellSelection() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const container = document.querySelector('.mm-viewer__body')
  // 批注输入弹层打开期间冻结锚点：用户在弹层里打字会让正文选区折叠，
  // 若此时又去选别的段落，锚点会悄悄换成另一段，和弹层里展示的原文对不上。
  if (commentDialogVisible.value) {
    hasActiveSelection.value = false
    return
  }
  if (!container) {
    hasActiveSelection.value = false
    return
  }
  // 可见性同步判定，点按钮时按钮要立刻淡出，不能等防抖
  const selection = window.getSelection()
  const collapsed = !(selection && selection.rangeCount > 0 && !selection.isCollapsed)
  if (collapsed) {
    // 折叠态只关按钮，不清锚点：点「添加批注」的瞬间浏览器就会折叠选区
    hasActiveSelection.value = false
    return
  }
  // 非折叠选区必须完整落在正文原文上：
  // 选到批注气泡文字 / 详情弹层文字时不弹按钮，并丢弃上一次的正文锚点，避免复用错位置。
  if (!isBodyTextSelection(container)) {
    hasActiveSelection.value = false
    annotationSelection.value = null
    return
  }
  hasActiveSelection.value = true

  // 坐标换算较重，拖选过程合并成一次
  if (shellSelectionTimer) clearTimeout(shellSelectionTimer)
  shellSelectionTimer = setTimeout(async () => {
    shellSelectionTimer = null
    // 弹层已打开就冻结锚点：点「添加批注」的瞬间浏览器会折叠选区，
    // 此刻再换算只会得到 null，把刚缓存、弹层正要用的锚点清掉。
    if (commentDialogVisible.value) return
    const { getSelectionOffsets } = await import('@/common/utils/selection.js')
    // 必须用提纯纯文本：getSelectionOffsets 产出的 start/end/selectedText/前后缀
    // 全部按 plainText 切片，提交时 isAnchorStillValid 也按 plainText 复核。
    // 传 md 原文会让两个坐标系错位，点确定必然报「批注位置已经变化」。
    const offsets = getSelectionOffsets(container, plainText.value || '')
    if (offsets) {
      annotationSelection.value = offsets
    } else {
      // 落在图片 alt / 表格间隙等映射不到的位置：同样收起按钮并丢弃旧锚点
      hasActiveSelection.value = false
      annotationSelection.value = null
    }
  }, 80)
}

function openShellComment() {
  if (!annotationSelection.value) {
    toast.show('请先在正文中选中文字')
    return
  }
  // 取消尚未执行的换算，避免它在弹层打开后把锚点清掉
  if (shellSelectionTimer) {
    clearTimeout(shellSelectionTimer)
    shellSelectionTimer = null
  }
  commentDialogText.value = ''
  commentDialogVisible.value = true
}

/**
 * 校验锚点在「当前正文」里是否仍然成立。
 * 用户点「添加批注」后浏览器会折叠选区，输入批注期间正文也可能被改动（甚至换文档），
 * 提交时必须按 plainText 复核一次，否则会把批注挂到错误位置。
 * @param {object|null} offsets 缓存的锚点
 * @returns {boolean} 仍然有效返回 true
 */
function isAnchorStillValid(offsets) {
  if (!offsets || typeof offsets.start !== 'number' || typeof offsets.end !== 'number') return false
  const text = plainText.value || ''
  if (offsets.end > text.length) return false
  if (text.slice(offsets.start, offsets.end) !== offsets.selectedText) return false
  // 前后缀也一并复核：同一段文字在文中重复出现时，只比选中文本会误判
  const prefixOk = !offsets.prefix || text.slice(offsets.start - offsets.prefix.length, offsets.start) === offsets.prefix
  const suffixOk = !offsets.suffix || text.slice(offsets.end, offsets.end + offsets.suffix.length) === offsets.suffix
  return prefixOk && suffixOk
}

async function submitShellComment() {
  const text = String(commentDialogText.value || '').trim()
  if (!text) return
  const offsets = annotationSelection.value
  if (!offsets) {
    // 锚点在输入期间失效时给出明确反馈，不能静默 return 让用户白点确定
    toast.show('批注位置已失效，请重新选中文字')
    commentDialogVisible.value = false
    return
  }
  if (!isAnchorStillValid(offsets)) {
    // 位置变化：不提交，清掉失效锚点让用户重选，避免写进一条指向错误位置的批注
    toast.show('批注位置已经变化，请重新选择')
    annotationSelection.value = null
    hasActiveSelection.value = false
    commentDialogVisible.value = false
    return
  }
  await handleCreateComment({
    selectedText: offsets.selectedText,
    prefix: offsets.prefix,
    suffix: offsets.suffix,
    start: offsets.start,
    end: offsets.end,
    comment: text
  })
  commentDialogVisible.value = false
  annotationSelection.value = null
  hasActiveSelection.value = false
}

// ---------------- 只读分享 ----------------
function handleShare(file) {
  if (!file) return
  shareTarget.value = file
  shareExpire.value = 86400
  shareVisible.value = true
}

async function confirmShare() {
  const target = shareTarget.value
  if (!target || shareCreating.value) return
  shareCreating.value = true
  try {
    const { createShare } = await import('@/common/api/mm-share.js')
    const { writeShareUrl } = await import('@/common/utils/clipboard.js')
    const res = await createShare({ file_id: target._id, expire_seconds: shareExpire.value })
    if (res.code === 0 && res.data && res.data.token) {
      const copied = await writeShareUrl(res.data.token)
      copied ? toast.success('链接已复制') : toast.success('分享链接已创建')
      shareVisible.value = false
    } else {
      toast.error(res.message || '分享创建失败，请重试')
    }
  } finally {
    shareCreating.value = false
    shareTarget.value = null
  }
}

/** 带分享令牌跳登录，登录成功后由 loginBack 带 query 回到首页 */
function goLoginWithShare(token) {
  const redirect = encodeURIComponent(`/pages/index/index?share_token=${token}`)
  uni.navigateTo({
    url: `/uni_modules/uni-id-pages/pages/login/login-withpwd?uniIdRedirectUrl=${redirect}`
  })
}

/** 打开分享文档前处理未保存改动；返回 false 表示中止 */
async function saveBeforeNavigate() {
  if (saveStatus.value !== 'dirty') return true
  return await confirm({
    title: '有未保存的改动',
    content: '打开分享文档将放弃当前未保存的改动，是否继续？'
  })
}

/**
 * 处理完分享令牌后把它从地址栏抹掉。
 * 否则用户刷新 / 来回切换页面时 URL 里还带着 token，会反复触发同一跳转。
 * hash 路由的 query 与普通 query 两种形态都要处理。
 * @returns {void}
 */
function clearShareTokenFromUrl() {
  if (typeof window === 'undefined') return
  const history = window.history
  const location = window.location
  if (!history || typeof history.replaceState !== 'function' || !location) return
  try {
    const url = new URL(location.href)
    let changed = false
    if (url.searchParams.has('share_token')) {
      url.searchParams.delete('share_token')
      changed = true
    }
    const hash = url.hash || ''
    const queryIndex = hash.indexOf('?')
    if (queryIndex !== -1) {
      const routePath = hash.slice(0, queryIndex)
      const params = new URLSearchParams(hash.slice(queryIndex + 1))
      if (params.has('share_token')) {
        params.delete('share_token')
        const rest = params.toString()
        url.hash = rest ? `${routePath}?${rest}` : routePath
        changed = true
      }
    }
    if (changed) history.replaceState(history.state, '', url.toString())
  } catch (error) {
    // 老浏览器 / 受限环境不支持 URL 解析时忽略，不影响已完成的跳转
  }
}

/** 幂等解析待处理的分享令牌；只读打开，不返回写授权 */
async function resolveShare() {
  const token = pendingShareToken.value || String(uni.getStorageSync('mm_pending_share_token') || '')
  if (!token || shareHandled.has(token) || navigating) return
  if (store.state.config.account_enabled && !isLoggedIn.value) {
    // guardLogin 会带 token 跳登录；保留待处理令牌，登录回来再试
    pendingShareToken.value = token
    return
  }
  shareHandled.add(token)
  pendingShareToken.value = ''
  try { uni.removeStorageSync('mm_pending_share_token') } catch (error) { /* 忽略 */ }
  navigating = true
  try {
    if (!(await saveBeforeNavigate())) {
      shareHandled.delete(token)
      return
    }
    const { openShare } = await import('@/common/api/mm-share.js')
    const res = await openShare({ token })
    if (res.code !== 0 || !res.data) {
      toast.error(res.message || '分享链接无效')
      shareHandled.delete(token)
      clearShareTokenFromUrl()
      return
    }
    const data = res.data
    let content = data.content || ''
    if (!content && data.tempUrl && typeof fetch === 'function') {
      try {
        const response = await fetch(data.tempUrl)
        content = await response.text()
      } catch (error) {
        content = ''
      }
    }
    // 是否可编辑由云端按访问者在文档库的写权限判定（账号关闭匿名直通；
    // 账号开启则按 管理员/归属/权限位 判定），前端不自行推断，服务端保存仍独立鉴权。
    const editable = data.can_edit === true
    shareReadOnly.value = !editable
    store.openFile(data.doc, content, [])
    activeCommentId.value = ''
    mode.value = editable ? 'edit' : 'read'
    saveStatus.value = 'saved'
    activeOutlineIndex.value = -1
    scrollHost = null
    nextTick(measureScroll)
    await Promise.all([reloadComments(data.file_id), loadImageUrlMap(content)])
    toast.show(editable ? '已打开共享文档（可编辑）' : '已打开共享文档（只读）')
    // 只跳这一次：把 token 从地址栏移除，刷新或再次进入都不再重复跳转
    clearShareTokenFromUrl()
  } finally {
    navigating = false
  }
}

// ---------------- 剪贴板 ----------------
/**
 * 检查剪贴板：分享链接询问是否打开，普通文本询问是否追加到当前文档。
 *
 * 只在开关开启时读；读到内容后与上次处理过的文本比对，
 * **只有新内容才继续走后续逻辑**，同一段文字不会被反复追问。
 */
async function inspectClipboard() {
  if (uni.getStorageSync('mm_clipboard_append_enabled') === false) return
  let clipboard
  try {
    clipboard = await import('@/common/utils/clipboard.js')
  } catch (error) {
    // 非 H5 构建或测试装载器不支持动态导入时静默降级，不影响主流程
    return
  }
  const { readClipboard, parseShareUrl, getLastClipboard, setLastClipboard } = clipboard
  const text = await readClipboard()
  // H5 未授权时读不到内容：按需求不再提供「显式读取」按钮，安静跳过
  if (!text) return
  if (text === getLastClipboard()) return
  setLastClipboard(text)

  const token = parseShareUrl(text)
  if (token) {
    const { verifyShare } = await import('@/common/api/mm-share.js')
    const verified = await verifyShare({ token })
    if (verified.code === 0 && verified.data && verified.data.valid) {
      const agreed = await confirm({ title: '检测到分享链接', content: '是否打开这份共享文档？' })
      if (agreed) {
        pendingShareToken.value = token
        await resolveShare()
      }
    }
    return
  }
  if (!store.state.currentFile || shareReadOnly.value) return
  const agreed = await confirm({ title: '剪贴板内容', content: '是否追加到当前文档末尾？' })
  if (agreed) {
    // 只改 store，让既有 watch 置 dirty，由用户用现有保存按钮提交
    store.setEditor(`${store.state.editorContent}\n\n${text}`)
    toast.success('已追加，请点击保存')
  }
}

function handleLocateComment(payload) {
  if (!payload) return
  const commentId = payload._id || ''
  const start = typeof payload.start_offset === 'number'
    ? payload.start_offset
    : (typeof payload.start === 'number' ? payload.start : 0)
  if (commentId) activeCommentId.value = commentId
  // 阅读器按 plainText 坐标滚动（mm-md-viewer 暴露 scrollToOffset）
  const viewer = viewerRef.value
  if (viewer && typeof viewer.scrollToOffset === 'function') viewer.scrollToOffset(start)
}

const viewerRef = ref(null)

// ---------------- 搜索 / 回收站 / 图片 ----------------
async function handleSearchSelect({ file_id, start_offset }) {
  const res = await getContent({ file_id })
  if (res.code === 0 && res.data) {
    let content = res.data.content || ''
    if (!content && res.data.tempUrl && typeof fetch === 'function') {
      try {
        const response = await fetch(res.data.tempUrl)
        content = await response.text()
      } catch (error) {
        content = ''
      }
    }
    store.openFile(res.data.doc, content, [])
    await Promise.all([reloadComments(file_id), loadImageUrlMap(content)])
    mode.value = 'read'
    saveStatus.value = 'saved'
    if (start_offset) {
      setTimeout(() => handleLocateComment({ start: start_offset }), 120)
    }
  }
}

async function handleTrashChanged() {
  await loadFiles(currentFolderId.value)
  await loadTree()
}

function goTrash() {
  uni.navigateTo({ url: '/pages/trash/trash' })
}

async function handleImageSelect({ fileId, name, tempUrl }) {
  if (!fileId) return
  // 记录 fileID → 临时 URL，供编辑器显示态渲染与保存时反替换
  if (tempUrl) imageUrlMap.value = { ...imageUrlMap.value, [fileId]: tempUrl }
  const editor = editorRef.value
  if (editor && typeof editor.insertImage === 'function') {
    // tempUrl 一并传入：props 传下去要等下一轮渲染，
    // 只靠子组件读 props 会在插入瞬间拿不到新图 URL，退化成追加到末尾。
    await nextTick()
    editor.insertImage(fileId, name, tempUrl)
  } else {
    // 编辑器未就绪时退化为追加存储态 token
    const token = `![${name || '图片'}](mm-image://${fileId})`
    const current = store.state.editorContent
    store.setEditor(`${current}${current ? '\n' : ''}${token}\n`)
  }
  toast.success('已插入图片')
}

/**
 * 扫描存储态 mm-image://<fileID>，批量换取临时 URL 供显示。
 * 存储态与显示态的转换只在渲染层发生，库与 plainText 始终基于存储态。
 */
async function loadImageUrlMap(content) {
  imageUrlMap.value = await resolveImageUrlsForText(content)
}

// ---------------- 主题 / 设置 ----------------
function cycleTheme() {
  const order = ['auto', 'light', 'dark']
  const index = order.indexOf(store.state.theme)
  const next = order[(index + 1) % 3]
  store.setTheme(next)
  setStoredTheme(next)
}

function goSettings() {
  uni.navigateTo({ url: '/pages/settings/settings' })
}

// ---------------- 通用输入弹层 ----------------
const inputVisible = ref(false)
const inputTitle = ref('')
const inputPlaceholder = ref('')
const inputValue = ref('')
let inputResolve = null

function openInput({ title, placeholder, value }) {
  inputTitle.value = title || ''
  inputPlaceholder.value = placeholder || ''
  inputValue.value = value || ''
  inputVisible.value = true
  return new Promise((resolve) => {
    inputResolve = resolve
  })
}

function confirmInput() {
  const value = String(inputValue.value || '').trim()
  inputVisible.value = false
  if (inputResolve) {
    inputResolve(value)
    inputResolve = null
  }
}

function cancelInput() {
  inputVisible.value = false
  if (inputResolve) {
    inputResolve('')
    inputResolve = null
  }
}

// ---------------- 浮层互斥 ----------------
/**
 * 页面同一时刻只允许一个浮层可见。
 *
 * 大纲、批注列表严格说是一个侧栏，但在用户视角里同属「打开了一个东西」，
 * 所以和居中弹窗一起纳入互斥：点开大纲时，正在显示的批注列表要让位。
 *
 * 冲突弹窗（conflictVisible）刻意排除在外——它是必须处理的中断，
 * 不能被其它浮层顺手关掉，否则用户的保存冲突就无处确认了。
 *
 * 每项都自带 close：通用输入弹层靠 Promise 把结果回给调用方，
 * 直接置 false 会让等待方永远挂着，必须走 cancelInput。
 */
const POPUPS = [
  { name: 'drawer', flag: drawerVisible, coexist: ['iconPicker'] },
  { name: 'outline', flag: outlineVisible },
  { name: 'annotation', flag: annotationVisible },
  { name: 'commentDetail', flag: commentDetailVisible },
  { name: 'allComments', flag: allCommentsVisible },
  { name: 'commentDialog', flag: commentDialogVisible },
  { name: 'share', flag: shareVisible },
  { name: 'imagePicker', flag: imagePickerVisible },
  { name: 'iconPicker', flag: iconPickerVisible, coexist: ['drawer'] },
  { name: 'move', flag: moveVisible },
  { name: 'input', flag: inputVisible, close: cancelInput }
]

/**
 * 关闭除 keep 之外的所有浮层。
 * @param {string} [keep] 需要保留的浮层名
 * @returns {void}
 */
function closePopupsExcept(keep) {
  const keepItem = POPUPS.find(item => item.name === keep)
  const keepCoexist = (keepItem && keepItem.coexist) || []
  for (const item of POPUPS) {
    if (item.name === keep || keepCoexist.indexOf(item.name) !== -1) continue
    // 自身声明的共存项也不关：抽屉与图标选择器可叠加，关图标不会收起目录
    const selfCoexist = item.coexist || []
    if (keep && selfCoexist.indexOf(keep) !== -1) continue
    if (!item.flag || !item.flag.value) continue
    if (typeof item.close === 'function') item.close()
    else item.flag.value = false
  }
}

/** 关闭全部浮层：切换阅读 / 编辑视图时调用 */
function closeAllPopups() {
  closePopupsExcept('')
}

for (const item of POPUPS) {
  watch(item.flag, (value) => {
    if (value) closePopupsExcept(item.name)
  })
}
</script>

<style scoped>
.mm-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--mm-bg);
  color: var(--mm-text);
  /* 字号五档：正文用 em 相对单位，改这一处即可整体缩放 */
  font-size: calc(16px * var(--mm-font-scale, 1));
}

/* 顶部栏 */
.mm-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(12px * var(--mm-ui-scale, 1));
  height: calc(48px * var(--mm-ui-scale, 1));
  padding: 0 calc(14px * var(--mm-ui-scale, 1));
  flex: none;
  border-bottom: 1px solid var(--mm-border);
  background-color: var(--mm-surface);
}

.mm-topbar__left,
.mm-topbar__right {
  display: flex;
  align-items: center;
  gap: calc(10px * var(--mm-ui-scale, 1));
  min-width: 0;
}

.mm-topbar__title {
  font-size: calc(14px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 保存状态光点：绿=已保存，黄=有改动/冲突，弱色=保存中 */
.mm-topbar__status {
  flex: none;
  width: 8px;
  height: calc(8px * var(--mm-ui-scale, 1));
  border-radius: 50%;
  background-color: var(--mm-text-weak);
}

.mm-topbar__status.is-saved {
  background-color: var(--mm-success);
}

.mm-topbar__status.is-dirty,
.mm-topbar__status.is-conflict {
  background-color: var(--mm-warning);
}

.mm-topbar__status.is-saving {
  opacity: 0.5;
}

/* 顶栏图标统一按 UI 系数缩放，image 形态用于图标字体里没有的字形 */
.mm-topbar__icon-img {
  width: calc(16px * var(--mm-ui-scale, 1));
  height: calc(16px * var(--mm-ui-scale, 1));
}

.mm-topbar__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: calc(28px * var(--mm-ui-scale, 1));
  height: calc(28px * var(--mm-ui-scale, 1));
  padding: 0 calc(4px * var(--mm-ui-scale, 1));
  border-radius: 6px;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text);
  cursor: pointer;
}

/* 图标字体是固定 px，用 scale 跟着 UI 系数走 */
.mm-topbar__icon-btn :deep(.uni-icons) {
  transform: scale(var(--mm-ui-scale, 1));
}

.mm-topbar__icon-btn:hover {
  background-color: var(--mm-surface-2);
}

.mm-topbar__theme {
  color: var(--mm-text-weak);
}

.mm-topbar__login {
  padding: 0 calc(8px * var(--mm-ui-scale, 1));
  color: var(--mm-accent);
  font-weight: 500;
}

/* 手机端底部悬浮保存：仅在有未保存改动时淡入，层级高于正文、低于弹层 */
.mm-save-fab {
  position: fixed;
  bottom: 24px;
  left: 50%;
  z-index: 20;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(8px);
  transition: opacity 180ms ease, transform 180ms ease;
}

.mm-save-fab.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}

/* 浮动「添加批注」：与保存按钮同层，靠右放置避免重叠 */
.mm-add-annotation-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 20;
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
}

.mm-add-annotation-fab.is-visible {
  opacity: 1;
  pointer-events: auto;
}

/* 批注输入弹层里引用的原文片段 */
.mm-dialog__quote {
  display: block;
  margin-bottom: 10px;
  padding: calc(6px * var(--mm-ui-scale, 1)) calc(8px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  background-color: var(--mm-surface-2);
  border-radius: 6px;
}

/* 批注详情：正文与元信息 */
.mm-dialog__text {
  display: block;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  line-height: 1.7;
  color: var(--mm-text);
  white-space: pre-wrap;
}

.mm-dialog__meta {
  display: flex;
  gap: calc(12px * var(--mm-ui-scale, 1));
  margin-top: 10px;
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

/* 全部批注：每条都展示原文与全文，不截断 */
.mm-all-comments__empty {
  padding: calc(28px * var(--mm-ui-scale, 1)) 0;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  text-align: center;
}

.mm-comment-card {
  padding: calc(10px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1));
  margin-bottom: calc(8px * var(--mm-ui-scale, 1));
  border: 1px solid var(--mm-border);
  border-radius: 8px;
  background-color: var(--mm-surface-2);
}

/* 「查看全部」携带的具体那条批注：边框高亮，便于一眼定位 */
.mm-comment-card.is-active {
  border-color: var(--mm-accent);
}

/* 标记段落：左侧强调线 + 三段式流式排版（选中片段高亮） */
.mm-comment-card__para {
  margin-bottom: calc(6px * var(--mm-ui-scale, 1));
  padding-left: calc(8px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  line-height: 1.6;
  color: var(--mm-text-weak);
  border-left: 2px solid var(--mm-accent);
}

.mm-comment-card__quote {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.mm-comment-card__hit {
  color: var(--mm-accent);
  font-weight: 600;
  background-color: var(--mm-mark);
  border-radius: 2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.mm-comment-card__text {
  display: block;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  line-height: 1.7;
  color: var(--mm-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.mm-comment-card__meta {
  display: block;
  margin-top: calc(6px * var(--mm-ui-scale, 1));
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

/* 分享有效期档位 */
.mm-share__options {
  display: flex;
  /* 5 个档位（含无限期）在窄屏放不下一行，允许折行 */
  flex-wrap: wrap;
  gap: calc(8px * var(--mm-ui-scale, 1));
  margin-bottom: 10px;
}

.mm-share__option {
  flex: 1 1 auto;
  min-width: calc(64px * var(--mm-ui-scale, 1));
  padding: calc(8px * var(--mm-ui-scale, 1)) calc(4px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  text-align: center;
  color: var(--mm-text-weak);
  border: 1px solid var(--mm-border);
  border-radius: 8px;
  cursor: pointer;
}

.mm-share__option.is-active {
  color: var(--mm-accent);
  border-color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

/* 分享对象名与说明，避免用户不确定分享的是哪篇、多久失效 */
.mm-share__sub {
  display: block;
  margin-bottom: 10px;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-share__tip {
  display: block;
  margin-bottom: 4px;
  font-size: calc(11px * var(--mm-ui-scale, 1));
  line-height: 1.6;
  color: var(--mm-text-weak);
}

/* 主体三栏 */
.mm-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.mm-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.mm-pane--tree {
  width: 260px;
  flex: none;
  border-right: 1px solid var(--mm-border);
  background-color: var(--mm-surface);
}

.mm-pane--list {
  width: 320px;
  flex: none;
  border-right: 1px solid var(--mm-border);
  background-color: var(--mm-surface);
}

.mm-pane--main {
  position: relative;
  flex: 1;
  min-width: 0;
  background-color: var(--mm-bg);
}

/* 大纲浮层：绝对定位覆盖在正文右侧，不参与 flex 计算（避免压塌 .mm-content） */
.mm-outline-pane {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 12;
  width: calc(240px * var(--mm-ui-scale, 1));
}

/* 回到顶部 / 回到底部：竖排在右下，起始位置高于底部两个浮钮 */
.mm-scroll-fabs {
  position: fixed;
  right: 24px;
  bottom: 76px;
  z-index: 19;
  display: flex;
  flex-direction: column;
  gap: calc(8px * var(--mm-ui-scale, 1));
}

.mm-scroll-fab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(32px * var(--mm-ui-scale, 1));
  height: calc(32px * var(--mm-ui-scale, 1));
  color: var(--mm-text);
  background-color: var(--mm-surface);
  border: 1px solid var(--mm-border);
  border-radius: 50%;
  cursor: pointer;
}

.mm-scroll-fab:hover {
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

/* 打开文档后：文档区与批注栏左右并排。
   mm-annotation 自带 height:100% + flex-basis:auto，若留在 column 流中会吃光高度，
   使 flex:1 的 .mm-content 被压成 0px，正文虽已渲染却被 overflow:auto 裁掉。 */
.mm-pane--main.is-split {
  flex-direction: row;
}

.mm-doc {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.mm-pane--main :deep(.mm-annotation-pane) {
  flex: none;
  width: 300px;
  min-width: 0;
  height: 100%;
  border-left: 1px solid var(--mm-border);
}

/* 窄屏回退为上下排布，批注栏限高，避免仍挤掉正文 */
@media (max-width: 900px) {
  /* 尺寸放大交给 --mm-ui-scale（<768px 时 1.16），这里只调整布局密度 */
  .mm-topbar {
    gap: calc(4px * var(--mm-ui-scale, 1));
    padding: 0 calc(10px * var(--mm-ui-scale, 1));
  }

  .mm-topbar__left,
  .mm-topbar__right {
    gap: calc(2px * var(--mm-ui-scale, 1));
  }

  .mm-mode {
    padding: calc(4px * var(--mm-ui-scale, 1)) calc(10px * var(--mm-ui-scale, 1));
  }

  .mm-add-annotation-fab {
    right: 16px;
    bottom: 24px;
  }

  .mm-scroll-fabs {
    right: 16px;
    bottom: 76px;
  }

  .mm-pane--main.is-split {
    flex-direction: column;
  }

  .mm-pane--main :deep(.mm-annotation-pane) {
    width: 100%;
    height: auto;
    max-height: 34%;
    border-left: none;
    border-top: 1px solid var(--mm-border);
  }

  /* 窄屏大纲改成从底部弹出的横条，避免只占 240px 宽反而挡住正文 */
  .mm-outline-pane {
    top: auto;
    left: 0;
    width: 100%;
    height: 40%;
    border-left: none;
    border-top: 1px solid var(--mm-border);
  }
}

.mm-pane__foot {
  flex: none;
  /* 左内边距留给 .mm-pane__link--inset 统一控制，才能与目录树图标严格对齐 */
  padding: calc(8px * var(--mm-ui-scale, 1)) calc(12px * var(--mm-ui-scale, 1)) calc(8px * var(--mm-ui-scale, 1)) 0;
  border-top: 1px solid var(--mm-border);
}

.mm-pane__link {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--mm-ui-scale, 1));
  padding: calc(6px * var(--mm-ui-scale, 1)) calc(4px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  cursor: pointer;
}

/*
 * 与目录树「全部文档」图标左对齐。
 * 树行的图标起点 = 6px 行内边距 + 14px（固定）展开箭头 + 4px 间距，
 * 前两者随 --mm-ui-scale 缩放，箭头是固定像素，所以这里要拆开算。
 */
.mm-pane__link--inset {
  padding-left: calc(10px * var(--mm-ui-scale, 1) + 14px);
}

/* 阅读 / 编辑切换：允许换行，窄屏不再靠挤压或隐藏文字塞进一行 */
.mm-mode {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: calc(6px * var(--mm-ui-scale, 1));
  row-gap: calc(2px * var(--mm-ui-scale, 1));
  min-height: calc(38px * var(--mm-ui-scale, 1));
  padding: calc(4px * var(--mm-ui-scale, 1)) calc(14px * var(--mm-ui-scale, 1));
  flex: none;
  border-bottom: 1px solid var(--mm-border);
  background-color: var(--mm-surface);
}

.mm-mode__item {
  padding: calc(3px * var(--mm-ui-scale, 1)) calc(10px * var(--mm-ui-scale, 1));
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  border-radius: 10px;
  cursor: pointer;
}

.mm-mode__item.is-active {
  color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

.mm-mode__spacer {
  flex: 1;
  min-width: 0;
}

.mm-mode__action {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--mm-ui-scale, 1));
  padding: calc(3px * var(--mm-ui-scale, 1)) calc(6px * var(--mm-ui-scale, 1));
  border-radius: 6px;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  cursor: pointer;
}

.mm-mode__action :deep(.uni-icons) {
  transform: scale(var(--mm-ui-scale, 1));
}

.mm-mode__action:hover {
  color: var(--mm-accent);
  background-color: var(--mm-surface-2);
}

/* 预览开关的开启态：用色彩表达，不加说明性小字 */
.mm-mode__action.is-active {
  color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

.mm-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.mm-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
  cursor: pointer;
}

/* 移动端抽屉 */
.mm-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--mm-surface);
}

/* 抽屉固定关闭入口：点击文件夹不再收起抽屉后，仍可明确关闭 */
.mm-drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  height: calc(40px * var(--mm-ui-scale, 1));
  padding: 0 calc(12px * var(--mm-ui-scale, 1));
  border-bottom: 1px solid var(--mm-border);
}

.mm-drawer__title {
  font-size: calc(13px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-drawer__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: calc(28px * var(--mm-ui-scale, 1));
  border-radius: 6px;
  cursor: pointer;
}

.mm-drawer__close:hover {
  background-color: var(--mm-surface-2);
}

.mm-drawer__tree {
  flex: none;
  max-height: 42%;
  overflow: auto;
  border-bottom: 1px solid var(--mm-border);
  padding: calc(8px * var(--mm-ui-scale, 1)) 0;
}

.mm-drawer__list {
  flex: 1;
  min-height: 0;
}

/* 通用输入弹层 */
.mm-dialog {
  padding: calc(18px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1));
  /*
   * 必须限高并允许内部滚动：批注详情里的原文与批注都可能很长，
   * 弹层按内容自然撑高会被视口裁掉，用户就「看不到全部批注内容」。
   */
  max-height: 82vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.mm-dialog__title {
  display: block;
  margin-bottom: 12px;
  font-size: calc(14px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

.mm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: calc(10px * var(--mm-ui-scale, 1));
  margin-top: 16px;
}

/* 移动到弹层 */
.mm-move {
  padding: calc(18px * var(--mm-ui-scale, 1)) calc(16px * var(--mm-ui-scale, 1)) calc(14px * var(--mm-ui-scale, 1));
}

.mm-move__title {
  display: block;
  margin-bottom: 10px;
  font-size: calc(14px * var(--mm-ui-scale, 1));
  font-weight: 600;
  color: var(--mm-text);
}

/* 当前路径面包屑 + 返回上一级：用布局表达层级，不加说明性小字 */
.mm-move__path {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: calc(4px * var(--mm-ui-scale, 1));
  margin-bottom: 10px;
  font-size: calc(12px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-move__crumb {
  padding: calc(2px * var(--mm-ui-scale, 1)) calc(4px * var(--mm-ui-scale, 1));
  border-radius: 4px;
  cursor: pointer;
}

.mm-move__crumb:hover {
  color: var(--mm-accent);
  background-color: var(--mm-surface-2);
}

.mm-move__crumb.is-active {
  color: var(--mm-accent);
  font-weight: 600;
}

.mm-move__sep {
  color: var(--mm-text-weak);
}

.mm-move__spacer {
  flex: 1;
}

.mm-move__up {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--mm-ui-scale, 1));
  padding: calc(2px * var(--mm-ui-scale, 1)) calc(6px * var(--mm-ui-scale, 1));
  border-radius: 4px;
  cursor: pointer;
}

.mm-move__up:hover {
  color: var(--mm-accent);
  background-color: var(--mm-surface-2);
}

.mm-move__body {
  max-height: 46vh;
  border: 1px solid var(--mm-border);
  border-radius: 8px;
}

.mm-move__item {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--mm-ui-scale, 1));
  height: calc(34px * var(--mm-ui-scale, 1));
  padding-left: calc(12px * var(--mm-ui-scale, 1));
  padding-right: calc(10px * var(--mm-ui-scale, 1));
  font-size: calc(13px * var(--mm-ui-scale, 1));
  color: var(--mm-text);
  cursor: pointer;
}

.mm-move__item:hover {
  background-color: var(--mm-surface-2);
}

.mm-move__item.is-current {
  color: var(--mm-accent);
  background-color: var(--mm-accent-weak);
}

/* 置灰只代表「不能移动到此处」，仍可点击进入浏览其下级目录 */
.mm-move__item.is-disabled {
  color: var(--mm-text-weak);
  opacity: 0.6;
  cursor: pointer;
}

.mm-move__item.is-disabled:hover {
  background-color: transparent;
}

.mm-move__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-move__reason {
  flex: none;
  font-size: calc(11px * var(--mm-ui-scale, 1));
  color: var(--mm-text-weak);
}

.mm-move__actions {
  display: flex;
  justify-content: flex-end;
  gap: calc(10px * var(--mm-ui-scale, 1));
  margin-top: 14px;
}
</style>
