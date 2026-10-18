'use client';
import Link from 'next/link'; import { useState } from 'react'; import { useRouter } from 'next/navigation';
import { FileUpload } from '@/components/FileUpload'; import { PasswordInput } from '@/components/PasswordInput'; import { Field, ErrorMessage } from '@/components/Field'; import { usePortal } from '@/components/PortalProvider'; import type { UploadedDocument, User } from '@/types';
import { transition } from '@/lib/workflow';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { registerWithSupabase } from '@/lib/supabase/register';
type Done = { kind: 'prototype' } | { kind: 'signed-in'; warnings: string[] } | { kind: 'confirm-email' };
export default function RegisterPage(){
 const {act}=usePortal();const router=useRouter();const [done,setDone]=useState<Done>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);const [id,setId]=useState<UploadedDocument>();
 async function submit(f:FormData){
  const get=(n:string)=>String(f.get(n)||'').trim();setError('');
  if(get('password')!==get('confirm')){setError('Passwords must match.');return;}
  const user:User={id:crypto.randomUUID(),firstName:get('first'),lastName:get('last'),address:get('address'),contact:get('contact'),email:get('email'),password:get('password'),role:'resident',status:'Active',createdAt:new Date().toISOString(),validId:id,privacyConsentAt:f.get('privacy')?new Date().toISOString():undefined};
  setBusy(true);
  try{
   if(!useSupabaseAuth){act({type:'register',user});setDone({kind:'prototype'});return;}
   // Same rules as the prototype (names, email, 8-character password, valid ID, consent), checked before anything is sent.
   transition({users:[],applications:[],schedules:[],audits:[],notifications:[],currentUserId:null},{type:'register',user});
   const result=await registerWithSupabase({firstName:user.firstName,lastName:user.lastName,address:user.address,contact:user.contact,email:user.email,password:user.password,validId:id!});
   if(result.status==='confirm-email'){setDone({kind:'confirm-email'});return;}
   act({type:'sessionUser',user:result.user});setDone({kind:'signed-in',warnings:result.warnings});
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 if(done)return <div className="min-h-screen grid place-items-center p-5"><div className="content-card p-8 text-center max-w-[460px]"><h1 className="text-2xl font-bold text-brand-ink">{done.kind==='confirm-email'?'Check Your Email':'Registration Complete'}</h1>
  {done.kind==='prototype'&&<><p className="text-sm mt-3">Your prototype account is ready for this browser session.</p><Link href="/login" className="primary-btn inline-block mt-6">Go to Login</Link></>}
  {done.kind==='confirm-email'&&<><p className="text-sm mt-3">We sent a confirmation link to your email. Open it, then log in. Your ID and address were not saved yet; please bring your ID to the barangay office.</p><Link href="/login" className="primary-btn inline-block mt-6">Go to Login</Link></>}
  {done.kind==='signed-in'&&<><p className="text-sm mt-3">Your account is ready and you are signed in.</p>{done.warnings.map(w=><p key={w} role="alert" className="text-xs mt-3 text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 text-left">{w}</p>)}<button type="button" className="primary-btn inline-block mt-6" onClick={()=>router.push('/resident/dashboard')}>Go to My Dashboard</button></>}
 </div></div>;
 return <div className="min-h-screen flex items-start justify-center py-5 px-4"><form className="content-card w-full max-w-[430px] px-9 py-8" onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}><div className="text-center"><h1 className="text-[25px] font-bold text-brand-ink">Resident Registration</h1><p className="text-xs mt-1">Create your account to access Barangay San Jose online services.</p></div><div className="grid grid-cols-2 gap-4 mt-8"><Field label="First Name *"><input name="first" required className="text-field" autoComplete="given-name"/></Field><Field label="Last Name *"><input name="last" required className="text-field" autoComplete="family-name"/></Field></div><div className="space-y-4 mt-4"><Field label="Full Address *"><input name="address" required className="text-field" autoComplete="street-address" placeholder="House No., Street, Subdivision"/></Field><div className="grid sm:grid-cols-2 gap-4"><Field label="Contact Number *"><input name="contact" type="tel" pattern="(09[0-9]{9}|\\+639[0-9]{9})" required className="text-field" placeholder="09123456789"/></Field><Field label="Email Address *"><input name="email" type="email" required className="text-field" autoComplete="email"/></Field></div><Field label="Password *"><PasswordInput name="password" minLength={8} required autoComplete="new-password"/></Field><Field label="Confirm Password *"><PasswordInput name="confirm" minLength={8} required autoComplete="new-password"/></Field><FileUpload label="Upload Valid ID" required idCard value={id} onChange={setId}/></div><label className="flex gap-2 mt-4 text-xs leading-4 text-slate-600"><input name="privacy" type="checkbox" required/>I have read and agree to the Privacy Notice regarding the processing of my personal information for barangay clearance services.</label><Link href="/information#privacy" className="text-xs underline mt-2 inline-block">Read Privacy Notice</Link><ErrorMessage message={error}/><div className="border-t mt-5 pt-3 flex justify-end gap-2"><Link href="/" className="secondary-btn">Cancel</Link><button className="primary-btn" disabled={busy}>{busy?'Creating your account…':'Register'}</button></div><p className="text-xs text-center mt-5">Already have an account? <Link href="/login" className="underline">Log in here</Link></p></form></div>;
}
