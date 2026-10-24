import { useEffect, useRef, useState } from 'react'
import { loadImportConfig, uploadDataset, loadImportStatus, downloadDatasetSource } from '../../services/import-dataset-service.js'
import { exportActiveKml } from '../../services/active-dataset-service.js'
import { collectSelectedNetworkAssetIds } from '../../pages/map/active-dataset-kml-export.js'
import { abortableDelay } from '../../services/abortable-delay.js'
import { createDownloadScope } from '../../services/download-scope.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

export function useTransferActions({ context, networks, selectedNetworkIds, canImport, releaseGuard }) {
  const [config, setConfig] = useState({loading:canImport, limit:null, error:''}), [configAttempt,setConfigAttempt] = useState(0)
  const [state,setState] = useState({busy:false, error:'', progress:'', resumable:false})
  const ownerRef = useRef(null), releaseRef = useRef(releaseGuard)
  useEffect(() => {releaseRef.current=releaseGuard},[releaseGuard])
  useEffect(() => {
    const controller=new AbortController(), owner={controller, busy:false, uploaded:null, navigating:false, downloads:createDownloadScope(controller.signal)}
    ownerRef.current=owner
    const stop=()=>{controller.abort();owner.downloads.dispose()}
    window.addEventListener('pagehide',stop)
    return ()=>{stop();window.removeEventListener('pagehide',stop)}
  },[])
  const expired=(error)=>{
    if(![401,403].includes(error.status))return false
    ownerRef.current?.controller.abort();releaseRef.current();clearSession();documentNavigation.replace('/');return true
  }
  useEffect(()=>{
    if(!canImport)return
    const controller=new AbortController()
    const stop=()=>controller.abort();window.addEventListener('pagehide',stop)
    void loadImportConfig({signal:controller.signal}).then(result=>{
      controller.signal.throwIfAborted()
      if(!Number.isFinite(result.maxFileSize)||result.maxFileSize<=0)throw new Error('Batas ukuran unggahan belum tersedia.')
      setConfig({loading:false,limit:result.maxFileSize,error:''})
    }).catch(error=>{
      if(controller.signal.aborted)return
      if([401,403].includes(error.status)){ownerRef.current?.controller.abort();releaseRef.current();clearSession();documentNavigation.replace('/');return}
      setConfig({loading:false,limit:null,error:error.message})
    })
    return()=>{stop();window.removeEventListener('pagehide',stop)}
  },[canImport,configAttempt])
  async function run(action) {
    const owner=ownerRef.current
    if(!owner||owner.controller.signal.aborted||owner.busy)return
    owner.busy=true;setState({busy:true,error:'',progress:'',resumable:false})
    try{await action(owner)}catch(error){if(!owner.controller.signal.aborted&&!expired(error))setState(previous=>({...previous,error:error.message,resumable:!!owner.uploaded}))}
    finally{owner.busy=false;if(!owner.controller.signal.aborted)setState(previous=>({...previous,busy:false}))}
  }
  async function poll(owner) {
    const signal=owner.controller.signal, uploaded=owner.uploaded
    setState(previous=>({...previous,progress:'Membaca file dan mencari tambahan…'}))
    while(!signal.aborted){
      const result=await loadImportStatus({statusUrl:uploaded.statusUrl,signal});signal.throwIfAborted()
      if(result.import?.id&&result.import.id!==uploaded.importId)throw new Error('Status impor tidak sesuai dengan unggahan ini.')
      if(result.import?.status==='ready'){
        owner.navigating=true;releaseRef.current();documentNavigation.assign(`/admin/datasets/import/${encodeURIComponent(uploaded.importId)}/preview`);return
      }
      if(result.import?.status==='failed'){owner.uploaded=null;throw new Error(result.import.error?.message||'Impor gagal diproses.')}
      if(!result.import?.status)throw new Error('Status impor tidak valid.')
      await abortableDelay(signal)
    }
  }
  return {
    ...state, config, ownerRef,
    retryConfig(){setConfig({loading:true,limit:null,error:''});setConfigAttempt(value=>value+1)},
    upload({name,file}) {
      if(!canImport)return
      return run(async owner=>{
        if(config.loading||config.error||!config.limit)throw new Error('Tunggu konfigurasi unggahan sebelum melanjutkan.')
        if(!name.trim()||name.trim().length>180)throw new Error('Isi nama impor, maksimal 180 karakter.')
        if(!file||!file.size||!/(\.kml|\.kmz)$/i.test(file.name)||file.size>config.limit)throw new Error('Pilih file KML/KMZ dengan ukuran yang diperbolehkan.')
        const signal=owner.controller.signal
        setState(previous=>({...previous,progress:'Mengunggah…'}))
        owner.uploaded=await uploadDataset({fields:{datasetId:context.datasetId,versionName:name.trim()},file,signal,onProgress:progress=>{if(!signal.aborted)setState(previous=>({...previous,progress:`Mengunggah${progress===null?'':` ${progress}%`}…`}))}})
        signal.throwIfAborted()
        if(!owner.uploaded?.importId||!owner.uploaded.statusUrl?.startsWith('/api/')){owner.uploaded=null;throw new Error('Respons unggahan tidak valid.')}
        await poll(owner)
      })
    },
    resume(){return run(poll)},
    download(source=false){return run(async owner=>{
      const signal=owner.controller.signal
      const assetIds=collectSelectedNetworkAssetIds(networks,selectedNetworkIds)
      if(!source&&!assetIds.length)throw new Error('Pilih jaringan berisi aset sebelum mengekspor KML.')
      setState(previous=>({...previous,progress:'Menyiapkan unduhan…'}))
      const result=source?await downloadDatasetSource({importId:context.datasetVersionId,signal}):await exportActiveKml({datasetId:context.datasetId,assetIds,signal})
      signal.throwIfAborted();owner.downloads.saveBlob(result.blob,result.filename);setState(previous=>({...previous,progress:'File berhasil disiapkan.'}))
    })},
  }
}
