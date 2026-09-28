// Supabase "Send SMS" Auth Hook — sends the real OTP text via Semaphore.
// Generated 2026-09-23, revised 2026-09-24. Context: ../../../../CHANGES.md,
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
// with Semaphore for the sender name (submitted 2026-09-23); change one, check
// the other.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const SEMAPHORE_API_KEY = Deno.env.get('SEMAPHORE_API_KEY');

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
    body: new URLSearchParams({ apikey: SEMAPHORE_API_KEY, number, message }),
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
  let sms: { otp: string };
  try {
    const wh = new Webhook(hookSecret.replace('v1,whsec_', ''));
    ({ user, sms } = wh.verify(payload, headers) as { user: { phone: string }; sms: { otp: string } });
  } catch (error) {
    console.error(
      'send-sms-hook: signature check failed — SEND_SMS_HOOK_SECRET most likely does not match the secret Supabase shows for this hook (copy it again, whole, including the v1,whsec_ start).',
      error instanceof Error ? error.message : String(error),
    );
    return respond(403, 'Signature verification failed.');
  }

  try {
    await sendViaSemaphore(user.phone, sms.otp);
    console.log('send-sms-hook: code handed to Semaphore.');
    return respond(200);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('send-sms-hook:', reason);
    return respond(error instanceof SemaphoreError ? 502 : 500, `Failed to send SMS: ${reason}`);
  }
});