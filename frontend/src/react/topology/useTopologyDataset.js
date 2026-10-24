import {useEffect,useState} from 'react'
import {loadTopologyDocument} from '../../services/topology-document-service.js'
import {clearSession} from '../../services/account-session.js'
import {documentNavigation} from '../../services/document-navigation.js'

export function useTopologyDataset(){
 const [state,setState]=useState({data:null,loading:true,error:''}),[attempt,setAttempt]=useState(0)
 useEffect(()=>{
  const controller=new AbortController(),signal=controller.signal,stop=()=>controller.abort()
  window.addEventListener('pagehide',stop)
  const query=new URLSearchParams(window.location.search);let stored=null
  try{stored=sessionStorage.getItem('sinergiActiveDatasetId')}catch{/* Optional storage. */}
  const requested={datasetId:query.get('datasetId')||stored||'dataset-semarang',siteId:query.get('siteId')||null}
  void loadTopologyDocument(requested,{signal}).then(data=>{
   if(signal.aborted)return
   try{sessionStorage.setItem('sinergiActiveDatasetId',data.mapData.activeContext.datasetId)}catch{/* Optional storage. */}
   setState({data,loading:false,error:''})
  }).catch(error=>{
   if(signal.aborted)return
   if([401,403].includes(error.status)){stop();clearSession();documentNavigation.replace('/');return}
   setState({data:null,loading:false,error:error.message})
  })
  return()=>{stop();window.removeEventListener('pagehide',stop)}
 },[attempt])
 return {...state,retry:()=>{setState({data:null,loading:true,error:''});setAttempt(value=>value+1)}}
}
