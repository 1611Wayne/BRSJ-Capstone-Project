import type { Application, AuditLog, MonthlyCollectionRow } from '@/types';
import { manilaDate } from '@/lib/workflow';
export const SLA_SECONDS = 60; // Demo threshold for the Staff payment check (upload to verification). No SLA has been approved; replace when one is.
// A generated clearance backed by a verified receipt photo is an issued OR transaction.
// Never count stale receipt/clearance fields on rejected, voided, reverted, or otherwise unissued requests.
const releasedOrApplications = (applications: Application[]) => applications.filter(a =>
  (a.status === 'Ready for Download' || a.status === 'Closed - Cleared') &&
  a.assessment && a.clearance && a.receipt && a.paymentVerification?.status === 'Verified' &&
  (a.receiptPhoto || a.receipt.receiptPhoto) && !a.simulatedPayment);

// Report saved assessment snapshots, including adjustments; never recompute historical fees from current schedules.
// Money is accumulated as integer centavos, then converted back to pesos for display/export.
export function monthlyRows(applications: Application[], byDay = false): MonthlyCollectionRow[] {
  const groups = new Map<string, MonthlyCollectionRow>();
  for (const a of releasedOrApplications(applications)) {
    const date = byDay ? manilaDate(a.clearance!.generatedAt) : '';
    const subcategory = a.clearanceType === 'Business Clearance' ? a.assessment!.category || a.businessSubcategory || 'General' : '—';
    const key = JSON.stringify([date, a.clearanceType, subcategory, a.applicationType]);
    const row = groups.get(key) || { date, clearanceType: a.clearanceType, subcategory, applicationType: a.applicationType, count: 0, assessed: 0, recorded: 0, components: Object.create(null) };
    row.count++; row.assessed += Math.round(a.assessment!.total * 100); row.recorded += Math.round(a.receipt!.amountPaid * 100);
    for (const item of a.assessment!.items) row.components[item.name] = (row.components[item.name] || 0) + Math.round(item.amount * 100);
    groups.set(key, row);
  }
  return Array.from(groups.values(), row => ({ ...row, assessed: row.assessed / 100, recorded: row.recorded / 100,
    components: Object.assign(Object.create(null), Object.fromEntries(Object.entries(row.components).map(([name, cents]) => [name, cents / 100]))) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.clearanceType.localeCompare(b.clearanceType) || a.subcategory.localeCompare(b.subcategory) || a.applicationType.localeCompare(b.applicationType));
}

export function monthlyCollectionReport(applications: Application[], month: string, type = '') {
  const eligible = releasedOrApplications(applications).filter(a => manilaDate(a.clearance!.generatedAt).slice(0, 7) === month && (!type || a.clearanceType === type));
  const daily = monthlyRows(eligible, true), monthly = monthlyRows(eligible);
  const feeComponents = Array.from(new Set(eligible.flatMap(a => a.assessment!.items.map(item => item.name)))).sort((a, b) => a.localeCompare(b));
  const sumMoney = (amounts: number[]) => amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100;
  const totals = { count: eligible.length, assessed: sumMoney(monthly.map(row => row.assessed)), recorded: sumMoney(monthly.map(row => row.recorded)),
    components: Object.fromEntries(feeComponents.map(name => [name, sumMoney(monthly.map(row => row.components[name] || 0))])) };
  const volumes = new Map<string, number>();
  for (const row of daily) volumes.set(row.date, (volumes.get(row.date) || 0) + row.count);
  const peakCount = Math.max(0, ...volumes.values());
  const peakDates = Array.from(volumes).filter(([, count]) => count === peakCount).map(([date]) => date).sort();
  return { daily, monthly, feeComponents, totals, peakCount, peakDates };
}
// Total processing duration, as the manuscript defines it (3.3.1): from the initial application submission to the Applicant's
// receipt confirmation. Null until the Applicant has confirmed receipt.
export function processingSeconds(a: Application) {
  return a.confirmation ? Math.max(0, (Date.parse(a.confirmation.timestamp) - Date.parse(a.dateRequested)) / 1000) : null;
}
// Staff payment check turnaround: from the receipt upload to Staff verification. This is what the SLA indicators measure.
export function paymentCheckSeconds(a: Application) {
  const v = a.paymentVerification;
  return v?.status === 'Verified' && v.checkedAt ? Math.max(0, (Date.parse(v.checkedAt) - Date.parse(v.submittedAt)) / 1000) : null;
}
export const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
// Daily OR Summary: clearances released against a verified OR on the given Manila day (the day Staff verified the payment).
// Include issued Treasury ORs only. Legacy typed ORs remain supported; when a verification record exists it must be verified.
// History stays in the audit report, including receipts on rejected, voided and reverted requests.
export const dailyOrApplications = (applications: Application[], date: string, type = '') =>
  applications.filter(a => (a.status === 'Ready for Download' || a.status === 'Closed - Cleared') &&
    a.receipt && a.clearance && !a.simulatedPayment &&
    (!a.paymentVerification || a.paymentVerification.status === 'Verified') &&
    manilaDate(a.clearance.generatedAt) === date && (!type || a.clearanceType === type));

// Common connecting words add little meaning to a frequency summary. Comments remain unchanged.
const feedbackStopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'here', 'him', 'his', 'i', 'in', 'is', 'it', 'its', "it's", 'me', 'my', 'of', 'on',
  'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'to',
  'was', 'we', 'were', 'with', 'you', 'your', 'am', 'do', 'does', 'did', 'im', "i'm",
  'ako', 'ang', 'at', 'ay', 'dito', 'doon', 'ikaw', 'ito', 'iyan', 'iyon', 'kami', 'kayo', 'ko',
  'kong', 'lang', 'mga', 'mo', 'na', 'naman', 'namin', 'nang', 'ng', 'nga', 'ni', 'nila', 'ninyo',
  'nito', 'niya', 'nyo', 'o', 'pa', 'para', 'po', 'rin', 'din', 'sa', 'si', 'siya', 'tayo', 'yung',
]);

export function feedbackSummary(applications: Application[]) {
  const entries = applications.filter(a => a.feedback && Number.isInteger(a.feedback.rating) && a.feedback.rating >= 1 && a.feedback.rating <= 5);
  const feedback = entries.map(a => a.feedback!);
  const average = feedback.length ? feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length : null;
  const types = new Map<string, { count: number; sum: number }>();
  const months = new Map<string, { count: number; sum: number }>();
  for (const a of entries) {
    const f = a.feedback!;
    const group = types.get(a.clearanceType) || { count: 0, sum: 0 };
    group.count++; group.sum += f.rating; types.set(a.clearanceType, group);
    if (Number.isFinite(Date.parse(f.submittedAt))) {
      const month = manilaDate(f.submittedAt).slice(0, 7);
      const row = months.get(month) || { count: 0, sum: 0 };
      row.count++; row.sum += f.rating; months.set(month, row);
    }
  }
  const byType = Array.from(types, ([clearanceType, row]) => ({ clearanceType, count: row.count, average: row.sum / row.count }))
    .sort((a, b) => a.clearanceType.localeCompare(b.clearanceType));
  const monthly: { month: string; count: number; average: number | null }[] = [];
  const datedMonths = Array.from(months.keys()).sort();
  if (datedMonths.length) {
    let month = datedMonths[0];
    const last = datedMonths[datedMonths.length - 1];
    while (month <= last) {
      const row = months.get(month);
      monthly.push({ month, count: row?.count || 0, average: row ? row.sum / row.count : null });
      const [year, number] = month.split('-').map(Number);
      month = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
    }
  }
  const ratingCounts = [5, 4, 3, 2, 1].map(rating => ({ rating, count: feedback.filter(f => f.rating === rating).length }));
  const wordCounts = new Map<string, number>();
  for (const entry of feedback) {
    const words = entry.comment.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}]+(?:['\u2019][\p{L}\p{M}]+)*/gu) || [];
    for (const token of words) {
      const word = token.replace(/\u2019/g, "'");
      if (word.length < 2 || feedbackStopWords.has(word)) continue;
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }
  const commonWords = Array.from(wordCounts, ([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'en')).slice(0, 10);
  return { total: feedback.length, average, byType, monthly, commentCount: feedback.filter(f => f.comment.trim()).length, ratingCounts, commonWords };
}

export function monthlyReversions(audits: AuditLog[], month: string) {
  const groups = new Map<string, { adminId: string; admin: string; edits: number; voids: number; reviews: number; total: number }>();
  const idsByName = new Map<string, Set<string>>();
  for (const log of audits) {
    if (log.role !== 'admin' || !log.userId) continue;
    const ids = idsByName.get(log.user) || new Set<string>();
    ids.add(log.userId); idsByName.set(log.user, ids);
  }
  for (const log of audits) {
    if (!log.reversion || log.role !== 'admin' || !['Edit Fields', 'Void Transaction', 'Mark Under Review'].includes(log.action) || manilaDate(log.timestamp).slice(0, 7) !== month) continue;
    // Older prototype entries stored only a name. Resolve it only when that name has one known Admin identity.
    const knownIds = idsByName.get(log.user);
    const adminId = log.userId || (knownIds?.size === 1 ? Array.from(knownIds)[0] : log.user);
    const row = groups.get(adminId) || { adminId, admin: log.user, edits: 0, voids: 0, reviews: 0, total: 0 };
    if (log.action === 'Edit Fields') row.edits++;
    if (log.action === 'Void Transaction') row.voids++;
    if (log.action === 'Mark Under Review') row.reviews++;
    row.total++; groups.set(adminId, row);
  }
  return Array.from(groups.values()).sort((a, b) => b.total - a.total || a.admin.localeCompare(b.admin) || a.adminId.localeCompare(b.adminId));
}
