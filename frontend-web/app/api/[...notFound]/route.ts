import { NextResponse } from 'next/server';

/**
 * JSON 404 for unmatched /api/* paths.
 *
 * Without this, a request for an API path no route handler claims (typo'd
 * endpoints, stale mobile builds, probes) falls through to the app's HTML 404
 * page — wrong Content-Type and wrong shape for an API caller, and it makes
 * "endpoint missing" indistinguishable from "returned markup".
 *
 * Safety: Next resolves more-specific routes before catch-alls at each segment
 * level, so every existing handler under app/api/ (including the deeper
 * catch-alls like app/api/v1/[...path], which own their subtree) keeps
 * serving its own paths. This handler only sees what nothing else claimed.
 *
 * OPTIONS never reaches here — the root middleware answers /api/* preflights
 * with 204 first — and middleware still decorates this response with CORS
 * headers for allow-listed origins.
 */
export const dynamic = 'force-dynamic';

async function notFound(request: Request, ctx: { params: Promise<{ notFound: string[] }> }) {
  const { notFound: segments } = await ctx.params;
  const path = `/api/${segments.join('/')}`;
  return NextResponse.json(
    { success: false, error: `No API route matches ${request.method} ${path}` },
    { status: 404 },
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
