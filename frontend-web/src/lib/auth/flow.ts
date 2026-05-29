'use client';

import { authHeaders } from '@/src/lib/auth/client';

export function buildLoginHref(nextPath: string): string {
  return `/open-mic/login?next=${encodeURIComponent(nextPath)}`;
}

export function redirectToLogin(nextPath: string): void {
  if (typeof window !== 'undefined') {
    window.location.href = buildLoginHref(nextPath);
  }
}

export function isUnauthorized(response: Response): boolean {
  return response.status === 401;
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { json?: boolean } = {}
): Promise<Response> {
  const headers = {
    ...(await authHeaders(Boolean(options.json))),
    ...(init.headers || {}),
  };
  return fetch(input, { ...init, headers });
}
