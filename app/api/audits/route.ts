import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { auditRecord } from '@/lib/auditRecords';

export const dynamic = 'force-dynamic';

// Admin loads the full audit history for monthly reporting. Staff may read an accessible transaction's history.
export async function GET(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  if (me.user.role === 'resident') return NextResponse.json({ error: 'Only Staff and Admin can read transaction logs.' }, { status: 403 });
  const reference = new URL(request.url).searchParams.get('reference');
  if (me.user.role === 'staff' && !reference) return NextResponse.json({ error: 'Select a transaction to read its log.' }, { status: 403 });
  const db = supabaseAdmin();
  if (reference) {
    const { data: application, error } = await db.from('applications').select('id, status, staff_encoder_id').eq('reference_no', reference).maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not check access to this transaction.' }, { status: 500 });
    if (!application || (application.status === 'Draft' && !application.staff_encoder_id)) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });
  }
  try {
    // Read every page: Supabase caps the number of rows in a single response.
    const records: Record<string, any>[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = db.from('audit_logs').select('*').order('id', { ascending: true }).range(offset, offset + 999);
      if (reference) query = query.eq('reference_no', reference);
      const { data, error } = await query;
      if (error) throw new Error('Could not load the transaction logs: ' + error.message);
      records.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const names = new Map<string, string>(), ids = Array.from(new Set(records.map(row => row.user_id).filter(Boolean)));
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await db.from('profiles').select('id, first_name, last_name').in('id', ids.slice(offset, offset + 100));
      if (error) throw new Error('Could not load the names on the transaction logs.');
      for (const profile of data || []) names.set(profile.id, [profile.first_name, profile.last_name].filter(Boolean).join(' '));
    }
    return NextResponse.json({ audits: records.map(row => auditRecord(row, names.get(row.user_id) || row.user_id || 'Not recorded')) });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
