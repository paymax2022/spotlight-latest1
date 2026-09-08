import { NextResponse } from 'next/server';

/**
 * POST /api/auth/register — delegates to the Go backend.
 *
 * This route used to call supabase.auth.signUp directly, which made it a SECOND
 * registration implementation. Sign-in was consolidated onto Go for exactly this
 * reason (see ../login/route.ts); registration was left behind and the two drifted:
 * only this path attributed referrals, only Go wrote an audit event, and Go sent
 * first_name/last_name where this sent full_name — the key the
 * on_auth_user_created trigger actually reads.
 *
 * Go is now the single source of truth. It performs the signup, sets the metadata
 * the profile trigger needs, writes the phone the trigger does not copy, attributes
 * the referral, and records the audit event.
 *
 * The response keeps this route's historic {user, tokens, message} shape so
 * existing web callers are unaffected, and adds needsVerification, which is what
 * the caller must branch on now that both cloud projects require a code.
 */
export const dynamic = 'force-dynamic';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';
const TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS ?? 20_000);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const fullName = String(body?.fullName ?? '').trim();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = body?.password;

    if (!fullName || !email || !password) {
      return NextResponse.json(
        { error: 'Full name, email, and password are required' },
        { status: 400 },
      );
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${GO_BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          phone: String(body?.phone ?? '').trim(),
          password,
          referralCode: body?.referralCode ?? '',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Log the TARGET, never the credentials.
      console.error(`[auth/register] upstream ${GO_BACKEND_URL} unreachable:`,
        err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'The sign-up service could not be reached.' }, { status: 504 });
    }

    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      // Go answers deliberately generically so a taken address is not
      // distinguishable from a rejected one. Do not enrich it here.
      return NextResponse.json(
        { error: payload?.error ?? 'Registration failed' },
        { status: upstream.status },
      );
    }

    return NextResponse.json({
      user: payload?.user ?? null,
      tokens: {
        accessToken: payload?.tokens?.accessToken ?? '',
        refreshToken: payload?.tokens?.refreshToken || undefined,
      },
      // True whenever no session came back — the account exists but cannot be
      // used until the emailed code is entered.
      needsVerification: payload?.needsVerification ?? true,
      message: payload?.message ?? 'Account created successfully',
    });
  } catch (err: unknown) {
    console.error('[auth/register]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
