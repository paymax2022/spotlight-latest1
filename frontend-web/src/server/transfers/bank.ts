/**
 * Block 11 — Wallet-to-Bank Transfer Service
 *
 * Provides:
 *   listBanks()                  — fetch all NGN banks from Paystack (cached 1h)
 *   resolveBankAccount()         — validate account number via Paystack
 *   getOrCreateRecipient()       — find/create Paystack transfer recipient
 *   calculateBankTransferFee()   — PRD §18.2 fee schedule
 *   initiateWalletToBank()       — reserve funds + call Paystack transfer API
 *
 * Transfer lifecycle:
 *   funds_reserved → provider_initiated → (webhook) → successful | failed
 *
 * On failure the webhook handler (bank-webhook.ts) inserts a REVERSAL_DEBIT
 * ledger entry to restore the sender's balance.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { getOrCreateAccount } from '@/src/server/wallet/service';
import { enforceWalletLimit } from '@/src/server/tiers/service';
import { autoSaveBeneficiary, touchLastUsed } from '@/src/server/transfers/beneficiaries';

const PAYSTACK_API = 'https://api.paystack.co';
const MIN_BANK_TRANSFER_KOBO = 100_000; // ₦1,000 minimum

// ---------------------------------------------------------------------------
// Fee schedule (PRD §18.2)
// ---------------------------------------------------------------------------

export function calculateBankTransferFee(amountKobo: number): number {
  if (amountKobo <= 500_000)   return 1_000;  // ₦0–₦5,000:  ₦10
  if (amountKobo <= 5_000_000) return 2_500;  // ₦5,001–₦50,000: ₦25
  return 5_000;                                // > ₦50,000: ₦50
}

// ---------------------------------------------------------------------------
// Paystack helper
// ---------------------------------------------------------------------------

async function paystackRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new ApiError('Paystack is not configured', 500);

  const res = await fetch(`${PAYSTACK_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(`Paystack error ${res.status}: ${body}`, res.status >= 500 ? 502 : res.status);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// listBanks
// ---------------------------------------------------------------------------

export interface BankItem {
  code: string;
  name: string;
  slug: string | null;
  type: string | null;
}

/** Returns the list of NGN banks supported by Paystack. */
export async function listBanks(): Promise<BankItem[]> {
  const json = await paystackRequest<{
    status: boolean;
    data: Array<{ code: string; name: string; slug?: string; type?: string }>;
  }>('/bank?currency=NGN&perPage=200');

  return (json.data ?? []).map((b) => ({
    code: b.code,
    name: b.name,
    slug: b.slug ?? null,
    type: b.type ?? null,
  }));
}

// ---------------------------------------------------------------------------
// resolveBankAccount
// ---------------------------------------------------------------------------

export interface ResolvedAccount {
  accountName: string;
  accountNumber: string;
}

export async function resolveBankAccount(
  bankCode: string,
  accountNumber: string,
): Promise<ResolvedAccount> {
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new ApiError('Account number must be exactly 10 digits', 400);
  }

  const json = await paystackRequest<{
    status: boolean;
    data?: { account_name?: string; account_number?: string };
    message?: string;
  }>(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);

  if (!json.status || !json.data?.account_name) {
    throw new ApiError(json.message ?? 'Could not resolve account', 404);
  }

  return {
    accountName: json.data.account_name,
    accountNumber: json.data.account_number ?? accountNumber,
  };
}

// ---------------------------------------------------------------------------
// getOrCreateRecipient
// ---------------------------------------------------------------------------

async function getOrCreateRecipient(input: {
  userId: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Promise<{ recipientId: string | null; recipientCode: string }> {
  const supabase = createAdminClient();

  // Check if we already have a stored recipient for this user+bank+account
  const { data: existing } = await supabase
    .from('bank_transfer_recipients')
    .select('id, paystack_recipient_code')
    .eq('user_id', input.userId)
    .eq('bank_code', input.bankCode)
    .eq('account_number', input.accountNumber)
    .maybeSingle();

  if (existing) {
    return {
      recipientId: (existing as { id: string }).id,
      recipientCode: (existing as { paystack_recipient_code: string }).paystack_recipient_code,
    };
  }

  // Create new Paystack recipient
  const json = await paystackRequest<{
    status: boolean;
    data?: { recipient_code?: string };
    message?: string;
  }>('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban',
      name: input.accountName,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: 'NGN',
    }),
  });

  if (!json.status || !json.data?.recipient_code) {
    throw new ApiError(json.message ?? 'Failed to create transfer recipient', 502);
  }

  const recipientCode = json.data.recipient_code;

  // Persist recipient for reuse
  const { data: inserted } = await supabase
    .from('bank_transfer_recipients')
    .insert({
      user_id: input.userId,
      bank_code: input.bankCode,
      bank_name: input.bankName,
      account_number: input.accountNumber,
      account_name: input.accountName,
      paystack_recipient_code: recipientCode,
    })
    .select('id')
    .maybeSingle();

  return {
    recipientId: (inserted as { id: string } | null)?.id ?? null,
    recipientCode,
  };
}

// ---------------------------------------------------------------------------
// initiateWalletToBank
// ---------------------------------------------------------------------------

export interface WalletToBankInput {
  userId: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amountKobo: number;
  idempotencyKey: string;
  narration?: string;
  saveBeneficiary?: boolean;
}

export interface BankTransferResult {
  alreadyProcessed: boolean;
  transferId: string;
  reference: string;
  amountKobo: number;
  feeKobo: number;
  accountName: string;
  accountNumberLast4: string;
  bankName: string;
  status: string;
  createdAt: string;
}

export async function initiateWalletToBank(
  input: WalletToBankInput,
): Promise<BankTransferResult> {
  if (!Number.isInteger(input.amountKobo) || input.amountKobo < MIN_BANK_TRANSFER_KOBO) {
    throw new ApiError(
      `Minimum bank transfer is ${MIN_BANK_TRANSFER_KOBO} kobo (₦${MIN_BANK_TRANSFER_KOBO / 100})`,
      400,
    );
  }

  const feeKobo = calculateBankTransferFee(input.amountKobo);

  const supabase = createAdminClient();

  // Idempotency: return existing transfer if key already used
  const { data: existing } = await supabase
    .from('bank_transfers')
    .select('id, reference, amount_kobo, fee_kobo, account_number_last4, bank_name, account_name, status, created_at')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    const row = existing as {
      id: string; reference: string; amount_kobo: number; fee_kobo: number;
      account_number_last4: string; bank_name: string; account_name: string;
      status: string; created_at: string;
    };
    return {
      alreadyProcessed: true,
      transferId: row.id,
      reference: row.reference,
      amountKobo: row.amount_kobo,
      feeKobo: row.fee_kobo,
      accountName: row.account_name,
      accountNumberLast4: row.account_number_last4,
      bankName: row.bank_name,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  const narration = (input.narration ?? '').slice(0, 100) || `Transfer to ${input.accountName}`;

  // Get/create Paystack recipient
  const { recipientId, recipientCode } = await getOrCreateRecipient({
    userId: input.userId,
    bankCode: input.bankCode,
    bankName: input.bankName,
    accountNumber: input.accountNumber,
    accountName: input.accountName,
  });

  // Get sender ledger account + enforce tier limit
  const accountId = await getOrCreateAccount(input.userId);
  const { dailyLimitKobo } = await enforceWalletLimit(input.userId, input.amountKobo + feeKobo);

  // Generate Paymax reference
  const reference = `BTF_${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;

  // ① Reserve funds atomically (debit ledger + create bank_transfer row)
  const { data: rpcRows, error: rpcError } = await supabase.rpc('reserve_for_bank_transfer', {
    p_account_id:              accountId,
    p_user_id:                 input.userId,
    p_recipient_id:            recipientId,
    p_bank_code:               input.bankCode,
    p_bank_name:               input.bankName,
    p_account_number_last4:    input.accountNumber.slice(-4),
    p_account_name:            input.accountName,
    p_paystack_recipient_code: recipientCode,
    p_amount_kobo:             input.amountKobo,
    p_fee_kobo:                feeKobo,
    p_reference:               reference,
    p_idempotency_key:         input.idempotencyKey,
    p_daily_limit_kobo:        dailyLimitKobo ?? 0,
    p_narration:               narration,
    p_metadata: {
      user_id: input.userId,
      bank_code: input.bankCode,
      transfer_type: 'wallet_to_bank',
    },
  });

  if (rpcError) {
    if (rpcError.code === '23505') {
      // Idempotency race — retry the idempotency lookup
      return initiateWalletToBank(input);
    }
    if (rpcError.message?.includes('INSUFFICIENT_BALANCE')) {
      throw new ApiError('Insufficient wallet balance', 402);
    }
    if (rpcError.message?.includes('TIER_LIMIT_EXCEEDED')) {
      throw new ApiError('Daily wallet limit for your KYC tier has been reached', 403);
    }
    throw new ApiError(`Failed to reserve funds: ${rpcError.message}`, 500);
  }

  const rpcRow = (rpcRows as Array<{ entry_id: string; transfer_id: string }>)[0];
  const transferId = rpcRow.transfer_id;

  // ② Call Paystack Transfers API
  let paystackTransferCode: string | null = null;
  let paystackTransferId: number | null = null;
  let providerError: string | null = null;

  try {
    const transferJson = await paystackRequest<{
      status: boolean;
      data?: {
        transfer_code?: string;
        id?: number;
        status?: string;
      };
      message?: string;
    }>('/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: input.amountKobo,
        recipient: recipientCode,
        reference,
        reason: narration,
        currency: 'NGN',
      }),
    });

    if (transferJson.data?.transfer_code) {
      paystackTransferCode = transferJson.data.transfer_code;
      paystackTransferId = transferJson.data.id ?? null;
    }
  } catch (err) {
    // Paystack call failed AFTER funds were reserved.
    // Mark as funds_reserved (not failed) — operations can retry manually.
    providerError = err instanceof Error ? err.message : 'Provider call failed';
  }

  // ③ Update bank_transfer with Paystack response
  const newStatus = paystackTransferCode ? 'provider_initiated' : 'funds_reserved';
  await supabase
    .from('bank_transfers')
    .update({
      status: newStatus,
      paystack_transfer_code: paystackTransferCode,
      paystack_transfer_id: paystackTransferId,
      failure_reason: providerError,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transferId);

  // ④ Post-transfer side effects — fire-and-forget, non-blocking
  if (recipientId) {
    const sideEffects: Promise<void>[] = [touchLastUsed(recipientId)];
    if (input.saveBeneficiary) sideEffects.push(autoSaveBeneficiary(input.userId, recipientId));
    await Promise.allSettled(sideEffects);
  }

  return {
    alreadyProcessed: false,
    transferId,
    reference,
    amountKobo: input.amountKobo,
    feeKobo,
    accountName: input.accountName,
    accountNumberLast4: input.accountNumber.slice(-4),
    bankName: input.bankName,
    status: newStatus,
    createdAt: new Date().toISOString(),
  };
}
