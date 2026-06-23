import { NextRequest, NextResponse } from 'next/server';

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

function cleanupExpiredEntries(now: number) {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(',');
    if (firstIp?.trim()) {
      return firstIp.trim();
    }
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp?.trim()) {
    return realIp.trim();
  }

  return '0.0.0.0';
}

export function getRateLimitKey(request: NextRequest, scope: string, identifier?: string): string {
  const clientIp = getClientIp(request);
  const suffix = identifier?.trim() || clientIp;
  return `${scope}:${suffix}`;
}

export function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions
): NextResponse | null {
  const now = Date.now();

  if (rateLimitStore.size > 1000) {
    cleanupExpiredEntries(now);
  }

  const existingEntry = rateLimitStore.get(options.key);
  if (!existingEntry || existingEntry.resetAt <= now) {
    rateLimitStore.set(options.key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return null;
  }

  if (existingEntry.count >= options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existingEntry.resetAt - now) / 1000));

    return NextResponse.json(
      {
        success: false,
        error: 'Too many requests. Please wait a moment and try again.',
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Limit': String(options.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(existingEntry.resetAt),
        },
      }
    );
  }

  existingEntry.count += 1;
  rateLimitStore.set(options.key, existingEntry);
  return null;
}
