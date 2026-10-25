import type { Application, FeeSchedule } from '@/types';
import { dateLabel } from './workflow';
import qrcode from 'qrcode-generator';

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function exportCSV(name: string, headers: string[], rows: (string | number)[][]) {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  downloadBlob(name + '.csv', new Blob(['\uFEFF' + [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
}

// Fetch the barangay logo, draw it on a 100 × 100 pixel canvas with a white background,
// and return a base64 JPEG. Canvas size is fixed at 100 × 100 so /Width and /Height in the
// PDF image XObject always match the actual JPEG dimensions. Returns '' on any error.
async function fetchLogoJpeg(): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = '/barangaylogo.png';
    });
    const SIZE = 100; // fixed — always outputs a 100 × 100 px JPEG
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; // white background so JPEG has no transparency
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Keep the seal's aspect ratio; centre it in the square canvas.
    const ratio = Math.min(SIZE / (img.naturalWidth || SIZE), SIZE / (img.naturalHeight || SIZE));
    const dw = (img.naturalWidth || SIZE) * ratio;
    const dh = (img.naturalHeight || SIZE) * ratio;
    ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
    return canvas.toDataURL('image/jpeg', 0.92).replace(/^data:image\/jpeg;base64,/, '');
  } catch {
    return '';
  }
}

// Escape a string for use inside a PDF text-showing operator.
function esc(text: string) {
  return text
    .normalize('NFKD')
    .replace(/₱/g, 'PHP ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// The simple line-based PDF used by the clearance document. Unchanged from before.
export function makePDF(title: string, lines: string[], verificationURL?: string): Blob {
  // A self-contained text PDF; standard Helvetica avoids downloaded fonts.
  const ascii = (text: string) => text.normalize('NFKD').replace(/₱/g, 'PHP ').replace(/[^\x20-\x7E]/g, ' ').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const wrapped = lines.flatMap(line => line.match(/.{1,83}(?:\s|$)|.{1,83}/g) || ['']);
  const qrCommands: string[] = [];
  if (verificationURL) { const qr = qrcode(0, 'M'); qr.addData(verificationURL); qr.make(); const n = qr.getModuleCount(), cell = 90 / n; qrCommands.push('0 0 0 rg'); for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (qr.isDark(row, col)) qrCommands.push(`${(450 + col * cell).toFixed(3)} ${(80 + (n - row - 1) * cell).toFixed(3)} ${cell.toFixed(3)} ${cell.toFixed(3)} re f`); }
  const stream = ['0.388 0.196 0.059 rg', 'BT /F1 18 Tf 50 780 Td (' + ascii('BARANGAY SAN JOSE') + ') Tj', '/F1 12 Tf 0 -25 Td (' + ascii(title) + ') Tj', '/F1 9 Tf 0 -25 Td (FRONTEND PROTOTYPE - SAMPLE ONLY - NOT AN OFFICIAL DOCUMENT) Tj', ...wrapped.slice(0, 30).map(line => '0 -18 Td (' + ascii(line) + ') Tj'), 'ET', ...qrCommands].join('\n');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'];
  let pdf = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((o, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; }); const start = pdf.length; pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF';
  return new Blob([pdf], { type: 'application/pdf' });
}

// Build the Pre-Assessment Slip as a structured A4 PDF.
//
// Coordinate system: origin = bottom-left of the page (y=0 is bottom, y=842 is top).
//
// Fixed Y landmarks:
//   Logo      : lower-left (50, 782), 50 × 50 pt → top at 832, clear of page top (842)
//   Header    : four lines at y = 826, 815, 804, 790 (beside logo, centred in page width)
//   Rule 1    : y = 776  — 14 pt gap below lowest header text (790 baseline)
//   Title     : y = 762  — 11 pt gap below rule
//   Rule 2    : y = 750  — 6 pt gap below title baseline
//   Ref No.   : y = 736  — 12 pt gap below rule 2
//   cy starts at 706 (30 pt gap below reference, then steps down with each row)
//   Footer    : rule at y=48, text at y=36 and y=24
//
// Rules are always drawn AFTER subtracting enough space (cy -= 12 before hline)
// so they sit in the gap BELOW the last text, never crossing it.
//
// NOTE: the ordinance reference is read from the FeeSchedule object passed in by the caller,
// because the stored Assessment does not keep its own copy.  If the schedule is edited later,
// re-downloading an old slip would show the new ordinance text, not the one that was current
// at assessment time.  A future fix is to snapshot schedule.ordinance onto the Assessment itself.
function buildAssessmentSlip(a: Application, schedule: FeeSchedule | undefined, logoJpeg: string): Blob {
  const isBusiness = a.clearanceType === 'Business Clearance';
  const items     = (a.assessment?.items ?? []).filter(i => i.amount > 0);
  const total     = a.assessment?.total ?? 0;
  const ordinance = schedule?.ordinance?.trim() || '[Revenue ordinance reference not on file]';

  const hasLogo = logoJpeg.length > 0;
  const ops: string[] = [];

  // Draw a thin brand-brown horizontal line across the content width.
  // Only call this in a GAP between content blocks — never on top of text.
  function hline(y: number) {
    ops.push(`0.388 0.196 0.059 RG 0.4 w 50 ${y} m 545 ${y} l S 0 G`);
  }

  // Draw a small grey label above a bold brown value.
  // labelY is the value baseline; the label sits 11 pt above it.
  function lv(label: string, value: string, x: number, labelY: number) {
    ops.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg ${x} ${labelY + 11} Td (${esc(label)}) Tj ET`);
    ops.push(`BT /Fb 9 Tf 0.388 0.196 0.059 rg ${x} ${labelY} Td (${esc(value)}) Tj ET`);
  }

  // ── LOGO ────────────────────────────────────────────────────────────────────
  // cm matrix: [width 0 0 height x y]  → draws 50 × 50 pt image at (50, 782).
  // Canvas was fixed at 100 × 100 px so /Width /Height in the XObject = 100.
  // Logo top = 832, page top = 842 → 10 pt margin. Clear of all header text. ✓
  if (hasLogo) {
    ops.push('q 50 0 0 50 50 782 cm /Img1 Do Q');
  }

  // ── HEADER TEXT ─────────────────────────────────────────────────────────────
  // Logo occupies x = 50–100. Text is centred in the full 595 pt page width,
  // so the minimum x ≥ 110 keeps it clear of the logo horizontally.
  // Y values are fixed so the lowest line (y=790) is 14 pt above rule 1 (776).
  const hLines = [
    { t: 'REPUBLIKA NG PILIPINAS', sz: 8,  bold: false, y: 826 },
    { t: 'LALAWIGAN NG RIZAL',     sz: 8,  bold: false, y: 815 },
    { t: 'BAYAN NG RODRIGUEZ',     sz: 8,  bold: false, y: 804 },
    { t: 'BARANGAY SAN JOSE',      sz: 11, bold: true,  y: 790 },
  ];
  for (const h of hLines) {
    const font   = h.bold ? '/Fb' : '/F1';
    const approxW = h.t.length * h.sz * 0.55;
    const tx     = Math.max(297.5 - approxW / 2, 110);
    ops.push(`BT ${font} ${h.sz} Tf 0.388 0.196 0.059 rg ${tx.toFixed(1)} ${h.y} Td (${esc(h.t)}) Tj ET`);
  }

  // Rule 1: 14 pt below 'BARANGAY SAN JOSE' baseline (790). Clear below logo (782). ✓
  hline(776);

  // ── TITLE ───────────────────────────────────────────────────────────────────
  // 762 = 776 − 14 pt. Title top ≈ 762 + 14 = 776 → just touches rule, no gap needed.
  const titleApproxW = 'PRE-ASSESSMENT SLIP'.length * 14 * 0.55;
  const titleX = Math.max(50, 297.5 - titleApproxW / 2);
  ops.push(`BT /Fb 14 Tf 0.388 0.196 0.059 rg ${titleX.toFixed(1)} 762 Td (PRE-ASSESSMENT SLIP) Tj ET`);

  // Rule 2: 8 pt below title baseline (762). Rule at 750, well below text. ✓
  hline(750);

  // ── REFERENCE NUMBER ────────────────────────────────────────────────────────
  // 12 pt clear gap below rule 2 (750 − 14 = 736).
  ops.push(`BT /Fb 10 Tf 0.388 0.196 0.059 rg 50 736 Td (Reference No.: ${esc(a.reference)}) Tj ET`);

  // ── CONTENT BLOCKS (tracked by cy) ──────────────────────────────────────────
  // 30 pt gap below reference (736 − 30 = 706) to first applicant value baseline.
  let cy = 706;
  // ROW=22: label(11pt above)+value(9pt) plus gap. Must satisfy: gap-after-rule > label_top_above_baseline (11+8=19pt), so rule-post-gap=22pt keeps labels clear. ✓
  const ROW = 22; // step per label+value pair

  lv('APPLICANT NAME', a.applicant, 50, cy); cy -= ROW;
  lv('ADDRESS',        a.address,   50, cy); cy -= ROW;
  lv('CONTACT NUMBER', a.contact,   50, cy); cy -= ROW;

  // 12 pt below last value → rule → 22 pt gap. Label cap-height (≈19pt above rule) is then fully below the rule. ✓
  cy -= 12; hline(cy); cy -= 22;

  lv('CLEARANCE TYPE',   a.clearanceType,    50, cy); cy -= ROW;
  lv('PURPOSE',          a.purpose,          50, cy); cy -= ROW;
  lv('APPLICATION TYPE', a.applicationType,  50, cy); cy -= ROW;

  // Business block — shown only for Business Clearance.
  if (isBusiness) {
    lv('BUSINESS NAME',     a.businessName || '\u2014',     50, cy); cy -= ROW;
    lv('BUSINESS LOCATION', a.businessLocation || '\u2014', 50, cy); cy -= ROW;
    const operator = a.ownership === 'Owner' ? a.applicant : (a.propertyOwner || a.applicant);
    lv('OPERATOR / PROPERTY OWNER', operator, 50, cy); cy -= ROW;
    if (a.businessSubcategory) { lv('SUBCATEGORY', a.businessSubcategory, 50, cy); cy -= ROW; }
    if (a.assessment?.category) {
      const cat = a.assessment.category + (a.assessment.classification ? ' \u2013 ' + a.assessment.classification : '');
      lv('BUSINESS CATEGORY', cat, 50, cy); cy -= ROW;
    }
  }

  // Gap + rule between clearance/business block and assessment info.
  cy -= 12; hline(cy); cy -= 22;

  // DATE ASSESSED and ASSESSED BY side by side on one row.
  lv('DATE ASSESSED', dateLabel(a.assessment?.assessedAt), 50,  cy);
  lv('ASSESSED BY',   a.assessment?.assessedBy || '\u2014',   310, cy);
  cy -= ROW;

  // Gap + rule below assessment row.
  cy -= 12; hline(cy); cy -= 22;

  // ── FEE BREAKDOWN ───────────────────────────────────────────────────────────
  // Right-alignment: "PHP" prefix at fixed x=408; numeric string right-anchored at x=542.
  // Formula: numX = 542 - numStr.length * 5.5  (Helvetica 9pt ≈ 5.5pt per digit/char).
  // Decimal points line up because ".00" (3 chars) is always 16.5pt from the right edge.
  const PHP_X = 408;
  const RIGHT_EDGE = 542;
  const CW9 = 5.5; // approx char width at 9pt
  const CW8 = 4.9; // approx char width at 8pt
  function amtOps(numStr: string, y: number, bold: boolean) {
    const font = bold ? '/Fb' : '/F1';
    const sz   = bold ? 10 : 9;
    const cw   = bold ? 6.0 : CW9; // bold digits slightly wider
    ops.push(`BT ${font} ${sz} Tf 0.388 0.196 0.059 rg ${PHP_X} ${y} Td (PHP) Tj ET`);
    const numX = RIGHT_EDGE - numStr.length * cw;
    ops.push(`BT ${font} ${sz} Tf 0.388 0.196 0.059 rg ${numX.toFixed(1)} ${y} Td (${esc(numStr)}) Tj ET`);
  }

  ops.push(`BT /Fb 9 Tf 0.388 0.196 0.059 rg 50 ${cy} Td (FEE BREAKDOWN) Tj ET`);
  cy -= 15;

  // Column headers — "Amount" right-anchored at x=542 to sit above the numeric column.
  const amtHdrX = RIGHT_EDGE - 'Amount'.length * CW8;
  ops.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg 50 ${cy} Td (Description) Tj ET`);
  ops.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg ${amtHdrX.toFixed(1)} ${cy} Td (Amount) Tj ET`);
  cy -= 5; hline(cy); cy -= 14;

  // Fee rows — 14 pt step. 10 rows = 140 pt total.
  for (const item of items) {
    ops.push(`BT /F1 9 Tf 0.1 0.1 0.1 rg 50 ${cy} Td (${esc(item.name)}) Tj ET`);
    amtOps(item.amount.toFixed(2), cy, false);
    cy -= 14;
  }

  // Rule below last fee row, then total.
  cy -= 4; hline(cy); cy -= 14;

  // Total row — bold, right-aligned.
  ops.push(`BT /Fb 10 Tf 0.388 0.196 0.059 rg 50 ${cy} Td (TOTAL DUE) Tj ET`);
  amtOps(total.toFixed(2), cy, true);
  cy -= 8; hline(cy); cy -= 22; // 22pt gap so 'Revenue Code Reference:' label clears the rule

  // ── REVENUE CODE REFERENCE ───────────────────────────────────────────────────
  // The 22pt post-rule gap above means label cap (cy+11+8 = cy+19) is 3pt below the rule. ✓
  ops.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg 50 ${cy + 11} Td (Revenue Code Reference:) Tj ET`);
  ops.push(`BT /F1 9 Tf 0.1 0.1 0.1 rg 50 ${cy} Td (${esc(ordinance)}) Tj ET`);
  cy -= 28;

  // ── INSTRUCTION TEXT ────────────────────────────────────────────────────────
  // No QR on the assessment slip. Instructions follow directly after the ordinance line.
  // Three lines at 12pt step; each is full-width (no QR to avoid).
  const instrLines = [
    'Please proceed to the Municipal Treasury of Rodriguez, Rizal to pay',
    'the total above. After paying, upload a photo of your Official Receipt',
    '(OR) through the portal to continue your application.',
  ];
  let iy = cy;
  for (const line of instrLines) {
    ops.push(`BT /F1 8.5 Tf 0.388 0.196 0.059 rg 50 ${iy} Td (${esc(line)}) Tj ET`);
    iy -= 12;
  }

  // ── FOOTER ──────────────────────────────────────────────────────────────────
  hline(48);
  ops.push(`BT /Fb 8 Tf 0.388 0.196 0.059 rg 50 36 Td (Ipil Street, Barangay San Jose, Rodriguez, Rizal 1860) Tj ET`);
  ops.push(`BT /F1 8 Tf 0.388 0.196 0.059 rg 50 24 Td (Serbisyong Makatao, Barangay na Makabago.) Tj ET`);
  ops.push(`BT /F1 7 Tf 0.5 0.5 0.5 rg 340 36 Td (SAMPLE ONLY - NOT AN OFFICIAL DOCUMENT) Tj ET`);

  // ── ASSEMBLE RAW PDF ─────────────────────────────────────────────────────────
  const stream = ops.join('\n');
  const contentStreamObj = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  const imgResources = hasLogo ? ' /XObject << /Img1 7 0 R >>' : '';
  const pageObj = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /Fb 5 0 R >>${imgResources} >> /Contents 6 0 R >>`;

  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,           // obj 1
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,   // obj 2
    pageObj,                                         // obj 3
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,       // obj 4 — regular
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`,  // obj 5 — bold
    contentStreamObj,                                // obj 6
  ];

  if (hasLogo) {
    // Decode base64 JPEG to binary.  Canvas was 100 × 100 px → declare matching /Width /Height.
    const binaryStr = atob(logoJpeg);
    const jpegLen   = binaryStr.length;
    const imgObj    = `<< /Type /XObject /Subtype /Image /Width 100 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegLen} >>`;
    objects.push(imgObj + '\nstream\n'); // binary bytes spliced in below

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(pdf.length);
      // Last object (the image): write header only; binary content comes separately.
      pdf += (i + 1) + ' 0 obj\n' + objects[i] + (i < objects.length - 1 ? '\nendobj\n' : '');
    }
    const numObj   = objects.length;
    const logoBin  = binaryStr;
    const xrefStart = pdf.length + logoBin.length + '\nendstream\nendobj\n'.length;
    const xrefText  =
      `xref\n0 ${numObj + 1}\n0000000000 65535 f \n` +
      offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') +
      `trailer\n<< /Size ${numObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    // Binary-safe assembly: text part → raw JPEG bytes → text remainder.
    const enc     = new TextEncoder();
    const p1      = enc.encode(pdf);
    const p2      = Uint8Array.from(logoBin, c => c.charCodeAt(0));
    const p3      = enc.encode('\nendstream\nendobj\n' + xrefText);
    const merged  = new Uint8Array(p1.length + p2.length + p3.length);
    merged.set(p1, 0); merged.set(p2, p1.length); merged.set(p3, p1.length + p2.length);
    return new Blob([merged], { type: 'application/pdf' });
  }

  // No logo — pure text PDF.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xrefStart = pdf.length;
  const numObj    = objects.length;
  pdf +=
    `xref\n0 ${numObj + 1}\n0000000000 65535 f \n` +
    offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${numObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

// applicationPDF is async so it can fetch the logo from the browser.
// Callers must await it.
//
// kind='assessment' : Pre-Assessment Slip (what the applicant brings to the Treasury).
// kind='clearance'  : Final clearance document (layout unchanged from before).
//
// schedule is needed to show the ordinance reference on the assessment slip.
// The Application stores only scheduleId, not the full schedule, so the caller looks it up.
export async function applicationPDF(
  a: Application,
  kind: 'assessment' | 'clearance',
  schedule?: FeeSchedule
): Promise<void> {
  if (!a.assessment) throw new Error('Assessment is not available.');
  if (kind === 'clearance' && (!(a.receipt || a.receiptPhoto || a.simulatedPayment) || !a.clearance || !['Ready for Download', 'Closed - Cleared'].includes(a.status))) throw new Error('Clearance is not available.');

  if (kind === 'assessment') {
    const logoJpeg = await fetchLogoJpeg(); // '' on error → slip generated without logo
    const blob = buildAssessmentSlip(a, schedule, logoJpeg);
    downloadBlob(a.reference + '-assessment.pdf', blob);
  } else {
    // Clearance document — plain layout, unchanged.
    const lines = ['Rodriguez, Rizal', 'Reference No.: ' + a.reference, 'Clearance Type: ' + a.clearanceType, 'Applicant: ' + a.applicant, 'Application Type: ' + a.applicationType];
    if (a.businessSubcategory) lines.push('Business Subcategory: ' + a.businessSubcategory);
    if (a.simulatedPayment) { lines.push('Payment Method: ' + a.simulatedPayment.method + ' (Simulated)', 'Sim. Reference: ' + a.simulatedPayment.referenceNumber, 'Amount: PHP ' + a.simulatedPayment.amount.toFixed(2), 'SIMULATION \u2013 not an official Treasury payment'); }
    else if (a.receipt) { lines.push('OR Number: ' + a.receipt.orNumber, 'OR Date: ' + a.receipt.orDate, 'Amount Paid: PHP ' + a.receipt.amountPaid.toFixed(2)); }
    else { lines.push('OR Number: ' + (a.paymentVerification?.orNumber || ''), 'Payment: Receipt photo verified by Staff', 'Verified By: ' + a.paymentVerification?.checkedBy); }
    lines.push('Issue Date: ' + a.clearance!.issueDate, ...(a.clearance!.revisedFrom ? ['REVISED - Original on ' + a.clearance!.revisedFrom] : []), '', 'DIGITAL COPY: the stamped original is released at the monitoring office.', 'This sample demonstrates fulfillment of a clearance request.', 'It is not a legally valid clearance.', '', 'Verification: ' + window.location.origin + '/verify/' + a.reference);
    downloadBlob(a.reference + '-clearance.pdf', makePDF(a.clearanceType, lines, window.location.origin + '/verify/' + a.reference));
  }
}
