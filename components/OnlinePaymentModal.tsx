'use client';
import { useState } from 'react';
import { AlertTriangle, CreditCard, CheckCircle2, X } from 'lucide-react';
import { usePortal } from './PortalProvider';
import { Field, ErrorMessage } from './Field';
import { formatPeso } from '@/data/revenueCodeData';
import type { SimulatedPayment } from '@/types';

const PAYMENT_METHODS: SimulatedPayment['method'][] = ['GCash', 'Bank Transfer', 'Maya', 'Other'];

interface Props {
  reference: string;
  amount: number;
  onSuccess: (simRef: string, method: SimulatedPayment['method']) => void;
  onClose: () => void;
}

export function OnlinePaymentModal({ reference, amount, onSuccess, onClose }: Props) {
  const { act } = usePortal();
  const [method, setMethod] = useState<SimulatedPayment['method']>('GCash');
  const [step, setStep] = useState<'select' | 'confirm' | 'done'>('select');
  const [simRef, setSimRef] = useState('');
  const [error, setError] = useState('');

  function handlePay() {
    try {
      const next = act({ type: 'onlinePayment', reference, method, amount });
      const app = next.applications.find(a => a.reference === reference);
      const ref = app?.simulatedPayment?.referenceNumber || '';
      setSimRef(ref);
      setStep('done');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-label="Online Payment Simulation">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[420px] overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-900">SIMULATION MODE</p>
            <p className="text-xs text-amber-800 mt-0.5">This is a simulated payment. No real money is involved and no official Treasury receipt will be issued.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 shrink-0"><X size={18} /></button>
        </div>

        <div className="px-6 py-6">
          {step === 'select' && (
            <>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-lg bg-brand-soft grid place-items-center">
                  <CreditCard size={20} className="text-brand-primary" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-brand-ink">Online Payment (Simulated)</h2>
                  <p className="text-xs text-slate-500">{reference}</p>
                </div>
              </div>

              <p className="text-sm font-semibold text-brand-ink mb-1">Amount to Pay</p>
              <p className="text-2xl font-bold text-brand-primary mb-5">{formatPeso(amount)}</p>

              <Field label="Select Payment Method">
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {PAYMENT_METHODS.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`border rounded-md py-2 px-3 text-sm font-semibold transition-colors ${method === m ? 'border-brand-primary bg-brand-soft text-brand-primary' : 'border-slate-200 text-slate-700 hover:border-brand-primary'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Field>

              <ErrorMessage message={error} />

              <div className="flex gap-2 mt-6">
                <button type="button" className="secondary-btn flex-1" onClick={onClose}>Cancel</button>
                <button type="button" className="primary-btn flex-1" onClick={() => setStep('confirm')}>
                  Proceed with {method}
                </button>
              </div>
            </>
          )}

          {step === 'confirm' && (
            <>
              <h2 className="text-base font-bold text-brand-ink mb-4">Confirm Simulated Payment</h2>
              <dl className="space-y-3 text-sm border rounded-md p-4 bg-slate-50">
                <div><dt className="text-xs text-slate-500">Application Reference</dt><dd className="font-semibold mt-0.5">{reference}</dd></div>
                <div><dt className="text-xs text-slate-500">Payment Method</dt><dd className="font-semibold mt-0.5">{method}</dd></div>
                <div><dt className="text-xs text-slate-500">Amount</dt><dd className="font-semibold mt-0.5">{formatPeso(amount)}</dd></div>
              </dl>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mt-4">⚠️ Clicking "Confirm Payment" will mark this application as paid (simulation only). A system-generated reference number will be issued — this is NOT an official Treasury OR.</p>
              <ErrorMessage message={error} />
              <div className="flex gap-2 mt-5">
                <button type="button" className="secondary-btn flex-1" onClick={() => { setStep('select'); setError(''); }}>Back</button>
                <button type="button" className="primary-btn flex-1" onClick={handlePay}>Confirm Payment</button>
              </div>
            </>
          )}

          {step === 'done' && (
            <div className="text-center py-2">
              <div className="mx-auto w-14 h-14 rounded-full bg-green-50 grid place-items-center mb-4">
                <CheckCircle2 size={30} className="text-green-600" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-bold text-brand-ink">Payment Recorded</h2>
              <p className="text-xs text-slate-500 mt-1">Simulated {method} payment confirmed.</p>
              <div className="mt-5 bg-slate-50 border rounded-md p-4 text-left space-y-2">
                <div><p className="text-xs text-slate-500">Simulation Reference No.</p><p className="text-sm font-bold text-brand-primary mt-0.5">{simRef}</p></div>
                <div><p className="text-xs text-slate-500">Amount</p><p className="text-sm font-semibold mt-0.5">{formatPeso(amount)}</p></div>
                <div><p className="text-xs text-slate-500">Method</p><p className="text-sm font-semibold mt-0.5">{method}</p></div>
              </div>
              <p className="text-xs text-amber-700 mt-3">SIMULATION – not an official Treasury payment</p>
              <button type="button" className="primary-btn w-full mt-5" onClick={() => onSuccess(simRef, method)}>
                Continue to Clearance
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
