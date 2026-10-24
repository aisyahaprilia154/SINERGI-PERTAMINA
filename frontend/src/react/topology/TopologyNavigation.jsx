import {useImperativeHandle,useState} from 'react'
import {Icon} from '../components/Icon.jsx'

// Zoom feedback is local: pointer wheel events never re-render the document, sidebar or inspector.
export function TopologyNavigation({navigationRef,api,ready,selectedAssetId,compact,legendOpen,legendRef,onLegend}){
 const [zoom,setZoom]=useState(1)
 useImperativeHandle(navigationRef,()=>({setZoom}),[])
 return <>
   <p className="topology-overview-hint" data-topology-overview-hint hidden={!(zoom<.5&&compact)}>Ketuk diagram untuk memperbesar, atau cari aset di panel.</p>
   <div className="topology-canvas-navigation" role="group" aria-label="Navigasi kanvas"><div className="topology-toolbar-group topology-toolbar-navigation" aria-label="Navigasi diagram"><div className="topology-stitch-zoom-control"><button type="button" data-action="zoom-out" aria-label="Perkecil diagram" disabled={!ready} onClick={()=>api.current?.zoomOut()}><Icon>remove</Icon></button><button type="button" className="topology-zoom-reset" data-topology-zoom-label title="Kembalikan zoom ke 100%" data-action="zoom-reset" aria-label="Kembalikan zoom ke 100%" disabled={!ready} onClick={()=>api.current?.resetZoom()}>{Math.round(zoom*100)}%</button><button type="button" data-action="zoom-in" aria-label="Perbesar diagram" disabled={!ready} onClick={()=>api.current?.zoomIn()}><Icon>add</Icon></button></div><button type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="fit" aria-label="Tampilkan seluruh diagram" disabled={!ready} onClick={()=>api.current?.fit()}><Icon>fit_screen</Icon><span>Semua</span></button><button type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="focus-relations" aria-label="Fokus ke relasi aset terpilih" disabled={!selectedAssetId} onClick={()=>api.current?.focusRelations()}><Icon>center_focus_strong</Icon><span>Aset</span></button><span className="topology-navigation-divider"/><button ref={legendRef} data-action="toggle-legend" type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button topology-legend-toggle" aria-label={legendOpen?'Sembunyikan legenda diagram':'Tampilkan legenda diagram'} aria-controls="topology-legend" aria-expanded={legendOpen} onClick={onLegend}><Icon>info</Icon></button></div></div>
 </>
}
