import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/style.css'
import '../../src/styles/map-route.css'
import '../../src/react/map/map-read.css'
import { ThemeProvider } from '../../src/react/theme/ThemeProvider.jsx'
import { SessionContext } from '../../src/react/session/session-context.js'
import { MapTransferDialog } from '../../src/react/map/MapTransferDialog.jsx'
import { SchematicDialog } from '../../src/react/map/SchematicDialog.jsx'
import { createMapReadModel } from '../../src/domain/map-read-model.js'
import { createMapDiagrams } from '../../src/domain/map-diagrams.js'
import { branchNameForFacility } from '../../src/domain/facility-branch.js'

const params=new URLSearchParams(location.search)
const payload=await fetch('/api/datasets/dataset-semarang/active').then(response=>response.json())
const model=createMapReadModel(payload),context={...model.activeContext,branchName:branchNameForFacility(model.selectedArea,model.activeContext.branchName)}
if(params.has('empty')){model.assets=[];model.diagramAssets=[];model.networks=[];model.poleGroups=[];model.topologyGraph={nodes:[],edges:[]}}
const user=JSON.parse(sessionStorage.getItem('sinergiSessionUser'))
function Lab(){
 const [dialog,setDialog]=useState(null)
 async function open(kind){
  if(params.get('implementation')!=='legacy'){setDialog(kind);return}
  if(kind==='diagram'){const {openSchematicDialog}=await import('../../test-support/legacy/pages/map/diagram-dialog.js');openSchematicDialog({diagrams:createMapDiagrams(model,'C-01'),activeContext:context,selectedAssetId:'C-01'})}
  else{const {openMapDataTransferDialog}=await import('../../test-support/legacy/pages/map/map-data-transfer-dialog.js');openMapDataTransferDialog({activeContext:context,networks:model.networks,selectedNetworkIds:new Set(model.networks.map(network=>network.id)),initialMode:kind,areaScopeLabel:model.selectedArea?.name})}
 }
 return <ThemeProvider><SessionContext value={{user}}><button onClick={()=>void open('import')}>Fixture import</button><button onClick={()=>void open('export')}>Fixture export</button><button onClick={()=>void open('diagram')}>Fixture diagram</button>{dialog==='diagram'?<SchematicDialog snapshot={{model,context,selectedAssetId:'C-01'}} onClose={()=>setDialog(null)}/>:dialog&&<MapTransferDialog snapshot={{context,networks:model.networks,selectedNetworkIds:new Set(model.networks.map(network=>network.id)),areaScopeLabel:model.selectedArea?.name,mode:dialog}} onClose={()=>setDialog(null)}/>}</SessionContext></ThemeProvider>
}
const root=createRoot(document.querySelector('#app'));root.render(<StrictMode><Lab/></StrictMode>)
window.addEventListener('pagehide',()=>root.unmount(),{once:true})
