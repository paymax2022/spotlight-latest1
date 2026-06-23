/**
 * Beneficiary Management API — Block 12
 *
 * Wraps:
 *   GET    /api/v1/beneficiaries
 *   POST   /api/v1/beneficiaries
 *   DELETE /api/v1/beneficiaries/:id
 *
 *   POST   /api/v1/banks/resolve  (account name lookup)
 *   POST   /api/v1/transfers/bank (bank transfer initiation)
 */
import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { Beneficiary, BankTransferResult } from '@/types/wallet';

type ApiRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Fee schedule — mirrors backend calculateBankTransferFee()
// ---------------------------------------------------------------------------

export function calculateBankTransferFee(amountKobo: number): number {
  if (amountKobo <= 500_000)   return 1_000;  // ₦0–₦5,000: ₦10
  if (amountKobo <= 5_000_000) return 2_500;  // ₦5,001–₦50,000: ₦25
  return 5_000;                               // > ₦50,000: ₦50
}

// ---------------------------------------------------------------------------
// Beneficiary CRUD
// ---------------------------------------------------------------------------

export async function fetchBeneficiaries(): Promise<Beneficiary[]> {
  const response = await api.get('/api/v1/beneficiaries');
  const data = (response.data?.data ?? response.data) as ApiRecord;
  const list = (Array.isArray(data?.beneficiaries) ? data.beneficiaries : []) as ApiRecord[];
  return list.map(mapBeneficiary);
}

export async function saveBeneficiary(recipientId: string, nickname?: string): Promise<Beneficiary> {
  const response = await api.post('/api/v1/beneficiaries', {
    recipient_id: recipientId,
    nickname,
  });
  const data = (response.data?.data ?? response.data) as ApiRecord;
  return mapBeneficiary((data?.beneficiary ?? data) as ApiRecord);
}

export async function removeBeneficiary(id: string): Promise<void> {
  await api.delete(`/api/v1/beneficiaries/${id}`);
}

// ---------------------------------------------------------------------------
// Bank account resolution
// ---------------------------------------------------------------------------

export interface ResolvedAccount {
  accountName: string;
  accountNumber: string;
}

export async function resolveBankAccount(
  bankCode: string,
  accountNumber: string,
): Promise<ResolvedAccount> {
  const response = await api.post('/api/v1/banks/resolve', {
    bank_code: bankCode,
    account_number: accountNumber,
  });
  const data = (response.data?.data ?? response.data) as ApiRecord;
  return {
    accountName:   String(data?.account_name ?? ''),
    accountNumber: String(data?.account_number ?? accountNumber),
  };
}

// ---------------------------------------------------------------------------
// Bank transfer initiation
// ---------------------------------------------------------------------------

export interface InitiateBankTransferPayload {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amountKobo: number;
  narration?: string;
  saveBeneficiary?: boolean;
}

export async function initiateBankTransfer(
  payload: InitiateBankTransferPayload,
): Promise<BankTransferResult> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post(
    '/api/v1/transfers/bank',
    {
      bank_code:        payload.bankCode,
      account_number:   payload.accountNumber,
      amount_kobo:      payload.amountKobo,
      narration:        payload.narration?.slice(0, 100),
      save_beneficiary: payload.saveBeneficiary ?? false,
    },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  const data = (response.data?.data ?? response.data) as ApiRecord;
  const transfer = (data?.transfer ?? data) as ApiRecord;
  return {
    transferId:          String(transfer.id ?? ''),
    reference:           String(transfer.reference ?? ''),
    amountKobo:          Number(transfer.amount_kobo ?? 0),
    feeKobo:             Number(transfer.fee_kobo ?? 0),
    totalDebitKobo:      Number(transfer.total_debit_kobo ?? 0),
    accountName:         String(transfer.account_name ?? ''),
    accountNumberLast4:  String(transfer.account_number_last4 ?? ''),
    bankName:            String(transfer.bank_name ?? ''),
    status:              String(transfer.status ?? 'funds_reserved'),
    alreadyProcessed:    Boolean(data?.already_processed ?? false),
    createdAt:           String(transfer.created_at ?? new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapBeneficiary(row: ApiRecord): Beneficiary {
  return {
    id:                 String(row.id ?? ''),
    bankCode:           String(row.bankCode ?? row.bank_code ?? ''),
    bankName:           String(row.bankName ?? row.bank_name ?? ''),
    accountNumberLast4: String(row.accountNumberLast4 ?? row.account_number_last4 ?? ''),
    accountName:        String(row.accountName ?? row.account_name ?? ''),
    nickname:           (row.nickname as string | null) ?? null,
    lastUsedAt:         (row.lastUsedAt ?? row.last_used_at ?? null) as string | null,
  };
}
