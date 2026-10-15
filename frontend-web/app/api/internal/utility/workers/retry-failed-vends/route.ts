import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runUtilityVendRetries } from '@/src/server/utility/service';

export const dynamic = 'force-dynamic';

// Machine-to-machine trigger for a scheduler (see
// .github/workflows/utility-vend-retry.yml). It can cause a vend or a refund, so it
// fails closed: with no UTILITY_WORKER_SECRET configured the route is unavailable
// rather than open. Safe to call repeatedly — every money leg is idempotent and
// every row is claimed with a version check before it is touched.
function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Hash both sides first so the compare is constant-time regardless of length.
function secretMatches(provided: string, expected: string) {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.UTILITY_WORKER_SECRET;
  if (!expected) return json({ success: false, error: 'Worker is not configured.' }, 503);

  const provided = request.headers.get('x-worker-secret') ?? '';
  if (!provided || !secretMatches(provided, expected)) {
    return json({ success: false, error: 'Unauthorized.' }, 401);
  }

  const raw = parseInt(new URL(request.url).searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 25;

  try {
    const summary = await runUtilityVendRetries({ limit });
    return json({ success: true, ...summary }, 200);
  } catch (err) {
    console.error('[utility/vend-retry] run failed:', err instanceof Error ? err.message : err);
    return json({ success: false, error: 'Vend retry run failed.' }, 500);
  }
}
