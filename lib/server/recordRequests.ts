import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PersonalRecordsRequest, User } from '@/types';

export const RECORD_REQUEST_SELECT = `id, resident_id, request_text, requested_at, status, response_text, responded_at, responded_by, include_summary,
  requester:profiles!personal_record_requests_resident_id_fkey ( first_name, last_name ),
  responder:profiles!personal_record_requests_responded_by_fkey ( first_name, last_name )`;
const name = (p: any) => { const row = Array.isArray(p) ? p[0] : p; return [row?.first_name, row?.last_name].filter(Boolean).join(' '); };
export const toRecordRequest = (r: Record<string, any>): PersonalRecordsRequest => ({
  id: r.id, residentId: r.resident_id, requestedBy: name(r.requester) || 'Applicant', message: r.request_text, requestedAt: r.requested_at, status: r.status,
  ...(r.status === 'Answered' ? { response: r.response_text, respondedAt: r.responded_at, respondedBy: name(r.responder) || 'Barangay office', includeSummary: r.include_summary === true } : {}),
});

export async function readRecordRequest(db: SupabaseClient, user: User, id: string) {
  let query = db.from('personal_record_requests').select(RECORD_REQUEST_SELECT).eq('id', id);
  if (user.role === 'resident') query = query.eq('resident_id', user.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('Records requests are currently unavailable. Please contact the Monitoring Office.');
  return data && (user.role !== 'resident' || data.resident_id === user.id) ? toRecordRequest(data) : null;
}

export async function listRecordRequests(db: SupabaseClient, user: User) {
  const requests: PersonalRecordsRequest[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = db.from('personal_record_requests').select(RECORD_REQUEST_SELECT);
    if (user.role === 'resident') query = query.eq('resident_id', user.id);
    const { data, error } = await query.order('requested_at', { ascending: false }).order('id').range(offset, offset + 999);
    if (error) throw new Error('Records requests are currently unavailable. Please contact the Monitoring Office.');
    requests.push(...(data ?? []).filter(r => user.role !== 'resident' || r.resident_id === user.id).map(toRecordRequest));
    if ((data?.length ?? 0) < 1000) return requests;
  }
}
