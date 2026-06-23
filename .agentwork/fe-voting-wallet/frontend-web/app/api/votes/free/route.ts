import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { castFreeVote } from '@/src/server/voting/free-vote.service';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import type { CastFreeVoteRequest } from '@/src/features/voting/types';

function getIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}

function getDevice(request: Request): string {
  return request.headers.get('x-device-fingerprint') || '';
}

async function tryGetUserId(request: Request): Promise<string | undefined> {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return undefined;
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser(token);
    return data.user?.id;
  } catch {
    return undefined;
  }
}

async function verifyCaptcha(token: string): Promise<boolean> {
  // Supports Cloudflare Turnstile and hCaptcha.
  // Set CAPTCHA_SECRET_KEY and CAPTCHA_VERIFY_URL in env.
  const secret = process.env.CAPTCHA_SECRET_KEY;
  const verifyUrl = process.env.CAPTCHA_VERIFY_URL ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  if (!secret) return true; // If no secret is configured, skip CAPTCHA check.

  try {
    const res = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    const json = (await res.json()) as { success: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const ip = getIp(request);

    // --- Rate limit: 30 free-vote requests per IP per minute ---
    const rl = checkRateLimit(`vote:free:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      return errorResponse('Too many requests. Please slow down.', 429);
    }

    const body = (await request.json()) as CastFreeVoteRequest & { captchaToken?: string };
    if (!body.contestId) return errorResponse('contestId is required', 400);
    if (!body.contestantId) return errorResponse('contestantId is required', 400);

    // --- CAPTCHA verification (when required by contest settings) ---
    if (body.captchaToken) {
      const valid = await verifyCaptcha(body.captchaToken);
      if (!valid) return errorResponse('CAPTCHA verification failed. Please try again.', 400);
    }

    const device = getDevice(request);
    const ua = request.headers.get('user-agent') || '';
    const userId = await tryGetUserId(request);

    const result = await castFreeVote(body, ip, device, ua, userId);
    return successResponse({ ...result });
  } catch (error) {
    return handleApiError(error, 'Failed to cast vote');
  }
}
