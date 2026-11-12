import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { transition } from '@/lib/workflow';
import { mobileForms } from '@/lib/phone';
import type { PortalState, User } from '@/types';

export const dynamic = 'force-dynamic';

// Admin User Management on the database (paper 3.3.1.1, Admin group: account creation, status updates, password resets
// for Staff and Applicant accounts). Admin accounts are never listed or changed here: the database refuses to create
// them (migration 4) and they are managed outside the app. Decided 2026-11-12: Admin creates STAFF accounts only;
// residents register themselves or at the Walk-in counter.

const COLUMNS = 'id, first_name, last_name, email, contact_number, address, role, status, created_at, id_verified_at, spam_flagged_at, spam_reason';
type Row = Record<string, any>;
const toUser = (p: Row): User => ({ id: p.id, firstName: p.first_name ?? '', lastName: p.last_name ?? '', email: p.email ?? '', password: '', role: p.role, status: p.status,
  createdAt: p.created_at, contact: p.contact_number ?? '', address: p.address ?? '',
  ...(p.id_verified_at ? { idVerifiedAt: p.id_verified_at } : {}), ...(p.spam_flagged_at ? { spamFlaggedAt: p.spam_flagged_at, spamReason: p.spam_reason ?? '' } : {}) });   // DB-11 (migration 21)
const fail = (error: string, status = 500) => NextResponse.json({ error }, { status });
const REASONS = ['User created', 'User updated', 'Password reset', 'Account deactivated', 'Account activated'];
const BANNED = '876000h';   // about 100 years: Supabase refuses sign-in until the ban is lifted with 'none'

async function listUsers(db: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('profiles').select(COLUMNS).in('role', ['resident', 'staff']).order('created_at', { ascending: false }).range(offset, offset + 999);
    if (error) throw new Error('Could not load the user accounts: ' + error.message);
    users.push(...(data ?? []).map(toUser));
    if ((data?.length ?? 0) < 1000) return users;
  }
}

async function admin() {
  const me = await currentUser(); if ('error' in me) return me;
  if (me.user.role !== 'admin') return { error: fail('Only Admin can manage user accounts.', 403) };
  return me;
}

// GET /api/users: every Staff and resident account (newest first), without passwords.
export async function GET() {
  const me = await admin(); if ('error' in me) return me.error;
  try { return NextResponse.json({ users: await listUsers(supabaseAdmin()) }); } catch (e) { return fail((e as Error).message); }
}

// POST /api/users { user, reason }: create a Staff account, save an edit, reset a password, or (de)activate an account.
// The same account rule as the screen (transition 'user' in lib/workflow.ts) checks it again; the database checks that
// the email and mobile number belong to nobody else. Answers with every account.
export async function POST(request: Request) {
  const me = await admin(); if ('error' in me) return me.error;
  const body = await request.json().catch(() => null) as { user?: Record<string, unknown>; reason?: unknown } | null;
  const raw = body?.user, reason = String(body?.reason ?? '');
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return fail('Send the account to save.', 400);
  if (!REASONS.includes(reason)) return fail('Unknown account action.', 400);
  const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

  const db = supabaseAdmin();
  const { data: row } = /^[0-9a-f-]{36}$/i.test(raw.id) ? await db.from('profiles').select(COLUMNS).eq('id', raw.id).maybeSingle() : { data: null };
  if (row && row.role === 'admin') return fail('Admin accounts cannot be created or changed here.', 403);
  const previous = row ? toUser(row) : undefined;
  const user: User = {
    id: previous?.id ?? raw.id, createdAt: previous?.createdAt ?? new Date().toISOString(),
    firstName: text(raw.firstName, 100), lastName: text(raw.lastName, 100), email: text(raw.email, 200).toLowerCase(),
    password: typeof raw.password === 'string' ? raw.password.slice(0, 200) : '',
    role: raw.role === 'staff' ? 'staff' : 'resident', status: raw.status === 'Inactive' ? 'Inactive' : 'Active',
    contact: text(raw.contact, 20), address: text(raw.address, 300),
  };
  if (!previous && user.role !== 'staff') return fail('Admin creates Staff accounts only. Residents register themselves or at the Walk-in counter.', 400);
  if (user.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) return fail('Enter a valid email address.', 400);
  let contact: string | null = null;
  if (user.contact) {
    const forms = mobileForms(user.contact);
    if (!forms) return fail('Enter a valid Philippine mobile number (e.g. 09123456789), or leave it empty.', 400);
    contact = forms.local;
    const { data: taken } = await db.from('profiles').select('id, first_name, last_name').in('contact_number', [forms.local, forms.international, forms.stored]).neq('id', user.id).limit(1).maybeSingle();
    if (taken) return fail(`The mobile number ${contact} already belongs to ${taken.first_name} ${taken.last_name}.`, 409);
  }
  if (user.email && user.email !== previous?.email) {
    const { data: taken } = await db.from('profiles').select('id').ilike('email', user.email).neq('id', user.id).limit(1).maybeSingle();
    if (taken) return fail('This email address is already registered.', 409);
  }

  // The shared rule: who may do it, Admin rows untouchable, name/email/password present.
  const state: PortalState = { users: [me.user, ...(previous ? [previous] : [])], applications: [], schedules: [], audits: [], notifications: [], currentUserId: me.user.id };
  try { transition(state, { type: 'user', user, reason }); } catch (e) { return fail((e as Error).message, 400); }

  const profile = { first_name: user.firstName, last_name: user.lastName, email: user.email || null, contact_number: contact, address: user.address, role: user.role, status: user.status };
  const passwordChanged = user.password.length > 0;
  if (!previous) {
    // A new Staff account: the sign-in account first (email confirmed, the temporary password), then its profile.
    const { data: created, error } = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true, user_metadata: { first_name: user.firstName, last_name: user.lastName } });
    if (error || !created.user) return fail('Could not create the account: ' + (error?.message ?? 'no account returned'), error?.status === 422 ? 409 : 500);
    user.id = created.user.id;
    const { error: profileError } = await db.from('profiles').update(profile).eq('id', user.id);
    if (profileError) {
      await db.auth.admin.deleteUser(user.id);   // never leave a sign-in account without its Staff profile
      return fail('The account was not created: ' + profileError.message);
    }
    if (user.status === 'Inactive') await db.auth.admin.updateUserById(user.id, { ban_duration: BANNED });
  } else {
    // An existing account: the sign-in side (email, password, blocked or not), then the profile.
    const auth: { email?: string; email_confirm?: boolean; password?: string; ban_duration?: string } = {};
    if (user.email && user.email !== previous.email) { auth.email = user.email; auth.email_confirm = true; }
    if (passwordChanged) auth.password = user.password;
    if (user.status !== previous.status) auth.ban_duration = user.status === 'Inactive' ? BANNED : 'none';
    if (Object.keys(auth).length) {
      const { error } = await db.auth.admin.updateUserById(user.id, auth);
      if (error) return fail('The sign-in account was not changed: ' + error.message, error.status === 422 ? 400 : 500);
    }
    const { error } = await db.from('profiles').update(profile).eq('id', user.id);
    if (error) return fail('The account was not saved: ' + error.message);
  }

  // Audit: who did it and the account before and after, never the password.
  const safe = (u?: User, contactNumber?: string | null) => u ? { name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, role: u.role, status: u.status, contact: contactNumber ?? u.contact, address: u.address } : null;
  const { error: auditError } = await db.from('audit_logs').insert({
    user_id: me.user.id, role: me.user.role, action: reason, application_id: null, reference_no: null,
    old_value: previous ? { account: previous.id, ...safe(previous) } : null,
    new_value: { account: user.id, ...safe(user, contact), ...(passwordChanged ? { password: previous ? 'reset by Admin' : 'temporary password set' } : {}) },
  });
  if (auditError) return fail('Saved, but the audit log was not: ' + auditError.message);

  try { return NextResponse.json({ id: user.id, users: await listUsers(db) }); } catch (e) { return fail('Saved, but could not read the accounts back: ' + (e as Error).message); }
}
