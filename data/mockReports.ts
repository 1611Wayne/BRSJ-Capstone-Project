import type { Application, AuditLog, ReportRecord } from '@/types';
import { manilaDate } from '@/lib/workflow';
export const SLA_SECONDS = 60; // Demo threshold for the Staff payment check (upload to verification). No SLA has been approved; replace when one is.
export function monthlyRows(applications: Application[]): ReportRecord[] {
  const groups: Record<string, ReportRecord> = {};
  for (const a of applications.filter(a => a.status !== 'Draft' && a.status !== 'Void')) {
    const row = groups[a.clearanceType] ||= { clearanceType: a.clearanceType, count: 0, assessed: 0, recorded: 0 };
    row.count++; row.assessed += a.assessment?.total || 0; // Collections are released payments with an OR. A simulated payment has no receipt, so it is never counted (manuscript 3.3.4).
    row.recorded += a.clearance && a.receipt ? a.receipt.amountPaid : 0;
  }
  return Object.values(groups);
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
// Exclude void transactions from daily entries and totals; their history remains in the Reversion Audit Report.
export const dailyOrApplications = (applications: Application[], date: string, type = '') =>
  applications.filter(a => a.status !== 'Void' && a.receipt && a.clearance && manilaDate(a.clearance.generatedAt) === date && (!type || a.clearanceType === type));

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
  const feedback = applications.flatMap(a => a.feedback && Number.isInteger(a.feedback.rating) && a.feedback.rating >= 1 && a.feedback.rating <= 5 ? [a.feedback] : []);
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
  return { total: feedback.length, commentCount: feedback.filter(f => f.comment.trim()).length, ratingCounts, commonWords };
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
