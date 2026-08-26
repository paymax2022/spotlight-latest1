import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient, formatUser } from '../_supabase';

/**
 * POST /api/auth/login — delegates to the Go backend.
 *
 * This route used to call supabase.auth.signInWithPassword directly with
 * {email, password}. That made it a SECOND implementation of sign-in, and the two
 * diverged: phone-or-email sign-in lives in the Go resolveLoginEmail, so a phone
 * number worked against Go and failed here. Pointing the mobile app at this
 * gateway therefore fixed one feature by breaking another.
 *
 * Go is now the single source of truth for authentication. It normalises a
 * Nigerian phone number to its last 10 digits, resolves it to an email without
 * ever disclosing that email, applies the lockout/failed-attempt rules, and
 * writes the audit trail — none of which was happening on this path.
 *
 * The response deliberately carries the session in BOTH shapes, because two
 * clients read it differently and neither should have to change:
 *   • `session.access_token`            — what the mobile app reads
 *   • `tokens.accessToken` + `user`     — what this app has always returned
 */
export const dynamic = 'force-dynamic';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';
const TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS ?? 20_000);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    // `identifier` is the new name; `email` stays accepted so existing web
    // callers keep working unchanged.
    const identifier = String(body?.identifier ?? body?.email ?? '').trim();
    const password = body?.password;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: 'Email or phone number and password are required' },
        { status: 400 },
      );
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${GO_BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Log the TARGET, never the credentials.
      console.error(`[auth/login] upstream ${GO_BACKEND_URL} unreachable:`,
        err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'The sign-in service could not be reached.' }, { status: 504 });
    }

    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      // 403 + email_not_confirmed means the password was RIGHT and only
      // verification is missing. It must survive as its own case: collapsing it
      // into 401 told the user their credentials were wrong and left them with
      // no way to reach the code-entry screen.
      if (upstream.status === 403 && payload?.code === 'email_not_confirmed') {
        return NextResponse.json(
          { error: payload?.error ?? 'Your email address has not been verified yet.',
            code: 'email_not_confirmed' },
          { status: 403 },
        );
      }
      // Otherwise pass Go's status through. It answers 401 with a DELIBERATELY
      // generic message so a wrong password and an unknown account are
      // indistinguishable; do not enrich it here.
      return NextResponse.json(
        { error: payload?.error ?? 'Invalid credentials' },
        { status: upstream.status === 400 ? 401 : upstream.status },
      );
    }

    const session = payload?.session ?? {};
    const accessToken = typeof session.access_token === 'string' ? session.access_token : '';
    const refreshToken = typeof session.refresh_token === 'string' ? session.refresh_token : '';
    if (!accessToken || !refreshToken) {
      console.error('[auth/login] upstream returned no session tokens');
      return NextResponse.json({ error: 'Sign in failed. Please try again.' }, { status: 502 });
    }

    // Resolve the user for the legacy response shape. Best-effort: sign-in has
    // already SUCCEEDED at this point, so a profile lookup failing must not turn
    // a good login into an error.
    let user: unknown = null;
    try {
      const anon = createAnonClient();
      const { data: got } = await anon.auth.getUser(accessToken);
      if (got?.user) {
        const admin = createServiceClient();
        const { data: profile } = await admin
          .from('user_profiles')
          .select('full_name, phone, kyc_status')
          .eq('id', got.user.id)
          .maybeSingle();
        user = formatUser(got.user, profile);
      }
    } catch (err) {
      console.error('[auth/login] profile lookup failed after a successful sign-in:',
        err instanceof Error ? err.message : err);
    }

    return NextResponse.json({
      success: true,
      session,                                        // mobile reads session.access_token
      tokens: { accessToken, refreshToken },          // existing web shape
      user,
      message: 'Login successful',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Login failed' }, { status: 500 });
  }
}
