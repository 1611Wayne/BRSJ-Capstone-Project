'use client';
import { useState } from 'react';
import type { Application, UploadedDocument } from '@/types';
import { usePortal } from './PortalProvider';
import { Field, ErrorMessage } from './Field';
import { DocumentPreview } from './DocumentPreview';
import { dateLabel,today } from '@/lib/workflow';
import { formatPeso } from '@/data/revenueCodeData';

export function PaymentVerification({application:a}:{application:Application}) {
 const {user,act}=usePortal();
 const [error,setError]=useState(''),[preview,setPreview]=useState<UploadedDocument>();
 const [orNumber,setOrNumber]=useState(''),[orDate,setOrDate]=useState(''),[amountPaid,setAmountPaid]=useState('');
 const photo=a.receiptPhoto||a.receipt?.receiptPhoto;
 if(!a.paymentVerification)return null;
 return <div className="content-card p-6 mt-6">
  <h2 className="text-lg font-bold text-brand-ink">Payment Verification</h2>
  {a.status==='For Checking'&&<p role="status" className="text-sm mt-3">For Checking — Staff will verify your payment before releasing your clearance.</p>}
  {a.paymentVerification.status==='Needs Correction'&&<p role="status" className="text-sm text-red-700 mt-3">Correction needed: {a.paymentVerification.notes}. Please resubmit your payment evidence.</p>}
  {a.paymentVerification.checkedBy&&<p className="text-xs text-slate-500 mt-3">Checked by {a.paymentVerification.checkedBy} on {dateLabel(a.paymentVerification.checkedAt)}</p>}
  {photo&&<button type="button" className="secondary-btn mt-4" onClick={()=>setPreview(photo)}>View Receipt Photo</button>}
  {user?.role==='staff'&&a.status==='For Checking'&&<>
   <p className="text-sm mt-4">Assessed amount: <strong>{formatPeso(a.assessment?.total||0)}</strong></p>
   <form className="mt-4" onSubmit={e=>{e.preventDefault();try{act({type:'verifyPayment',reference:a.reference,orNumber:orNumber.trim(),orDate,amountPaid:amountPaid.trim()});setError('');}catch(e){setError((e as Error).message);}}}>
    {!a.simulatedPayment&&<Field label="Official Receipt (OR) Number *"><input className="text-field" required value={orNumber} onChange={e=>setOrNumber(e.target.value)} placeholder="Enter the OR number shown on the receipt"/><p className="text-xs text-slate-500 mt-2">Review the receipt photo and manually enter the OR number shown on it.</p></Field>}
    {!a.simulatedPayment&&!a.receipt&&<Field label="OR Date *"><input type="date" className="text-field" required max={today()} value={orDate} onChange={e=>setOrDate(e.target.value)}/><p className="text-xs text-slate-500 mt-2">The date printed on the receipt.</p></Field>}
    {!a.simulatedPayment&&!a.receipt&&<Field label="Amount Paid (PHP) *"><input type="number" min="0" step="0.01" className="text-field" required value={amountPaid} onChange={e=>setAmountPaid(e.target.value)} placeholder="Enter the amount printed on the receipt"/><p className="text-xs text-slate-500 mt-2">It must match the assessed amount. If the receipt shows a different amount, return the payment with a reason instead.</p></Field>}
    <button type="submit" className="primary-btn mt-4" disabled={!a.simulatedPayment&&(!orNumber.trim()||(!a.receipt&&(!orDate||!amountPaid.trim())))}>Verify Payment</button>
   </form>

  </>}
  <ErrorMessage message={error}/>
  {a.paymentVerification.orNumber&&<p className="text-sm mt-3">OR Number: <strong>{a.paymentVerification.orNumber}</strong></p>}
  {preview&&<DocumentPreview document={preview} onClose={()=>setPreview(undefined)}/>}
 </div>;
}
