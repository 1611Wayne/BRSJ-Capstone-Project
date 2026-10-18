import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from './config';

let client: SupabaseClient | undefined;

// Browser client with the PUBLISHABLE key. It acts as the signed-in user, so the database access rules decide
// what it may read; the session lives in cookies that the server can read too.
export function supabaseBrowser(): SupabaseClient {
  client ??= createBrowserClient(supabaseUrl, supabaseAnonKey);
  return client;
}
