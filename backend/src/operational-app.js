import http from 'node:http'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { AppError,asAppError } from './errors.js'
import { receiveImportUpload } from './http/multipart-upload.js'
import { createOpenFreeMapProxy } from './http/openfreemap-proxy.js'
import { validateUploadedFile } from './import/upload-validation.js'
import { readKmzResourceBuffer } from './import/kmz-extractor.js'
import { newId } from './domain/operational-model.js'
import { snapshotToView,insertRows } from './storage/operational-repository.js'
import { buildActiveAssetCatalog,queryActiveAssets } from './domain/active-dataset-query.js'
import { serializeActiveDatasetKml } from './domain/active-dataset-kml.js'
import { requireAdministrator,HEARTBEAT_INTERVAL_MS,ONLINE_TIMEOUT_MS } from './security/authorization.js'

export function createOperationalApp({repository,importService,fileStore,config,authenticator,accountStore}) {
  const basemap=createOpenFreeMapProxy({directory:path.join(config.dataRoot,'basemap-cache')})
  return http.createServer(async(request,response)=>{
    response.setHeader('x-content-type-options','nosniff');response.setHeader('x-frame-options','DENY')
    response.setHeader('referrer-policy','same-origin');response.setHeader('cache-control','private, no-store')
    const correlationId=newId('request');response.setHeader('x-correlation-id',correlationId)
    const send=(status,body)=>{
      const bytes=Buffer.from(JSON.stringify(body));response.statusCode=status;response.setHeader('content-type','application/json; charset=utf-8')
      if(bytes.length>1024&&/\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {response.setHeader('content-encoding','gzip');response.setHeader('vary','Accept-Encoding');response.end(gzipSync(bytes))}
      else response.end(bytes)
    }
    try {
      const url=new URL(request.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if(request.method==='GET'&&url.pathname==='/health') {
        await repository.pool.query('SELECT 1 FROM sinergi.dataset_state LIMIT 1');return send(200,{status:'ok',schema:2})
      }
      if(request.method==='GET'&&url.pathname.startsWith('/api/basemap/openfreemap/')) return await basemap.handle(url.pathname,response,request)
      if(request.method==='POST'&&url.pathname==='/api/auth/login') {
        const body=await readJson(request,4096),user=await accountStore.verify(body.identifier,body.password)
        if(!user) throw new AppError('Username atau kata sandi salah.',{code:'invalid_credentials',statusCode:401})
        await accountStore.markSeen(user.id)
        return send(200,{...authenticator.issueSession(user),user:publicUser(user)})
      }
      let user=authenticator.authenticate(request)
      if(authenticator.isSession(request)){
        try{user=await accountStore.resolveSession(user)}catch(error){if(error.code==='session_revoked')authenticator.revokeUser(user.id);throw error}
        authenticator.updateSessionUser(request,user)
        if(authenticator.touch(request))await accountStore.markSeen(user.id)
      }
      if(url.pathname==='/api/auth/me'&&request.method==='GET') return send(200,{user:publicUser(user)})
      if(url.pathname==='/api/auth/heartbeat'&&request.method==='POST')return send(200,{user:publicUser(user),heartbeatIntervalSeconds:HEARTBEAT_INTERVAL_MS/1000,onlineTimeoutSeconds:ONLINE_TIMEOUT_MS/1000})
      if(url.pathname==='/api/auth/logout'&&request.method==='POST') {authenticator.revoke(request);return send(200,{loggedOut:true})}
      const admin=()=>requireAdministrator(request,authenticator)
      if(parts[0]==='api'&&parts[1]==='admin'&&parts[2]==='users'){
        admin()
        if(request.method==='GET'&&!parts[3])return send(200,{users:(await accountStore.list()).map(a=>({...a,online:a.active&&authenticator.isOnline(a.id)})),serverTime:new Date().toISOString(),onlineTimeoutSeconds:ONLINE_TIMEOUT_MS/1000})
        if((request.method==='POST'&&!parts[3])||(request.method==='PATCH'&&parts[3]&&!parts[4])||(request.method==='POST'&&parts[4]==='password')){
          const result=await accountStore.manage({actorId:user.id,userId:parts[3],body:await readJson(request,8192),resetPassword:parts[4]==='password'})
          if(result.sessionsRevoked)authenticator.revokeUser(result.user.id)
          return send(parts[3]?200:201,result)
        }
      }
      if(url.pathname==='/api/import-config'&&request.method==='GET') {
        admin();return send(200,{datasets:(await repository.pool.query('SELECT id FROM sinergi.dataset_state ORDER BY id')).rows,
          maxFileSize:config.upload.maxFileSize,allowedExtensions:['.kml','.kmz']})
      }
      if(parts[0]==='api'&&parts[1]==='imports') {
        if(!(request.method==='GET'&&['source-resources','overlay-resources','source-file'].includes(parts[3]))) admin()
        const id=parts[2]
        if(!id&&request.method==='GET') return send(200,{imports:(await repository.pool.query('SELECT id,dataset_id,name,source_filename,status,summary,error,base_revision,created_at,applied_at FROM sinergi.imports ORDER BY created_at DESC LIMIT 100')).rows})
        if(!id&&request.method==='POST') {
          const upload=await receiveImportUpload(request,{fileStore,maxFileSize:config.upload.maxFileSize})
          try {
            const validated=await validateUploadedFile({filePath:upload.temporaryPath,filename:upload.filename,mimeType:upload.mimeType,size:upload.size,maxFileSize:config.upload.maxFileSize})
            const datasetId=upload.fields.datasetId || (await repository.pool.query('SELECT id FROM sinergi.dataset_state ORDER BY id LIMIT 1')).rows[0]?.id
            const state=await repository.state(repository.pool,datasetId),importId=newId('import')
            const source=await fileStore.commitOriginal(upload.temporaryPath,importId,validated.extension)
            await repository.transaction(async client=>{
              await insertRows(client,'imports',[{id:importId,dataset_id:datasetId,name:String(upload.fields.versionName ?? upload.filename).slice(0,180),
                source_filename:validated.sourceFilename,source_storage_key:source.storageKey,source_checksum:upload.checksum,source_size:upload.size,
                status:'processing',base_revision:Number(state.revision),actor_id:user.id,summary:{},source_manifest:{}}])
              await client.query("INSERT INTO sinergi.jobs(id,import_id,status) VALUES($1,$2,'queued')",[newId('job'),importId])
              await repository.audit(client,'import.uploaded',{actorId:user.id,datasetId,importId,details:{filename:validated.sourceFilename,size:upload.size}})
            })
            return send(202,{importId,statusUrl:`/api/imports/${importId}`,previewUrl:`/api/imports/${importId}/preview`})
          } finally {await fileStore.removeTemporary(upload.temporaryPath)}
        }
        if(id&&request.method==='GET'&&parts[3]==='source-file') {
          const record=await importService.get(id),source=await fileStore.readVerifiedOriginal({storageKey:record.source_storage_key,expectedSize:Number(record.source_size),expectedChecksum:record.source_checksum})
          response.setHeader('content-type',record.source_filename?.endsWith('.kmz')?'application/vnd.google-earth.kmz':'application/vnd.google-earth.kml+xml')
          response.setHeader('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(record.source_filename ?? 'source.kmz')}`);return response.end(source.bytes)
        }
        if(id&&request.method==='GET'&&!parts[3]) {
          const record=await importService.get(id),job=(await repository.pool.query('SELECT id,status,progress,error FROM sinergi.jobs WHERE import_id=$1',[id])).rows[0]
          return send(200,{import:record,job})
        }
        if(id&&request.method==='GET'&&parts[3]==='preview') return send(200,await importService.preview(id))
        if(id&&request.method==='POST'&&parts[3]==='refresh') {
          const record=await importService.get(id)
          if(record.status!=='ready') throw new AppError('Preview tidak dapat diperbarui.',{code:'import_not_ready',statusCode:409})
          await repository.transaction(async client=>{
            const changed=await client.query("UPDATE sinergi.imports SET status='processing' WHERE id=$1 AND status='ready' RETURNING id",[id])
            if(!changed.rowCount) throw new AppError('Preview telah berubah.',{code:'import_not_ready',statusCode:409})
            await client.query("UPDATE sinergi.jobs SET status='queued',attempts=0,progress=0,available_at=now(),error=null WHERE import_id=$1",[id])
          })
          return send(202,{importId:id,statusUrl:`/api/imports/${id}`})
        }
        if(id&&request.method==='PATCH'&&parts[3]==='items'&&parts[4]) return send(200,await importService.decide(id,parts[4],await readJson(request),user.id))
        if(id&&request.method==='POST'&&parts[3]==='apply') {
          const body=await readJson(request);return send(200,await importService.apply(id,body.expectedRevision,user.id))
        }
      }
      if(parts[0]==='api'&&parts[1]==='datasets'&&parts[2]) {
        const datasetId=parts[2]
        if(request.method==='POST'&&parts[3]==='diagram') {
          admin();const body=await readJson(request)
          return send(200,await repository.saveDiagram({datasetId,expectedRevision:body.expectedRevision,changes:body.changes,actorId:user.id}))
        }
        if(['PUT','DELETE'].includes(request.method)&&parts[3]==='active'&&parts[4]==='assets'&&parts[5]&&parts[6]==='icon') {
          admin();const body=await readJson(request,3*1024*1024)
          return send(200,await repository.saveIcon({datasetId,assetId:parts[5],expectedRevision:body.expectedRevision,dataUrl:request.method==='DELETE'?null:body.dataUrl,actorId:user.id}))
        }
        const {snapshot,view}=await repository.readView(datasetId)
        if(request.method==='GET'&&parts[3]==='topology'&&parts[4]==='graph') return send(200,view.topologyGraph)
        if(parts[3]==='active') {
          if(request.method==='GET'&&!parts[4]) return send(200,view)
          if(request.method==='GET'&&parts[4]==='sites') return send(200,{sites:view.sites,revision:view.revision})
          if(request.method==='GET'&&parts[4]==='overlays') return send(200,{overlays:view.overlays,revision:view.revision})
          const catalog=buildCatalog(view)
          if(request.method==='GET'&&parts[4]==='assets'&&!parts[5]) {
            const query=Object.fromEntries(url.searchParams)
            for(const name of ['category','assetType','assetId','networkFamily']) query[name]=url.searchParams.getAll(name)
            if(query.siteId&&!view.sites.some(s=>s.id===query.siteId)) delete query.siteId
            return send(200,queryActiveAssets({catalog,revision:view.revision,query,isAdministrator:user.role==='Administrator'}))
          }
          if(request.method==='GET'&&parts[4]==='assets'&&parts[5]) {
            const asset=catalog.find(a=>a.canonicalAssetId===parts[5])
            if(!asset) throw new AppError('Aset tidak ditemukan.',{code:'asset_not_found',statusCode:404})
            const connections=view.topologyGraph.edges.filter(r=>[r.sourceAssetId,r.targetAssetId].includes(parts[5]))
            return send(200,{operationalSchema:2,revision:view.revision,recordRevision:view.revision,asset:{...asset.rawAsset,...asset,positions:asset.positions},
              identity:{canonicalAssetId:asset.canonicalAssetId,aliasValues:snapshot.aliases.filter(a=>a.asset_id===asset.canonicalAssetId).map(a=>a.match_value)},
              geometries:asset.geometries,connections,relations:connections,mountingRelations:view.mountingRelations.filter(r=>[r.sourceAssetId,r.targetAssetId].includes(parts[5])),
              mountingExpectations:view.mountingExpectations,sourceMetadata:asset.rawProperties})
          }
          if(request.method==='POST'&&parts[4]==='exports'&&parts[5]==='kml') {
            const query=await readJson(request),result=queryActiveAssets({catalog,revision:view.revision,query:{...query,siteId:view.sites.some(s=>s.id===query.siteId)?query.siteId:undefined,limit:Math.max(1,catalog.length)},isAdministrator:user.role==='Administrator',allowLargeLimit:true})
            const removedPaths=new Set(view.assets.filter(a=>a.relationPathRemoved).map(a=>a.id))
            const selected=new Set(result.items.map(i=>i.canonicalAssetId)),items=catalog.filter(a=>selected.has(a.canonicalAssetId)&&!removedPaths.has(a.canonicalAssetId))
            const kml=serializeActiveDatasetKml({operationalSchema:2,datasetVersion:view.datasetVersion,activePointer:{revision:view.revision},items,filter:query,
              relations:view.relations.filter(r=>selected.has(r.sourceAssetId)&&selected.has(r.targetAssetId))})
            response.setHeader('content-type','application/vnd.google-earth.kml+xml; charset=utf-8');response.setHeader('content-disposition','attachment; filename="sinergi-active.kml"')
            response.setHeader('x-dataset-version-id',view.datasetVersion.id);response.setHeader('x-active-pointer-revision',String(view.revision));return response.end(kml)
          }
        }
      }
      // Immutable resources remain tied to their original import, including
      // historical icons used by the cumulative operational dataset.
      if(parts[0]==='api'&&['imports','dataset-versions'].includes(parts[1])&&['source-resources','overlay-resources'].includes(parts[3])&&request.method==='GET') {
        const record=await importService.get(parts[2]),resource=(record.source_manifest.resources ?? []).find(r=>r.resourceId===parts[4])
        if(!resource) throw new AppError('Resource tidak ditemukan.',{code:'resource_not_found',statusCode:404})
        const original=await fileStore.readVerifiedOriginal({storageKey:record.source_storage_key,expectedChecksum:record.source_checksum,expectedSize:Number(record.source_size)})
        const found=await readKmzResourceBuffer(original.bytes,[resource.relativePath ?? resource.path ?? resource.archivePath,...(resource.relativePaths ?? [])].filter(Boolean),config.upload)
        const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}
        response.setHeader('content-type',resource.mimeType ?? mime[resource.extension] ?? 'application/octet-stream');return response.end(found.bytes ?? found.buffer ?? found)
      }
      throw new AppError('Endpoint tidak ditemukan.',{code:'not_found',statusCode:404})
    } catch(error) {
      const appError=asAppError(error)
      if(!appError.expose) console.error(`[${correlationId}] ${error.code ?? error.name}: ${error.message}`)
      if(!response.headersSent) send(appError.statusCode,{error:{code:appError.code,message:appError.expose?appError.message:'Terjadi kesalahan internal.',details:appError.expose?appError.details:undefined}})
      else response.destroy()
    }
  })
}
async function readJson(request,limit=256*1024) {
  if(!String(request.headers['content-type'] ?? '').startsWith('application/json')) throw new AppError('Body JSON diperlukan.',{code:'invalid_content_type',statusCode:415})
  const chunks=[];let size=0
  for await(const chunk of request){size+=chunk.length;if(size>limit) throw new AppError('Request terlalu besar.',{code:'request_too_large',statusCode:413});chunks.push(chunk)}
  try{const body=JSON.parse(Buffer.concat(chunks).toString());if(!body||Array.isArray(body)||typeof body!=='object')throw new Error();return body}catch{throw new AppError('JSON tidak valid.',{code:'invalid_json',statusCode:400})}
}
function publicUser(user){return {id:user.id,name:user.name,username:user.username,role:user.role,email:user.email}}
function buildCatalog(view) {
  return buildActiveAssetCatalog({record:view,topologyGraph:view.topologyGraph}).map(item=>({...item,siteId:item.rawAsset.facilityId,
    categoryId:item.rawAsset.categoryId,facilityId:item.rawAsset.facilityId,diagramRole:item.rawAsset.diagramRole}))
}
