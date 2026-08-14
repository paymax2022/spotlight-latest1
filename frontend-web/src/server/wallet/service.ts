import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { validateAmountKobo, buildIdempotencyKey } from './ledger';
import type { LedgerEntryRow } from './ledger';
import { checkIdempotencyKey, checkTopupIdempotencyKey } from './idempotency';
import {
  buildJournalLegs,
  getOrCreateStandingAccount,
  postJournal,
  DEFAULT_CREDIT_COUNTER,
  DEFAULT_DEBIT_COUNTER,
  type StandingAccountType,
} from './journal';
import { enforceWalletLimit } from '@/src/server/tiers/service';

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

async function migrateLegacyMobileBalanceIfNeeded(userId: string, accountId: string) {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from('ledger_entries')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);

  if ((count ?? 0) > 0) return;

  const { data: legacy } = await supabase
    .from('mobile_fintech_accounts')
    .select('available_balance, currency')
    .eq('user_id', userId)
    .maybeSingle();

  const legacyBalance = Number(legacy?.available_balance ?? 0);
  if (legacyBalance <= 0) return;

  const amountKobo = Math.round(legacyBalance * 100);

  // ADR-040: an opening balance carried over from the legacy mobile system is
  // still a money movement — DR settlement (the platform owed those funds all
  // along) / CR the user's wallet.
  const counterAccountId = await getOrCreateStandingAccount('settlement');
  await postJournal(
    buildJournalLegs({
      primaryAccountId: accountId,
      counterAccountId,
      primarySide: 'CREDIT',
      amountKobo,
      reference: `LEGACY-MOBILE-${userId}`,
      idempotencyKey: `legacy-mobile-fintech:${userId}:initial-credit`,
      description: 'Migrated legacy mobile wallet balance',
      metadata: { source: 'mobile_fintech_accounts', currency: legacy?.currency ?? 'NGN' },
    }),
    'Failed to migrate legacy wallet balance',
  );
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
  await migrateLegacyMobileBalanceIfNeeded(userId, accountId);
  const supabase = createAdminClient();

  // The user's spendable funds live across TWO ledger account types: 'wallet'
  // (this Next.js wallet) and 'user_wallet' (the Go finance ledger — the
  // money-path authority that transport/gifting/payouts debit). Read-only sum
  // of both so the displayed balance reflects real spendable money; mutations
  // still go through each system's own ledger.
  const { data: walletAccounts } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('currency', 'NGN')
    .in('type', ['wallet', 'user_wallet']);
  const accountIds = (walletAccounts ?? []).map((a) => a.id as string);
  if (!accountIds.includes(accountId)) accountIds.push(accountId);

  const { data: balances } = await supabase
    .from('wallet_balance')
    .select('available_kobo, currency, account_id')
    .in('account_id', accountIds);

  const availableKobo = (balances ?? []).reduce(
    (sum, row) => sum + ((row.available_kobo as number) ?? 0),
    0,
  );
  const data = (balances ?? []).find((row) => row.account_id === accountId) ?? null;
  const { count: ledgerEntryCount } = await supabase
    .from('ledger_entries')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);

  if (availableKobo === 0 && (ledgerEntryCount ?? 0) === 0) {
    const { data: legacy } = await supabase
      .from('mobile_fintech_accounts')
      .select('available_balance, currency')
      .eq('user_id', userId)
      .maybeSingle();

    const legacyBalance = Number(legacy?.available_balance ?? 0);
    if (legacyBalance > 0) {
      return {
        available_kobo: Math.round(legacyBalance * 100),
        currency: (legacy?.currency as string) ?? 'NGN',
        account_id: accountId,
      };
    }
  }

  return {
    available_kobo: availableKobo,
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
  /**
   * Standing account carrying the counter-leg (ADR-040). Defaults to
   * `provider_clearing` for credits and `settlement` for debits/reversals.
   * Pass an explicit one where the counterparty is known — e.g. a referral
   * bonus is funded by `referral_reward_expense`, not by a payment provider.
   * A reversal MUST name the same account the original movement used, so the
   * correction drains the pot it filled.
   */
  counterAccount?: StandingAccountType;
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

  // ADR-040: money entering a wallet has a source. Post the balanced pair —
  // DR the counter account / CR the wallet — in one atomic insert. A UNIQUE
  // violation on either leg rolls back both, so `alreadyProcessed` still means
  // "this exact event was already posted", never "half of it was".
  const counterAccountId = await getOrCreateStandingAccount(
    input.counterAccount ?? DEFAULT_CREDIT_COUNTER,
  );
  const { duplicate } = await postJournal(
    buildJournalLegs({
      primaryAccountId: accountId,
      counterAccountId,
      primarySide: 'CREDIT',
      amountKobo: input.amountKobo,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      metadata: input.metadata,
    }),
    'Failed to credit wallet',
  );

  return { alreadyProcessed: duplicate, amountKobo: input.amountKobo };
}

export async function debitWallet(
  userId: string,
  input: WalletMutationInput,
): Promise<WalletMutationResult> {
  validateAmountKobo(input.amountKobo);

  // ADR-040: this path posts its counter-leg INSIDE debit_wallet_atomic, which
  // hardcodes `settlement` — the RPC's argument list is deliberately unchanged.
  // Accepting a different counterAccount here would silently post to the wrong
  // account (it type-checks, reads correctly, and lands somewhere else), so
  // refuse it. Callers needing another counterparty must post through the
  // journal helper directly.
  if (input.counterAccount && input.counterAccount !== DEFAULT_DEBIT_COUNTER) {
    throw new ApiError(
      `debitWallet cannot post to counter account '${input.counterAccount}': ` +
      `debit_wallet_atomic always posts to '${DEFAULT_DEBIT_COUNTER}' (ADR-040).`,
      500,
    );
  }

  const hit = await checkIdempotencyKey(input.idempotencyKey);
  if (hit.alreadyProcessed) {
    return { alreadyProcessed: true, amountKobo: hit.amountKobo };
  }

  // Block 7: get the user's tier daily limit before touching the DB.
  // enforceWalletLimit throws 403 for Tier 0 or exceeded daily cap.
  const { dailyLimitKobo } = await enforceWalletLimit(userId, input.amountKobo);

  const accountId = await getOrCreateAccount(userId);
  await migrateLegacyMobileBalanceIfNeeded(userId, accountId);
  const supabase = createAdminClient();

  // Atomic debit via Postgres RPC — balance check + optional daily-limit check
  // + INSERT happen under a row-level lock on ledger_accounts (fixes Block 4 TOCTOU).
  const { error } = await supabase.rpc('debit_wallet_atomic', {
    p_account_id:       accountId,
    p_amount_kobo:      input.amountKobo,
    p_reference:        input.reference,
    p_idempotency_key:  input.idempotencyKey,
    p_daily_limit_kobo: dailyLimitKobo,
    p_description:      input.description ?? null,
    p_metadata:         input.metadata ?? null,
  });

  if (error) {
    if (error.code === '23505') {
      return { alreadyProcessed: true, amountKobo: input.amountKobo };
    }
    // Map RPC-raised exceptions to appropriate HTTP status codes
    if (error.message?.includes('INSUFFICIENT_BALANCE')) {
      throw new ApiError(
        `Insufficient wallet balance. Required: ${input.amountKobo} kobo.`,
        402,
      );
    }
    if (error.message?.includes('TIER_LIMIT_EXCEEDED')) {
      throw new ApiError(
        'Daily wallet limit for your KYC tier has been reached.',
        403,
      );
    }
    throw new ApiError(`Failed to debit wallet: ${error.message}`, 500);
  }

  return { alreadyProcessed: false, amountKobo: input.amountKobo };
}

export async function reverseWalletDebit(
  userId: string,
  input: WalletMutationInput,
): Promise<WalletMutationResult> {
  validateAmountKobo(input.amountKobo);

  const hit = await checkIdempotencyKey(input.idempotencyKey);
  if (hit.alreadyProcessed) {
    return { alreadyProcessed: true, amountKobo: hit.amountKobo };
  }

  const accountId = await getOrCreateAccount(userId);

  // ADR-040: the correction is a balanced pair too — REVERSAL_DEBIT restores the
  // wallet, REVERSAL_CREDIT drains the account the original debit credited.
  // Default `settlement` mirrors debit_wallet_atomic's counter-leg, so a refund
  // of a debit posted through that RPC returns the funds to the same pot.
  const counterAccountId = await getOrCreateStandingAccount(
    input.counterAccount ?? DEFAULT_DEBIT_COUNTER,
  );
  const { duplicate } = await postJournal(
    buildJournalLegs({
      primaryAccountId: accountId,
      counterAccountId,
      primarySide: 'REVERSAL_DEBIT',
      amountKobo: input.amountKobo,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      metadata: input.metadata,
    }),
    'Failed to reverse wallet debit',
  );

  return { alreadyProcessed: duplicate, amountKobo: input.amountKobo };
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

// ---------------------------------------------------------------------------
// Topup status — polled by the app after the user returns from Paystack so a
// module checkout can proceed once the wallet has actually been credited (the
// webhook flips the intent to 'completed' on charge.success).
// ---------------------------------------------------------------------------

export interface TopupStatusResult {
  reference: string;
  status: string; // 'pending' | 'completed' | 'failed'
  amountKobo: number;
  completed: boolean;
}

export async function getTopupStatus(reference: string, userId: string): Promise<TopupStatusResult | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('wallet_topup_intents')
    .select('payment_reference, status, amount_kobo, user_id')
    .eq('payment_reference', reference)
    .maybeSingle();
  if (!data || data.user_id !== userId) return null;
  const status = String(data.status ?? 'pending');
  return {
    reference: String(data.payment_reference ?? reference),
    status,
    amountKobo: Number(data.amount_kobo ?? 0),
    completed: status === 'completed',
  };
}
