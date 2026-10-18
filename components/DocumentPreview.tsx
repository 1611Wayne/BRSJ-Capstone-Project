'use client';
import { useEffect, useState } from 'react';
import { Modal } from './Modal';import type { UploadedDocument } from '@/types';import { downloadBlob,makePDF } from '@/lib/downloads';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { supabaseBrowser } from '@/lib/supabase/browser';

// Shows a document. A file stored in the private bucket (it has a path) is opened through a short-lived signed link,
// which the bucket's rules give only to its owner, Staff and Admin. Prototype records keep the sample download.
export function DocumentPreview({document,onClose,bucket='application-documents'}:{document:UploadedDocument;onClose:()=>void;bucket?:string}) {
 const [signed,setSigned]=useState<string>(),[error,setError]=useState('');
 useEffect(()=>{
  if(document.url||!document.path||!useSupabaseAuth)return;
  let cancelled=false;
  supabaseBrowser().storage.from(bucket).createSignedUrl(document.path,300).then(({data,error})=>{if(cancelled)return;if(error||!data)setError('This file could not be opened: '+(error?.message||'no link'));else setSigned(data.signedUrl);});
  return()=>{cancelled=true;};
 },[document.url,document.path,bucket]);
 const url=document.url||signed;
 return <Modal title={document.requirement} onClose={onClose}><p className="text-sm my-4 break-all">{document.name}</p>
  {url?(document.type==='application/pdf'?<iframe title={document.requirement} src={url} className="w-full h-[400px] border"/>:<img src={url} alt={document.requirement} className="max-h-[400px] mx-auto object-contain"/>)
  :document.path&&useSupabaseAuth?<p role={error?'alert':'status'} className="text-sm border bg-slate-50 p-6">{error||'Opening the file…'}</p>
  :<div className="border bg-slate-50 p-6"><p className="text-sm">Only document metadata is retained in this session. Sample records contain no personal ID images.</p><button className="secondary-btn mt-4" onClick={()=>downloadBlob('sample-document.pdf',makePDF('Sample Supporting Document',[document.requirement,'File: '+document.name,'No real personal information or identity document is stored.']))}>Download sample document</button></div>}
  <button className="primary-btn mt-5" onClick={onClose}>Close</button></Modal>}
