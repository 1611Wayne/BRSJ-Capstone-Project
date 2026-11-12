import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// DB-11 account checks (migration 21, decided 2026-11-13): a resident whose ID Staff have not checked yet may have only
// ONE open request; a resident flagged as spam may not submit new requests until Admin clears the flag.

// Requests that still need the office's work (Draft, Closed - Cleared and Void do not count).
export const OPEN_STATUSES = ['Pending Assessment', 'Under Review', 'Rejected', 'Awaiting OR', 'For Checking', 'Ready for Download'];

export type AccountCheck = { idVerifiedAt: string | null; idVerifiedBy: string | null; spamFlaggedAt: string | null; spamFlaggedBy: string | null; spamReason: string | null };

export async function loadAccountCheck(db: SupabaseClient, residentId: string): Promise<AccountCheck | null> {
  const { data, error } = await db.from('profiles').select('id_verified_at, id_verified_by, spam_flagged_at, spam_flagged_by, spam_reason').eq('id', residentId).maybeSingle();
  if (error) throw new Error(/column/i.test(error.message) ? 'The account checks are not set up yet: run migration 21 on Supabase.' : 'Could not read the account: ' + error.message);
  if (!data) return null;
  const ids = [data.id_verified_by, data.spam_flagged_by].filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await db.from('profiles').select('id, first_name, last_name').in('id', ids);
    for (const p of people ?? []) names.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' '));
  }
  return {
    idVerifiedAt: data.id_verified_at, idVerifiedBy: data.id_verified_by ? names.get(data.id_verified_by) ?? 'Staff' : null,
    spamFlaggedAt: data.spam_flagged_at, spamFlaggedBy: data.spam_flagged_by ? names.get(data.spam_flagged_by) ?? 'Staff' : null, spamReason: data.spam_reason,
  };
}

// Before a request is submitted: the reason it may not be, or null. `reference` is the request being submitted.
export async function submissionBlock(db: SupabaseClient, residentId: string, reference: string | undefined, byStaff: boolean): Promise<{ error: string; status: number } | null> {
  let check: AccountCheck | null;
  try { check = await loadAccountCheck(db, residentId); } catch (e) { return { error: (e as Error).message, status: 500 }; }
  if (!check) return { error: 'The applicant\'s account could not be found.', status: 404 };
  if (check.spamFlaggedAt) {
    return byStaff
      ? { error: 'This account is flagged as spam. Ask Admin to clear the flag (User Management) before submitting for this person.', status: 403 }
      : { error: 'Your account is on hold. Please contact the barangay office.', status: 403 };
  }
  if (check.idVerifiedAt || byStaff) return null;   // Staff at the counter check the ID themselves (the submission marks it)
  let query = db.from('applications').select('id', { count: 'exact', head: true }).eq('resident_id', residentId).in('status', OPEN_STATUSES);
  if (reference) query = query.neq('reference_no', reference);
  const { count, error } = await query;
  if (error) return { error: 'Could not check your open requests. Please try again.', status: 500 };
  if ((count ?? 0) >= 1) return { error: 'You already have a request in progress. Until the barangay office checks your ID with that request, you can have one open request at a time. You can save this one as a draft and submit it later.', status: 409 };
  return null;
}
