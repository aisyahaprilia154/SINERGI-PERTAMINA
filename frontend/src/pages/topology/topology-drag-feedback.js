// Keep the lifted asset locked to the pointer. Only its scale and tilt settle
// with a spring; smoothing the coordinates themselves makes drag feel late.
export function createAssetDragFeedback(nodeElement, pointer, { reducedMotion = false } = {}) {
  if (!nodeElement) return null
  const rect = nodeElement.getBoundingClientRect()
  const bounds = safeBounds(nodeElement, rect)
  const ghost = document.createElement('div')
  ghost.className = 'topology-drag-ghost'
  ghost.setAttribute('aria-hidden', 'true')

  const surface = document.createElement('div')
  surface.className = 'topology-drag-ghost-surface'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', nodeElement.ownerSVGElement?.getAttribute('class') ?? 'topology-diagram-svg')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  const sourceSvg = nodeElement.ownerSVGElement
  const defs = sourceSvg?.querySelector('defs')
  const style = sourceSvg?.querySelector('style')
  if (defs) svg.append(defs.cloneNode(true))
  if (style) svg.append(style.cloneNode(true))
  svg.setAttribute('viewBox', `${bounds.x - 12} ${bounds.y - 12} ${bounds.width + 24} ${bounds.height + 24}`)
  const clone = nodeElement.cloneNode(true)
  clone.removeAttribute('data-node-id')
  clone.removeAttribute('tabindex')
  clone.removeAttribute('aria-label')
  clone.classList.remove('selected', 'dimmed', 'is-dragging')
  clone.classList.add('topology-drag-ghost-node')
  svg.append(clone)
  surface.append(svg)
  ghost.append(surface)
  const hint = document.createElement('div')
  hint.className = 'topology-drag-hint'
  ghost.append(hint)

  // Keep the lifted preview compact. The old size followed the full SVG
  // bounding box, which made a normal JB look like a giant white card.
  const width = Math.max(108, Math.min(164, rect.width * 1.52))
  const naturalHeight = width * (bounds.height + 24) / Math.max(1, bounds.width + 24)
  const height = Math.max(84, Math.min(122, naturalHeight))
  Object.assign(ghost.style, { width: `${width}px`, height: `${height}px` })
  document.body.append(ghost)

  const pointerState = { x: pointer.clientX, y: pointer.clientY, previousX: pointer.clientX }
  const pointerOffset = { x: 8, y: -10 }
  const desired = { scale: 1.075, rotation: 0 }
  // Start below the resting scale so the first animation frames visibly lift
  // the asset away from the canvas. Initializing at the target value removed
  // the spring motion and made the preview feel as though it never appeared.
  const rendered = { scale: reducedMotion ? desired.scale : .84, rotation: 0 }
  let target = null
  let connectionTarget = null
  let animationFrame = 0
  let disposed = false

  const applyTransform = () => {
    ghost.style.transform = `translate3d(${pointerState.x - width / 2 + pointerOffset.x}px, ${pointerState.y - height / 2 + pointerOffset.y}px, 0) rotate(${rendered.rotation}deg) scale(${rendered.scale})`
  }
  const render = () => {
    if (disposed) return
    const spring = reducedMotion ? 1 : .34
    rendered.scale += (desired.scale - rendered.scale) * spring
    rendered.rotation += (desired.rotation - rendered.rotation) * spring
    applyTransform()
    animationFrame = window.requestAnimationFrame(render)
  }
  applyTransform()
  animationFrame = window.requestAnimationFrame(render)

  const restoreTarget = () => {
    if (!target) return
    target.element.classList.remove('drop-target')
    for (const [key, value] of Object.entries(target.original)) {
      if (value === null) target.rect.removeAttribute(key)
      else target.rect.setAttribute(key, value)
    }
    target.slot.remove()
    target = null
  }
  const dispose = () => {
    disposed = true
    if (animationFrame) window.cancelAnimationFrame(animationFrame)
    restoreTarget()
    connectionTarget?.classList.remove('is-connection-drop-target')
    ghost.remove()
  }

  return {
    hint(message, valid) {
      if (hint.textContent !== message) hint.textContent = message
      ghost.classList.toggle('has-valid-drop', valid)
    },
    connection(element) {
      if (connectionTarget === element) return
      connectionTarget?.classList.remove('is-connection-drop-target')
      connectionTarget = element
      connectionTarget?.classList.add('is-connection-drop-target')
      ghost.classList.toggle('is-over-device', Boolean(element))
      desired.scale = element ? .98 : target ? .98 : 1.075
      desired.rotation = 0
    },
    move(event) {
      const dx = event.clientX - pointerState.previousX
      pointerState.previousX = event.clientX
      pointerState.x = event.clientX
      pointerState.y = event.clientY
      desired.rotation = target ? 0 : Math.max(-1.8, Math.min(1.8, dx * .03))
      applyTransform()
    },
    target(element, box) {
      if (target?.element === element) return
      restoreTarget()
      ghost.classList.toggle('is-over-frame', Boolean(element))
      if (!element || !box) {
        desired.scale = 1.075
        return
      }
      // Selection outlines are also rects, but they are intentionally
      // transparent. Expand the visible frame body so the destination visibly
      // opens up while an asset is dragged over it.
      const frameRect = element.querySelector(
        '.topology-mounting-bubble, .topology-mounting-frame, .topology-mounting-box, rect',
      )
      if (!frameRect) return
      const original = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, frameRect.getAttribute(key)]))
      const visibleBox = Object.fromEntries(Object.entries(original).map(([key, value]) => [key, Number(value)]))
      element.classList.add('drop-target')
      frameRect.setAttribute('x', visibleBox.x - 8)
      frameRect.setAttribute('y', visibleBox.y - 3)
      frameRect.setAttribute('width', visibleBox.width + 16)
      frameRect.setAttribute('height', visibleBox.height + 60)
      const slot = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      slot.classList.add('topology-drop-slot')
      const outline = document.createElementNS(svg.namespaceURI, 'rect')
      for (const [key, value] of Object.entries({
        x: visibleBox.x + 16,
        y: visibleBox.y + visibleBox.height + 8,
        width: Math.max(48, visibleBox.width - 32),
        height: 32,
        rx: 11,
      })) outline.setAttribute(key, value)
      slot.append(outline)
      element.append(slot)
      target = { element, rect: frameRect, original, slot }
      desired.scale = .98
      desired.rotation = 0
    },
    async finish(destination = null) {
      const end = destination?.getBoundingClientRect()
      restoreTarget()
      connectionTarget?.classList.remove('is-connection-drop-target')
      hint.hidden = true
      ghost.classList.remove('is-over-frame')
      if (!reducedMotion && ghost.animate) {
        if (animationFrame) window.cancelAnimationFrame(animationFrame)
        const endX = end ? end.left + (end.width - width) / 2 : rect.left
        const endY = end ? end.top + (end.height - height) / 2 : rect.top
        await ghost.animate([
          { transform: ghost.style.transform, opacity: 1 },
          { transform: `translate3d(${endX}px, ${endY}px, 0) rotate(0deg) scale(${end ? Math.max(.72, end.width / width) : rect.width / width})`, opacity: end ? 0 : .16 },
        ], { duration: 230, easing: 'cubic-bezier(.22, .8, .2, 1)', fill: 'forwards' }).finished.catch(() => {})
      }
      dispose()
    },
    cancel: dispose,
  }
}

function safeBounds(nodeElement, rect) {
  try {
    const bounds = nodeElement.getBBox()
    if (bounds.width > 0 && bounds.height > 0) return bounds
  } catch {}
  return { x: 0, y: 0, width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
}
