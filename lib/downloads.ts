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

// ─── Logo helpers ─────────────────────────────────────────────────────────────

// Fetch the barangay logo as a 100 × 100 px JPEG for the page header.
// Canvas size is fixed so /Width /Height in the PDF XObject always match.
async function fetchLogoJpeg(): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = '/barangaylogo.png';
    });
    const SIZE = 100;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, SIZE, SIZE);
    const ratio = Math.min(SIZE / (img.naturalWidth || SIZE), SIZE / (img.naturalHeight || SIZE));
    const dw = (img.naturalWidth || SIZE) * ratio, dh = (img.naturalHeight || SIZE) * ratio;
    ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
    return canvas.toDataURL('image/jpeg', 0.92).replace(/^data:image\/jpeg;base64,/, '');
  } catch { return ''; }
}

// Fetch the barangay logo as a 280 × 280 px JPEG, pre-blended with a white
// overlay so it looks like a faint watermark when drawn large on the page.
async function fetchSealJpeg(): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = '/barangaylogo.png';
    });
    const SIZE = 280;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, SIZE, SIZE);
    const ratio = Math.min(SIZE / (img.naturalWidth || SIZE), SIZE / (img.naturalHeight || SIZE));
    const dw = (img.naturalWidth || SIZE) * ratio, dh = (img.naturalHeight || SIZE) * ratio;
    ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
    // 85% white overlay → seal is faint enough that text on top stays crisp in B&W print
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(0, 0, SIZE, SIZE);
    return canvas.toDataURL('image/jpeg', 0.92).replace(/^data:image\/jpeg;base64,/, '');
  } catch { return ''; }
}

// ─── PDF escape helper ────────────────────────────────────────────────────────

function esc(text: string) {
  return text
    .normalize('NFKD')
    .replace(/₱/g, 'PHP ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// ─── Simple clearance PDF (text-only) kept for test imports ──────────────────
export function makePDF(title: string, lines: string[], verificationURL?: string): Blob {
  const ascii = (text: string) => text.normalize('NFKD').replace(/₱/g, 'PHP ').replace(/[^\x20-\x7E]/g, ' ').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const wrapped = lines.flatMap(line => line.match(/.{1,83}(?:\s|$)|.{1,83}/g) || ['']);
  const qrCmds: string[] = [];
  if (verificationURL) { const qr = qrcode(0, 'M'); qr.addData(verificationURL); qr.make(); const n = qr.getModuleCount(), c = 90 / n; qrCmds.push('0 0 0 rg'); for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) qrCmds.push(`${(450 + col * c).toFixed(3)} ${(80 + (n - r - 1) * c).toFixed(3)} ${c.toFixed(3)} ${c.toFixed(3)} re f`); }
  const stream = ['0.388 0.196 0.059 rg', 'BT /F1 18 Tf 50 780 Td (' + ascii('BARANGAY SAN JOSE') + ') Tj', '/F1 12 Tf 0 -25 Td (' + ascii(title) + ') Tj', '/F1 9 Tf 0 -25 Td (FRONTEND PROTOTYPE - SAMPLE ONLY - NOT AN OFFICIAL DOCUMENT) Tj', ...wrapped.slice(0, 30).map(line => '0 -18 Td (' + ascii(line) + ') Tj'), 'ET', ...qrCmds].join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'];
  let pdf = '%PDF-1.4\n'; const offs = [0]; objs.forEach((o, i) => { offs.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; }); const s = pdf.length; pdf += 'xref\n0 6\n0000000000 65535 f \n' + offs.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + s + '\n%%EOF';
  return new Blob([pdf], { type: 'application/pdf' });
}

// ─── Multi-image PDF assembler ────────────────────────────────────────────────
// Builds a one-page PDF with up to N inline JPEG image XObjects.
// images[i] becomes /ImgN in the content stream (1-indexed).
function assemblePDF(
  streamText: string,
  images: Array<{ data: Uint8Array; w: number; h: number }>,
): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const push = (s: string) => chunks.push(enc.encode(s));
  const len = () => chunks.reduce((a, c) => a + c.length, 0);

  push('%PDF-1.4\n');
  const o1 = len(); push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  const o2 = len(); push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
  const o3 = len();
  const imgDictEntries = images.map((_, i) => `/Img${i + 1} ${7 + i} 0 R`).join(' ');
  const xobj = images.length ? ` /XObject << ${imgDictEntries} >>` : '';
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /Fb 5 0 R >>${xobj} >> /Contents 6 0 R >>\nendobj\n`);
  const o4 = len(); push(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  const o5 = len(); push(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`);
  const streamBytes = enc.encode(streamText);
  const o6 = len(); push(`6 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
  chunks.push(streamBytes); push('\nendstream\nendobj\n');

  const imgStarts: number[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    imgStarts.push(len());
    push(`${7 + i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`);
    chunks.push(img.data);
    push('\nendstream\nendobj\n');
  }

  const xrefStart = len();
  const total = 6 + images.length;
  const starts = [0, o1, o2, o3, o4, o5, o6, ...imgStarts];
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) xref += String(starts[i]).padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  push(xref);

  const out = new Uint8Array(len());
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new Blob([out], { type: 'application/pdf' });
}

// ─── Clearance PDF config ─────────────────────────────────────────────────────

// Signatory names and titles. Update here whenever personnel changes.
const OFFICIALS = {
  punong:    { name: 'HON. GLENN S. EVANGELISTA', title: 'Punong Barangay' },
  secretary: { name: 'MINERVA D. QUITA',          title: 'Barangay Secretary' },
  monitoring:{ name: 'MR. JOSEPH C. PATRICIO',    title: 'Head, Monitoring Dept.' },
};

// Validity lines per clearance category.
// SOURCE: sample clearance photos provided by project team.
// NOT YET CONFIRMED by Barangay San Jose — verify before go-live.
const VALIDITY = {
  business: (year: number) =>
    `This clearance is valid until December 31, ${year} and not valid without official seal.`,
  default: () =>
    `This clearance is valid for Forty-five (45) days from the date of issue and not valid without official seal.`,
};

// Format day number with ordinal suffix, e.g. 1 -> "1st", 11 -> "11th", 22 -> "22nd".
function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

// Parse a YYYY-MM-DD date string and format it as used in clearances.
function parseClearanceDate(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const MONTHS = ['', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  return { year, month, day, monthName: MONTHS[month] ?? '' };
}

// ─── Clearance PDF builder ────────────────────────────────────────────────────
// Single Barangay Clearance layout for all nine clearance types.
// Business Clearance adds three extra rows (Business Name, Location, Operator).
function buildClearancePDF(
  a: Application,
  schedule: FeeSchedule | undefined,
  headerLogoJpeg: string,
  sealJpeg: string,
): Blob {
  const isBusiness = a.clearanceType === 'Business Clearance';
  const clearance = a.clearance!;
  const { year, day, monthName } = parseClearanceDate(clearance.issueDate);
  const ordinance = schedule?.ordinance?.trim() || 'applicable Barangay Revenue Codes and Ordinances';
  const amtPaid = a.receipt?.amountPaid ?? a.simulatedPayment?.amount ?? 0;
  const orNo = a.receipt?.orNumber ?? a.paymentVerification?.orNumber ?? '';
  const orDate = a.receipt?.orDate ?? '';
  const verURL = window.location.origin + '/verify/' + a.reference;
  const operator = a.ownership === 'Owner' ? a.applicant : (a.propertyOwner || a.applicant);
  const isRevised = !!clearance.revisedFrom;
  const docTitle = isBusiness ? 'BARANGAY CLEARANCE FOR BUSINESS PERMIT' : a.clearanceType.toUpperCase();
  // 'an' before vowel-initial type names (Electrical, Excavation); 'a' before all others.
  const article = /^[aeiou]/i.test(a.clearanceType) ? 'an' : 'a';

  // Ordered image assets: seal first (background), header logo second.
  const hasSeal = sealJpeg.length > 0;
  const hasLogo = headerLogoJpeg.length > 0;
  const imgAssets: Array<{ data: Uint8Array; w: number; h: number }> = [];
  let sealName = '', logoName = '';
  if (hasSeal) { imgAssets.push({ data: Uint8Array.from(atob(sealJpeg), c => c.charCodeAt(0)), w: 280, h: 280 }); sealName = `Img${imgAssets.length}`; }
  if (hasLogo) { imgAssets.push({ data: Uint8Array.from(atob(headerLogoJpeg), c => c.charCodeAt(0)), w: 100, h: 100 }); logoName = `Img${imgAssets.length}`; }

  const ops: string[] = [];

  // Helper: brown horizontal rule across content margin (x=50 to x=545).
  function hline(y: number) {
    ops.push(`0.388 0.196 0.059 RG 0.4 w 50 ${y} m 545 ${y} l S 0 G`);
  }
  // Helper: thin dark line for form blanks.
  function blank(x1: number, y: number, x2: number) {
    ops.push(`0.3 G 0.5 w ${x1} ${y} m ${x2} ${y} l S 0 G`);
  }

  // ── 1. SEAL WATERMARK ───────────────────────────────────────────────────────
  // Drawn first (bottom layer). Its canvas has a solid white background so it is opaque.
  // 200 × 200 pt, centred on page (297.5, 421).
  if (hasSeal) ops.push(`q 200 0 0 200 197.5 321 cm /${sealName} Do Q`);

  // ── 2. REVISED DIAGONAL WATERMARK (above seal, behind all other content) ───
  // Seal is drawn first so it does not cover the REVISED text.
  // 90 pt bold, rotated 45° around page centre, grey 0.87 (≈ seal lightness).
  // Only on revised clearances; non-revised clearances skip this block.
  if (isRevised) {
    // Width ≈ 7 chars × 90pt × 0.55 = 347pt → centre offset −173.
    // Cap-height ≈ 63pt → vertical centre offset −32.
    ops.push('q 0.7071 0.7071 -0.7071 0.7071 297.5 421 cm');
    ops.push('0.87 0.87 0.87 rg');
    ops.push(`BT /Fb 90 Tf -173 -32 Td (REVISED) Tj ET`);
    ops.push('Q');
  }

  // ── 3. HEADER LOGO ──────────────────────────────────────────────────────────
  if (hasLogo) ops.push(`q 50 0 0 50 50 782 cm /${logoName} Do Q`);

  // ── 4. HEADER TEXT (centred, beside logo) ───────────────────────────────────
  const hLines = [
    { t: 'REPUBLIKA NG PILIPINAS', sz: 8,  bold: false, y: 826 },
    { t: 'LALAWIGAN NG RIZAL',     sz: 8,  bold: false, y: 815 },
    { t: 'BAYAN NG RODRIGUEZ',     sz: 8,  bold: false, y: 804 },
    { t: 'BARANGAY SAN JOSE',      sz: 11, bold: true,  y: 790 },
  ];
  for (const h of hLines) {
    const font = h.bold ? '/Fb' : '/F1';
    const tx = Math.max(297.5 - h.t.length * h.sz * 0.55 / 2, 110);
    ops.push(`BT ${font} ${h.sz} Tf 0.388 0.196 0.059 rg ${tx.toFixed(1)} ${h.y} Td (${esc(h.t)}) Tj ET`);
  }

  hline(776);

  // ── 5. DOCUMENT TITLE ───────────────────────────────────────────────────────
  const titleX = Math.max(50, 297.5 - docTitle.length * 12 * 0.55 / 2);
  ops.push(`BT /Fb 12 Tf 0.388 0.196 0.059 rg ${titleX.toFixed(1)} 762 Td (${esc(docTitle)}) Tj ET`);

  hline(750);

  // ── 6. REFERENCE NUMBER ─────────────────────────────────────────────────────
  ops.push(`BT /F1 9 Tf 0.4 0.4 0.4 rg 50 736 Td (Reference No.:) Tj ET`);
  ops.push(`BT /Fb 9 Tf 0.388 0.196 0.059 rg 135 736 Td (${esc(a.reference)}) Tj ET`);

  // ── 7. QR CODE (top-right, 55 × 55 pt) ─────────────────────────────────────
  const qr = qrcode(0, 'M');
  qr.addData(verURL); qr.make();
  const qn = qr.getModuleCount(), qCell = 55 / qn;
  const qrLeft = 480, qrBot = 677; // bottom-left corner of QR block
  ops.push('0 0 0 rg');
  for (let row = 0; row < qn; row++)
    for (let col = 0; col < qn; col++)
      if (qr.isDark(row, col))
        ops.push(`${(qrLeft + col * qCell).toFixed(2)} ${(qrBot + (qn - row - 1) * qCell).toFixed(2)} ${qCell.toFixed(2)} ${qCell.toFixed(2)} re f`);
  ops.push(`BT /F1 7 Tf 0.5 0.5 0.5 rg ${qrLeft} ${(qrBot - 9).toFixed(1)} Td (Scan to verify) Tj ET`);

  // ── 8. "TO WHOM IT MAY CONCERN" + INTRO ────────────────────────────────────
  ops.push(`BT /Fb 9 Tf 0.2 0.2 0.2 rg 50 720 Td (To Whom It May Concern:) Tj ET`);

  const introLines = [
    `  This is to certify that the person whose name and thumb mark appears here on has`,
    `  requested ${article} ${esc(a.clearanceType)} from this office and the information`,
    `  are listed below;`,
  ];
  let iy = 706;
  for (const line of introLines) {
    ops.push(`BT /F1 9 Tf 0.2 0.2 0.2 rg 50 ${iy} Td (${line}) Tj ET`);
    iy -= 14;
  }

  // ── 9. FIELDS TABLE ─────────────────────────────────────────────────────────
  // Label at x=87, colon at x=193, value at x=200.
  function field(label: string, value: string, y: number) {
    ops.push(`BT /F1 9 Tf 0.4 0.4 0.4 rg 87 ${y} Td (${esc(label)}) Tj ET`);
    ops.push(`BT /F1 9 Tf 0.4 0.4 0.4 rg 193 ${y} Td (:) Tj ET`);
    ops.push(`BT /Fb 9 Tf 0.12 0.12 0.12 rg 200 ${y} Td (${esc(value)}) Tj ET`);
  }

  let cy = 656;
  const FR = 20; // row height for field rows

  field('Name',               a.applicant, cy); cy -= FR;
  field('Residential Address', a.address,  cy); cy -= FR;
  field('Location',           'Same as above', cy); cy -= FR;
  field('Remarks',            'N/A',       cy); cy -= FR;
  field('Purpose',            a.purpose,   cy); cy -= FR;

  if (isBusiness) {
    field('Business Name',     a.businessName || '-',     cy); cy -= FR;
    field('Business Location', a.businessLocation || '-', cy); cy -= FR;
    field('Operator',          operator,                  cy); cy -= FR;
  }

  // ── 10. ORDINANCE LINE ──────────────────────────────────────────────────────
  cy -= 8;
  ops.push(`BT /F1 9 Tf 0.2 0.2 0.2 rg 75 ${cy} Td (  This clearance is being issued pursuant to Barangay Revenue Code) Tj ET`);
  cy -= 14;
  ops.push(`BT /F1 9 Tf 0.2 0.2 0.2 rg 75 ${cy} Td (  ${esc(ordinance)}.) Tj ET`);
  cy -= 22;

  // ── 11. ISSUED DATE ─────────────────────────────────────────────────────────
  ops.push(`BT /F1 9 Tf 0.2 0.2 0.2 rg 75 ${cy} Td (  Issued this ${ordinal(day)} day of ${monthName} ${year} at the office of the Punong Barangay,) Tj ET`);
  cy -= 14;
  ops.push(`BT /F1 9 Tf 0.2 0.2 0.2 rg 75 ${cy} Td (  Barangay San Jose, Rodriguez, Rizal.) Tj ET`);
  cy -= 20;

  // Light rule separating body from payment block.
  ops.push(`0.6 G 0.4 w 50 ${cy} m 545 ${cy} l S 0 G`);
  cy -= 16;

  // ── 12. CTC / PAYMENT BLOCK (left) + THUMB MARK BOX (right) ─────────────
  // Left column: CTC, Issued at/on, Amount, OR No.
  const blockTop = cy;
  const lx = 87; // label start x
  const ex = 170; // value / blank-line start x
  const blankEnd = 260;

  function payRow(label: string, vy: number, valueText: string | null) {
    ops.push(`BT /F1 9 Tf 0.4 0.4 0.4 rg ${lx} ${vy} Td (${esc(label)}) Tj ET`);
    if (valueText !== null) {
      ops.push(`BT /Fb 9 Tf 0.12 0.12 0.12 rg ${ex} ${vy} Td (${esc(valueText)}) Tj ET`);
    } else {
      blank(ex, vy - 2, blankEnd); // underline for handwriting
    }
  }

  payRow('CTC No.:',   cy,      null);      cy -= 16;
  payRow('Issued at:', cy,      null);      cy -= 16;
  payRow('Issued On:', cy,      null);      cy -= 16;
  payRow('Amount:',    cy,      `PHP ${amtPaid.toFixed(2)}`); cy -= 16;
  payRow('OR No.:',    cy,      orNo || '-'); cy -= 16;
  payRow('OR Date:',   cy,      orDate || '-'); cy -= 8;

  // Thumb mark box at right side, spanning the height of the payment block.
  const boxL = 350, boxR = 475;
  const boxTop = blockTop + 6, boxBot = cy - 4;
  ops.push(`0.4 G 0.6 w ${boxL} ${boxBot} m ${boxL} ${boxTop} l ${boxR} ${boxTop} l ${boxR} ${boxBot} l ${boxL} ${boxBot} l S 0 G`);
  ops.push(`BT /F1 8 Tf 0.4 0.4 0.4 rg ${boxL + 18} ${boxTop - 14} Td (Thumb mark) Tj ET`);

  // 30 pt clear space for the applicant's handwritten signature, then a thin line.
  cy -= 30;
  blank(50, cy, 320);
  cy -= 12; // 12 pt gap: 9 pt cap-height sits 5 pt below the line
  ops.push(`BT /Fb 9 Tf 0.2 0.2 0.2 rg 52 ${cy} Td (Signature over printed name of applicant) Tj ET`);
  cy -= 22;

  // ── 12. LIGHT SEPARATOR ─────────────────────────────────────────────────────
  ops.push(`0.6 G 0.4 w 50 ${cy} m 545 ${cy} l S 0 G`);
  cy -= 16;

  // ── 13. SIGNATURE BLOCK ──────────────────────────────────────────────────────
  // 'Issued by:' sits above the signature space, then 30 pt clear for handwriting,
  // then a thin line, then name and title. Punong mirrors the Secretary layout.
  ops.push(`BT /F1 9 Tf 0.4 0.4 0.4 rg 50 ${cy} Td (Issued by:) Tj ET`);
  cy -= 30; // 30 pt space for Secretary and Punong handwritten signatures
  blank(50, cy, 240);  // Secretary signature line
  blank(310, cy, 490); // Punong signature line
  cy -= 12; // 12 pt gap between signature line and printed name
  // Both names at the same Y — Punong uses the same font size (9 pt) as Secretary.
  ops.push(`BT /Fb 9 Tf 0.12 0.12 0.12 rg 50 ${cy} Td (${esc(OFFICIALS.secretary.name)}) Tj ET`);
  ops.push(`BT /Fb 9 Tf 0.12 0.12 0.12 rg 310 ${cy} Td (${esc(OFFICIALS.punong.name)}) Tj ET`);
  cy -= 13;
  // Titles directly below names on both sides.
  ops.push(`BT /F1 9 Tf 0.4 0.4 0.4 rg 50 ${cy} Td (${esc(OFFICIALS.secretary.title)}) Tj ET`);
  ops.push(`BT /F1 9 Tf 0.4 0.4 0.4 rg 310 ${cy} Td (${esc(OFFICIALS.punong.title)}) Tj ET`);
  cy -= 30; // 30 pt space for Monitoring signatory's handwritten signature

  // Monitoring signatory (below, left side).
  blank(50, cy, 280); // Monitoring signature line
  cy -= 12; // 12 pt gap between signature line and printed name
  ops.push(`BT /Fb 9 Tf 0.12 0.12 0.12 rg 50 ${cy} Td (${esc(OFFICIALS.monitoring.name)}) Tj ET`); cy -= 13;
  ops.push(`BT /F1 9 Tf 0.4 0.4 0.4 rg 50 ${cy} Td (${esc(OFFICIALS.monitoring.title)}) Tj ET`); cy -= 20;

  // ── 15. VALIDITY LINE (+ revised-copy notice immediately above it) ──────────
  // Non-revised clearances skip the if block entirely — their layout is unchanged.
  if (isRevised) {
    ops.push(`BT /Fb 9 Tf 0.2 0.2 0.2 rg 50 ${cy} Td (REVISED COPY - Original issued on ${esc(clearance.revisedFrom!)}) Tj ET`);
    cy -= 14;
  }
  const validityText = isBusiness ? VALIDITY.business(year) : VALIDITY.default();
  // Split at ~88 chars so it fits in 9pt Helvetica at full page width.
  const midPoint = validityText.indexOf(' ', 70);
  if (midPoint > 0 && validityText.length > 88) {
    ops.push(`BT /F1 8 Tf 0.2 0.2 0.2 rg 50 ${cy} Td (${esc(validityText.slice(0, midPoint))}) Tj ET`); cy -= 11;
    ops.push(`BT /F1 8 Tf 0.2 0.2 0.2 rg 50 ${cy} Td (${esc(validityText.slice(midPoint + 1))}) Tj ET`); cy -= 16;
  } else {
    ops.push(`BT /F1 8 Tf 0.2 0.2 0.2 rg 50 ${cy} Td (${esc(validityText)}) Tj ET`); cy -= 16;
  }

  // ── 16. FOOTER ──────────────────────────────────────────────────────────────
  hline(48);
  ops.push(`BT /Fb 8 Tf 0.388 0.196 0.059 rg 50 36 Td (Ipil Street, Barangay San Jose, Rodriguez, Rizal 1860) Tj ET`);
  ops.push(`BT /F1 8 Tf 0.388 0.196 0.059 rg 50 24 Td (Serbisyong Makatao, Barangay na Makabago.) Tj ET`);
  ops.push(`BT /F1 7 Tf 0.5 0.5 0.5 rg 340 36 Td (SAMPLE ONLY - NOT AN OFFICIAL DOCUMENT) Tj ET`);

  return assemblePDF(ops.join('\n'), imgAssets);
}

// ─── Assessment Slip ──────────────────────────────────────────────────────────
// Canvas fixed at 100 × 100 px so /Width /Height always match.
async function fetchLogoJpegSlip(): Promise<string> { return fetchLogoJpeg(); }

// Build the Pre-Assessment Slip as a structured A4 PDF.
//
// Fixed Y landmarks (PDF origin = bottom-left):
//   Logo      : (50, 782) 50×50 pt. Top = 832.
//   Header    : y = 826, 815, 804, 790. Rule 1 at y=776.
//   Title     : y = 762. Rule 2 at y = 750. Ref No at y=736.
//   cy starts at 706, ROW=22, section-rule post-gap=22pt.
//   Footer    : rule y=48, text y=36, y=24.
//
// NOTE: ordinance text is read from the FeeSchedule at download time.
// If the schedule is later edited, re-downloading an old slip shows new ordinance text.
// A future fix is to snapshot schedule.ordinance onto the Assessment itself.
function buildAssessmentSlip(a: Application, schedule: FeeSchedule | undefined, logoJpeg: string): Blob {
  const isBusiness = a.clearanceType === 'Business Clearance';
  const items     = (a.assessment?.items ?? []).filter(i => i.amount > 0);
  const total     = a.assessment?.total ?? 0;
  const ordinance = schedule?.ordinance?.trim() || '[Revenue ordinance reference not on file]';

  const hasLogo = logoJpeg.length > 0;
  const ops: string[] = [];

  function hline(y: number) {
    ops.push(`0.388 0.196 0.059 RG 0.4 w 50 ${y} m 545 ${y} l S 0 G`);
  }
  function lv(label: string, value: string, x: number, labelY: number) {
    ops.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg ${x} ${labelY + 11} Td (${esc(label)}) Tj ET`);
    ops.push(`BT /Fb 9 Tf 0.388 0.196 0.059 rg ${x} ${labelY} Td (${esc(value)}) Tj ET`);
  }

  if (hasLogo) ops.push('q 50 0 0 50 50 782 cm /Img1 Do Q');

  const hLinesSlip = [
    { t: 'REPUBLIKA NG PILIPINAS', sz: 8,  bold: false, y: 826 },
    { t: 'LALAWIGAN NG RIZAL',     sz: 8,  bold: false, y: 815 },
    { t: 'BAYAN NG RODRIGUEZ',     sz: 8,  bold: false, y: 804 },
    { t: 'BARANGAY SAN JOSE',      sz: 11, bold: true,  y: 790 },
  ];
  for (const h of hLinesSlip) {
    const font = h.bold ? '/Fb' : '/F1';
    const tx = Math.max(297.5 - h.t.length * h.sz * 0.55 / 2, 110);
    ops.push(`BT ${font} ${h.sz} Tf 0.388 0.196 0.059 rg ${tx.toFixed(1)} ${h.y} Td (${esc(h.t)}) Tj ET`);
  }

  hline(776);
  const titleX = Math.max(50, 297.5 - 'PRE-ASSESSMENT SLIP'.length * 14 * 0.55 / 2);
  ops.push(`BT /Fb 14 Tf 0.388 0.196 0.059 rg ${titleX.toFixed(1)} 762 Td (PRE-ASSESSMENT SLIP) Tj ET`);
  hline(750);
  ops.push(`BT /Fb 10 Tf 0.388 0.196 0.059 rg 50 736 Td (Reference No.: ${esc(a.reference)}) Tj ET`);

  let cy = 706;
  const ROW = 22;

  lv('APPLICANT NAME', a.applicant, 50, cy); cy -= ROW;
  lv('ADDRESS',        a.address,   50, cy); cy -= ROW;
  lv('CONTACT NUMBER', a.contact,   50, cy); cy -= ROW;
  cy -= 12; hline(cy); cy -= 22;

  lv('CLEARANCE TYPE',   a.clearanceType,   50, cy); cy -= ROW;
  lv('PURPOSE',          a.purpose,         50, cy); cy -= ROW;
  lv('APPLICATION TYPE', a.applicationType, 50, cy); cy -= ROW;

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

  cy -= 12; hline(cy); cy -= 22;

  lv('DATE ASSESSED', dateLabel(a.assessment?.assessedAt), 50,  cy);
  lv('ASSESSED BY',   a.assessment?.assessedBy || '\u2014',   310, cy);
  cy -= ROW;
  cy -= 12; hline(cy); cy -= 22;

  const PHP_X = 408, RIGHT_EDGE = 542, CW9 = 5.5;
  function amtOps(numStr: string, y: number, bold: boolean) {
    const font = bold ? '/Fb' : '/F1', sz = bold ? 10 : 9, cw = bold ? 6.0 : CW9;
    ops.push(`BT ${font} ${sz} Tf 0.388 0.196 0.059 rg ${PHP_X} ${y} Td (PHP) Tj ET`);
    const numX = RIGHT_EDGE - numStr.length * cw;
    ops.push(`BT ${font} ${sz} Tf 0.388 0.196 0.059 rg ${numX.toFixed(1)} ${y} Td (${esc(numStr)}) Tj ET`);
  }

  ops.push(`BT /Fb 9 Tf 0.388 0.196 0.059 rg 50 ${cy} Td (FEE BREAKDOWN) Tj ET`); cy -= 15;
  const amtHdrX = RIGHT_EDGE - 'Amount'.length * 4.9;
  ops.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg 50 ${cy} Td (Description) Tj ET`);
  ops.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg ${amtHdrX.toFixed(1)} ${cy} Td (Amount) Tj ET`);
  cy -= 5; hline(cy); cy -= 14;

  for (const item of items) {
    ops.push(`BT /F1 9 Tf 0.1 0.1 0.1 rg 50 ${cy} Td (${esc(item.name)}) Tj ET`);
    amtOps(item.amount.toFixed(2), cy, false);
    cy -= 14;
  }

  cy -= 4; hline(cy); cy -= 14;
  ops.push(`BT /Fb 10 Tf 0.388 0.196 0.059 rg 50 ${cy} Td (TOTAL DUE) Tj ET`);
  amtOps(total.toFixed(2), cy, true);
  cy -= 8; hline(cy); cy -= 22;

  ops.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg 50 ${cy + 11} Td (Revenue Code Reference:) Tj ET`);
  ops.push(`BT /F1 9 Tf 0.1 0.1 0.1 rg 50 ${cy} Td (${esc(ordinance)}) Tj ET`);
  cy -= 28;

  const instrLines = [
    'Please proceed to the Municipal Treasury of Rodriguez, Rizal to pay',
    'the total above. After paying, upload a photo of your Official Receipt',
    '(OR) through the portal to continue your application.',
  ];
  let siy = cy;
  for (const line of instrLines) {
    ops.push(`BT /F1 8.5 Tf 0.388 0.196 0.059 rg 50 ${siy} Td (${esc(line)}) Tj ET`);
    siy -= 12;
  }

  hline(48);
  ops.push(`BT /Fb 8 Tf 0.388 0.196 0.059 rg 50 36 Td (Ipil Street, Barangay San Jose, Rodriguez, Rizal 1860) Tj ET`);
  ops.push(`BT /F1 8 Tf 0.388 0.196 0.059 rg 50 24 Td (Serbisyong Makatao, Barangay na Makabago.) Tj ET`);
  ops.push(`BT /F1 7 Tf 0.5 0.5 0.5 rg 340 36 Td (SAMPLE ONLY - NOT AN OFFICIAL DOCUMENT) Tj ET`);

  // Assemble with one image XObject (header logo at /Img1).
  const stream = ops.join('\n');
  const images = hasLogo ? [{ data: Uint8Array.from(atob(logoJpeg), c => c.charCodeAt(0)), w: 100, h: 100 }] : [];
  return assemblePDF(stream, images);
}

// ─── Public entry point ───────────────────────────────────────────────────────
// kind='assessment' : Pre-Assessment Slip (what the applicant brings to the Treasury).
// kind='clearance'  : Official clearance document (single Layout 1 for all types).
//
// schedule is needed to show the revenue ordinance reference.
// The Application stores only scheduleId, not the full ordinance text,
// so the caller must look up and pass the matching FeeSchedule.
export async function applicationPDF(
  a: Application,
  kind: 'assessment' | 'clearance',
  schedule?: FeeSchedule,
): Promise<void> {
  if (!a.assessment) throw new Error('Assessment is not available.');
  if (kind === 'clearance' && (!(a.receipt || a.receiptPhoto || a.simulatedPayment) || !a.clearance || !['Ready for Download', 'Closed - Cleared'].includes(a.status))) throw new Error('Clearance is not available.');

  if (kind === 'assessment') {
    const logoJpeg = await fetchLogoJpeg();
    const blob = buildAssessmentSlip(a, schedule, logoJpeg);
    downloadBlob(a.reference + '-assessment.pdf', blob);
  } else {
    // Fetch header logo and seal watermark in parallel; either can fail gracefully.
    const [headerLogoJpeg, sealJpeg] = await Promise.all([fetchLogoJpeg(), fetchSealJpeg()]);
    const blob = buildClearancePDF(a, schedule, headerLogoJpeg, sealJpeg);
    downloadBlob(a.reference + '-clearance.pdf', blob);
  }
}
