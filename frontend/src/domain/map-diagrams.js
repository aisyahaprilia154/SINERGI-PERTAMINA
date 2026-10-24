import { buildSchematicGraph } from '../pages/map/schematic-graph.js'
import { calculateSchematicLayout } from '../pages/map/schematic-layout.js'

export function createMapDiagrams(model, selectedAssetId) {
  const assets=[...new Map([...model.assets,...(model.diagramAssets||[])].map(asset=>[asset.id,asset])).values()]
  return Object.fromEntries(['all-assets','full-map','selected'].map(scope=>{
    const graph=buildSchematicGraph({assets,networks:model.networks,topologyGraph:model.topologyGraph,poleGroups:model.poleGroups,focusedAssetId:selectedAssetId,scope})
    return [scope,{graph,layout:calculateSchematicLayout(graph)}]
  }))
}

export function diagramFilename(graph, context) {
  return `sinergi-diagram-${context.branchId||context.datasetId}-${graph.mode||'network'}-${context.version}`.toLowerCase().replaceAll(/[^a-z0-9-]+/g,'-')
}
export function resolutionText(status){return status==='confirmed'?'Relasi otomatis terkonfirmasi':'Belum tersambung'}
export function diagramMeta(graph,layout,context){
  if(graph.mode==='selected')return `${graph.neighborCount??Math.max(0,layout.nodes.length-1)} aset terhubung langsung · ${context.branchName} · Dataset ${context.version} · Read-only`
  if(graph.mode==='all-assets'&&graph.diagnostics)return `${layout.nodes.length} aset · ${graph.diagnostics.confirmedEdgeCount} relasi otomatis · ${graph.isolatedNodeIds?.length||graph.diagnostics.unresolvedNodeCount||0} tanpa relasi · ${graph.diagnostics.validation.coveragePercent}% tercakup · ${context.branchName} · Dataset ${context.version} · Read-only`
  return `${layout.nodes.length} aset · ${graph.relationCount??layout.edges.length} koneksi terkonfirmasi · ${context.branchName} · Dataset ${context.version} · Read-only`
}
