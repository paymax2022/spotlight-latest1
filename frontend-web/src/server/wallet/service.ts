import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { validateAmountKobo, buildIdempotencyKey } from './ledger';
import type { LedgerEntryRow } from './ledger';
import { checkIdempotencyKey, checkTopupIdempotencyKey } from './idempotency';

const MIN_TOPUP_KOBO = 10_000; // ₦100 minimum

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

/**
 * Find or create the wallet ledger_account for a user.
 * Handles the concurrent-insert race via a re-fetch on UNIQUE conflict.
 */
export async function getOrCreateAccount(userId: string): Promise<string> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'wallet')
    .eq('currency', 'NGN')
    .maybeSingle();

  if (existing) return existing.id as string;

  const newId = crypto.randomUUID();
  const { error } = await supabase
    .from('ledger_accounts')
    .insert({ id: newId, user_id: userId, type: 'wallet', currency: 'NGN' });

  if (error) {
    // Race: another concurrent request inserted first — re-fetch
    const { data: raced } = await supabase
      .from('ledger_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'wallet')
      .eq('currency', 'NGN')
      .maybeSingle();
    if (raced) return raced.id as string;
    throw new ApiError('Failed to create wallet account', 500);
  }

  return newId;
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export interface WalletBalance {
  available_kobo: number;
  currency: string;
  account_id: string;
}

export async function getBalance(userId: string): Promise<WalletBalance> {
  const accountId = await getOrCreateAccount(userId);
  const supabase = createAdminClient();

  const { data } = await supabase
    .from('wallet_balance')
    .select('available_kobo, currency, account_id')
    .eq('account_id', accountId)
    .maybeSingle();

  return {
    available_kobo: (data?.available_kobo as number) ?? 0,
    currency: (data?.currency as string) ?? 'NGN',
    account_id: accountId,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface WalletMutationInput {
  amountKobo: number;
  reference: string;
  idempotencyKey: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface WalletMutationResult {
  alreadyProcessed: boolean;
  amountKobo: number;
}

export async function creditWallet(
  userId: string,
  input: WalletMutationInput,
): Promise<WalletMutationResult> {
  validateAmountKobo(input.amountKobo);

  const hit = await checkIdempotencyKey(input.idempotencyKey);
  if (hit.alreadyProcessed) {
    return { alreadyProcessed: true, amountKobo: hit.amountKobo };
  }

  const accountId = await getOrCreateAccount(userId);
  const supabase = createAdminClient();

  const { error } = await supabase.from('ledger_entries').insert({
    account_id: accountId,
    type: 'CREDIT',
    amount_kobo: input.amountKobo,
    reference: input.reference,
    idempotency_key: input.idempotencyKey,
    description: input.description ?? null,
    metadata: input.metadata ?? null,
  });

  if (error) {
    if (error.code === '23505') {
      // UNIQUE violation — concurrent insert with same idempotency_key; treat as duplicate
      return { alreadyProcessed: true, amountKobo: input.amountKobo };
    }
    throw new ApiError(`Failed to credit wallet: ${error.message}`, 500);
  }

  return { alreadyProcessed: false, amountKobo: input.amountKobo };
}

export async function debitWallet(
  userId: string,
  input: WalletMutationInput,
): Promise<WalletMutationResult> {
  validateAmountKobo(input.amountKobo);

  const hit = await checkIdempotencyKey(input.idempotencyKey);
  if (hit.alreadyProcessed) {
    return { alreadyProcessed: true, amountKobo: hit.amountKobo };
  }

  const accountId = await getOrCreateAccount(userId);
  const supabase = createAdminClient();

  // Check balance — fail closed if DB error
  // NOTE: This check + insert is not atomic. A concurrent debit could overdraft.
  // Atomic enforcement (RPC with advisory lock) is added in Block 7 (tier limits).
  const { data: balanceRow } = await supabase
    .from('wallet_balance')
    .select('available_kobo')
    .eq('account_id', accountId)
    .maybeSingle();

  const available = (balanceRow?.available_kobo as number) ?? 0;
  if (available < input.amountKobo) {
    throw new ApiError(
      `Insufficient wallet balance. Available: ${available} kobo, required: ${input.amountKobo} kobo.`,
      402,
    );
  }

  const { error } = await supabase.from('ledger_entries').insert({
    account_id: accountId,
    type: 'DEBIT',
    amount_kobo: input.amountKobo,
    reference: input.reference,
    idempotency_key: input.idempotencyKey,
    description: input.description ?? null,
    metadata: input.metadata ?? null,
  });

  if (error) {
    if (error.code === '23505') {
      return { alreadyProcessed: true, amountKobo: input.amountKobo };
    }
    throw new ApiError(`Failed to debit wallet: ${error.message}`, 500);
  }

  return { alreadyProcessed: false, amountKobo: input.amountKobo };
}

// ---------------------------------------------------------------------------
// Transaction history
// ---------------------------------------------------------------------------

export async function listTransactions(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<LedgerEntryRow[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = opts.offset ?? 0;

  const accountId = await getOrCreateAccount(userId);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new ApiError('Failed to fetch transactions', 500);

  return (data ?? []) as LedgerEntryRow[];
}

// ---------------------------------------------------------------------------
// Topup intent
// ---------------------------------------------------------------------------

export interface TopupInput {
  amountKobo: number;
  idempotencyKey: string;
  callbackUrl?: string;
}

export interface TopupIntentResult {
  alreadyProcessed: boolean;
  intentId: string;
  paymentReference: string;
  authorizationUrl: string;
  amountKobo: number;
}

export async function createTopupIntent(
  userId: string,
  email: string,
  input: TopupInput,
): Promise<TopupIntentResult> {
  validateAmountKobo(input.amountKobo);

  if (input.amountKobo < MIN_TOPUP_KOBO) {
    throw new ApiError(
      `Minimum topup amount is ${MIN_TOPUP_KOBO} kobo (₦${MIN_TOPUP_KOBO / 100}). Got: ${input.amountKobo} kobo.`,
      400,
    );
  }

  // Idempotency — return existing intent if key already used
  const existing = await checkTopupIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { alreadyProcessed: true, ...existing };
  }

  const paymentReference = `TOPUP_${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
  const supabase = createAdminClient();

  // Insert intent before calling Paystack — if Paystack fails, intent stays 'pending'
  const intentId = crypto.randomUUID();
  const { error: insertError } = await supabase.from('wallet_topup_intents').insert({
    id: intentId,
    user_id: userId,
    amount_kobo: input.amountKobo,
    payment_reference: paymentReference,
    idempotency_key: input.idempotencyKey,
    status: 'pending',
  });

  if (insertError) {
    if (insertError.code === '23505') {
      // Race on idempotency_key — re-fetch
      const raced = await checkTopupIdempotencyKey(input.idempotencyKey);
      if (raced) return { alreadyProcessed: true, ...raced };
    }
    throw new ApiError('Failed to create topup intent', 500);
  }

  // Call Paystack initialize
  const authorizationUrl = await initializePaystackPayment({
    reference: paymentReference,
    email,
    amountKobo: input.amountKobo,
    callbackUrl: input.callbackUrl,
    metadata: {
      type: 'wallet_topup',
      topup_intent_id: intentId,
      user_id: userId,
    },
  });

  // Store the authorization URL
  await supabase
    .from('wallet_topup_intents')
    .update({ authorization_url: authorizationUrl })
    .eq('id', intentId);

  return {
    alreadyProcessed: false,
    intentId,
    paymentReference,
    authorizationUrl,
    amountKobo: input.amountKobo,
  };
}

// ---------------------------------------------------------------------------
// Paystack initialization (wallet-owned, independent of voting module)
// ---------------------------------------------------------------------------

async function initializePaystackPayment(input: {
  reference: string;
  email: string;
  amountKobo: number;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new ApiError('Paystack is not configured', 500);

  const body: Record<string, unknown> = {
    reference: input.reference,
    email: input.email,
    amount: input.amountKobo,
    currency: 'NGN',
    metadata: input.metadata ?? {},
  };
  if (input.callbackUrl) body.callback_url = input.callbackUrl;

  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new ApiError(`Paystack initialization failed: ${res.statusText}`, 502);
  }

  const json = await res.json() as { status: boolean; data?: { authorization_url?: string } };
  const authorizationUrl = json.data?.authorization_url;
  if (!authorizationUrl) {
    throw new ApiError('Paystack did not return an authorization URL', 502);
  }

  return authorizationUrl;
}
