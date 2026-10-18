import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from './config';

// Server client that acts as the user of THIS request (read from the session cookies), with the publishable key.
// Unlike supabaseAdmin(), it is bound by the database access rules, so it only sees what that user may see.
export function supabaseForRequest(): SupabaseClient {
  const store = cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Called from a Server Component, which cannot set cookies; middleware.ts refreshes them. */ }
      },
    },
  });
}
