import { useCallback, useState } from 'react'
import { branchNameForFacility } from '../../domain/facility-branch.js'

export function useMapTransfer() {
  const [snapshot,setSnapshot]=useState(null)
  const open=useCallback((model,selection,mode)=>setSnapshot(previous=>previous||{
    context:{...model.activeContext,branchName:branchNameForFacility(model.selectedArea,model.activeContext.branchName)},
    networks:model.networks,selectedNetworkIds:new Set(selection.selectedNetworkIds),areaScopeLabel:model.selectedArea?.name||null,mode,
  }),[])
  const close=useCallback(()=>setSnapshot(null),[])
  return {snapshot,open,close}
}
