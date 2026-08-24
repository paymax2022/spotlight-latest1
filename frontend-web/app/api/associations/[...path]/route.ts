// Catch-all proxy: /associations/* → Go backend /api/v1/finance/associations/*
//
// Path reconciliation: the mobile client calls bare /associations/... (EXPO_PUBLIC_API_BASE_URL
// points at this Next.js app). The Go backend mounts the module at /api/v1/finance/associations.
// This single route handler closes the gap without changing either the client or the backend.
//
// Auth: forwards the Bearer JWT from the originating request.
// Idempotency-Key: forwarded verbatim for every money mutation (IRON RULE).
// Feature-gated: FEATURE_ASSOCIATION_ENABLED=true to go live; 503 otherwise.

import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';

async function proxy(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (!featureFlags.association()) {
    return errorResponse('Association module is not available.', 503);
  }
  try {
    await requireRequestUser(request);

    const params = await ctx.params;
    const suffix = params.path.join('/');
    const url = new URL(request.url);
    const targetUrl = `${GO_BACKEND_URL}/api/v1/finance/associations/${suffix}${url.search}`;

    const method = request.method;
    const hasBody = method !== 'GET' && method !== 'HEAD';

    const headers: HeadersInit = {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    };

    const auth = request.headers.get('Authorization') || request.headers.get('authorization');
    if (auth) headers['Authorization'] = auth;

    // Forward idempotency key on all mutation requests (IRON RULE).
    const idem = request.headers.get('Idempotency-Key');
    if (idem) headers['Idempotency-Key'] = idem;

    let body: BodyInit | undefined;
    if (hasBody) {
      try { body = await request.text(); } catch { /* empty body */ }
    }

    const upstream = await fetch(targetUrl, { method, headers, body });
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export const GET    = proxy;
export const POST   = proxy;
export const PUT    = proxy;
export const PATCH  = proxy;
export const DELETE = proxy;
