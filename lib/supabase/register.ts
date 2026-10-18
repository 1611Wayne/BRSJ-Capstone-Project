import type { UploadedDocument, User } from '@/types';
import { supabaseBrowser } from './browser';

export interface RegistrationInput { firstName: string; lastName: string; address: string; contact: string; email: string; password: string; validId: UploadedDocument }
export type RegistrationResult =
  | { status: 'signed-in'; user: User; warnings: string[] }
  | { status: 'confirm-email' };

const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);

// Real sign-up for an Applicant, as that person (publishable key), so Supabase's own sign-up limits apply.
// 1. Create the account; the database trigger makes the profile (names, email, privacy consent).
// 2. Save the address and contact number on the profile (the access rules let a person update their own).
// 3. Upload the ID into the private valid-ids bucket, in the person's own folder, under a new file name.
// Steps 2 and 3 need a session, which exists only when "Confirm email" is off in the Supabase dashboard.
export async function registerWithSupabase(input: RegistrationInput): Promise<RegistrationResult> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { first_name: input.firstName.trim(), last_name: input.lastName.trim(), privacy_consent: true } },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) throw new Error('This email is already registered. Log in instead.');
    if (/password/i.test(error.message)) throw new Error('Choose a stronger password: ' + error.message);
    if (/rate limit|too many/i.test(error.message)) throw new Error('Too many sign-ups from here right now. Please try again in a few minutes.');
    throw new Error(error.message);
  }
  if (!data.session || !data.user) return { status: 'confirm-email' };
  const userId = data.user.id, warnings: string[] = [];

  const { error: profileError } = await supabase.from('profiles')
    .update({ address: input.address.trim(), contact_number: input.contact.trim() }).eq('id', userId);
  if (profileError) warnings.push(profileError.code === '23505'
    ? 'This contact number is already used by another account, so it was not saved. The barangay office can correct it.'
    : 'Your address and contact number could not be saved (' + profileError.message + ').');

  try {
    const blob = await (await fetch(input.validId.url!)).blob();
    const path = `${userId}/${Date.now()}-${safeFileName(input.validId.name)}`;
    const { error: uploadError } = await supabase.storage.from('valid-ids').upload(path, blob, { contentType: input.validId.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error: pathError } = await supabase.from('profiles').update({ valid_id_path: path }).eq('id', userId);
    if (pathError) throw pathError;
  } catch (e) {
    warnings.push('Your ID could not be uploaded (' + ((e as Error).message || 'unknown error') + '). Please bring it to the barangay office.');
  }

  const response = await fetch('/api/me', { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Your account was created, but it could not be loaded. Please log in.');
  return { status: 'signed-in', user: body.user as User, warnings };
}
