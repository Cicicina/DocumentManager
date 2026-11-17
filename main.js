import App from './App'

// #ifndef VUE3
import Vue from 'vue'
Vue.config.productionTip = false


App.mpType = 'app'

const app = new Vue({
  ...App
})
app.$mount()
// #endif

// #ifdef VUE3
import {createSSRApp} from 'vue'
import '@/common/theme.css'

export function createApp() {
	const app = createSSRApp(App)
	// Wot UI（wot-design-uni@1.14.0）的 npm 包是 uni_modules 源码形态：
	// 没有 default 插件导出、没有 dist 下的全局 CSS，组件内部还依赖 easycom
	// 自动引入的 <wd-icon> 等标签，因此不能 app.use，也不能只挑几个组件
	// app.component 全局注册。组件统一由 pages.json 的 easycom custom 规则
	// 自动引入（单一形态，不与全局注册混用），此处不注册任何 Wot 组件。
	// 主题样式已在上方引入，深浅色由 common/utils/theme.js 注入。
	return {
		app
	}
}
// #endif
