import { useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { activateOverlay, isTopOverlay } from './overlay-lifecycle.js'
import { Icon } from './Icon.jsx'
import '../../styles/react-overlays.css'

export function Overlay({ open, onClose, title, children, variant = 'dialog', busy = false, initialFocusRef, footer }) {
  const id = useId(), layer = useRef(null), dialog = useRef(null)
  const actions = useRef({ onClose, busy })
  useLayoutEffect(() => { actions.current = { onClose, busy } })
  useLayoutEffect(() => {
    if (!open) return
    return activateOverlay(layer.current, dialog.current, {
      initialFocus: initialFocusRef?.current,
      onEscape: () => { if (!actions.current.busy) actions.current.onClose() },
    })
  }, [open, initialFocusRef])
  if (!open) return null
  const drawer = variant === 'drawer'
  const close = () => { if (!busy && isTopOverlay(layer.current)) onClose() }
  return createPortal(
    <div ref={layer} data-react-overlay className={drawer ? 'au-editor-layer' : 'version-dialog-layer'} onClick={event => { if (event.target === event.currentTarget) close() }}>
      {drawer && <button className="au-editor-backdrop" data-close-editor type="button" aria-label="Tutup panel" tabIndex={-1} disabled={busy} onClick={close} />}
      <section ref={dialog} className={drawer ? 'au-editor' : 'admin-dialog version-dialog'} role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={busy} tabIndex={-1}>
        <div className={drawer ? 'au-editor-heading' : 'admin-section-heading'}>
          <h2 id={id}>{title}</h2>
          <button type="button" className="au-icon" data-close-editor aria-label={drawer ? 'Tutup panel' : 'Tutup dialog'} disabled={busy} onClick={close}><Icon>close</Icon></button>
        </div>
        {children}
        {footer && <div className={drawer ? 'au-editor-footer' : 'version-dialog-actions'}>{footer}</div>}
      </section>
    </div>, document.body,
  )
}
