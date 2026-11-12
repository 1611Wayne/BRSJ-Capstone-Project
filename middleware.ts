import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Keeps the Supabase sign-in session fresh: on each page request it lets Supabase renew an expiring token and writes
// the new cookies to both the request (for the server code that runs next) and the response (for the browser).
// Does nothing unless real sign-in is switched on (NEXT_PUBLIC_AUTH_MODE=supabase).
//
// Page guard (DB-5, 2026-11-12): the Staff, Admin and resident pages are only sent to someone signed in with that role,
// read from the DATABASE (their own profile row), so changing the page in the browser cannot open another role's
// screens. Not signed in: to Login (and back to this page afterwards). Inactive: to Login. Wrong role: to their own
// dashboard. The server routes check the role again on every request (lib/server/currentUser.ts); this only stops the
// screens themselves. RoleGate in the browser still handles the finer steps (an unfinished registration).
const AREAS = ['resident', 'staff', 'admin'] as const;

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (process.env.NEXT_PUBLIC_AUTH_MODE !== 'supabase' || !url || !key) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();

  const area = AREAS.find(a => request.nextUrl.pathname === '/' + a || request.nextUrl.pathname.startsWith('/' + a + '/'));
  if (!area) return response;
  // A redirect keeps any renewed sign-in cookies.
  const go = (path: string, next?: string) => {
    const target = new URL(path, request.url);
    if (next) target.searchParams.set('next', next);
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach(c => redirect.cookies.set(c));
    return redirect;
  };
  if (!user) return go('/login', request.nextUrl.pathname + request.nextUrl.search);
  const { data: profile } = await supabase.from('profiles').select('role, status').eq('id', user.id).maybeSingle();
  if (!profile || profile.status !== 'Active') return go('/login');
  if (profile.role !== area) return go('/' + profile.role + '/dashboard');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};
