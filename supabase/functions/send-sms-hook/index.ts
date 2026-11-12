// Supabase "Send SMS" Auth Hook — sends the real OTP text via Semaphore.
// Generated 2026-09-23, revised 2026-09-24, 2026-11-06 (daily caps) and
// 2026-11-12 (sends to sms.phone, so a number change reaches the NEW number). Context: ../../../../CHANGES.md,
// "Semaphore Send SMS Hook" entry.
//
// WHAT THIS IS: whenever Supabase Auth needs to send someone a phone OTP
// code, it calls this function with the code and the user's phone number.
// This function verifies the call genuinely came from Supabase, then hands
// the code to Semaphore to actually deliver as a text message.
//
// REVISION 2026-09-24: the first version put its failure reasons only in the
// reply sent back to Supabase, which Supabase does not show anyone — so a
// failure looked like a bare "500" with no way to see why. This version
// (a) writes every failure reason to the function's logs and (b) uses a
// different HTTP status for each kind of failure, so the status Supabase
// reports back to the caller already says roughly what went wrong:
//     401  Supabase's own gate rejected the call: "Verify JWT" is still ON
//          for this function (this code never even ran)
//     403  signature check failed: SEND_SMS_HOOK_SECRET doesn't match
//     502  Semaphore refused the message (see the logs for its reason,
//          e.g. no approved sender name yet, no credit, bad key)
//     500  something on our side: a secret is missing, or a crash
//     200  the code was handed to Semaphore
//
// Structure and the verification approach come from Supabase's own
// documented example for this hook (supabase.com/docs/guides/auth/
// auth-hooks/send-sms-hook, fetched 2026-09-23), which uses Twilio — only the
// "send the message" part is swapped for Semaphore's API (confirmed against
// semaphore.co/docs; same request shape as ../../sms-test/test-semaphore.js).
// The signature verification is NOT provider-specific and is used exactly as
// Supabase documents it — it is the only thing stopping anyone who finds this
// URL from sending texts on this Semaphore account.
//
// PRIVACY: function logs are visible to everyone on the Supabase project, so
// this code never logs the OTP or the phone number — not even when Semaphore
// echoes them back inside an error reply (see redact()).
//
// The OTP wording below should stay matched to the sample message registered
// with Semaphore for the sender name (approved 2026-11, "BrgySJMR"); change
// one, check the other.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const SEMAPHORE_API_KEY = Deno.env.get('SEMAPHORE_API_KEY');
// The sender name Semaphore approved for this account: what the text shows as
// "from". Without it Semaphore uses its own default name, not ours.
const SENDER_NAME = 'BrgySJMR';

// Daily caps (rolling 24 hours), checked by public.claim_sms_send (migration
// 20261106010000_sms_daily_cap.sql) before every text, because every text costs
// Semaphore credit. Change the numbers here; no migration needed.
const CODES_PER_NUMBER_PER_DAY = 5;     // stops flooding one phone
const CODES_PER_PROJECT_PER_DAY = 200;  // stops a bot draining the balance

// A refusal we decided on ourselves (not Semaphore, not a fault).
class LimitError extends Error {}

// Asks the database whether this text may go, and records it if so. Uses the
// project URL and service key Supabase gives every Edge Function. If the check
// itself fails, nothing is sent: a broken limit must not mean "no limit".
async function claimSend(phone: string) {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing, so the daily limit cannot be checked.');
  const res = await fetch(`${url}/rest/v1/rpc/claim_sms_send`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_phone: phone, per_number: CODES_PER_NUMBER_PER_DAY, per_day: CODES_PER_PROJECT_PER_DAY }),
  });
  if (!res.ok) throw new Error(`the daily limit could not be checked (HTTP ${res.status}); is migration 15 run?`);
  const answer = await res.json();
  if (answer === 'number') throw new LimitError(`This number already got ${CODES_PER_NUMBER_PER_DAY} codes today. Try again tomorrow, or sign in with email.`);
  if (answer === 'project') throw new LimitError('Sign-in by text is busy today. Please sign in with email, or try again tomorrow.');
  if (answer !== 'ok') throw new Error('unexpected answer from the daily limit check.');
}

// Marks "Semaphore itself said no", as opposed to a problem on our side.
class SemaphoreError extends Error {}

// Supabase stores phone numbers in E.164 (e.g. "+639171234567"). Semaphore's
// documented format is the local style with no country code (e.g.
// "09171234567") — this project is Philippines-only, so this conversion is
// intentionally narrow rather than a general E.164 parser.
function toSemaphoreNumber(e164: string): string {
  const digits = e164.replace(/^\+/, '');
  if (digits.startsWith('63') && digits.length === 12) {
    return '0' + digits.slice(2);
  }
  return digits; // fallback: pass through unchanged if it doesn't match the expected PH shape
}

// Replaces each sensitive string with a placeholder before it can reach a log.
function redact(text: string, sensitive: string[]): string {
  return sensitive.reduce((t, s) => (s ? t.split(s).join('[hidden]') : t), text);
}

async function sendViaSemaphore(phone: string, otp: string) {
  if (!SEMAPHORE_API_KEY) {
    throw new Error('SEMAPHORE_API_KEY is not set — add it under Edge Functions -> Secrets.');
  }
  const number = toSemaphoreNumber(phone);
  const message = `San Jose Clearance Portal: your verification code is ${otp}. Do not share this code with anyone.`;
  const res = await fetch('https://semaphore.co/api/v4/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ apikey: SEMAPHORE_API_KEY, number, message, sendername: SENDER_NAME }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new SemaphoreError(
      `Semaphore rejected the request (HTTP ${res.status}): ${redact(JSON.stringify(body), [otp, number, phone])}`,
    );
  }
  return body;
}

function respond(status: number, message?: string) {
  const body = status === 200 ? {} : { error: { http_code: status, message } };
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const hookSecret = Deno.env.get('SEND_SMS_HOOK_SECRET');

  if (!hookSecret) {
    console.error('send-sms-hook: SEND_SMS_HOOK_SECRET is not set — add it under Edge Functions -> Secrets.');
    return respond(500, 'SEND_SMS_HOOK_SECRET is not set.');
  }

  // Two jobs in one call: rejects the request outright if it wasn't really
  // signed by Supabase, and — only once that passes — hands back the user and
  // the OTP it wants sent.
  let user: { phone: string };
  let sms: { otp: string; phone?: string };
  try {
    const wh = new Webhook(hookSecret.replace('v1,whsec_', ''));
    ({ user, sms } = wh.verify(payload, headers) as { user: { phone: string }; sms: { otp: string; phone?: string } });
  } catch (error) {
    console.error(
      'send-sms-hook: signature check failed — SEND_SMS_HOOK_SECRET most likely does not match the secret Supabase shows for this hook (copy it again, whole, including the v1,whsec_ start).',
      error instanceof Error ? error.message : String(error),
    );
    return respond(403, 'Signature verification failed.');
  }

  // Where the code goes (REVISION 2026-11-12): Supabase puts the destination in
  // sms.phone. For a sign-in that is the account's number; when a resident CHANGES
  // their number (Profile page) it is the NEW number, while user.phone is still
  // the old one (checked in Supabase's auth source, internal/api/phone.go). Older
  // Supabase versions sent no sms.phone, hence the fallback.
  const to = sms.phone || user.phone;

  // Philippine mobile numbers only (Semaphore is a Philippine service, and the
  // portal is for one barangay); anything else is refused before it costs credit.
  if (!/^\+?639\d{9}$/.test(to ?? '')) {
    console.error('send-sms-hook: refused a number that is not a Philippine mobile number.');
    return respond(400, 'Only Philippine mobile numbers (09...) can receive sign-in codes.');
  }

  try {
    await claimSend(to.replace(/^\+/, ''));
    await sendViaSemaphore(to, sms.otp);
    console.log('send-sms-hook: code handed to Semaphore.');
    return respond(200);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof LimitError) {
      console.warn('send-sms-hook: daily limit reached, nothing sent:', reason);
      return respond(429, reason);
    }
    console.error('send-sms-hook:', reason);
    return respond(error instanceof SemaphoreError ? 502 : 500, `Failed to send SMS: ${reason}`);
  }
});