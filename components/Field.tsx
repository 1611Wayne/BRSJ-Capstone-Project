import { isValidElement } from 'react';

export function Field({label,children,hint}:{label:string;children:React.ReactNode;hint?:string}) {
 const labelMarksRequired=label.trim().endsWith('*');
 const childMarksRequired=isValidElement<{required?:boolean}>(children)&&Boolean(children.props.required);
 const required=labelMarksRequired||childMarksRequired;
 const visibleLabel=labelMarksRequired?label.trim().slice(0,-1).trimEnd():label;
 return <label className="block"><span className="field-label">{visibleLabel}{required&&<span className="required-marker" aria-hidden="true"> *</span>}</span>{children}{hint&&<span className="block text-xs text-slate-500 mt-1">{hint}</span>}</label>;
}
export function ErrorMessage({message}:{message:string}) { return message ? <p role="alert" className="border border-red-200 bg-red-50 text-red-800 p-3 text-sm my-4">{message}</p> : null; }
export function Notice({children}:{children:React.ReactNode}) { return <p role="status" className="border border-brand-border bg-brand-soft text-brand-ink p-3 text-sm my-4">{children}</p>; }
