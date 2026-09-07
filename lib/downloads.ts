import type { Application } from '@/types';
import { dateLabel } from './workflow';
import qrcode from 'qrcode-generator';
export function downloadBlob(name:string,blob:Blob){ const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000); }
export function exportCSV(name:string,headers:string[],rows:(string|number)[][]) {
 const cell=(value:string|number)=>{let text=String(value);if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
 downloadBlob(name+'.csv',new Blob(['\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
}
export function makePDF(title:string,lines:string[],verificationURL?:string):Blob {
 // A self-contained text PDF; standard Helvetica avoids downloaded fonts.
 const ascii=(text:string)=>text.normalize('NFKD').replace(/₱/g,'PHP ').replace(/[^\x20-\x7E]/g,' ').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
 const wrapped=lines.flatMap(line=>line.match(/.{1,83}(?:\s|$)|.{1,83}/g)||['']);
 const qrCommands:string[]=[];
 if(verificationURL){const qr=qrcode(0,'M');qr.addData(verificationURL);qr.make();const n=qr.getModuleCount(),cell=90/n;qrCommands.push('0 0 0 rg');for(let row=0;row<n;row++)for(let col=0;col<n;col++)if(qr.isDark(row,col))qrCommands.push(`${(450+col*cell).toFixed(3)} ${(80+(n-row-1)*cell).toFixed(3)} ${cell.toFixed(3)} ${cell.toFixed(3)} re f`);}
 const stream=['0.388 0.196 0.059 rg','BT /F1 18 Tf 50 780 Td ('+ascii('BARANGAY SAN JOSE')+') Tj','/F1 12 Tf 0 -25 Td ('+ascii(title)+') Tj','/F1 9 Tf 0 -25 Td (FRONTEND PROTOTYPE - SAMPLE ONLY - NOT AN OFFICIAL DOCUMENT) Tj',...wrapped.slice(0,30).map(line=>'0 -18 Td ('+ascii(line)+') Tj'),'ET',...qrCommands].join('\n');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];
 let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const start=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';
 return new Blob([pdf],{type:'application/pdf'});
}
export function applicationPDF(a:Application,kind:'assessment'|'clearance'){
 if(!a.assessment)throw new Error('Assessment is not available.');
 if(kind==='clearance'&&(!a.receipt||!a.clearance||!['Ready for Download','Closed - Cleared'].includes(a.status)))throw new Error('Clearance is not available.');
 const lines=['Rodriguez, Rizal', 'Reference No.: '+a.reference,'Clearance Type: '+a.clearanceType,'Applicant: '+a.applicant,'Application Type: '+a.applicationType];
 if(kind==='assessment')lines.push('Business Category: '+(a.assessment.category||'Not applicable'),'Classification / Scale: '+(a.assessment.classification||'Not applicable'),'',...a.assessment.items.map(i=>i.name+': PHP '+i.amount.toFixed(2)),'TOTAL: PHP '+a.assessment.total.toFixed(2),'Assessed By: '+a.assessment.assessedBy,'Assessed At: '+dateLabel(a.assessment.assessedAt),'','Present this sample Pre-Assessment Slip at the Municipal Treasury in the demo workflow.','The portal does not collect payments or issue Official Receipts.','All fee values are illustrative.');
 else lines.push('OR Number: '+a.receipt!.orNumber,'OR Date: '+a.receipt!.orDate,'Amount Paid: PHP '+a.receipt!.amountPaid.toFixed(2),'Issue Date: '+a.clearance!.issueDate,...(a.clearance!.revisedFrom?['REVISED - Original on '+a.clearance!.revisedFrom]:[]),'','This sample demonstrates fulfillment of a clearance request.','It is not a legally valid clearance and contains no official signature or seal.','','Verification: '+window.location.origin+'/verify/'+a.reference);
 downloadBlob(a.reference+'-'+kind+'.pdf',makePDF(kind==='assessment'?'Pre-Assessment Slip':a.clearanceType,lines,kind==='clearance'?window.location.origin+'/verify/'+a.reference:undefined));
}
