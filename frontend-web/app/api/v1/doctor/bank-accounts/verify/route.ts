import { NextResponse } from 'next/server';
import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Proxy: POST /api/v1/doctor/bank-accounts/verify
//      → Go POST /api/v1/doctor/profile/bank-account/verify.
//
// The previous implementation was dead both ways: it read the `access_token`
// COOKIE (the Bearer header every sibling route and mobile clients send was
// ignored → 401) and forwarded to `${NEXT_PUBLIC_API_URL}` — a variable that
// defaults to http://localhost:8000, not the Go backend (GO_BACKEND_URL), and
// it bypassed proxyToGoBackend entirely (no rate limit, no request-id, no
// client-IP forwarding). Body passes through verbatim; Go binds/validates
// bank_code/account_number/bank_name itself.
export async function POST(request: Request) {
  try {
    // Flag gate FIRST — the whole /api/v1/doctor/* module is unmounted in Go
    // when FEATURE_DOCTOR_ENABLED is off. Answering validation errors here
    // while every sibling 404s leaks that this leaf exists (error-shape
    // enumeration) and invites traffic against a dead upstream.
    if (!featureFlags.doctor()) {
      return NextResponse.json(
        { error: 'This service is not available.' },
        { status: 503 }
      );
    }
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/v1/doctor/profile/bank-account/verify', { method: 'POST' });
  } catch (err) { return handleApiError(err); }
}
