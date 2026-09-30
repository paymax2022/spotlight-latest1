import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import type { AdminListMeta } from '@/src/server/admin/query';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function successResponse<T extends Record<string, unknown>>(payload: T, status = 200) {
  return NextResponse.json(payload, { status });
}

export function listResponse<T>(
  key: string,
  items: T[],
  meta: AdminListMeta,
  extra: Record<string, unknown> = {},
  status = 200,
) {
  return NextResponse.json(
    {
      success: true,
      [key]: items,
      meta,
      ...extra,
    },
    { status },
  );
}

export function errorResponse(message: string, status = 500) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export function handleApiError(error: unknown, fallbackMessage = 'Internal server error') {
  if (error instanceof ApiError) {
    return errorResponse(error.message, error.status);
  }

  if (error instanceof Error && error.message === 'UNAUTHORIZED') {
    return errorResponse('Unauthorized', 401);
  }

  if (error instanceof Error && error.message === 'FORBIDDEN') {
    return errorResponse('Forbidden', 403);
  }

  // Everything reaching this branch is an UNEXPECTED error — it must not
  // vanish. ApiError/401/403 above are control flow; this path is a defect
  // or dependency failure and needs a trace in both planes.
  console.error('[api] unhandled error:', error);
  Sentry.captureException(error);

  return errorResponse(fallbackMessage, 500);
}
