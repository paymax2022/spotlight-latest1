import { NextResponse } from 'next/server';
import { requireRequestUser, getRequestUserRole } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

/**
 * GET /api/v1/admin/contests — the contest list for the admin console.
 *
 * ADMIN CONSOLIDATION, SLICE 3 (path A). frontend-admin is the surviving admin
 * console, but several consoles that still live in frontend-web are SERVER
 * COMPONENTS reading frontend-web's own TypeScript layer directly — there is no
 * Go module behind them. Rather than invent those Go modules before anything can
 * move, path A exposes the data frontend-web already has as an authenticated API
 * that frontend-admin reaches through its proxy.
 *
 * Auth works across the two apps without a bridge: frontend-admin signs in with
 * supabase.auth.signInWithPassword and keeps session.access_token, and
 * requireRequestUser validates exactly that token via supabase.auth.getUser.
 * Both apps are Supabase underneath — the difference is the sign-in UI and where
 * the token is held, not the identity provider.
 *
 * The role check is explicit here because requireRequestUser answers "who are
 * you", not "may you" — the same gap that left /api/crowdfunding/admin
 * authenticated but unauthorized until e7945b3d.
 */
const ADMIN_ROLES = new Set(['admin', 'super-admin', 'system-admin', 'superadmin']);

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);

    const role = (await getRequestUserRole(user.id)) ?? '';
    if (!ADMIN_ROLES.has(role.toLowerCase())) {
      return errorResponse('Admin access required.', 403);
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') ?? undefined;

    const supabase = createAdminClient();
    let query = supabase
      .from('contests')
      .select('id, name, contest_type, status, start_date, end_date, created_at')
      .order('created_at', { ascending: false });

    if (type) query = query.eq('contest_type', type);

    const { data, error } = await query;
    if (error) throw error;

    // `contests` is the envelope frontend-admin's services already expect (see
    // crowdfundingAdminService), so the client shape stays consistent across the
    // Go-backed and web-backed modules.
    return NextResponse.json({ contests: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}
