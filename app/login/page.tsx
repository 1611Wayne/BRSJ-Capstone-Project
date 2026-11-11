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
import { placeholderEmail } from '@/lib/accountEmail';
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
// For "Forgot password?" (existingOnly), a number with no account gets no code and no new account.
async function sendCode(mobile: string, captchaToken: string, existingOnly = false): Promise<string> {
  const forms = mobileForms(mobile);
  if (!forms) throw new Error('Enter a mobile number like 09171234567.');
  const response = await fetch('/api/sms/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile: forms.local }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The code could not be sent. Please try again.');
  const { error } = await supabaseBrowser().auth.signInWithOtp({ phone: forms.international, options: { captchaToken: captchaToken || undefined, shouldCreateUser: !existingOnly } });
  if (error) throw new Error(/captcha/i.test(error.message) ? 'The security check failed. Please try again.' : /rate|seconds|too many/i.test(error.message) ? 'Please wait a minute before asking for another code.'
    : existingOnly && /signup|not allowed|not found/i.test(error.message) ? 'No account has this mobile number. Check the number, or ask the barangay office to set a temporary password for you.'
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

// "Forgot password?" by email: Supabase's own email sends a reset link that opens /reset-password (decided 2026-11-12:
// no outside email service). Supabase's free email only reaches a few addresses an hour, so the text code stays first.
async function emailResetLink(email: string, captchaToken: string) {
  const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/reset-password', captchaToken: captchaToken || undefined });
  if (error) throw new Error(/captcha/i.test(error.message) ? 'The security check failed. Please try again.'
    : /rate limit|too many|seconds/i.test(error.message) ? 'Too many reset emails were sent recently. Please try again later, or use a text code instead.'
    : /not authorized|cannot be used/i.test(error.message) ? 'We cannot send an email to this address right now. Please use a text code instead, or ask the barangay office to set a temporary password for you.'
    : /invalid/i.test(error.message) ? 'This email address cannot receive email. Check it, or use a text code instead.'
    : 'The email could not be sent: ' + error.message);
}

// "Forgot password?": after signing in with a text code, the new password is set on the server (app/api/account/password).
async function saveNewPassword(password: string) {
  const response = await fetch('/api/account/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The password was not changed. Please try again.');
}

const RESEND_SECONDS = 60;

export default function LoginPage(){
 const router=useRouter(),query=useSearchParams();const {act}=usePortal();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [mode,setMode]=useState<'password'|'sms'|'reset'>('password'),[mobile,setMobile]=useState(''),[phone,setPhone]=useState(''),[code,setCode]=useState(''),[wait,setWait]=useState(0);
 const [signedIn,setSignedIn]=useState<PortalState>(),[notice,setNotice]=useState('');   // "Forgot password?": signed in by code, new password still to set
 const [resetBy,setResetBy]=useState<'code'|'email'>('code'),[emailSent,setEmailSent]=useState('');
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
  try{setPhone(await sendCode(mobile,captchaToken,mode==='reset'));setCode('');setWait(RESEND_SECONDS);}catch(e){setError((e as Error).message);}finally{setBusy(false);setCaptchaReset(n=>n+1);}
 }
 async function submitCode(){
  setError('');setBusy(true);
  try{
   const user=await verifyCode(phone,code),s=act({type:'sessionUser',user});
   if(mode!=='reset')return finish(s);
   // Forgot password: an account with a real email now sets a new password; one without (walk-in, text-only) keeps signing in by code.
   if(placeholderEmail(user.email)){setNotice('You are signed in. Your account has no email to sign in with, so keep using "Text me a code" to sign in.');setTimeout(()=>finish(s),2500);return;}
   setSignedIn(s);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function submitNewPassword(f:FormData){
  setError('');const password=String(f.get('newPassword')),again=String(f.get('confirmPassword'));
  if(password!==again)return setError('The two passwords do not match.');
  setBusy(true);
  try{await saveNewPassword(password);setNotice('Your password was changed. Use it next time with your email.');setTimeout(()=>finish(signedIn!),2000);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const tab=(value:'password'|'sms',label:string)=><button type="button" role="tab" aria-selected={mode===value} className={`flex-1 py-2 text-xs font-semibold border-b-2 ${mode===value?'border-brand-primary text-brand-primary':'border-transparent text-slate-500'}`} onClick={()=>{setMode(value);setPhone('');setCode('');setError('');}}>{label}</button>;
 const startReset=()=>{setMode('reset');setResetBy('code');setEmailSent('');setPhone('');setCode('');setError('');setNotice('');};
 async function requestEmail(f:FormData){
  setError('');setBusy(true);const email=String(f.get('resetEmail'));
  try{await emailResetLink(email,captchaToken);setEmailSent(email.trim());}catch(e){setError((e as Error).message);}finally{setBusy(false);setCaptchaReset(n=>n+1);}
 }
 return <div className="min-h-screen bg-page-bg flex items-start justify-center pt-[60px] px-4"><div className="content-card w-full max-w-[325px] px-9 py-9">
 <div className="text-center"><h1 className="text-[25px] font-bold text-brand-ink">{mode==='reset'?'Reset Password':'Login'}</h1><p className="text-xs text-slate-600 mt-3">{mode==='reset'?'Sign in with a code sent to the mobile number on your account, then choose a new password.':'Access your Barangay San Jose account.'}</p></div>
 {useSupabaseAuth&&mode!=='reset'&&<div role="tablist" aria-label="How to sign in" className="flex mt-6">{tab('password','Email and password')}{tab('sms','Text me a code')}</div>}
 {notice?<p role="status" className="text-sm text-green-800 bg-green-50 border border-green-200 px-3 py-2 mt-6">{notice}</p>
 :mode==='reset'&&signedIn?<form onSubmit={e=>{e.preventDefault();void submitNewPassword(new FormData(e.currentTarget));}}>
  <p className="text-xs text-slate-600 mt-6">You are signed in. Choose a new password for {signedIn.users.find(u=>u.id===signedIn.currentUserId)?.email}.</p>
  <div className="mt-4 space-y-4"><Field label="New Password"><PasswordInput name="newPassword" autoComplete="new-password" required minLength={8} maxLength={72} placeholder="At least 8 characters"/></Field><Field label="Confirm New Password"><PasswordInput name="confirmPassword" autoComplete="new-password" required minLength={8} maxLength={72}/></Field></div>
  <ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy}>{busy?'Saving…':'Save New Password'}</button>
  <button type="button" className="text-xs underline text-slate-600 mt-4" onClick={()=>finish(signedIn)}>Skip for now</button>
 </form>
 :mode==='reset'&&resetBy==='email'?(emailSent?<p role="status" className="text-sm text-green-800 bg-green-50 border border-green-200 px-3 py-2 mt-6">If {emailSent} is on an account, we emailed it a reset link. Open it on this same phone or computer within an hour. Check your spam folder too.</p>
  :<form onSubmit={e=>{e.preventDefault();void requestEmail(new FormData(e.currentTarget));}}>
  <p className="text-xs text-slate-600 mt-6">Enter the email you sign in with. We will email you a link to choose a new password.</p>
  <div className="mt-4"><Field label="Email"><input name="resetEmail" type="email" autoComplete="email" required className="text-field" placeholder="you@example.com"/></Field></div>
  <Captcha onToken={setCaptchaToken} resetKey={captchaReset}/><ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy||needCheck}>{busy?'Sending…':'Email Me a Reset Link'}</button>
  <button type="button" className="text-xs underline text-brand-primary mt-4" onClick={()=>{setResetBy('code');setError('');}}>Text me a code instead</button>
 </form>)
 :mode==='password'?<form onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}>
  <div className="mt-6 space-y-4"><Field label="Email or Username"><input name="email" autoComplete="username" required className="text-field" placeholder="Enter your email or username"/></Field><Field label="Password"><PasswordInput name="password" autoComplete="current-password" required placeholder="Enter your password"/></Field></div>
  {useSupabaseAuth&&<p className="text-right mt-2"><button type="button" className="text-xs underline text-brand-primary" onClick={startReset}>Forgot password?</button></p>}
  <Captcha onToken={setCaptchaToken} resetKey={captchaReset}/><ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy||needCheck}>{busy?'Signing in…':'Login'}</button>
 </form>
 :!phone?<form onSubmit={e=>{e.preventDefault();void requestCode();}}>
  <p className="text-xs text-slate-600 mt-6">{mode==='reset'?'Enter the mobile number on your account. We will text it a 6-digit code. No mobile number on your account? Ask the barangay office to set a temporary password for you.':'We will text a 6-digit code to your mobile number. If this number is not registered yet, you can finish registering after signing in.'}</p>
  <div className="mt-4"><Field label="Mobile Number"><input type="tel" inputMode="tel" autoComplete="tel" required className="text-field" placeholder="09171234567" value={mobile} onChange={e=>setMobile(e.target.value)}/></Field></div>
  <Captcha onToken={setCaptchaToken} resetKey={captchaReset}/><ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy||needCheck}>{busy?'Sending the code…':'Send Code'}</button>
  {mode==='reset'&&<button type="button" className="text-xs underline text-brand-primary mt-4" onClick={()=>{setResetBy('email');setError('');}}>Email me a reset link instead</button>}
 </form>
 :<form onSubmit={e=>{e.preventDefault();void submitCode();}}>
  <p role="status" className="text-xs text-slate-600 mt-6">We sent a code to {mobileForms(phone)?.local}. It is valid for a few minutes.</p>
  <div className="mt-4"><Field label="6-digit Code"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="text-field tracking-[0.3em]" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></Field></div>
  <Captcha onToken={setCaptchaToken} resetKey={captchaReset}/><ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy||code.length!==6}>{busy?'Checking…':'Sign In'}</button>
  <div className="flex justify-between mt-4 text-xs"><button type="button" className="underline text-brand-primary disabled:text-slate-400 disabled:no-underline" disabled={busy||wait>0||needCheck} onClick={()=>void requestCode()}>{wait>0?`Send a new code in ${wait}s`:'Send a new code'}</button><button type="button" className="underline text-slate-600" onClick={()=>{setPhone('');setCode('');setError('');}}>Use another number</button></div>
 </form>}
 {mode==='reset'&&!signedIn&&!notice&&<button type="button" className="secondary-btn w-full mt-3" onClick={()=>{setMode('password');setPhone('');setCode('');setError('');}}>Back to Login</button>}
 <Link href="/" className="secondary-btn w-full mt-3 block text-center">Back to Home</Link><p className="text-xs text-center mt-8">Don&apos;t have an account? <Link href="/register" className="underline text-brand-primary">Register</Link></p><p className="text-xs text-center mt-4 text-slate-500"><Link href="/information#privacy" className="underline">Privacy Notice</Link></p>
 </div></div>;
}
