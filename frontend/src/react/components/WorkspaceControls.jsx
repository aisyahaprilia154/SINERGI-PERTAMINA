import { Icon } from './Icon.jsx'
import '../../styles/react-workspace-controls.css'

export function WorkspaceControls({ zoom = 1, onZoomIn, onZoomOut, onReset, onFit, onFocus, onHelp, disabled = false }) {
  return <div data-react-workspace-controls className="topology-canvas-navigation" role="group" aria-label="Navigasi kanvas"><div className="topology-toolbar-group topology-toolbar-navigation" aria-label="Navigasi diagram">
    <div className="topology-stitch-zoom-control">
      <button type="button" data-action="zoom-out" aria-label="Perkecil diagram" disabled={disabled} onClick={onZoomOut}><Icon>remove</Icon></button>
      <button type="button" className="topology-zoom-reset" data-action="zoom-reset" data-topology-zoom-label title="Kembalikan zoom ke 100%" aria-label="Kembalikan zoom ke 100%" disabled={disabled} onClick={onReset}>{Math.round(zoom * 100)}%</button>
      <button type="button" data-action="zoom-in" aria-label="Perbesar diagram" disabled={disabled} onClick={onZoomIn}><Icon>add</Icon></button>
    </div>
    <button type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="fit" title="Tampilkan seluruh diagram" aria-label="Tampilkan seluruh diagram" disabled={disabled} onClick={onFit}><Icon>fit_screen</Icon><span>Semua</span></button>
    {onFocus && <button type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="focus-relations" title="Fokus ke relasi aset terpilih" aria-label="Fokus ke relasi aset terpilih" disabled={disabled} onClick={onFocus}><Icon>center_focus_strong</Icon><span>Aset</span></button>}
    {onHelp && <button type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="help" title="Bantuan diagram" aria-label="Bantuan diagram" disabled={disabled} onClick={onHelp}><Icon>help</Icon></button>}
  </div></div>
}
