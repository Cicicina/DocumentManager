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
 *   真正拖动时给元素临时加 touch-action: none，交给 pointermove 全权处理。
 */
import { ref } from 'vue'

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
    const dx = Math.abs(event.clientX - originX)
    const dy = Math.abs(event.clientY - originY)

    if (!armed) {
      // 触屏：长按计时器未到就已经移动 → 判定为滚动，放弃本次拖动
      if (event.pointerType === 'touch') {
        if (dx > TOUCH_SLOP || dy > TOUCH_SLOP) cancel()
        return
      }
      // 鼠标：越过阈值才开始拖
      if (dx < MOUSE_THRESHOLD && dy < MOUSE_THRESHOLD) return
      clearHold()
      arm()
      if (!armed) return
    }

    if (event.cancelable) event.preventDefault()

    const target = indexFromPoint(event.clientX, event.clientY)
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
    if (dragEl && dragEl.style) dragEl.style.touchAction = lastTouchAction
    dragEl = null
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
    active = true
    armed = false
    dragIndex = index
    currentItem = item
    originX = event.clientX || 0
    originY = event.clientY || 0
    dragEl = event.currentTarget || event.target || null
    clearHold()
    if (event.pointerType === 'touch') {
      holdTimer = setTimeout(() => {
        holdTimer = null
        arm()
      }, TOUCH_HOLD_MS)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
      document.addEventListener('pointercancel', cancel)
    }
  }

  return { draggingId, startDrag }
}

export default { useImageDragSort }
