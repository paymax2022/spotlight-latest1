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

  return errorResponse(fallbackMessage, 500);
}
