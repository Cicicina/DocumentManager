<script>
  import checkUpdate from '@/uni_modules/uni-upgrade-center-app/utils/check-update';
  import { ANONYMOUS_USER_ID } from '@/common/constants.js'
  import { useAppStore } from '@/common/store/index.js'
  import { getConfig } from '@/common/api/mm-settings.js'
  import { applyTheme, watchSystemTheme, getStoredTheme } from '@/common/utils/theme.js'
  import { applyFont, getStoredFont } from '@/common/utils/font.js'

  export default {
    onLaunch: async function() {
      console.log('App Launch')
		// #ifdef MP-WEIXIN
		uniCloud.initSecureNetworkByWeixin()
		// #endif
      checkUpdate() //更新升级

      // 首屏准备：读取系统配置 → 注入主题 → 标记就绪（加载动画据此淡出）
      const store = useAppStore()
      try {
        // getConfig 无需登录态；失败时用默认配置继续，不阻塞首屏
        const res = await getConfig()
        if (res && res.code === 0 && res.data) {
          store.setConfig(res.data)
          if (res.data.anonymous === true) {
            store.setUser({ anonymous: true, uid: ANONYMOUS_USER_ID })
          }
        }
      } catch (error) {
        // 服务空间未绑定等异常留给页面提示，此处只保证首屏可进入
      }

      // 主题：手动偏好优先，auto 时由 CSS 的 prefers-color-scheme 跟随系统
      const savedTheme = getStoredTheme()
      store.setTheme(savedTheme)
      applyTheme(savedTheme)
      watchSystemTheme()

      // 字号：本地偏好优先，未设置时用默认「中」
      applyFont(getStoredFont())

      // 只切换就绪标记，不触碰 editorContent（唯一编辑内容源）
      store.setReady(true)
    },
    mounted() {
      // #ifdef H5
      //const VConsole = require('@/common/js/vconsole.min.js')
      //new VConsole()
      // #endif
    },
    onShow: function() {
      console.log('App Show')
    },
    onHide: function() {
      console.log('App Hide')
    }
  }
</script>

<style>
  /*每个页面公共css */
  /* #ifndef APP-NVUE */
  view {
    box-sizing: border-box;
  }

  /*
   * md-editor 格式栏：为固定在视口右缘的「更多」按钮预留空间，
   * 避免横向滚动到最右侧时挡住最后一个按钮（源码地址）。
   * 必须写在 App.vue 全局样式：mm-md-editor 组件内的 <style> 会被 uni-app
   * 追加 [data-v-xxx] 作用域，命中不了 md-editor 异步组件的内部 DOM。
   */
  .mm-editor .md-editor-toolbar-wrapper .md-editor-toolbar {
    padding-right: calc(36px * var(--mm-ui-scale, 1));
  }

  @font-face {
    font-family: "iconfont";
    src: url('https://at.alicdn.com/t/font_2354462_s00xh8caffp.ttf');
  }

  .ico {
    font-family: iconfont;
  }

  /* #endif */
</style>
