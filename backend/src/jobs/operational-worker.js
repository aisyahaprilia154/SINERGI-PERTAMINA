import {newId} from '../domain/operational-model.js'

export class OperationalWorker {
  constructor({repository,importService,pollMilliseconds=1000}) {
    Object.assign(this,{repository,importService,pollMilliseconds});this.id=newId('worker');this.stopped=true;this.pending=null
  }
  async tick() {
    const job=await this.repository.transaction(async client=>{
      const exhausted=await client.query("UPDATE sinergi.jobs SET status='failed',locked_by=null,lock_expires_at=null,error=$1 WHERE status='running' AND lock_expires_at<now() AND attempts>=max_attempts RETURNING import_id",[JSON.stringify({code:'retry_exhausted',message:'Pemrosesan terhenti setelah batas percobaan.'})])
      for(const row of exhausted.rows) await client.query("UPDATE sinergi.imports SET status='failed' WHERE id=$1 AND status='processing'",[row.import_id])
      const row=(await client.query(`SELECT * FROM sinergi.jobs WHERE (status IN ('queued','retry_wait') AND available_at<=now())
        OR (status='running' AND lock_expires_at<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0]
      if(!row) return null
      await client.query("UPDATE sinergi.jobs SET status='running',attempts=attempts+1,locked_by=$2,lock_expires_at=now()+interval '2 minutes',progress=10 WHERE id=$1",[row.id,this.id])
      return {...row,attempts:row.attempts+1}
    })
    if(!job) return false
    const heartbeat=setInterval(()=>{void this.repository.pool.query("UPDATE sinergi.jobs SET lock_expires_at=now()+interval '2 minutes' WHERE id=$1 AND locked_by=$2 AND status='running'",[job.id,this.id]).catch(()=>{})},20000)
    try {
      await this.importService.process(job.import_id,{lease:this.id})
      await this.repository.pool.query("UPDATE sinergi.jobs SET status='succeeded',progress=100,locked_by=null,lock_expires_at=null,completed_at=now(),error=null,result=$3 WHERE id=$1 AND locked_by=$2",[job.id,this.id,JSON.stringify({importId:job.import_id})])
    } catch(error) {
      const retry=job.attempts<job.max_attempts&&(!error.statusCode||error.statusCode>=500)
      const detail={code:error.code ?? 'processing_failed',message:error.expose?error.message:'Pemrosesan gagal. Silakan coba lagi.'}
      await this.repository.transaction(async client=>{
        const owned=await client.query("UPDATE sinergi.jobs SET status=$3,available_at=now()+interval '5 seconds',locked_by=null,lock_expires_at=null,error=$4 WHERE id=$1 AND locked_by=$2 RETURNING id",[job.id,this.id,retry?'retry_wait':'failed',JSON.stringify(detail)])
        if(!retry&&owned.rowCount) await client.query("UPDATE sinergi.imports SET status='failed',error=$2 WHERE id=$1 AND status='processing'",[job.import_id,JSON.stringify(detail)])
      })
      console.error(`[import-worker] ${job.id}: ${error.code ?? error.name}`)
    } finally {clearInterval(heartbeat)}
    return true
  }
  start() {
    this.stopped=false
    const pause=()=>new Promise(resolve=>{this.timer=setTimeout(resolve,this.pollMilliseconds);this.wake=resolve})
    const loop=async()=>{while(!this.stopped){try{if(!await this.tick()) await pause()}catch(error){console.error('[import-worker]',error.code ?? error.name);await pause()}}}
    this.pending=loop()
  }
  async stop(){this.stopped=true;clearTimeout(this.timer);this.wake?.();await this.pending}
}
