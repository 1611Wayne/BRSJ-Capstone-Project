import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// True when .env.local (or the Vercel project) has the values the server needs. Without them the app keeps
// running on the built-in sample data, so a teammate without keys can still work on screens.
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let admin: SupabaseClient | undefined;

// Server-only client with the SECRET key. It bypasses every access rule (RLS), so use it only in server code that
// decides for itself what the caller may see, and select only the columns that caller is allowed to get.
// The 'server-only' import above makes the build fail if a browser component ever imports this file.
export function supabaseAdmin(): SupabaseClient {
  if (!supabaseConfigured()) throw new Error('Supabase is not configured: fill in .env.local (see .env.example).');
  admin ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
