'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePortal } from '@/components/PortalProvider';
import { Field, ErrorMessage } from '@/components/Field';
import { PasswordInput } from '@/components/PasswordInput';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { mobileForms } from '@/lib/phone';
import { Captcha, captchaSiteKey } from '@/components/Captcha';
import type { PortalState, User } from '@/types';

// After Supabase accepted the sign-in, /api/me reads the role (and whether registration is finished) from the database.
async function loadMe(): Promise<User> {
  const response = await fetch('/api/me', { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { await supabaseBrowser().auth.signOut(); throw new Error(body.error || 'Could not load your account.'); }
  return body.user as User;
}

// Real sign-in: Supabase checks the password, then /api/me reads the role from the database.
async function signInWithSupabase(email: string, password: string, captchaToken: string): Promise<User> {
  const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken: captchaToken || undefined } });
  if (error) throw new Error(/invalid login credentials/i.test(error.message) ? 'The email or password is incorrect.' : /email not confirmed/i.test(error.message) ? 'Please confirm your email first, using the link we sent you.' : error.message);
  return loadMe();
}

// Sign-in by text (Semaphore, sender BrgySJMR): the server first puts the number on the account that already has it,
// then Supabase texts a 6-digit code. A number with no account gets a new one, which must finish registering.
async function sendCode(mobile: string, captchaToken: string): Promise<string> {
  const forms = mobileForms(mobile);
  if (!forms) throw new Error('Enter a mobile number like 09171234567.');
  const response = await fetch('/api/sms/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile: forms.local }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The code could not be sent. Please try again.');
  const { error } = await supabaseBrowser().auth.signInWithOtp({ phone: forms.international, options: { captchaToken: captchaToken || undefined } });
  if (error) throw new Error(/captcha/i.test(error.message) ? 'The security check failed. Please try again.' : /rate|seconds|too many/i.test(error.message) ? 'Please wait a minute before asking for another code.'
    // The SMS hook refused (daily limit for this number or for the portal) or failed; Supabase hides its reason.
    : /hook/i.test(error.message) ? 'We could not send a code right now. This number may have reached today’s limit of codes. Please try again tomorrow, or sign in with email.'
    : 'The code could not be sent: ' + error.message);
  return forms.international;
}
async function verifyCode(phone: string, code: string): Promise<User> {
  const { error } = await supabaseBrowser().auth.verifyOtp({ phone, token: code.trim(), type: 'sms' });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'The code is wrong or has expired. Ask for a new one.' : error.message);
  return loadMe();
}

const RESEND_SECONDS = 60;

export default function LoginPage(){
 const router=useRouter(),query=useSearchParams();const {act}=usePortal();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [mode,setMode]=useState<'password'|'sms'>('password'),[mobile,setMobile]=useState(''),[phone,setPhone]=useState(''),[code,setCode]=useState(''),[wait,setWait]=useState(0);
 const [captchaToken,setCaptchaToken]=useState(''),[captchaReset,setCaptchaReset]=useState(0);const needCheck=!!captchaSiteKey&&!captchaToken;
 useEffect(()=>{if(wait<=0)return;const t=setTimeout(()=>setWait(w=>w-1),1000);return()=>clearTimeout(t);},[wait]);
 function finish(s:PortalState){
  const user=s.users.find(u=>u.id===s.currentUserId)!;const next=query.get('next');
  router.push(user.needsProfile?'/resident/complete-profile':next?.startsWith('/'+user.role+'/')?next:'/'+user.role+'/dashboard');
 }
 async function submit(f:FormData){
  setError('');setBusy(true);
  try{
   const email=String(f.get('email')),password=String(f.get('password'));
   finish(useSupabaseAuth?act({type:'sessionUser',user:await signInWithSupabase(email,password,captchaToken)}):act({type:'login',email,password}));
  }catch(e){setError((e as Error).message);setCaptchaReset(n=>n+1);}finally{setBusy(false);}
 }
 async function requestCode(){
  setError('');setBusy(true);
  try{setPhone(await sendCode(mobile,captchaToken));setCode('');setWait(RESEND_SECONDS);}catch(e){setError((e as Error).message);}finally{setBusy(false);setCaptchaReset(n=>n+1);}
 }
 async function submitCode(){
  setError('');setBusy(true);
  try{finish(act({type:'sessionUser',user:await verifyCode(phone,code)}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const tab=(value:'password'|'sms',label:string)=><button type="button" role="tab" aria-selected={mode===value} className={`flex-1 py-2 text-xs font-semibold border-b-2 ${mode===value?'border-brand-primary text-brand-primary':'border-transparent text-slate-500'}`} onClick={()=>{setMode(value);setError('');}}>{label}</button>;
 return <div className="min-h-screen bg-page-bg flex items-start justify-center pt-[60px] px-4"><div className="content-card w-full max-w-[325px] px-9 py-9">
 <div className="text-center"><h1 className="text-[25px] font-bold text-brand-ink">Login</h1><p className="text-xs text-slate-600 mt-3">Access your Barangay San Jose account.</p></div>
 {useSupabaseAuth&&<div role="tablist" aria-label="How to sign in" className="flex mt-6">{tab('password','Email and password')}{tab('sms','Text me a code')}</div>}
 {mode==='password'?<form onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}>
  <div className="mt-6 space-y-4"><Field label="Email or Username"><input name="email" autoComplete="username" required className="text-field" placeholder="Enter your email or username"/></Field><Field label="Password"><PasswordInput name="password" autoComplete="current-password" required placeholder="Enter your password"/></Field></div>
  <Captcha onToken={setCaptchaToken} resetKey={captchaReset}/><ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy||needCheck}>{busy?'Signing in…':'Login'}</button>
 </form>
 :!phone?<form onSubmit={e=>{e.preventDefault();void requestCode();}}>
  <p className="text-xs text-slate-600 mt-6">We will text a 6-digit code to your mobile number. If this number is not registered yet, you can finish registering after signing in.</p>
  <div className="mt-4"><Field label="Mobile Number"><input type="tel" inputMode="tel" autoComplete="tel" required className="text-field" placeholder="09171234567" value={mobile} onChange={e=>setMobile(e.target.value)}/></Field></div>
  <Captcha onToken={setCaptchaToken} resetKey={captchaReset}/><ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy||needCheck}>{busy?'Sending the code…':'Send Code'}</button>
 </form>
 :<form onSubmit={e=>{e.preventDefault();void submitCode();}}>
  <p role="status" className="text-xs text-slate-600 mt-6">We sent a code to {mobileForms(phone)?.local}. It is valid for a few minutes.</p>
  <div className="mt-4"><Field label="6-digit Code"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="text-field tracking-[0.3em]" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></Field></div>
  <Captcha onToken={setCaptchaToken} resetKey={captchaReset}/><ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy||code.length!==6}>{busy?'Checking…':'Sign In'}</button>
  <div className="flex justify-between mt-4 text-xs"><button type="button" className="underline text-brand-primary disabled:text-slate-400 disabled:no-underline" disabled={busy||wait>0||needCheck} onClick={()=>void requestCode()}>{wait>0?`Send a new code in ${wait}s`:'Send a new code'}</button><button type="button" className="underline text-slate-600" onClick={()=>{setPhone('');setCode('');setError('');}}>Use another number</button></div>
 </form>}
 <Link href="/" className="secondary-btn w-full mt-3 block text-center">Back to Home</Link><p className="text-xs text-center mt-8">Don&apos;t have an account? <Link href="/register" className="underline text-brand-primary">Register</Link></p><p className="text-xs text-center mt-4 text-slate-500"><Link href="/information#privacy" className="underline">Privacy Notice</Link></p>
 </div></div>;
}
