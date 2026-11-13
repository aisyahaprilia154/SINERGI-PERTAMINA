import {useId} from 'react'
import {MapDialog} from '../map/MapDialog.jsx'
import '../../styles/auth-help.css'
export function AuthDialog({title,onClose,children}){
  const id=useId()
  return <MapDialog className="auth-dialog" labelledBy={id} onClose={onClose}><header><h2 id={id}>{title}</h2><button type="button" aria-label="Tutup bantuan akun" onClick={onClose}>×</button></header>{children}</MapDialog>
}
