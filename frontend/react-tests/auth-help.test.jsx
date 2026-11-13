import {StrictMode} from 'react'
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {AccessRequestDialog} from '../src/react/login/AccessRequestDialog.jsx'
import {GoogleSignIn} from '../src/react/components/GoogleSignIn.jsx'
import {LoginPage} from '../src/react/login/LoginPage.jsx'
import {AccessRequestsPanel} from '../src/react/users/AccessRequestsPanel.jsx'
import {SessionContext} from '../src/react/session/session-context.js'
import {ThemeProvider} from '../src/react/theme/ThemeProvider.jsx'
import {documentNavigation} from '../src/services/document-navigation.js'

let calls,rows,reviewFailure,googleResponse
const pending={id:'request-1',kind:'access',identifier:'new@example.test',email:'new@example.test',full_name:'New User',unit_name:'IT',status:'pending',created_at:'2026-10-29T00:00:00Z',google_subject:null}
beforeEach(()=>{
  calls=[];rows=[{...pending}];reviewFailure=false;googleResponse={state:'pending',message:'Menunggu persetujuan administrator.'}
  sessionStorage.clear();localStorage.clear();delete window.google
  HTMLDialogElement.prototype.showModal??=function(){}
  HTMLDialogElement.prototype.close??=function(){}
  vi.spyOn(HTMLDialogElement.prototype,'showModal').mockImplementation(function(){this.setAttribute('open','')})
  vi.spyOn(HTMLDialogElement.prototype,'close').mockImplementation(function(){this.removeAttribute('open')})
  vi.spyOn(documentNavigation,'replace').mockImplementation(()=>{})
  vi.spyOn(documentNavigation,'assign').mockImplementation(()=>{})
  vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,...options,body})
    if(url==='/api/auth/options')return Response.json({googleEnabled:false})
    if(url==='/api/auth/google/challenge')return Response.json({clientId:'client',nonce:'nonce'})
    if(url==='/api/auth/google/login')return Response.json(googleResponse)
    if(url==='/api/auth/requests')return Response.json({message:'Permintaan telah diterima.'},{status:202})
    if(url==='/api/admin/access-requests')return Response.json({requests:rows,pendingCount:rows.filter(r=>r.status==='pending').length})
    if(url.endsWith('/review')){
      if(reviewFailure)return Response.json({error:{message:'Permintaan sudah berubah.'}},{status:409})
      rows=rows.map(r=>({...r,status:body.action==='reject'?'rejected':'approved'}));return Response.json({status:rows[0].status})
    }
    throw Error(`Unexpected request ${url}`)
  }))
})
afterEach(()=>{vi.unstubAllGlobals();delete window.google})
const mount=element=>render(<StrictMode><ThemeProvider><SessionContext value={{user:{id:'admin',username:'admin',role:'Administrator'},signIn:vi.fn()}}>{element}</SessionContext></ThemeProvider></StrictMode>)
const requestWrites=()=>calls.filter(c=>c.url==='/api/auth/requests')

it('opens help from login, submits access without a reason or role and shows the acknowledgement',async()=>{
  mount(<LoginPage/>);await userEvent.click(screen.getByRole('button',{name:'Ajukan akses',exact:true}))
  const dialog=screen.getByRole('dialog',{name:'Ajukan akses SINERGI'})
  await userEvent.type(within(dialog).getByLabelText('Nama lengkap'),'New User')
  await userEvent.type(within(dialog).getByLabelText('Email'),'new@example.test')
  await userEvent.type(within(dialog).getByLabelText('Unit / bagian'),'IT')
  expect(within(dialog).queryByLabelText(/alasan/i)).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button',{name:'Ajukan akses',exact:true}))
  expect(await screen.findByRole('status')).toHaveTextContent('Permintaan telah diterima.')
  expect(requestWrites()[0].body).toMatchObject({kind:'access',fullName:'New User',email:'new@example.test',unit:'IT'})
  expect(requestWrites()[0].body.role).toBeUndefined()
})
it('forgot password asks for an identifier without asking for a new password',async()=>{
  mount(<AccessRequestDialog kind="password_reset" onClose={vi.fn()}/>);
  await userEvent.type(screen.getByLabelText('Email atau username'),'missing-user')
  expect(screen.queryByLabelText('Password baru')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button',{name:'Kirim permintaan'}));expect(await screen.findByRole('status')).toHaveTextContent('Permintaan telah diterima.')
  expect(requestWrites()[0].body.identifier).toBe('missing-user')
})
it('verified Google application keeps identity read-only and asks only for the unit',async()=>{
  mount(<AccessRequestDialog kind="access" google={{applicationToken:'admission',profile:{name:'Google User',email:'google@gmail.com'}}} onClose={vi.fn()}/>);
  expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');expect(screen.getByLabelText('Nama lengkap')).toHaveValue('Google User')
  await userEvent.type(screen.getByLabelText('Unit / bagian'),'Operations');await userEvent.click(screen.getByRole('button',{name:'Ajukan akses'}))
  await screen.findByRole('status');expect(requestWrites()[0].body.applicationToken).toBe('admission')
})
it('does not load the external Google script when Google is not configured',async()=>{
  mount(<GoogleSignIn onResult={vi.fn()}/>);expect(await screen.findByText(/Login Google belum tersedia/)).toBeVisible()
  expect(screen.getByRole('button',{name:'Lanjutkan dengan Google'})).toBeDisabled()
  expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull()
})
it('admin reviews a request with explicit identity verification and retries failed approvals without losing fields',async()=>{
  const changed=vi.fn(),count=vi.fn();mount(<AccessRequestsPanel hidden={false} onCount={count} onChanged={changed}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Tinjau'}))
  const dialog=screen.getByRole('dialog',{name:'Tinjau permintaan'})
  expect(within(dialog).getByLabelText('Username')).toHaveValue('new')
  await userEvent.type(within(dialog).getByLabelText('Password awal'),'a-long-password-for-tests')
  await userEvent.click(within(dialog).getByLabelText(/Saya sudah memverifikasi/));await userEvent.click(within(dialog).getByLabelText(/Saya akan menyampaikan/))
  reviewFailure=true;await userEvent.click(within(dialog).getByRole('button',{name:'Setujui dan buat akun'}));expect(await screen.findByRole('alert')).toHaveTextContent('Permintaan sudah berubah.')
  expect(within(dialog).getByLabelText('Password awal')).toHaveValue('a-long-password-for-tests')
  reviewFailure=false;await userEvent.click(within(dialog).getByRole('button',{name:'Setujui dan buat akun'}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(count).toHaveBeenLastCalledWith(0)
})
it('Google approvals do not ask the administrator to create a password',async()=>{
  rows=[{...pending,google_subject:'google-sub'}];mount(<AccessRequestsPanel hidden={false} onCount={vi.fn()} onChanged={vi.fn()}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Tinjau'}));expect(screen.queryByLabelText('Password awal')).not.toBeInTheDocument();expect(screen.getByText(/Pemohon dapat langsung masuk dengan Google/)).toBeVisible()
})
it('pagehide aborts pending request polling and dialog submission',async()=>{
  const count=vi.fn();mount(<AccessRequestsPanel hidden={false} onCount={count} onChanged={vi.fn()}/>);await screen.findByRole('button',{name:'Tinjau'});fireEvent(window,new Event('pagehide'))
  expect(calls.filter(c=>c.url==='/api/admin/access-requests').every(c=>c.signal.aborted)).toBe(true)
})

it('login exposes password and help actions without Google controls or configuration requests',()=>{
  mount(<LoginPage/>);expect(screen.queryByRole('button',{name:/Google/})).not.toBeInTheDocument();expect(document.querySelector('.login-divider')).toBeNull();expect(calls.some(c=>c.url.startsWith('/api/auth/google')||c.url==='/api/auth/options')).toBe(false);expect(screen.getByRole('button',{name:'Lupa kata sandi?'})).toBeVisible();expect(screen.getByRole('button',{name:'Ajukan akses',exact:true})).toBeVisible()
})
