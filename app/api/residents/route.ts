import { NextResponse } from 'next/server';
import type { User } from '@/types';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);

// GET /api/residents: Staff and Admin search existing registered residents.
export async function GET(request: Request) {
  const me = await currentUser();
  if ('error' in me) return me.error;
  if (me.user.role !== 'staff' && me.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only staff and admin can search residents.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const db = supabaseAdmin();

  let query = db.from('profiles')
    .select('id, first_name, last_name, email, contact_number, address, role, status, valid_id_path, created_at')
    .eq('role', 'resident')
    .eq('status', 'Active')
    .order('first_name', { ascending: true })
    .limit(50);

  if (q) {
    const cleanQ = q.replace(/[%_,()]/g, ' ');
    query = query.or(`first_name.ilike.%${cleanQ}%,last_name.ilike.%${cleanQ}%,contact_number.ilike.%${cleanQ}%,email.ilike.%${cleanQ}%,address.ilike.%${cleanQ}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'Could not search residents: ' + error.message }, { status: 500 });
  }

  const residents: User[] = (data ?? []).map(r => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email ?? '',
    password: '',
    role: 'resident',
    status: r.status,
    contact: r.contact_number ?? '',
    address: r.address ?? '',
    createdAt: r.created_at,
    validId: r.valid_id_path ? {
      requirement: 'Valid ID',
      name: r.valid_id_path.split('/').pop() || 'Valid ID',
      size: 0,
      type: 'image/jpeg',
      path: r.valid_id_path,
      status: 'Verified',
    } : undefined,
  }));

  return NextResponse.json({ residents });
}

// POST /api/residents: Staff or Admin registers a new resident at the counter.
export async function POST(request: Request) {
  const me = await currentUser();
  if ('error' in me) return me.error;
  if (me.user.role !== 'staff' && me.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only staff and admin can register walk-in residents.' }, { status: 403 });
  }

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  let firstName = '', lastName = '', contact = '', address = '', email = '';
  let validIdFile: { name: string; type: string; size: number; buffer: Buffer } | undefined;
  let validIdStoragePath: string | undefined;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const rawName = String(formData.get('name') ?? '').trim();
    const parts = rawName.split(/\s+/);
    firstName = String(formData.get('firstName') ?? parts.shift() ?? '').trim();
    lastName = String(formData.get('lastName') ?? parts.join(' ') ?? '').trim();
    contact = String(formData.get('contact') ?? '').trim();
    address = String(formData.get('address') ?? '').trim();
    email = String(formData.get('email') ?? '').trim();

    const file = formData.get('validId');
    if (file && typeof file === 'object' && 'arrayBuffer' in file) {
      const f = file as File;
      if (f.size > 0) {
        if (f.size > 5 * 1024 * 1024) {
          return NextResponse.json({ error: 'Valid ID must be at most 5 MB.' }, { status: 400 });
        }
        if (!['image/jpeg', 'image/png', 'application/pdf'].includes(f.type)) {
          return NextResponse.json({ error: 'Valid ID must be a JPG, PNG or PDF.' }, { status: 400 });
        }
        validIdFile = {
          name: f.name,
          type: f.type,
          size: f.size,
          buffer: Buffer.from(await f.arrayBuffer()),
        };
      }
    }
  } else {
    let body: any;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
    firstName = String(body.firstName ?? '').trim();
    lastName = String(body.lastName ?? '').trim();
    contact = String(body.contact ?? '').trim();
    address = String(body.address ?? '').trim();
    email = String(body.email ?? '').trim();
    validIdStoragePath = body.validId?.path ? String(body.validId.path) : undefined;
  }

  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'Resident full name is required.' }, { status: 400 });
  }
  if (!contact || !/^(09\d{9}|\+639\d{9})$/.test(contact)) {
    return NextResponse.json({ error: 'Enter a valid Philippine mobile number (e.g. 09123456789).' }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: 'Complete address is required.' }, { status: 400 });
  }

  // Check if contact number already registered
  const { data: existingContact } = await db.from('profiles').select('id, first_name, last_name').eq('contact_number', contact).maybeSingle();
  if (existingContact) {
    return NextResponse.json({
      error: `A resident with mobile number ${contact} is already registered (${existingContact.first_name} ${existingContact.last_name}). Please select them in "Search Existing Resident".`
    }, { status: 409 });
  }

  // If email was entered, validate format and check uniqueness
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    const { data: existingEmail } = await db.from('profiles').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (existingEmail) {
      return NextResponse.json({ error: 'This email address is already registered.' }, { status: 409 });
    }
  }

  // Generate walk-in email if resident did not provide an email
  const residentEmail = email ? email.toLowerCase() : `walk-in-${Date.now()}-${Math.floor(Math.random() * 10000)}@barangaysanjose.local`;

  // Create user in Supabase auth (with confirmed email and generated secure random password)
  const { data: authData, error: authError } = await db.auth.admin.createUser({
    email: residentEmail,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      privacy_consent: true,
    },
  });

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Could not create resident account: ' + (authError?.message ?? 'no user returned') }, { status: 500 });
  }

  const userId = authData.user.id;

  // Upload valid ID if file buffer was provided
  let validIdPath = validIdStoragePath;
  if (validIdFile) {
    const safeName = safeFileName(validIdFile.name);
    const path = `${userId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await db.storage.from('valid-ids').upload(path, validIdFile.buffer, {
      contentType: validIdFile.type,
      upsert: false,
    });
    if (uploadError) {
      return NextResponse.json({ error: 'Could not upload Valid ID: ' + uploadError.message }, { status: 500 });
    }
    validIdPath = path;
  }

  // Update profile with details
  const { error: profileError } = await db.from('profiles').update({
    first_name: firstName,
    last_name: lastName,
    contact_number: contact,
    address: address,
    role: 'resident',
    status: 'Active',
    privacy_consent_at: now,
    ...(validIdPath ? { valid_id_path: validIdPath } : {}),
  }).eq('id', userId);

  if (profileError) {
    return NextResponse.json({ error: 'Resident account created, but profile could not be updated: ' + profileError.message }, { status: 500 });
  }

  // Record audit log
  await db.from('audit_logs').insert({
    user_id: me.user.id,
    role: me.user.role,
    action: 'Walk-in resident registered',
    reference_no: null,
    application_id: null,
    new_value: { resident_id: userId, name: `${firstName} ${lastName}`, contact },
  });

  const resident: User = {
    id: userId,
    firstName,
    lastName,
    email: residentEmail,
    password: '',
    role: 'resident',
    status: 'Active',
    contact,
    address,
    createdAt: now,
    validId: validIdPath ? {
      requirement: 'Valid ID',
      name: validIdFile?.name || validIdPath.split('/').pop() || 'Valid ID',
      size: validIdFile?.size || 0,
      type: validIdFile?.type || 'image/jpeg',
      path: validIdPath,
      status: 'Verified',
    } : undefined,
  };

  return NextResponse.json({ resident });
}
