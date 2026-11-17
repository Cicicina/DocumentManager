/**
 * 图片拖动排序（H5，pointer 事件）。
 *
 * 用法：把返回的 startDrag 绑到每个卡片的 @pointerdown，并给卡片加
 * `:data-drag-index="index"` 与 `:class="{ 'is-dragging': draggingId === item._id }"`。
 * 拖动过程中直接就地重排数组（有实时反馈），松手时把最终数组交给 onCommit 写库。
 *
 * 不用 HTML5 draggable：uni-app 的 <view> 不是原生可拖元素，且触屏端不生效。
 * 这里靠 elementFromPoint 找落点，鼠标与手指走同一套逻辑。
 */
import { ref } from 'vue'

/**
 * @param {() => Array} getItems 读取当前列表
 * @param {(next: Array) => void} setItems 写回重排后的列表
 * @param {(items: Array) => void|Promise<void>} onCommit 松手时回调最终顺序
 * @returns {{draggingId: object, startDrag: Function}}
 */
export function useImageDragSort(getItems, setItems, onCommit) {
  const draggingId = ref('')
  let dragIndex = -1
  let active = false
  /** 是否真的移动过：单纯点击卡片不能触发一次无意义的写库 */
  let hasMoved = false

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

  function handleMove(event) {
    if (!active) return
    const target = indexFromPoint(event.clientX, event.clientY)
    if (target < 0 || target === dragIndex) return
    const items = Array.isArray(getItems()) ? getItems().slice() : []
    if (dragIndex >= items.length || target >= items.length) return
    const [movedItem] = items.splice(dragIndex, 1)
    items.splice(target, 0, movedItem)
    dragIndex = target
    hasMoved = true
    setItems(items)
  }

  function detach() {
    if (typeof document === 'undefined') return
    document.removeEventListener('pointermove', handleMove)
    document.removeEventListener('pointerup', handleUp)
    document.removeEventListener('pointercancel', handleUp)
  }

  function handleUp() {
    if (!active) return
    active = false
    draggingId.value = ''
    detach()
    if (!hasMoved) return
    hasMoved = false
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
    hasMoved = false
    dragIndex = index
    draggingId.value = item._id || item.file_id || ''
    if (typeof document !== 'undefined') {
      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
      document.addEventListener('pointercancel', handleUp)
    }
  }

  return { draggingId, startDrag }
}

export default { useImageDragSort }
