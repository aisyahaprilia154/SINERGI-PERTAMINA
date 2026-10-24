import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Native modal focus/inert behavior; React owns the entire dialog subtree.
export function MapDialog({ className, labelledBy, onClose, onEscape = onClose, children }) {
  const dialog = useRef(null)
  useLayoutEffect(() => {
    const element = dialog.current, opener = document.activeElement
    element.showModal()
    return () => { element.close(); if (opener?.isConnected && !opener.disabled) opener.focus({preventScroll:true}) }
  }, [])
  return createPortal(<dialog ref={dialog} className={className} aria-labelledby={labelledBy} aria-modal="true" data-react-map-dialog
    onCancel={event => {event.preventDefault(); onEscape()}}
    onKeyDown={event => {if(event.key === 'Escape'){event.preventDefault();event.stopPropagation();onEscape()}}}
    onClick={event => {if(event.target === event.currentTarget)onClose()}}>{children}</dialog>, document.body)
}
