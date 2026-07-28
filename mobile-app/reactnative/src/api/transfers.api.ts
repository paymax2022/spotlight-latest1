/**
 * Wallet-to-Wallet Transfer API — Block 10
 *
 * Wraps:
 *   GET  /api/v1/transfers/paymax/resolve?identifier=
 *   POST /api/v1/transfers/paymax
 */
import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { TransferRecipient, WalletTransfer } from '@/types/wallet';

type ApiRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Fee schedule — mirrors backend calculateTransferFee() (Block 10)
// ---------------------------------------------------------------------------

/** Returns fee in kobo for a given transfer amount in kobo. */
export function calculateTransferFee(amountKobo: number): number {
  if (amountKobo <= 500_000)   return 0;      // ₦0–₦5,000: free
  if (amountKobo <= 5_000_000) return 1_000;  // ₦5,001–₦50,000: ₦10
  return 2_500;                               // > ₦50,000: ₦25
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

/**
 * Look up a Paymax user by phone, email, or username.
 * Returns a safe preview with masked phone — never exposes full PII.
 */
export async function resolvePaymaxRecipient(identifier: string): Promise<TransferRecipient> {
  const response = await api.get('/api/v1/transfers/paymax/resolve', {
    params: { identifier: identifier.trim() },
  });
  const data = (response.data?.data ?? response.data) as ApiRecord;
  const recipient = (data?.recipient ?? data) as ApiRecord;
  return {
    userId:      String(recipient.user_id ?? ''),
    displayName: String(recipient.display_name ?? 'Paymax User'),
    maskedPhone: String(recipient.masked_phone ?? ''),
    avatarUrl:   (recipient.avatar_url as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Transfer initiation
// ---------------------------------------------------------------------------

export interface InitiateTransferPayload {
  recipientIdentifier: string;
  amountKobo: number;
  narration?: string;
}

export async function initiateWalletTransfer(
  payload: InitiateTransferPayload,
): Promise<WalletTransfer> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post(
    '/api/v1/transfers/paymax',
    {
      recipient_identifier: payload.recipientIdentifier,
      amount_kobo:          payload.amountKobo,
      narration:            payload.narration?.slice(0, 100),
    },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  const data = (response.data?.data ?? response.data) as ApiRecord;
  const transfer = (data?.transfer ?? data) as ApiRecord;
  return {
    id:                   String(transfer.id ?? ''),
    reference:            String(transfer.reference ?? ''),
    amountKobo:           Number(transfer.amount_kobo ?? 0),
    feeKobo:              Number(transfer.fee_kobo ?? 0),
    totalDebitKobo:       Number(transfer.total_debit_kobo ?? 0),
    narration:            (transfer.narration as string | null) ?? null,
    status:               (transfer.status as WalletTransfer['status']) ?? 'successful',
    receiverDisplayName:  String(transfer.receiver_display_name ?? ''),
    alreadyProcessed:     Boolean(data?.already_processed ?? false),
    createdAt:            String(transfer.created_at ?? new Date().toISOString()),
  };
}
