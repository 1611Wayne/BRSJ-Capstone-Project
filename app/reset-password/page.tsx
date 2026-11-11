'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePortal } from '@/components/PortalProvider';
import { Field, ErrorMessage } from '@/components/Field';
import { PasswordInput } from '@/components/PasswordInput';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { User } from '@/types';

// The page the "Forgot password?" reset email opens (Supabase's own email, decided 2026-11-12). Supabase's sign-in
// library turns the link's ?code=… into a session by itself (only in the browser that asked for the email); a link made
// another way may carry the session in the #fragment instead. Then the person chooses a new password, which the server
// saves (app/api/account/password, within 15 minutes of opening the link).
export default function ResetPasswordPage(){
 const router=useRouter();const {act}=usePortal();
 const [state,setState]=useState<'checking'|'ready'|'invalid'|'done'>('checking'),[user,setUser]=useState<User>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!useSupabaseAuth){setState('invalid');return;}
  let cancelled=false;
  (async()=>{
   const supabase=supabaseBrowser();
   const query=new URLSearchParams(window.location.search),hash=new URLSearchParams(window.location.hash.slice(1));
   const linkError=query.get('error_description')||hash.get('error_description');
   if(linkError){setError(/expired|invalid/i.test(linkError)?'This reset link has expired or was already used.':linkError);setState('invalid');return;}
   if(hash.get('access_token')&&hash.get('refresh_token')){
    const {error}=await supabase.auth.setSession({access_token:hash.get('access_token')!,refresh_token:hash.get('refresh_token')!});
    if(error){setState('invalid');return;}
   }
   const {data:{session}}=await supabase.auth.getSession();   // waits for the ?code=… exchange to finish
   if(!session){if(!cancelled)setState('invalid');return;}
   window.history.replaceState(null,'','/reset-password');   // the code and tokens are used; keep them out of the address bar
   const response=await fetch('/api/me',{cache:'no-store'});const body=await response.json().catch(()=>({}));
   if(cancelled)return;
   if(!response.ok){setError(body.error||'Could not load your account.');setState('invalid');return;}
   setUser(body.user as User);setState('ready');
  })().catch(()=>{if(!cancelled)setState('invalid');});
  return()=>{cancelled=true;};
 },[]);
 async function save(f:FormData){
  setError('');const password=String(f.get('newPassword')),again=String(f.get('confirmPassword'));
  if(password!==again)return setError('The two passwords do not match.');
  setBusy(true);
  try{
   const response=await fetch('/api/account/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password,via:'email'})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'The password was not changed. Please try again.');
   setState('done');const s=act({type:'sessionUser',user:user!});const me=s.users.find(u=>u.id===s.currentUserId)!;
   setTimeout(()=>router.push(me.needsProfile?'/resident/complete-profile':'/'+me.role+'/dashboard'),2000);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="min-h-screen bg-page-bg flex items-start justify-center pt-[60px] px-4"><div className="content-card w-full max-w-[325px] px-9 py-9">
  <div className="text-center"><h1 className="text-[25px] font-bold text-brand-ink">Reset Password</h1></div>
  {state==='checking'&&<p role="status" className="text-sm text-slate-600 mt-6 text-center">Checking your reset link…</p>}
  {state==='invalid'&&<><p role="alert" className="text-sm text-red-700 mt-6">{error||'This reset link is not valid any more, or it was opened on another device or browser. Open it on the same phone or computer where you asked for it, or ask for a new link.'}</p><Link href="/login" className="primary-btn w-full mt-6 block text-center">Back to Login</Link></>}
  {state==='ready'&&<form onSubmit={e=>{e.preventDefault();void save(new FormData(e.currentTarget));}}>
   <p className="text-xs text-slate-600 mt-6">Choose a new password for {user?.email}.</p>
   <div className="mt-4 space-y-4"><Field label="New Password"><PasswordInput name="newPassword" autoComplete="new-password" required minLength={8} maxLength={72} placeholder="At least 8 characters"/></Field><Field label="Confirm New Password"><PasswordInput name="confirmPassword" autoComplete="new-password" required minLength={8} maxLength={72}/></Field></div>
   <ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy}>{busy?'Saving…':'Save New Password'}</button>
  </form>}
  {state==='done'&&<p role="status" className="text-sm text-green-800 bg-green-50 border border-green-200 px-3 py-2 mt-6">Your password was changed. Use it next time with your email.</p>}
 </div></div>;
}
