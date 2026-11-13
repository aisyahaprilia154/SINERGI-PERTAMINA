import {randomUUID,randomBytes,scrypt as derive} from 'node:crypto'
import {promisify} from 'node:util'
import {AppError} from '../errors.js'
import {validNewPassword} from './password-policy.js'

const scrypt=promisify(derive)
export const REQUEST_RECEIVED='Permintaan telah diterima. Administrator akan memverifikasi identitas Anda melalui kanal internal resmi.'
const invalid=message=>new AppError(message,{code:'invalid_request',statusCode:400})
const conflict=message=>new AppError(message,{code:'request_conflict',statusCode:409})
function text(value,max,required=true){if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))throw invalid('Lengkapi data dengan format yang sesuai.');return value.trim()}
export function accessRequestInput(body,google=null){
  if(!['access','password_reset'].includes(body.kind))throw invalid('Jenis permintaan tidak valid.')
  if(body.kind==='password_reset')return {kind:body.kind,identifier:text(body.identifier,254).toLowerCase(),fullName:null,email:null,unit:null,subject:null}
  const email=text(google?.email??body.email,254).toLowerCase()
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw invalid('Email tidak valid.')
  return {kind:'access',identifier:email,email,fullName:text(google?.name||body.fullName,128),unit:text(body.unit,120),subject:google?.sub??null}
}
export class AccessRequests {
  constructor(pool){this.pool=pool}
  async submit(body,google=null){
    const r=accessRequestInput(body,google)
    // Public submission deliberately does not look up whether an account exists.
    await this.pool.query(`INSERT INTO sinergi.access_requests(id,kind,identifier,full_name,email,unit_name,google_subject)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (kind,identifier) WHERE status='pending' DO UPDATE SET
      google_subject=COALESCE(sinergi.access_requests.google_subject,EXCLUDED.google_subject),
      full_name=CASE WHEN EXCLUDED.google_subject IS NOT NULL THEN EXCLUDED.full_name ELSE sinergi.access_requests.full_name END,
      unit_name=CASE WHEN EXCLUDED.google_subject IS NOT NULL THEN EXCLUDED.unit_name ELSE sinergi.access_requests.unit_name END`,[randomUUID(),r.kind,r.identifier,r.fullName,r.email,r.unit,r.subject])
    return {message:REQUEST_RECEIVED}
  }
  async list(){
    const result=await this.pool.query(`SELECT r.*,u.id AS matched_user_id,u.username AS matched_username,
      u.email AS registered_email,u.password_hash IS NOT NULL AS has_password,
      EXISTS(SELECT 1 FROM sinergi.auth_identities a WHERE a.user_id=u.id) AS has_google
      FROM sinergi.access_requests r LEFT JOIN sinergi.app_users u
      ON (r.kind='password_reset' AND (u.username=r.identifier OR lower(u.email)=r.identifier))
      OR (r.kind='access' AND lower(u.email)=r.email)
      ORDER BY r.created_at DESC LIMIT 300`)
    return {requests:result.rows,pendingCount:Number((await this.pool.query("SELECT count(*) FROM sinergi.access_requests WHERE status='pending'")).rows[0].count)}
  }
  async review(id,body,actorId){
    if(!['approve','reject'].includes(body.action))throw invalid('Tindakan tidak valid.')
    if(body.action==='approve'&&body.identityVerified!==true)throw invalid('Verifikasi identitas pemohon terlebih dahulu.')
    const note=text(body.note??'',500,body.action==='reject')
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sinergi.user-management'))")
      const request=(await client.query('SELECT * FROM sinergi.access_requests WHERE id=$1 FOR UPDATE',[id])).rows[0]
      if(!request)throw new AppError('Permintaan tidak ditemukan.',{code:'not_found',statusCode:404})
      if(request.status!=='pending')throw conflict('Permintaan sudah diproses. Muat ulang daftar.')
      let account=null,sessionsRevoked=false
      if(body.action==='approve'){
        if(request.kind==='password_reset'){
          account=(await client.query('SELECT * FROM sinergi.app_users WHERE username=$1 OR lower(email)=$1 FOR UPDATE',[request.identifier])).rows[0]
          if(!account)throw conflict('Akun tidak ditemukan. Tolak permintaan ini setelah verifikasi.')
          if(!account.password_hash)throw conflict('Akun ini masuk melalui Google. Pemulihan akun dilakukan melalui Google.')
        }else{
          if((await client.query('SELECT 1 FROM sinergi.app_users WHERE lower(email)=$1',[request.email])).rowCount)throw conflict('Email sudah memiliki akun. Gunakan alur hubungkan Google dari akun yang sudah login.')
          if(request.google_subject&&(await client.query("SELECT 1 FROM sinergi.auth_identities WHERE provider='google' AND subject=$1",[request.google_subject])).rowCount)throw conflict('Identitas Google sudah terhubung.')
        }
        let passwordHash=null
        if(request.kind==='password_reset'||!request.google_subject){
          if(body.deliveryConfirmed!==true)throw invalid('Pastikan password akan disampaikan melalui kanal internal resmi kepada pemilik akun.')
          if(!validNewPassword(body.password))throw invalid('Password harus terdiri dari 15–1024 karakter.')
          const salt=randomBytes(16).toString('hex');passwordHash=`scrypt$${salt}$${(await scrypt(body.password,salt,64)).toString('hex')}`
        }
        if(request.kind==='access'){
          const username=text(body.username,64).toLowerCase()
          if(!/^[a-z0-9._-]{1,64}$/.test(username))throw invalid('Username tidak valid.')
          account=(await client.query(`INSERT INTO sinergi.app_users(id,username,email,password_hash,role,display_name,unit_name)
            VALUES($1,$2,$3,$4,'Viewer',$5,$6) RETURNING *`,[randomUUID(),username,request.email,passwordHash,request.full_name,request.unit_name])).rows[0]
          if(request.google_subject)await client.query("INSERT INTO sinergi.auth_identities(provider,subject,user_id,email) VALUES('google',$1,$2,$3)",[request.google_subject,account.id,request.email])
        }else{
          await client.query('UPDATE sinergi.app_users SET password_hash=$2,auth_version=auth_version+1,updated_at=clock_timestamp() WHERE id=$1',[account.id,passwordHash]);sessionsRevoked=true
        }
      }
      const status=body.action==='approve'?'approved':'rejected'
      await client.query('UPDATE sinergi.access_requests SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now(),resolved_user_id=$5 WHERE id=$1',[id,status,note,actorId,account?.id??null])
      await client.query('INSERT INTO sinergi.audit_events(id,event,actor_id,details) VALUES($1,$2,$3,$4)',[randomUUID(),`access_request.${status}`,actorId,JSON.stringify({requestId:id,kind:request.kind,userId:account?.id,identityVerified:body.identityVerified===true})])
      await client.query('COMMIT')
      return {status,userId:account?.id??null,sessionsRevoked}
    }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')throw conflict('Username, email, atau identitas sudah digunakan. Muat ulang dan periksa kembali.');throw error}
    finally{client.release()}
  }
}

export class RequestLimiter {
  constructor({now=Date.now,max=20,window=15*60*1000}={}){Object.assign(this,{now,max,window});this.entries=new Map()}
  check(key){
    const now=this.now();for(const [k,e] of this.entries)if(e.until<=now)this.entries.delete(k)
    let e=this.entries.get(key)
    if(!e){if(this.entries.size>=10000)throw new AppError('Layanan sedang sibuk. Coba lagi nanti.',{code:'rate_limited',statusCode:429});e={until:now+this.window,count:0};this.entries.set(key,e)}
    if(++e.count>this.max)throw new AppError('Terlalu banyak permintaan. Coba lagi nanti.',{code:'rate_limited',statusCode:429})
  }
}
