import { extractSessionToken, isSessionValid, resolveEnforce } from '../../../middleware';
import { apiV1 } from '@/config/env';

/**
 * Self-gate for /api/* routes that sit outside the '/admin/:path*' middleware
 * matcher but perform privileged work. A session "counts" only when the
 * backend admits the bearer as a console admin — the same menu-counts probe
 * signInAdmin uses (RequireAdminConsoleRole). A merely-valid Supabase JWT is
 * NOT enough: the public anon key and every registered account satisfy
 * isSessionValid. Fails closed on any non-2xx or network error.
 */
export async function requireAdminSession(request: Request): Promise<boolean> {
  if (!resolveEnforce(process.env.ADMIN_MIDDLEWARE_ENFORCE)) return false;
  const token = extractSessionToken(request.headers.get('cookie'));
  if (!(await isSessionValid(token))) return false;
  try {
    const probe = await fetch(`${apiV1()}/admin/menu-counts`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    });
    return probe.ok;
  } catch {
    return false;
  }
}
