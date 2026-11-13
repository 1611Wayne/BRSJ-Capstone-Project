'use client';
import { InspectionForm } from './InspectionForm';
import { ApplicantAccountCheck } from './ApplicantAccountCheck';
import { useEffect, useState } from 'react';import { useRouter } from 'next/navigation';import Link from 'next/link';import { XCircle, CheckCircle2, FileText, Eye, LockKeyhole } from 'lucide-react';
import { usePortal } from './PortalProvider';import { Modal } from './Modal';import { Field,ErrorMessage,Notice } from './Field';import { FeeTable } from './FeeTable';import { StatusBadge } from './StatusBadge';import { DocumentPreview } from './DocumentPreview';import { ReplaceDocuments } from './ReplaceDocuments';import { revenueCategories } from '@/data/revenueCodeData';import { formatPeso } from '@/data/revenueCodeData';import { activeSchedule,requirements } from '@/lib/workflow';import type { UploadedDocument } from '@/types';
export function AssessmentPage({reference}:{reference:string}){
 const router=useRouter();const {state,user,act}=usePortal();const a=state.applications.find(a=>a.reference===reference);
 const [category,setCategory]=useState(a?.assessment?.category||(a?.businessSubcategory==='Ambulant'?'Ambulant / Mobile Vendor':a?.businessSubcategory==='Lessor (Paupahan)'?'Lessor':revenueCategories[0].name)),[classification,setClassification]=useState(a?.assessment?.classification||(a?.businessSubcategory==='Ambulant'?'':a?.businessSubcategory==='Lessor (Paupahan)'?revenueCategories.find(c=>c.name==='Lessor')!.classifications![0].name:'Small')),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState<UploadedDocument>();
 const [feeDraft,setFeeDraft]=useState<{scheduleId:string;amounts:string[]}>();
 const [docs,setDocs]=useState(a?.documents||[]);
 // Follow the shared data: records loaded from the database after this page opened, or reloaded after the server refused a change.
 useEffect(()=>{if(a)setDocs(a.documents);},[a?.documents]);
 // After Confirm Assessment: a short confirmation, then back to the dashboard by itself after 3 seconds.
 const [assessed,setAssessed]=useState<number|null>(null);
 useEffect(()=>{if(assessed===null)return;const t=setTimeout(()=>router.push('/staff/dashboard'),3000);return()=>clearTimeout(t);},[assessed,router]);
 // Reject state
 const [showReject,setShowReject]=useState(false),[rejectReason,setRejectReason]=useState(''),[rejectCategory,setRejectCategory]=useState<'standard'|'spam'>('standard');
 if(!a)return <div className="p-8">Application Not Found</div>;const business=a.clearanceType==='Business Clearance';const current=revenueCategories.find(c=>c.name===category)!;const schedule=activeSchedule(state.schedules,a.clearanceType,business?category:'',business?classification:'');const editable=a.status==='Pending Assessment'||(a.status==='Under Review'&&!a.receipt);
 const feeAmounts=schedule?(feeDraft?.scheduleId===schedule.id?feeDraft.amounts:a.assessment?.scheduleId===schedule.id?a.assessment.items.map(item=>item.amount.toFixed(2)):schedule.items.map(item=>item.amount.toFixed(2))):[];
 const validAmounts=feeAmounts.every(value=>/^\d+(\.\d{1,2})?$/.test(value)&&Number.isFinite(Number(value))&&Number.isSafeInteger(Math.round(Number(value)*100)));
 const feeTotal=feeAmounts.reduce((sum,value)=>sum+Math.round(Number(value||0)*100),0)/100;
 const inspectionPending=!!a.inspection?.scheduledAt&&a.inspection.status!=='Completed';
 const requiredDocs=requirements(a).filter(r=>r.required);
 const verifiedCount=requiredDocs.filter(r=>docs.some(d=>d.requirement===r.name&&d.status==='Verified')).length;
 const allVerified=verifiedCount===requiredDocs.length;
 const reviewItems=[...requiredDocs,...docs.filter(d=>!requiredDocs.some(r=>r.name===d.requirement)).map(d=>({name:d.requirement,required:false}))];
 function review(next:UploadedDocument[]){try{act({type:'review',reference,documents:next});setDocs(next);setError('');}catch(e){setError((e as Error).message);}}
 return <div className="p-5 md:p-8">
  <h1 className="text-[27px] font-bold text-brand-ink">{a.clearanceType} Assessment &amp; Evaluation</h1>
  <div className="flex gap-3 mt-3 items-center"><span className="text-sm">{reference}</span><StatusBadge status={a.status}/></div>
  <ErrorMessage message={error}/>{message&&<Notice>{message}</Notice>}
  {a.corrections?.some(c=>c.status==='Open')&&<Notice>The Applicant sent a correction request. <Link href={'/staff/applications/'+reference} className="underline font-semibold">Open the request</Link> and fix the entries before confirming the assessment.</Notice>}

  {/* Rejected banner */}
  {a.status==='Rejected'&&a.rejection&&<div className="mt-5 border border-red-200 bg-red-50 rounded-md p-4 flex gap-3"><XCircle size={20} className="text-red-600 shrink-0 mt-0.5"/><div><p className="font-semibold text-red-800 text-sm">Application Rejected</p><p className="text-xs text-red-700 mt-1">{a.rejection.reason}</p><p className="text-xs text-slate-500 mt-1">By {a.rejection.rejectedBy}. The request goes back to the Applicant. When they send a correction request, correct it on the <Link href={'/staff/applications/'+reference} className="underline">application details page</Link> and mark it resolved to reopen it.</p></div></div>}

  <div className="grid xl:grid-cols-[1.25fr_1fr] gap-6 mt-7">
   <div className="space-y-6">
    <div className="content-card p-6">
     <h2 className="font-bold text-brand-ink border-b pb-3">Application Summary</h2>
     <dl className="form-grid mt-5">{Object.entries({Applicant:a.applicant,...(business?{'Business Subcategory':a.businessSubcategory||'Business Clearance only'}:{}),'Business Name':business?a.businessName:'—','Business / Property Location':a.businessLocation,'Application Type':a.applicationType,'Ownership Type':a.ownership,'Property Owner':a.propertyOwner||'—',...(a.hasEmployees!==undefined?{'Employees':a.hasEmployees?(a.employeeCount!=null?`Yes (${a.employeeCount})`:'Yes'):'No'}:{})}).map(([k,v])=><div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-sm font-semibold mt-1">{v}</dd></div>)}</dl>
    </div>
    <div className="content-card p-6">
     {a.residentId&&<ApplicantAccountCheck residentId={a.residentId}/>}<div className="flex flex-wrap justify-between items-center gap-3"><h2 className="font-bold text-brand-ink">Requirements Review</h2><span className="text-xs font-semibold text-slate-600">{verifiedCount} of {requiredDocs.length} required documents verified</span></div>
     <div role="status" className={`mt-4 rounded-md border p-4 ${allVerified?'border-green-200 bg-green-50 text-green-800':'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <div className="flex items-start gap-3">{allVerified?<CheckCircle2 size={20} className="shrink-0"/>:<LockKeyhole size={20} className="shrink-0"/>}<div><p className="text-sm font-semibold">{allVerified?'Required documents verified':'Verification required before assessment'}</p><p className="text-xs mt-1 leading-5">{allVerified?'All required documents have been checked.':'Open each document, check its contents, then mark it Verified. Confirm Assessment stays disabled until every required document is verified.'}</p></div></div>
     </div>
     {editable&&<ReplaceDocuments application={a} onReplaced={setDocs}/>}
     <ul className="space-y-3 mt-5">{reviewItems.map(r=>{const d=docs.find(d=>d.requirement===r.name);const verified=d?.status==='Verified';return <li key={r.name} className={`rounded-md border p-4 ${verified?'border-green-200 bg-green-50/40':'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-3">{verified?<CheckCircle2 size={20} className="shrink-0 text-green-600 mt-1"/>:<FileText size={20} className="shrink-0 text-slate-500 mt-1"/>}<div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold text-brand-ink">{r.name}</h3><span className={`text-xs font-semibold ${verified?'text-green-700':!d||d.status==='Missing'||d.status==='Needs Replacement'?'text-red-700':'text-slate-600'}`}>{d?.status||'Missing'}</span></div><p className="text-xs text-slate-500 mt-1 break-all">{d?.name||'No document uploaded'} · {r.required?'Required':'Additional document'}</p>
       {d&&<div className="flex flex-wrap items-end gap-3 mt-4"><button type="button" className="secondary-btn flex items-center gap-2 !text-xs" onClick={()=>setPreview(d)}><Eye size={15}/>View Document</button>{editable&&<><button type="button" disabled={verified} className="primary-btn !text-xs" onClick={()=>review(docs.map(x=>x.requirement===r.name?{...x,status:'Verified'}:x))}>{verified?'Verified':'Mark Verified'}</button><Field label="Review status"><select aria-label={r.name+' review status'} className="select-field !text-xs" value={d.status} onChange={e=>review(docs.map(x=>x.requirement===r.name?{...x,status:e.target.value as UploadedDocument['status']}:x))}>{['Pending Review','Verified','Missing','Needs Replacement'].map(status=><option key={status}>{status}</option>)}</select></Field>{(d.status==='Missing'||d.status==='Needs Replacement')&&<Field label="Reason for the Applicant (optional)"><input key={d.status} aria-label={r.name+' reason'} className="text-field !text-xs" maxLength={200} defaultValue={d.note||''} placeholder="Example: The photo is too blurry to read." onBlur={e=>{if(e.target.value!==(d.note||''))review(docs.map(x=>x.requirement===r.name?{...x,note:e.target.value}:x));}}/></Field>}</>}</div>}
      </div></div>
     </li>})}</ul>
    </div>
    <InspectionForm application={a}/>
   </div>

   <div className="content-card p-6 h-fit">
    <h2 className="font-bold text-brand-ink border-b pb-3">Assessment Information</h2>
    {business&&<div className="space-y-4 mt-4">
     <Field label="Business Category *"><select disabled={!editable} className="select-field" value={category} onChange={e=>{setCategory(e.target.value);setClassification(revenueCategories.find(c=>c.name===e.target.value)?.classifications?.[0].name||'');}}>{revenueCategories.map(c=><option key={c.name}>{c.name}</option>)}</select><p className="text-xs text-slate-500 mt-2">Applicant indicated: {a.businessSubcategory||'Business Clearance only'}. Staff make the final selection.</p></Field>
     {current.classifications&&<Field label="Classification / Scale *"><select disabled={!editable} value={classification} className="select-field" onChange={e=>setClassification(e.target.value)}>{current.classifications.map(c=><option key={c.name}>{c.name}</option>)}</select></Field>}
    </div>}
    <div className="mt-6">{editable&&schedule?<div className="table-wrap"><table className="portal-table border border-slate-300"><thead><tr><th>Fee Component</th><th className="!text-right">Amount (PHP)</th></tr></thead><tbody>{schedule.items.map((item,index)=><tr key={index}><td>{item.name}</td><td><input type="number" inputMode="decimal" min="0" step="0.01" required aria-label={item.name+' amount'} className="text-field text-right" value={feeAmounts[index]} onChange={e=>setFeeDraft({scheduleId:schedule.id,amounts:feeAmounts.map((value,i)=>i===index?e.target.value:value)})}/></td></tr>)}<tr className="bg-slate-100"><td className="font-bold">Total Amount Due</td><td className="text-right font-bold" aria-live="polite">{validAmounts?formatPeso(feeTotal):'Enter valid amounts'}</td></tr></tbody></table></div>:<FeeTable items={a.assessment?.items||schedule?.items||[]}/>}</div>
    <p className="text-xs mt-4 text-slate-500">Amounts start from the effective fee schedule. Staff can adjust them for this application before confirming assessment.</p>
    <p className="text-sm mt-5">Assessed By: <strong>{a.assessment?.assessedBy||user?.firstName+' '+user?.lastName}</strong></p>

    <button aria-describedby="assessment-verification-hint" disabled={!editable||!schedule||!allVerified||!validAmounts||inspectionPending} className="primary-btn w-full mt-5" onClick={()=>{try{act({type:'assess',reference,category:business?category:'',classification:business?classification:'',amounts:feeAmounts.map(Number)});setError('');setAssessed(feeTotal);}catch(e){setError((e as Error).message);}}}>Confirm Assessment</button>

    {editable&&<p id="assessment-verification-hint" className="text-xs mt-3 text-slate-600">{!allVerified?'Verify all required documents above to enable Confirm Assessment.':inspectionPending?'Complete the scheduled inspection above before confirming assessment.':!schedule?'No fee schedule is available for this assessment.':'All required documents are verified. Assessment can be confirmed.'}</p>}

    {/* Reject Button */}
    {editable&&!showReject&&<button type="button" className="w-full mt-3 flex items-center justify-center gap-2 border border-red-300 text-red-700 hover:bg-red-50 transition-colors rounded px-4 py-2 text-sm font-semibold" onClick={()=>setShowReject(true)}><XCircle size={16}/>Reject Application</button>}

    {/* Inline rejection form */}
    {showReject&&<div className="mt-3 border border-red-200 bg-red-50 rounded-md p-4">
     <p className="text-sm font-semibold text-red-800 mb-2">Reject this application</p>
     <Field label="Rejection category"><select className="select-field mb-3" value={rejectCategory} onChange={e=>setRejectCategory(e.target.value as 'standard'|'spam')}><option value="standard">Documents or application details</option><option value="spam">Spam or abuse</option></select></Field>{rejectCategory==='spam'&&<p className="text-sm text-red-800 mb-3">Describe the spam or abuse clearly. This rejects this request only. Account flags are managed separately by Staff and Admin.</p>}<Field label="Reason for Rejection *"><textarea className="textarea-field min-h-[70px]" placeholder="State the reason clearly so the resident can address it." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/></Field>
     <div className="flex gap-2 mt-3">
      <button type="button" className="secondary-btn flex-1" onClick={()=>{setShowReject(false);setRejectReason('');setRejectCategory('standard');}}>Cancel</button>
      <button type="button" className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded px-4 py-2 text-sm font-semibold transition-colors" onClick={()=>{try{act({type:'reject',reference,reason:rejectReason,category:rejectCategory});setShowReject(false);setMessage('Application has been rejected.');setError('');}catch(e){setError((e as Error).message);}}}disabled={!rejectReason.trim()}>Confirm Rejection</button>
     </div>
    </div>}

    <Link href={'/staff/applications/'+reference} className="text-sm underline block mt-4">View transaction details</Link>
   </div>
  </div>
  {preview&&<DocumentPreview document={preview} reference={reference} onClose={()=>setPreview(undefined)}/>}
  {assessed!==null&&<Modal compact title="Application Assessed" onClose={()=>router.push('/staff/dashboard')}>
   <div role="status" className="text-center mt-4"><CheckCircle2 size={40} className="text-green-600 mx-auto" aria-hidden="true"/>
    <p className="text-sm mt-3"><strong>{reference}</strong> is assessed at <strong>{formatPeso(assessed)}</strong>. The Applicant is notified to pay at the Treasury.</p>
    <p className="text-xs text-slate-500 mt-3">Returning to the dashboard in 3 seconds…</p>
    <button type="button" className="primary-btn w-full mt-5" onClick={()=>router.push('/staff/dashboard')}>Go to Dashboard</button></div>
  </Modal>}
 </div>;
}
