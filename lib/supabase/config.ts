// Public settings (safe in the browser). NEXT_PUBLIC_ values are written into the build, so they must be read literally.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Real sign-in (Supabase Auth) is used only when NEXT_PUBLIC_AUTH_MODE=supabase and the project is configured.
// Otherwise the login page uses the prototype's sample accounts, so teammates without keys keep working.
export const useSupabaseAuth = process.env.NEXT_PUBLIC_AUTH_MODE === 'supabase' && Boolean(supabaseUrl && supabaseAnonKey);

// Real accounts have database ids (UUIDs); the prototype's sample accounts have ids like "resident-maria".
export const isRealAccount = (id?: string | null) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
