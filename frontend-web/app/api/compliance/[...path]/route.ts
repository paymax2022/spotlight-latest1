import { NextResponse } from 'next/server';

/**
 * Catch-all stub: /api/compliance/<...> → 501 Not Implemented.
 *
 * Audit finding (academy E2E): the /academy/compliance dashboards
 * (app/academy/compliance/page.tsx and the src/hooks/useCompliance* hooks) call
 * ~25 endpoints under /api/compliance/* — metrics, reports, alerts, trends,
 * schedules, export, incidents, workflows, automation rules, analytics, KPIs,
 * insights, benchmarks, risk escalations, recommendations, consent-log — but NO
 * such routes exist: not as Next route handlers and not on the Go backend
 * (the only Go "compliance" surface is referral-scoped at
 * /api/finance/referral/compliance/* + /api/referral/admin/compliance/*, a
 * different feature). The UI shipped ahead of its API.
 *
 * Returning an explicit 501 keeps the gap greppable and gives the hooks a JSON
 * error instead of Next's HTML 404 — they already degrade to their error/empty
 * states on a non-OK response. When a real compliance API is built, specific
 * route handlers added under this path take precedence over this catch-all.
 */
export const dynamic = 'force-dynamic';

function notImplemented(request: Request) {
  const pathname = new URL(request.url).pathname;
  return NextResponse.json(
    {
      success: false,
      error: `Not implemented: ${pathname} — the compliance API surface does not exist yet.`,
    },
    { status: 501 },
  );
}

export const GET = notImplemented;
export const POST = notImplemented;
export const PUT = notImplemented;
export const PATCH = notImplemented;
export const DELETE = notImplemented;
export const HEAD = notImplemented;
