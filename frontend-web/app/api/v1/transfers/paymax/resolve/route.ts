/**
 * GET /api/v1/transfers/paymax/resolve?identifier=<cashtag|phone|email>
 *
 * Resolve a Paymax recipient by cashtag, phone number, or email.
 * Returns a safe preview (masked phone, display name) — no PII exposed.
 * For a `@`/`$` cashtag the normalised `handle` is echoed, so the confirmation
 * screen can show what the sender typed instead of a number they never used.
 * Requires Bearer token and FEATURE_WALLET_TRANSFERS_ENABLED.
 */
import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireFeature } from '@/src/lib/feature-flags';
import { resolvePaymaxUser } from '@/src/server/transfers/wallet-to-wallet';

export async function GET(request: Request) {
  try {
    requireFeature('walletTransfers');

    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const identifier = (searchParams.get('identifier') ?? '').trim();

    if (!identifier) {
      return NextResponse.json(
        { success: false, error: 'identifier query param is required' },
        { status: 400 },
      );
    }

    const recipient = await resolvePaymaxUser(identifier, user.id);

    return NextResponse.json({
      success: true,
      recipient: {
        user_id:      recipient.userId,
        display_name: recipient.displayName,
        masked_phone: recipient.maskedPhone,
        avatar_url:   recipient.avatarUrl,
        // Undefined for phone/email sends, so JSON.stringify drops the key
        // rather than sending `"handle": null` on every legacy lookup.
        handle:       recipient.handle,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
