/**
 * Wire → domain mapper for the wallet-to-wallet recipient preview.
 *
 * GET /api/v1/transfers/paymax/resolve returns `{ recipient: { … } }`; the
 * client used to inline that field list inside resolvePaymaxRecipient(), where
 * a field the server starts sending is silently dropped. Kept as a pure
 * function so the shape is testable without an HTTP mock
 * (tests/unit/transfers/cashtagRecipient.spec.ts).
 */
import type { TransferRecipient } from '@/types/wallet';

type ApiRecord = Record<string, unknown>;

/** Maps one resolve-endpoint `recipient` object into the domain type. */
export function toPaymaxRecipient(recipient: ApiRecord): TransferRecipient {
  return {
    userId:      String(recipient.user_id ?? ''),
    displayName: String(recipient.display_name ?? 'Paymax User'),
    maskedPhone: String(recipient.masked_phone ?? ''),
    avatarUrl:   (recipient.avatar_url as string | null) ?? null,
    // Present only for a `@`/`$` send; `?? null` (not `as string | null`) so a
    // missing key reads as "no handle" rather than undefined leaking onward.
    handle:      typeof recipient.handle === 'string' ? recipient.handle : null,
  };
}
