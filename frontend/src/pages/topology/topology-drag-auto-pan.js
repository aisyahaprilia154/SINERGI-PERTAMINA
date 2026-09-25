const EDGE_SIZE = 104
const MAX_SPEED = 2100 // CSS pixels per second at the viewport edge

export function dragAutoPanVelocity({
  clientX, clientY, rect, scrollLeft = 0, scrollTop = 0,
  scrollWidth = 0, scrollHeight = 0, clientWidth = 0, clientHeight = 0,
} = {}) {
  if (!rect || clientX < rect.left || clientX > rect.right
    || clientY < rect.top || clientY > rect.bottom) return { x: 0, y: 0 }
  const horizontalEdge = Math.min(EDGE_SIZE, (rect.right - rect.left) / 3)
  const verticalEdge = Math.min(EDGE_SIZE, (rect.bottom - rect.top) / 3)
  const speed = (distance, edge) => edge > 0 && distance < edge
    ? MAX_SPEED * ((edge - distance) / edge) ** 1.25 : 0
  const right = speed(rect.right - clientX, horizontalEdge)
  const left = speed(clientX - rect.left, horizontalEdge)
  const bottom = speed(rect.bottom - clientY, verticalEdge)
  const top = speed(clientY - rect.top, verticalEdge)
  return {
    x: right && scrollLeft < scrollWidth - clientWidth - 1 ? right
      : left && scrollLeft > 1 ? -left : 0,
    y: bottom && scrollTop < scrollHeight - clientHeight - 1 ? bottom
      : top && scrollTop > 1 ? -top : 0,
  }
}

export function createDragAutoPan(viewport, onScroll, {
  requestFrame = callback => window.requestAnimationFrame(callback),
  cancelFrame = id => window.cancelAnimationFrame(id),
} = {}) {
  let pointer = null
  let frameId = 0
  let lastTime = null
  let stopped = false

  const velocity = () => dragAutoPanVelocity({
    ...pointer,
    rect: viewport.getBoundingClientRect(),
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
    scrollWidth: viewport.scrollWidth,
    scrollHeight: viewport.scrollHeight,
    clientWidth: viewport.clientWidth,
    clientHeight: viewport.clientHeight,
  })
  const schedule = () => {
    if (!stopped && !frameId) frameId = requestFrame(tick)
  }
  const tick = timestamp => {
    frameId = 0
    if (stopped || !pointer) return
    const { x, y } = velocity()
    if (!x && !y) { lastTime = null; return }
    const elapsed = lastTime === null ? 16 : Math.min(32, Math.max(1, timestamp - lastTime))
    lastTime = timestamp
    const beforeX = viewport.scrollLeft
    const beforeY = viewport.scrollTop
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth,
      beforeX + x * elapsed / 1000))
    viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight,
      beforeY + y * elapsed / 1000))
    if (viewport.scrollLeft !== beforeX || viewport.scrollTop !== beforeY) {
      onScroll(pointer)
      schedule()
    } else lastTime = null
  }

  return {
    move({ clientX, clientY }) {
      if (stopped) return
      pointer = { clientX, clientY }
      if (velocity().x || velocity().y) schedule()
      else if (frameId) {
        cancelFrame(frameId)
        frameId = 0
        lastTime = null
      }
    },
    stop() {
      stopped = true
      pointer = null
      if (frameId) cancelFrame(frameId)
      frameId = 0
      lastTime = null
    },
  }
}
