'use client';
import { useEffect, useState } from 'react';
import { Modal } from './Modal';import type { UploadedDocument } from '@/types';import { downloadBlob,makePDF } from '@/lib/downloads';
import { useSupabaseAuth } from '@/lib/supabase/config';

// Shows a document through the authenticated signing route; prototype records keep the sample download.
export function DocumentPreview({document,onClose,reference,bucket='application-documents'}:{document:UploadedDocument;onClose:()=>void;reference:string;bucket?:'application-documents'|'receipt-photos'|'valid-ids'}) {
 const [signed,setSigned]=useState<string>(),[error,setError]=useState('');
 useEffect(()=>{
  if(document.url||!document.path||!useSupabaseAuth)return;
  let cancelled=false;
  fetch('/api/files/signed-url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bucket,path:document.path,reference})})
   .then(async response=>{const result=await response.json();if(!response.ok||!result.signedUrl)throw new Error(result.error||'no link');if(!cancelled)setSigned(result.signedUrl);})
   .catch(e=>{if(!cancelled)setError('This file could not be opened: '+(e as Error).message);});
  return()=>{cancelled=true;};
 },[document.url,document.path,bucket,reference]);
 const url=document.url||signed;
 return <Modal title={document.requirement} onClose={onClose}><p className="text-sm my-4 break-all">{document.name}</p>
  {url?(document.type==='application/pdf'?<iframe title={document.requirement} src={url} className="w-full h-[400px] border"/>:<img src={url} alt={document.requirement} className="max-h-[400px] mx-auto object-contain"/>)
  :document.path&&useSupabaseAuth?<p role={error?'alert':'status'} className="text-sm border bg-slate-50 p-6">{error||'Opening the file…'}</p>
  :<div className="border bg-slate-50 p-6"><p className="text-sm">Only document metadata is retained in this session. Sample records contain no personal ID images.</p><button className="secondary-btn mt-4" onClick={()=>downloadBlob('sample-document.pdf',makePDF('Sample Supporting Document',[document.requirement,'File: '+document.name,'No real personal information or identity document is stored.']))}>Download sample document</button></div>}
  <button className="primary-btn mt-5" onClick={onClose}>Close</button></Modal>}
