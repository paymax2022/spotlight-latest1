/**
 * Unified transfers feature — data layer.
 *
 * Toggle: EXPO_PUBLIC_TRANSFERS_USE_MOCK
 *   - unset / 'true'  → fully offline mock (default; whole flow runs standalone)
 *   - 'false'         → live calls through the Next proxy at /api/v1/transfers/*
 *
 * Money endpoints go through the Next proxy (base = EXPO_PUBLIC_API_BASE_URL).
 * Idempotency-Key is attached to every money mutation via generateIdempotencyKey.
 * The PIN is a real gate — it is verified before any transfer is initiated.
 *
 * Wallet → wallet (Paymax P2P) keeps using the existing transfers.api.ts so the
 * P2P flow is unchanged.
 */
import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { transfersMock } from './mock';
import type {
  Bank,
  ResolvedAccount,
  TransferReceiptData,
  WalletBankTransferInput,
  BankToBankTransferInput,
} from './types';

export const USE_MOCK =
  (process.env.EXPO_PUBLIC_TRANSFERS_USE_MOCK ?? 'true') !== 'false';

type ApiRecord = Record<string, unknown>;
const unwrap = (res: { data?: ApiRecord }): ApiRecord =>
  (res.data?.data ?? res.data ?? {}) as ApiRecord;

// ── Bank list ────────────────────────────────────────────────────────────────

export async function fetchBanks(): Promise<Bank[]> {
  if (USE_MOCK) return transfersMock.fetchBanks();
  const res = await api.get('/api/v1/transfers/banks');
  const data = unwrap(res);
  const list = (Array.isArray(data.banks) ? data.banks : Array.isArray(data) ? data : []) as ApiRecord[];
  return list.map((b) => ({
    code: String(b.code ?? ''),
    name: String(b.name ?? ''),
    slug: String(b.slug ?? ''),
  }));
}

// ── Account-name resolution ──────────────────────────────────────────────────

export async function resolveAccount(
  bankCode: string,
  accountNumber: string,
  provider?: string,
): Promise<ResolvedAccount> {
  if (USE_MOCK) return transfersMock.resolveAccount(bankCode, accountNumber);
  const res = await api.post('/api/v1/transfers/resolve-account', {
    bankCode,
    accountNumber,
    provider,
  });
  const data = unwrap(res);
  return {
    accountName: String(data.accountName ?? data.account_name ?? ''),
    accountNumber: String(data.accountNumber ?? data.account_number ?? accountNumber),
    bankCode,
  };
}

// ── Transaction PIN gate ─────────────────────────────────────────────────────

export async function getPinStatus(): Promise<{ hasPin: boolean }> {
  if (USE_MOCK) return transfersMock.getPinStatus();
  const res = await api.get('/api/v1/transfers/pin/status');
  const data = unwrap(res);
  return { hasPin: Boolean(data.hasPin ?? data.has_pin ?? false) };
}

/**
 * Set or CHANGE the transaction PIN.
 *
 * `currentPin` is required by the backend whenever a PIN already exists: SetPin
 * verifies it before overwriting. Omitting it does not merely fail — the empty
 * string is evaluated as a WRONG GUESS and counts toward the 5-failure lockout,
 * so a client that forgets it can lock the user out of transfers.
 */
export async function createPin(pin: string, currentPin?: string): Promise<void> {
  if (USE_MOCK) return transfersMock.createPin(pin);
  await api.post('/api/v1/transfers/pin', currentPin ? { pin, current_pin: currentPin } : { pin });
}

export async function verifyPin(pin: string): Promise<void> {
  if (USE_MOCK) return transfersMock.verifyPin(pin);
  await api.post('/api/v1/transfers/pin/verify', { pin });
}

// ── Wallet → Bank ────────────────────────────────────────────────────────────

export async function walletToBankTransfer(
  input: WalletBankTransferInput,
): Promise<TransferReceiptData> {
  if (USE_MOCK) return transfersMock.walletToBank(input);
  const res = await api.post(
    '/api/v1/transfers/bank',
    {
      bank_code: input.bankCode,
      account_number: input.accountNumber,
      amount_kobo: input.amountKobo,
      narration: input.narration?.slice(0, 100),
      save_beneficiary: input.saveBeneficiary ?? false,
      pin: input.pin,
    },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  const data = unwrap(res);
  const t = (data.transfer ?? data) as ApiRecord;
  return {
    reference: String(t.reference ?? ''),
    amountKobo: Number(t.amount_kobo ?? input.amountKobo),
    feeKobo: Number(t.fee_kobo ?? 0),
    totalKobo: Number(t.total_debit_kobo ?? input.amountKobo),
    destinationName: String(t.account_name ?? input.accountName),
    destinationDetail: `${input.bankName} • •••• ${input.accountNumber.slice(-4)}`,
    sourceLabel: 'Wallet',
    status: String(t.status ?? 'funds_reserved'),
    createdAt: String(t.created_at ?? new Date().toISOString()),
  };
}

// ── Bank → Bank (provider pass-through) ──────────────────────────────────────

export async function bankToBankTransfer(
  input: BankToBankTransferInput,
): Promise<TransferReceiptData> {
  if (USE_MOCK) return transfersMock.bankToBank(input);
  const res = await api.post(
    '/api/v1/transfers/bank-to-bank',
    {
      source_bank_code: input.source.bankCode,
      source_account_number: input.source.accountNumber,
      destination_bank_code: input.destination.bankCode,
      destination_account_number: input.destination.accountNumber,
      amount_kobo: input.amountKobo,
      narration: input.narration?.slice(0, 100),
      save_beneficiary: input.saveBeneficiary ?? false,
      pin: input.pin,
    },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  const data = unwrap(res);
  const t = (data.transfer ?? data) as ApiRecord;
  return {
    reference: String(t.reference ?? ''),
    amountKobo: Number(t.amount_kobo ?? input.amountKobo),
    feeKobo: Number(t.fee_kobo ?? 0),
    totalKobo: Number(t.total_debit_kobo ?? input.amountKobo),
    destinationName: String(t.account_name ?? input.destination.accountName),
    destinationDetail: `${input.destination.bankName} • •••• ${input.destination.accountNumber.slice(-4)}`,
    sourceLabel: `${input.source.bankName} • •••• ${input.source.accountNumber.slice(-4)}`,
    status: String(t.status ?? 'processing'),
    createdAt: String(t.created_at ?? new Date().toISOString()),
    provider: (t.provider as string | undefined) ?? 'Paystack',
  };
}

// ── Fee schedule (display only; backend is authoritative) ─────────────────────

export function walletBankFee(amountKobo: number): number {
  if (amountKobo <= 500_000) return 1_000;
  if (amountKobo <= 5_000_000) return 2_500;
  return 5_000;
}

export function bankToBankFee(amountKobo: number): number {
  if (amountKobo <= 500_000) return 2_500;
  if (amountKobo <= 5_000_000) return 5_000;
  return 7_500;
}
