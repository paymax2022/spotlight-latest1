import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Sets/clears the HttpOnly session cookie the admin middleware reads. The client
// (features/auth/adminAuth) POSTs its Supabase access token here after sign-in so
// the session becomes server-readable; middleware.ts verifies it (HS256 when
// SUPABASE_JWT_SECRET is set). Storing the token in an HttpOnly cookie keeps it
// out of JS reach; the legacy localStorage copy still powers the service-layer
// Bearer calls until those migrate to cookie auth (tracked separately).

const SESSION_COOKIE = 'sb-admin-token';
const MAX_TTL_SECONDS = 60 * 60; // cap at 1h regardless of client input

export async function POST(req: Request): Promise<NextResponse> {
  let token: unknown;
  let maxAge: unknown;
  try {
    const body = await req.json();
    token = body?.token;
    maxAge = body?.maxAge;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request body.' }, { status: 400 });
  }

  // Shape check only — the middleware is the authority on validity (verifies the
  // signature). We never trust this endpoint to authorize anything.
  if (typeof token !== 'string' || token.length < 20 || token.split('.').length !== 3) {
    return NextResponse.json({ ok: false, error: 'A valid session token is required.' }, { status: 400 });
  }

  const ttl = typeof maxAge === 'number' && maxAge > 0 ? Math.min(Math.floor(maxAge), MAX_TTL_SECONDS) : MAX_TTL_SECONDS;

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ttl,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(): Promise<NextResponse> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
