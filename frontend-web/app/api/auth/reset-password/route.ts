import { NextResponse } from 'next/server';
import { createServiceClient, extractBearerToken } from '../_supabase';
import { callGo, goErrorMessage } from '../_otp';

/**
 * POST /api/auth/reset-password — completes a password reset.
 *
 * TWO SHAPES, because the reset EMAIL carries two mechanisms:
 *
 *   { email, code, password }  → the emailed CODE, completed by the Go backend.
 *   { password } + Bearer      → the emailed LINK, whose recovery session the
 *                                client already holds. Unchanged.
 *
 * Both are supported deliberately: /api/auth/request-password-reset sends the
 * Supabase link AND our code, so a user may arrive holding either. Dropping the
 * link path would break every reset already in someone's inbox.
 *
 * The code path falls back to nothing. If Go says the feature is closed there is
 * no Supabase equivalent for a code Supabase never issued, so the caller is told
 * to use the link instead — which is the mechanism that is working in that state.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password, email, code } = body ?? {};

    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // ── the emailed code ──
    if (email && code) {
      const go = await callGo('/api/auth/reset-password', {
        email: String(email).trim().toLowerCase(),
        code: String(code).trim(),
        newPassword: password,
      });

      if (go.kind === 'answered') {
        if (go.status >= 400) {
          return NextResponse.json(
            { error: goErrorMessage(go.body, 'Password reset failed') },
            { status: go.status },
          );
        }
        return NextResponse.json({ message: 'Password updated successfully' });
      }

      console.info('[auth/reset-password] code path unavailable:', go.reason);
      return NextResponse.json(
        { error: 'Code-based reset is unavailable. Please use the link in the reset email.' },
        { status: 503 },
      );
    }

    // ── the emailed link ──
    // The client sends the recovery access token as the Bearer header after
    // following the link (deep-linked back into the app on mobile).
    const token = extractBearerToken(request);
    if (!token) {
      return NextResponse.json(
        { error: 'A reset code or a reset link session is required' },
        { status: 400 },
      );
    }

    const admin = createServiceClient();

    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 401 });
    }

    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 500 });
    }

    return NextResponse.json({ message: 'Password updated successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Password reset failed' }, { status: 500 });
  }
}
