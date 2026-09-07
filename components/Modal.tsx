'use client';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({title,onClose,children,compact=false}:{title:string;onClose:()=>void;children:React.ReactNode;compact?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null); const id=useId();
  useEffect(()=>{ const dialog=ref.current; const previous=document.activeElement as HTMLElement; dialog?.showModal(); const old=document.body.style.overflow; document.body.style.overflow='hidden'; return()=>{dialog?.close();document.body.style.overflow=old;previous?.focus();}; },[]);
  return <dialog ref={ref} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}} className={`portal-modal ${compact?'max-w-[325px]':'max-w-[560px]'}`}><div className="relative p-6"><button aria-label="Close dialog" className="absolute right-3 top-3 p-1 text-slate-500" onClick={onClose}><X size={18}/></button><h2 id={id} className="text-xl font-bold text-brand-ink pr-5">{title}</h2>{children}</div></dialog>;
}
