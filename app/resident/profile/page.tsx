'use client';
import { useEffect, useState } from 'react';import { usePortal } from '@/components/PortalProvider';import { Field,ErrorMessage,Notice } from '@/components/Field';import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';import { supabaseBrowser } from '@/lib/supabase/browser';import { mobileForms } from '@/lib/phone';import { placeholderEmail } from '@/lib/accountEmail';import type { User } from '@/types';

// A resident's own Profile (decided 2026-11-12). The address they change themselves. A new mobile number is saved only
// after a text code to the NEW number confirms it, because it is also their "Text me a code" sign-in number. Name and
// email are changed by the barangay office (Admin, User Management): the name is checked against their ID and the email
// is their sign-in. With real sign-in everything is saved on the database (app/api/profile) and audited.
async function profileCall(payload: Record<string, unknown>) {
 const response=await fetch('/api/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Your change was not saved. Please try again.');return body;
}
const RESEND_SECONDS=60;

export default function ProfilePage(){
 const {user,act}=usePortal();const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [changing,setChanging]=useState(false),[mobile,setMobile]=useState(''),[phone,setPhone]=useState(''),[code,setCode]=useState(''),[wait,setWait]=useState(0),[mobileError,setMobileError]=useState('');
 useEffect(()=>{if(wait<=0)return;const t=setTimeout(()=>setWait(w=>w-1),1000);return()=>clearTimeout(t);},[wait]);
 if(!user)return null;
 const real=useSupabaseAuth&&isRealAccount(user.id);
 const refresh=(u:User)=>act({type:'sessionUser',user:u});
 async function saveAddress(address:string){
  setError('');setMessage('');setBusy(true);
  try{
   if(real)refresh((await profileCall({action:'address',address})).user);
   else act({type:'user',user:{...user!,address},reason:'Profile updated'});
   setMessage('Your address was saved.');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function sendCode(){
  setMobileError('');setBusy(true);
  try{
   if(!real){const forms=mobileForms(mobile);if(!forms)throw new Error('Enter a mobile number like 09171234567.');act({type:'user',user:{...user!,contact:forms.local},reason:'Profile updated'});setChanging(false);setMobile('');setMessage('Your mobile number was saved.');return;}
   const {phone:international}=await profileCall({action:'checkMobile',mobile});
   const {error}=await supabaseBrowser().auth.updateUser({phone:international});
   if(error)throw new Error(/already|registered|exists/i.test(error.message)?'This mobile number is already on another account. If it is yours, ask the barangay office.':/rate|seconds|too many/i.test(error.message)?'Please wait a minute before asking for another code.':/hook/i.test(error.message)?'We could not send a code right now. This number may have reached today’s limit of codes. Please try again tomorrow.':'The code could not be sent: '+error.message);
   setPhone(international);setCode('');setWait(RESEND_SECONDS);
  }catch(e){setMobileError((e as Error).message);}finally{setBusy(false);}
 }
 async function confirmCode(){
  setMobileError('');setBusy(true);
  try{
   const {error}=await supabaseBrowser().auth.verifyOtp({phone,token:code.trim(),type:'phone_change'});
   if(error)throw new Error(/expired|invalid/i.test(error.message)?'The code is wrong or has expired. Ask for a new one.':error.message);
   refresh((await profileCall({action:'mobileConfirmed'})).user);
   setChanging(false);setPhone('');setMobile('');setCode('');setMessage('Your new mobile number is confirmed and saved. Use it next time you sign in with a text code.');
  }catch(e){setMobileError((e as Error).message);}finally{setBusy(false);}
 }
 const cancel=()=>{setChanging(false);setPhone('');setMobile('');setCode('');setMobileError('');};
 return <div className="px-6 py-12 max-w-[720px] mx-auto"><h1 className="text-[27px] font-bold text-brand-ink">Profile</h1>
  {message&&<Notice>{message}</Notice>}
  <div className="content-card mt-7 p-7">
   <h2 className="text-lg font-bold text-brand-ink">Your details</h2>
   <dl className="form-grid mt-4 text-sm">
    <div><dt className="field-label">Name</dt><dd>{[user.firstName,user.lastName].filter(Boolean).join(' ')||'—'}</dd></div>
    <div><dt className="field-label">Email</dt><dd>{placeholderEmail(user.email)?'No email on file. You sign in with a text code.':user.email}</dd></div>
   </dl>
   <p className="text-xs text-slate-600 mt-4">To change your name or email, please ask the barangay office. Your name must match your valid ID, and your email is how you sign in.</p>
  </div>
  <form className="content-card mt-6 p-7" onSubmit={e=>{e.preventDefault();void saveAddress(String(new FormData(e.currentTarget).get('address')).trim());}}>
   <h2 className="text-lg font-bold text-brand-ink">Address</h2>
   <div className="mt-4"><Field label="Complete Address *"><input name="address" required className="text-field" defaultValue={user.address}/></Field></div>
   <ErrorMessage message={error}/><div className="text-right mt-5"><button className="primary-btn" disabled={busy}>{busy&&!changing?'Saving…':'Save Address'}</button></div>
  </form>
  <div className="content-card mt-6 p-7">
   <h2 className="text-lg font-bold text-brand-ink">Mobile Number</h2>
   <p className="text-sm mt-3">{user.contact||'No mobile number on file.'}</p>
   <p className="text-xs text-slate-600 mt-1">This is also the number you use for &quot;Text me a code&quot; on the Login page.</p>
   {!changing?<button type="button" className="secondary-btn mt-4" onClick={()=>{setChanging(true);setMessage('');}}>Change Mobile Number</button>
   :!phone?<form className="mt-4" onSubmit={e=>{e.preventDefault();void sendCode();}}>
    <Field label="New Mobile Number"><input type="tel" inputMode="tel" autoComplete="tel" required className="text-field" placeholder="09171234567" value={mobile} onChange={e=>setMobile(e.target.value)}/></Field>
    {real&&<p className="text-xs text-slate-600 mt-2">We will text a 6-digit code to the new number to make sure it is yours.</p>}
    <ErrorMessage message={mobileError}/><div className="flex justify-end gap-2 mt-5"><button type="button" className="secondary-btn" onClick={cancel}>Cancel</button><button className="primary-btn" disabled={busy}>{busy?'Please wait…':real?'Send Code':'Save Number'}</button></div>
   </form>
   :<form className="mt-4" onSubmit={e=>{e.preventDefault();void confirmCode();}}>
    <p role="status" className="text-xs text-slate-600">We sent a code to {mobileForms(phone)?.local}. It is valid for a few minutes.</p>
    <div className="mt-3"><Field label="6-digit Code"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="text-field tracking-[0.3em]" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></Field></div>
    <ErrorMessage message={mobileError}/>
    <div className="flex justify-between items-center gap-2 mt-5 flex-wrap"><button type="button" className="text-xs underline text-brand-primary disabled:text-slate-400 disabled:no-underline" disabled={busy||wait>0} onClick={()=>void sendCode()}>{wait>0?`Send a new code in ${wait}s`:'Send a new code'}</button><div className="flex gap-2"><button type="button" className="secondary-btn" onClick={cancel}>Cancel</button><button className="primary-btn" disabled={busy||code.length!==6}>{busy?'Checking…':'Confirm Number'}</button></div></div>
   </form>}
  </div>
  {real&&!placeholderEmail(user.email)&&<p className="text-xs text-slate-600 mt-6">Want a new password? Sign out, then use &quot;Forgot password?&quot; on the Login page.</p>}
 </div>;
}
