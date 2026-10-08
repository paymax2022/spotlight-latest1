import { NextResponse } from 'next/server';

/**
 * JSON 404 for the bare `/api` path — the one API URL the
 * app/api/[...notFound] catch-all can't see (catch-alls require at least one
 * segment). Same rationale: an API caller should never get the HTML 404 page.
 * Deeper paths are unaffected — this only matches `/api` exactly.
 */
export const dynamic = 'force-dynamic';

function notFound(request: Request) {
  return NextResponse.json(
    { success: false, error: `No API route matches ${request.method} /api` },
    { status: 404 },
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
