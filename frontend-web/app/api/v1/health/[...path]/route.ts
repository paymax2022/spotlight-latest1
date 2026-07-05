import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy for the Health verticals member API (shared platform +
// pharmacy/lab/vet). /api/v1/health/<...> → Go /api/finance/health/<...>.
// Auth + feature-flag guarded; Go enforces object-level authZ, NDPA
// consent/access-logging, guarded state machines, escrow hold→release→refund,
// and the HL-1..12 invariants. Admin routes (/api/health/<v>/admin/*) hit Go
// directly. Money mutations forward the Idempotency-Key. X-Device-Id (sent by
// the mobile clients on symptom-search) is forwarded too — Go meters the
// per-user+device rate limit off its salted hash, falling back to IP when absent.

// X-Device-Id is an opaque per-install identifier (the mobile clients mint a
// uuid). Only a bounded, printable-token value is ever forwarded upstream —
// anything else (oversized, control chars, header-injection attempts) is
// dropped and the backend falls back to IP-based metering.
const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

async function forward(request: Request, path: string[]) {
  if (!featureFlags.health()) return errorResponse('Health services are not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    const deviceId = request.headers.get('X-Device-Id');
    const safeDeviceId = deviceId && DEVICE_ID_RE.test(deviceId) ? deviceId : null;
    return proxyToGoBackend(request, `/api/finance/health/${sub}`, safeDeviceId ? { headers: { 'X-Device-Id': safeDeviceId } } : undefined);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}
