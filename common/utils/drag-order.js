/**
 * 图片拖动排序（H5，pointer 事件）。
 *
 * 用法：把返回的 startDrag 绑到每个卡片的 @pointerdown，并给卡片加
 * `:data-drag-index="index"` 与 `:class="{ 'is-dragging': draggingId === item._id }"`。
 * 拖动过程中直接就地重排数组（有实时反馈），松手时把最终数组交给 onCommit 写库。
 *
 * 不用 HTML5 draggable：uni-app 的 <view> 不是原生可拖元素，且触屏端不生效。
 * 这里靠 elementFromPoint 找落点，鼠标与手指走同一套逻辑。
 *
 * 两种进入拖动的方式，避免和页面滚动打架：
 * - 鼠标：按下后移动超过 4px 即开始拖（点击不会误触发）。
 * - 触屏：长按 300ms 才开始拖；在此之前手指移动超过 8px 视为滚动，直接放弃。
 *
 * 触屏的关键点：touch-action 在 pointerdown 那一刻就被浏览器锁定，
 * 300ms 后再改 dragEl.style.touchAction 已经晚了——手指一移浏览器就接管滚动并
 * 发 pointercancel，拖动永远起不来。所以进入拖动后必须在 document 上挂一个
 * { passive: false } 的 touchmove，主动 preventDefault 阻止滚动接管。
 * 同时禁掉长按弹出的系统菜单 / 文字选择（iOS 尤其明显）。
 */
import { ref } from 'vue'

/**
 * 从 uni-app 的（可能被包装的）事件里取出触点信息。
 *
 * 关键坑（与批注「查看全部」同款）：uni-app H5 中 <view @pointerdown> 的 $event
 * 可能是包装对象，pointerType / clientX / currentTarget 都不在顶层；部分内置浏览器
 * 甚至只发 touchstart（带 touches/changedTouches）、不发 pointerdown。
 * 旧实现直接读 event.pointerType === 'touch'，这两种情况都拿不到 → 长按定时器
 * 永远不启动，表现就是「长按图片没反应」。
 *
 * 这里按优先级探测：原生 PointerEvent → uni 包装的 $event/mp.detail → touch 事件。
 * @returns {{isTouch:boolean, x:number, y:number, el:Element|null, cancelable:boolean,
 *   preventDefault:Function, stopPropagation:Function, source:object}}
 */
function normalizePointerEvent(event) {
  const noop = () => {}
  const fallback = { isTouch: false, x: 0, y: 0, el: null, cancelable: false, preventDefault: noop, stopPropagation: noop, source: event }

  // 按优先级收集候选原生事件源：外层本身 → uni 包装层 → touch 触点
  const candidates = []
  if (event && typeof event === 'object') {
    candidates.push(event)
    const detail = event.mp && event.mp.detail ? event.mp.detail : null
    if (event.$event) candidates.push(event.$event)
    if (event.mp) candidates.push(event.mp)
    if (detail) candidates.push(detail)
    if (event.detail) candidates.push(event.detail)
  }

  // touch 事件：触点在 touches / changedTouches，事件本体带 currentTarget
  const touchList = event && (event.changedTouches || event.touches)
  const touch = touchList && touchList.length ? touchList[0] : null

  let isTouch = false
  let x = NaN
  let y = NaN
  let el = null
  let cancelable = false
  let preventDefault = noop
  let stopPropagation = noop
  let source = event

  // 先从事件候选里取坐标、pointerType、DOM 元素
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    if (candidate.pointerType === 'touch') isTouch = true
    if (Number.isNaN(x) && Number.isFinite(candidate.clientX)) x = candidate.clientX
    if (Number.isNaN(y) && Number.isFinite(candidate.clientY)) y = candidate.clientY
    if (!el && candidate.currentTarget && candidate.currentTarget.querySelectorAll) el = candidate.currentTarget
    if (!el && candidate.target && candidate.target.querySelectorAll) el = candidate.target
    if (typeof candidate.preventDefault === 'function') {
      const fn = candidate.preventDefault.bind(candidate)
      if (preventDefault === noop) preventDefault = fn
    }
    if (typeof candidate.stopPropagation === 'function') {
      const fn = candidate.stopPropagation.bind(candidate)
      if (stopPropagation === noop) stopPropagation = fn
    }
    if (cancelable || candidate.cancelable === true) cancelable = true
    source = candidate
  }

  // touch 事件：pointerType 缺失，但有触点即认定为触屏
  if (touch) {
    isTouch = true
    if (Number.isNaN(x) && Number.isFinite(touch.clientX)) x = touch.clientX
    if (Number.isNaN(y) && Number.isFinite(touch.clientY)) y = touch.clientY
  }

  // 完全取不到坐标时视为无效事件，调用方直接忽略
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback

  return { isTouch, x, y, el, cancelable, preventDefault, stopPropagation, source }
}

/** 鼠标判定为「开始拖动」的位移阈值（px） */
const MOUSE_THRESHOLD = 4
/** 触屏长按多久进入拖动（ms） */
const TOUCH_HOLD_MS = 300
/** 触屏在长按生效前允许的抖动位移（px），超过即认为是滚动 */
const TOUCH_SLOP = 8

/**
 * @param {() => Array} getItems 读取当前列表
 * @param {(next: Array) => void} setItems 写回重排后的列表
 * @param {(items: Array) => void|Promise<void>} onCommit 松手时回调最终顺序
 * @returns {{draggingId: object, startDrag: Function}}
 */
export function useImageDragSort(getItems, setItems, onCommit) {
  const draggingId = ref('')
  let dragIndex = -1
  /** 手势进行中（已按下、未松手） */
  let active = false
  /** 已真正进入拖动状态（决定是否写库） */
  let armed = false
  let dragEl = null
  let originX = 0
  let originY = 0
  let holdTimer = null
  let currentItem = null
  let lastTouchAction = ''
  /** 按下时是否为触屏手势：document 上的 pointermove 不一定带 pointerType，沿用按下结论 */
  let touchGesture = false

  /**
   * 触屏拖动期间阻止页面滚动：handleMove 在 armed 后调用 point.preventDefault()，
   * 而 touchmove 监听挂成 passive:false（见 startDrag），preventDefault 才会生效。
   * 长按时段（未 armed）handleMove 会提前 return 不拦截，页面仍可正常滚动。
   */

  /** 长按会触发系统菜单 / 文字选择，弹出来后 pointercancel 会打断拖动 */
  function handleContextMenu(event) {
    if (!active) return
    if (event.cancelable) event.preventDefault()
  }

  /** 由屏幕坐标反查落点卡片的下标，找不到返回 -1 */
  function indexFromPoint(x, y) {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return -1
    const element = document.elementFromPoint(x, y)
    if (!element || typeof element.closest !== 'function') return -1
    const holder = element.closest('[data-drag-index]')
    if (!holder) return -1
    const index = Number(holder.getAttribute('data-drag-index'))
    return Number.isFinite(index) ? index : -1
  }

  function clearHold() {
    if (holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  /** 进入拖动状态：锁定该元素的触摸手势，并点亮 is-dragging */
  function arm() {
    if (armed || !active) return
    armed = true
    draggingId.value = (currentItem && (currentItem._id || currentItem.file_id)) || ''
    if (dragEl && dragEl.style) {
      lastTouchAction = dragEl.style.touchAction || ''
      dragEl.style.touchAction = 'none'
    }
  }

  function handleMove(event) {
    if (!active) return
    const point = normalizePointerEvent(event)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    const dx = Math.abs(point.x - originX)
    const dy = Math.abs(point.y - originY)

    if (!armed) {
      // 触屏：长按计时器未到就已经移动 → 判定为滚动，放弃本次拖动
      if (touchGesture) {
        if (dx > TOUCH_SLOP || dy > TOUCH_SLOP) cancel()
        return
      }
      // 鼠标：越过阈值才开始拖
      if (dx < MOUSE_THRESHOLD && dy < MOUSE_THRESHOLD) return
      clearHold()
      arm()
      if (!armed) return
    }

    point.preventDefault()

    const target = indexFromPoint(point.x, point.y)
    if (target < 0 || target === dragIndex) return
    const items = Array.isArray(getItems()) ? getItems().slice() : []
    if (dragIndex >= items.length || target >= items.length) return
    const [movedItem] = items.splice(dragIndex, 1)
    items.splice(target, 0, movedItem)
    dragIndex = target
    setItems(items)
  }

  function detach() {
    clearHold()
    if (typeof document === 'undefined') return
    document.removeEventListener('pointermove', handleMove)
    document.removeEventListener('pointerup', handleUp)
    document.removeEventListener('pointercancel', cancel)
    document.removeEventListener('touchmove', handleMove, { passive: false })
    document.removeEventListener('touchend', handleUp)
    document.removeEventListener('touchcancel', cancel)
    if (dragEl && dragEl.removeEventListener) dragEl.removeEventListener('contextmenu', handleContextMenu)
    if (dragEl && dragEl.style) dragEl.style.touchAction = lastTouchAction
    dragEl = null
    touchGesture = false
  }

  /** 放弃本次手势（滚动 / 系统取消），不写库 */
  function cancel() {
    if (!active) return
    active = false
    armed = false
    draggingId.value = ''
    detach()
  }

  function handleUp() {
    if (!active) return
    const wasArmed = armed
    active = false
    armed = false
    draggingId.value = ''
    detach()
    if (!wasArmed) return
    const items = Array.isArray(getItems()) ? getItems().slice() : []
    Promise.resolve(onCommit(items)).catch(() => {})
  }

  /**
   * 开始拖动。
   * @param {object} event 原生 pointerdown 事件
   * @param {object} item 卡片数据
   * @param {number} index 卡片在列表中的下标
   * @returns {void}
   */
  function startDrag(event, item, index) {
    if (!item || !Number.isFinite(index)) return
    // 归一化事件：兼容原生 PointerEvent / uni 包装对象 / 只有 touchstart 的浏览器
    const pointer = normalizePointerEvent(event)
    if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return

    active = true
    armed = false
    dragIndex = index
    currentItem = item
    originX = pointer.x
    originY = pointer.y
    touchGesture = pointer.isTouch
    dragEl = pointer.el || (event && (event.currentTarget || event.target)) || null
    clearHold()
    if (pointer.isTouch) {
      holdTimer = setTimeout(() => {
        holdTimer = null
        arm()
      }, TOUCH_HOLD_MS)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
      document.addEventListener('pointercancel', cancel)
      if (pointer.isTouch) {
        // 部分内置浏览器只发 touch 事件（不发 pointer 事件），补一套监听保证能拖动/松手提交。
        // passive:false 才能 preventDefault，否则浏览器照常滚动并中断拖动。
        document.addEventListener('touchmove', handleMove, { passive: false })
        document.addEventListener('touchend', handleUp)
        document.addEventListener('touchcancel', cancel)
        if (dragEl && dragEl.addEventListener) dragEl.addEventListener('contextmenu', handleContextMenu)
      }
    }
  }

  return { draggingId, startDrag }
}

export default { useImageDragSort }
