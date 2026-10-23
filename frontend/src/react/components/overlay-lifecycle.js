// One focus/inert owner per document, including nested React dialogs.
const stack = []
const savedInert = new Map()
let previousOverflow = '', firstOpener = null

function setInert(node, value) { node.inert = value; node.toggleAttribute('inert', value) }

function focusable(root) {
  return [...root.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')].filter(element => {
    if (element.disabled || element.tabIndex < 0 || element.closest('[hidden],[inert]')) return false
    for (let node = element; node && node !== root.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  })
}

export function isTopOverlay(layer) {
  return stack.at(-1)?.layer === layer
}

function syncInert() {
  const top = stack.at(-1)
  if (!top) {
    for (const [node, inert] of savedInert) setInert(node, inert)
    savedInert.clear()
    document.body.style.overflow = previousOverflow
    return
  }
  for (const node of document.body.children) {
    if (!savedInert.has(node)) savedInert.set(node, Boolean(node.inert || node.hasAttribute('inert')))
    setInert(node, node !== top.layer)
  }
  stack.forEach((entry, index) => { entry.layer.style.zIndex = String(110 + index * 10) })
}

export function activateOverlay(layer, dialog, { onEscape, initialFocus }) {
  const opener = document.activeElement
  if (!stack.length) { previousOverflow = document.body.style.overflow; firstOpener = opener; document.body.style.overflow = 'hidden' }
  const entry = { layer, dialog, previousZIndex: layer.style.zIndex }
  stack.push(entry)
  syncInert()
  const focusFirst = () => (focusable(dialog)[0] || dialog).focus()
  if (initialFocus?.isConnected && dialog.contains(initialFocus) && !initialFocus.disabled) initialFocus.focus()
  else focusFirst()
  const keyboard = event => {
    if (!isTopOverlay(layer)) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onEscape(); return }
    if (event.key !== 'Tab') return
    const fields = focusable(dialog), first = fields[0], last = fields.at(-1)
    if (!first) { event.preventDefault(); dialog.focus(); return }
    if (!dialog.contains(document.activeElement) || document.activeElement === dialog) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const focus = event => { if (isTopOverlay(layer) && !dialog.contains(event.target)) focusFirst() }
  document.addEventListener('keydown', keyboard, true)
  document.addEventListener('focusin', focus, true)
  let released = false
  return () => {
    if (released) return
    released = true
    const wasTop = isTopOverlay(layer)
    stack.splice(stack.indexOf(entry), 1)
    layer.style.zIndex = entry.previousZIndex
    document.removeEventListener('keydown', keyboard, true)
    document.removeEventListener('focusin', focus, true)
    syncInert()
    if (wasTop) {
      const target = stack.length ? opener : firstOpener
      if (target?.isConnected && !target.disabled && !target.closest('[inert]')) target.focus()
      else if (stack.length) (focusable(stack.at(-1).dialog)[0] || stack.at(-1).dialog).focus()
    }
    if (!stack.length) firstOpener = null
  }
}
