import {randomBytes,randomUUID} from 'node:crypto'
import {OAuth2Client} from 'google-auth-library'
import {AppError} from '../errors.js'

const denied=()=>new AppError('Verifikasi Google gagal atau telah kedaluwarsa. Coba lagi.',{code:'google_invalid',statusCode:401})
export class GoogleIdentity {
  constructor({pool,clientId='',origins=[],verify,now=Date.now}){
    if(clientId&&!origins.length)throw new Error('SINERGI_PUBLIC_ORIGINS wajib diisi sebelum mengaktifkan Google.')
    Object.assign(this,{pool,clientId,origins,now});this.challenges=new Map();this.applications=new Map()
    const client=new OAuth2Client(clientId)
    this.verify=verify??(async credential=>(await client.verifyIdToken({idToken:credential,audience:clientId})).getPayload())
  }
  assertOrigin(request){
    const origin=request.headers.origin
    if(!origin||!this.origins.includes(origin))throw new AppError('Asal permintaan tidak diizinkan.',{code:'invalid_origin',statusCode:403})
  }
  browser(request){return String(request.headers.cookie??'').split(';').map(p=>p.trim()).find(p=>p.startsWith('sinergi_google='))?.slice('sinergi_google='.length)}
  clean(){for(const map of [this.challenges,this.applications])for(const [k,v] of map)if(v.until<=this.now())map.delete(k)}
  challenge(request,response){
    if(!this.clientId)throw new AppError('Login Google belum dikonfigurasi.',{code:'google_unavailable',statusCode:503})
    this.clean();if(this.challenges.size>=2048)throw new AppError('Coba lagi nanti.',{code:'rate_limited',statusCode:429})
    const browser=this.browser(request)??randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url')
    this.challenges.set(nonce,{browser,until:this.now()+10*60*1000})
    const secure=this.origins.every(o=>o.startsWith('https://'))?'; Secure':''
    response.setHeader('set-cookie',`sinergi_google=${browser}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=3600${secure}`)
    return {nonce,clientId:this.clientId}
  }
  async identity(request,body){
    this.assertOrigin(request);this.clean()
    const challenge=this.challenges.get(body.nonce)
    if(!this.clientId||!challenge||challenge.browser!==this.browser(request))throw denied()
    this.challenges.delete(body.nonce)
    let profile;try{profile=await this.verify(body.credential)}catch{throw denied()}
    if(typeof profile?.sub!=='string'||!profile.sub||profile.sub.length>255||profile.nonce!==body.nonce||profile.email_verified!==true||typeof profile.email!=='string'||profile.email.length>254)throw denied()
    return profile
  }
  async login(request,body){
    const profile=await this.identity(request,body)
    const user=(await this.pool.query(`SELECT u.* FROM sinergi.auth_identities i JOIN sinergi.app_users u ON u.id=i.user_id
      WHERE i.provider='google' AND i.subject=$1`,[profile.sub])).rows[0]
    if(user)return {user:{id:user.id,username:user.username,name:user.display_name||user.username,email:user.email,role:user.role,authVersion:Number(user.auth_version),hasGoogle:true,hasPassword:!!user.password_hash}}
    if((await this.pool.query('SELECT 1 FROM sinergi.app_users WHERE lower(email)=$1',[profile.email.toLowerCase()])).rowCount)return {state:'link_required',message:'Email ini sudah memiliki akun SINERGI. Masuk dengan password, lalu buka Metode login untuk menghubungkan Google.'}
    const pending=(await this.pool.query("SELECT status FROM sinergi.access_requests WHERE google_subject=$1 AND status='pending' LIMIT 1",[profile.sub])).rows[0]
    if(pending)return {state:'pending',message:'Pengajuan akses Anda sedang menunggu persetujuan administrator. Silakan masuk dengan Google lagi setelah disetujui.'}
    if(this.applications.size>=2048)throw new AppError('Coba lagi nanti.',{code:'rate_limited',statusCode:429})
    const applicationToken=randomBytes(32).toString('base64url')
    this.applications.set(applicationToken,{profile,browser:this.browser(request),until:this.now()+10*60*1000})
    return {state:'application_required',applicationToken,profile:{name:profile.name??'',email:profile.email}}
  }
  application(request,token){
    this.assertOrigin(request);this.clean();const grant=this.applications.get(token)
    if(!grant||grant.browser!==this.browser(request))throw denied()
    return grant.profile
  }
  async link(request,body,user,accountStore){
    const reauthenticated=await accountStore.verify(user.username,body.password)
    if(!reauthenticated||reauthenticated.id!==user.id)throw new AppError('Password akun SINERGI tidak sesuai.',{code:'invalid_credentials',statusCode:401})
    const profile=await this.identity(request,body)
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const locked=(await client.query('SELECT auth_version FROM sinergi.app_users WHERE id=$1 FOR UPDATE',[user.id])).rows[0]
      if(!locked||Number(locked.auth_version)!==reauthenticated.authVersion)throw denied()
      await client.query("INSERT INTO sinergi.auth_identities(provider,subject,user_id,email) VALUES('google',$1,$2,$3)",[profile.sub,user.id,profile.email.toLowerCase()])
      await client.query('INSERT INTO sinergi.audit_events(id,event,actor_id,details) VALUES($1,$2,$3,$4)',[randomUUID(),'user.google_linked',user.id,JSON.stringify({userId:user.id})])
      await client.query('COMMIT');return {linked:true}
    }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')throw new AppError('Akun SINERGI atau Google sudah memiliki hubungan login.',{code:'identity_exists',statusCode:409});throw error}
    finally{client.release()}
  }
}
