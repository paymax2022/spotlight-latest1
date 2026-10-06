import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { resolveUtilityCommission, type ResolvedCommission } from '@/src/server/commission/config';
import { creditWallet, debitWallet, reverseWalletDebit } from '@/src/server/wallet/service';
import {
  calculateUtilityPricing,
  getViableUtilityRoutes,
  selectUtilityProvider,
  type UtilityRouteCandidate,
  canRequeryUtilityStatus,
  canReverseUtilityTransaction,
  nextStatusFromProvider,
  protectProviderCredentialsPayload,
  providerCredentialsConfigured,
  getUtilityProviderTimeoutMs,
  UtilityProviderTimeoutError,
  withUtilityProviderTimeout,
} from './helpers';
import { getUtilityAdapter } from './adapters/registry';
import { fetchVtpassServices, type VtpassServiceInfo } from './adapters/vtpass';
import type { UtilityValidationResult } from './adapters/types';
import {
  notifyUtilityCustomer,
  notifyUtilityTransactionStatus,
  queueUtilityAdminAlert,
} from './notifications';
import type {
  UtilityBillerRow,
  UtilityCategory,
  UtilityCategorySettingRow,
  UtilityPayInput,
  UtilityPricing,
  UtilityProviderAttemptRow,
  UtilityProductMappingRow,
  UtilityProductRow,
  UtilityProviderRow,
  UtilityTransactionRow,
} from './types';
import type { UtilityPurchaseResult } from './adapters/types';

function receiptNumber(id: string) {
  return `UTL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(0, 8).toUpperCase()}`;
}

// AUD-BILL-005: a stuck transaction is only safe to recover once it is older
// than any in-flight writer could possibly still own it. Provider calls are
// capped at getUtilityProviderTimeoutMs (max 120s) per attempt and failover
// walks a small routes list, so 10 minutes is far beyond a live purchase.
const UTILITY_STUCK_MIN_AGE_MS = 10 * 60_000;

function isStuckPastThreshold(transaction: UtilityTransactionRow) {
  return Date.now() - new Date(transaction.updated_at).getTime() >= UTILITY_STUCK_MIN_AGE_MS;
}

// Attempts recorded as anything other than a definitive provider 'failed' are
// ambiguous for recovery: 'started'/'timeout'/'error' can mean the provider
// received (and possibly vended) a request whose request_id embeds the call
// timestamp and cannot be reconstructed for a requery. Never auto-reverse on
// ambiguous evidence — refunding a vend that succeeded would pay out twice.
const AMBIGUOUS_ATTEMPT_STATUSES: ReadonlySet<UtilityProviderAttemptRow['status']> = new Set([
  'started',
  'pending',
  'timeout',
  'error',
  'successful',
]);

/**
 * AUD-BILL-005 — probe the ledger for this transaction's money legs.
 *
 * BOTH writer conventions must be recognised: this plane posts the wallet leg
 * under the caller's key verbatim (`utility:<tx>:DEBIT`, `…:REVERSAL_DEBIT`,
 * `…:PAYSTACK_REFUND`, `…:ADMIN_REVERSAL_*`), while the Go plane
 * (backend/internal/utilitybills) derives its own per-side suffixes from the
 * CLIENT key (`<key>:debit:credit`, `<key>:reversal:rev_debit`, and
 * `utility:<tx>:ADMIN_REVERSAL_DEBIT:rev_debit`). Probing only the TS keys
 * would misread a Go-written row as "no debit" — stranding real money, or
 * worse, refunding it again.
 *
 * The paystack VALIDATION_REFUND credit cannot be probed by key at all (it is
 * keyed on the intent id, which the transaction does not store), so for
 * paystack-source rows it is matched by the captured payment reference.
 */
async function lookupUtilityMoneyLegs(
  transaction: UtilityTransactionRow,
): Promise<{ debitPosted: boolean; compensationPosted: boolean }> {
  const supabase = createAdminClient();
  const key = transaction.idempotency_key;
  const debitKeys = [
    `utility:${transaction.id}:DEBIT`,
    `${key}:debit:debit`,
    `${key}:debit:credit`,
  ];
  const compensationKeys = [
    `utility:${transaction.id}:REVERSAL_DEBIT`,
    `utility:${transaction.id}:PAYSTACK_REFUND`,
    `utility:${transaction.id}:PAYSTACK_REFUND:credit`,
    `utility:${transaction.id}:ADMIN_REVERSAL_DEBIT`,
    `utility:${transaction.id}:ADMIN_REVERSAL_DEBIT:rev_debit`,
    `utility:${transaction.id}:ADMIN_REVERSAL_DEBIT:rev_credit`,
    `utility:${transaction.id}:ADMIN_REVERSAL_PAYSTACK_REFUND`,
    `utility:${transaction.id}:ADMIN_REVERSAL_PAYSTACK_REFUND:counter`,
    `utility:${transaction.id}:ADMIN_REVERSAL_PAYSTACK_REFUND:credit`,
    `${key}:reversal:rev_debit`,
    `${key}:reversal:rev_credit`,
  ];
  const { data: legs, error } = await supabase
    .from('ledger_entries')
    .select('idempotency_key')
    .in('idempotency_key', [...debitKeys, ...compensationKeys]);
  if (error) throw new ApiError('Failed to inspect utility ledger legs.', 500);

  const posted = new Set(((legs ?? []) as Array<{ idempotency_key: string }>).map((leg) => leg.idempotency_key));
  const debitPosted = debitKeys.some((k) => posted.has(k));
  let compensationPosted = compensationKeys.some((k) => posted.has(k));

  if (!compensationPosted && transaction.payment_source === 'paystack') {
    const paymentRef = transaction.metadata?.payment_reference;
    if (typeof paymentRef === 'string' && paymentRef) {
      const { data: refund } = await supabase
        .from('ledger_entries')
        .select('id')
        .eq('reference', paymentRef)
        .eq('type', 'CREDIT')
        .limit(1);
      compensationPosted = (refund ?? []).length > 0;
    }
  }

  return { debitPosted, compensationPosted };
}

// AUD-BILL-005 — how long a just-'failed' row must age before an ADMIN
// reversal may claim it. While a row is freshly failed its compensator
// (recovery or the in-flight writer's auto-reverse) is likely still inside its
// probe→post window — the window serialises admin compensation behind it
// without a schema-level lock.
const UTILITY_ADMIN_SETTLE_WINDOW_MS = 60_000;

/**
 * AUD-BILL-005 — claim a still-open transaction for settlement by flipping it
 * to 'failed' in ONE write. 'failed' is outside every other claim set AND
 * outside the writer's guarded settle statuses, so after this CAS lands: no
 * second compensator can enter the probe→post window concurrently, and an
 * in-flight writer's settle patch is refused outright. null means another
 * writer owns the row — adopt its outcome.
 */
async function claimUtilityForSettlement(
  transaction: UtilityTransactionRow,
  reason: string,
): Promise<UtilityTransactionRow | null> {
  const supabase = createAdminClient();
  const { data: claimed } = await supabase
    .from('utility_transactions')
    .update({ status: 'failed', failure_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', transaction.id)
    .eq('updated_at', transaction.updated_at)
    .in('status', ['initiated', 'wallet_debited', 'provider_pending'])
    .select('*');
  return ((claimed ?? [])[0] ?? null) as UtilityTransactionRow | null;
}

/**
 * AUD-BILL-005 — claim an already-'failed' row for ADMIN reversal. The 60s
 * window keeps the admin out of a just-claimed row's probe→post window; the
 * observed updated_at CAS guards against a second admin claiming the same
 * version.
 */
async function claimFailedUtilityForReversal(
  transaction: UtilityTransactionRow,
): Promise<UtilityTransactionRow | null> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - UTILITY_ADMIN_SETTLE_WINDOW_MS).toISOString();
  const { data: claimed } = await supabase
    .from('utility_transactions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', transaction.id)
    .eq('updated_at', transaction.updated_at)
    .eq('status', 'failed')
    .lt('updated_at', cutoff)
    .select('*');
  return ((claimed ?? [])[0] ?? null) as UtilityTransactionRow | null;
}

async function reloadUtilityTransaction(transaction: UtilityTransactionRow): Promise<UtilityTransactionRow> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('utility_transactions').select('*').eq('id', transaction.id).maybeSingle();
  return (data ?? transaction) as UtilityTransactionRow;
}

/**
 * AUD-BILL-005 — close out a utility transaction that can no longer fulfil.
 *
 * `authoritative` controls whether the wallet/paystack money leg is
 * compensated: true means we can prove the provider never vended (zero
 * attempts, only definitive 'failed' attempts, or an authoritative failed
 * verdict on a real provider_reference), so reversing/refunding is safe.
 * false means vend evidence is ambiguous — the row is marked 'failed' and ops
 * is alerted, but the money leg is left for manual reconciliation.
 *
 * Compensation reuses payUtility's own idempotency keys
 * (`utility:<tx>:REVERSAL_DEBIT` / `utility:<tx>:PAYSTACK_REFUND`), so a
 * reversal already posted by the original request or an earlier sweep is a
 * no-op, never a double refund — and the ledger probe recognises the Go
 * plane's keys for transactions this plane did not write.
 */
async function settleFailedUtilityTransaction(
  transaction: UtilityTransactionRow,
  reason: string,
  opts: { authoritative: boolean },
): Promise<UtilityTransactionRow> {
  // The claim flips the row to 'failed' in one write — outside every other
  // claim set — so exactly one compensator can ever be inside the probe→post
  // window, and an in-flight writer's guarded settle write refuses to land
  // after the claim.
  const claimed = await claimUtilityForSettlement(transaction, reason);
  if (!claimed) return reloadUtilityTransaction(transaction);

  if (!opts.authoritative) {
    await addEvent(transaction.id, 'stuck_needs_manual_reconciliation', reason);
    queueUtilityAdminAlert({
      title: 'Utility transaction needs manual reconciliation',
      message: `${transaction.receipt_number ?? transaction.id} failed with ambiguous provider attempts — verify with the provider before reversing.`,
      audience: 'support',
    });
    await notifyUtilityTransactionStatus(claimed, reason);
    return claimed;
  }

  const legs = await lookupUtilityMoneyLegs(claimed);
  let compensated = false;
  if (legs.compensationPosted) {
    // Money was already returned (by payUtility's failure branch, an earlier
    // sweep, a Go-plane reversal, or the paystack validation refund) — this
    // call only converges the status.
    compensated = true;
  } else if (claimed.payment_source === 'wallet') {
    // Only reverse when the DEBIT leg actually posted — a crash between the
    // transaction insert and the wallet debit leaves 'initiated' with no money
    // moved, and posting a reversal there would hand the user free funds.
    if (legs.debitPosted) {
      try {
        await reverseWalletDebit(claimed.user_id, {
          amountKobo: claimed.retail_amount_kobo,
          reference: claimed.receipt_number ?? claimed.id,
          idempotencyKey: `utility:${claimed.id}:REVERSAL_DEBIT`,
          description: `Utility payment reversal ${claimed.receipt_number ?? claimed.id}`,
          metadata: { utility_transaction_id: claimed.id, category: claimed.category, auto_reversal: true },
        });
        compensated = true;
        await addEvent(claimed.id, 'wallet_reversed', 'Wallet debit reversed for unfulfilled utility payment.');
      } catch (error) {
        // The reversal could not post — the row lands on 'failed' (NOT
        // 'reversed') so the outstanding money stays visible, with an explicit
        // failure event + alert matching the Go plane's stuck_reversal_failed.
        await addEvent(claimed.id, 'stuck_reversal_failed', error instanceof Error ? error.message : 'Wallet reversal could not be posted.');
        queueUtilityAdminAlert({
          title: 'Utility stuck-transaction reversal failed',
          message: `${claimed.receipt_number ?? claimed.id} is debited and unfulfilled, but the reversal failed to post — refund manually.`,
          audience: 'support',
        });
      }
    } else if (transaction.status !== 'initiated') {
      // The status claims money moved but no debit leg exists — an integrity
      // anomaly, never a silent failure.
      queueUtilityAdminAlert({
        title: 'Utility transaction debited without a ledger debit',
        message: `${transaction.receipt_number ?? transaction.id} was ${transaction.status} but no wallet debit leg exists — investigate.`,
        audience: 'support',
      });
    }
  } else {
    // 'paystack' transactions only exist because the charge verified before
    // payUtility ran — the money was captured, so refund it to the wallet. The
    // captured payment_reference is the PROOF of capture: without it (an
    // integrity anomaly, or a forged-source row) a credit would mint funds.
    const paymentRef = claimed.metadata?.payment_reference;
    if (typeof paymentRef === 'string' && paymentRef) {
      try {
        await creditWallet(claimed.user_id, {
          amountKobo: claimed.retail_amount_kobo,
          reference: claimed.receipt_number ?? claimed.id,
          idempotencyKey: `utility:${claimed.id}:PAYSTACK_REFUND`,
          description: `Refund: utility payment ${claimed.receipt_number ?? claimed.id} (provider could not complete)`,
          metadata: {
            utility_transaction_id: claimed.id,
            category: claimed.category,
            refund_reason: 'provider_failed',
            original_payment_source: 'paystack',
            auto_reversal: true,
          },
        });
        compensated = true;
        await addEvent(claimed.id, 'paystack_refunded', 'Paystack payment refunded to wallet for unfulfilled utility payment.');
      } catch (error) {
        await addEvent(claimed.id, 'paystack_refund_failed', error instanceof Error ? error.message : 'Paystack refund credit could not be posted.');
        queueUtilityAdminAlert({
          title: 'Utility paystack refund failed',
          message: `${claimed.receipt_number ?? claimed.id} was captured but unfulfilled, and the wallet refund failed to post — refund manually.`,
          audience: 'support',
        });
      }
    } else {
      await addEvent(claimed.id, 'paystack_refund_skipped', 'Paystack-sourced transaction carries no payment_reference — no proof of capture; refusing to credit.');
      queueUtilityAdminAlert({
        title: 'Utility transaction paystack-sourced without a payment reference',
        message: `${claimed.receipt_number ?? claimed.id} is paystack-sourced but has no captured payment_reference — refund refused; investigate.`,
        audience: 'support',
      });
    }
  }

  const supabase = createAdminClient();
  const status = compensated ? 'reversed' : 'failed';
  await supabase.from('utility_transactions').update({
    status,
    failure_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq('id', transaction.id);
  await addEvent(transaction.id, compensated ? 'auto_reversed' : 'failed_no_debit', reason);
  const updated = await reloadUtilityTransaction(transaction);
  await notifyUtilityTransactionStatus(updated, reason);
  return updated;
}

/**
 * AUD-BILL-005 — crash recovery for transactions that never completed the
 * provider loop ('initiated'/'wallet_debited'). Recovery is driven by
 * utility_provider_attempts evidence rather than a provider query: the
 * request_id a provider might know is timestamp-embedded and
 * unreconstructible, so a requery can only ever answer "not found".
 */
async function recoverStuckUtilityTransaction(transaction: UtilityTransactionRow): Promise<UtilityTransactionRow> {
  if (!isStuckPastThreshold(transaction)) return transaction;

  const attempts = await listUtilityTransactionAttempts(transaction.id);
  const ambiguous = attempts.some((attempt) => AMBIGUOUS_ATTEMPT_STATUSES.has(attempt.status));
  if (ambiguous) {
    return settleFailedUtilityTransaction(transaction, 'Stuck transaction has provider attempts that may have vended — manual reconciliation required.', { authoritative: false });
  }
  return settleFailedUtilityTransaction(transaction, 'Stuck transaction recovered: no provider fulfilment was recorded.', { authoritative: true });
}

// Commission module integration (additive, guarded). When an active
// commission_config row matches the resolved (service, subtype), prefer its
// customer-facing convenience fee over the utility_products value. When the fee
// unless a config row deliberately differs. Reversible: delete these two lines
// in payUtility to fall fully back to utility_products pricing.
function applyCommissionConvenienceFee(
  pricing: UtilityPricing,
  config: ResolvedCommission['config'],
): UtilityPricing {
  if (!config) return pricing;
  const convenienceFeeKobo = config.convenience_fee_kobo;
  if (convenienceFeeKobo === pricing.convenienceFeeKobo) return pricing;

  const delta = convenienceFeeKobo - pricing.convenienceFeeKobo;
  const retailAmountKobo = pricing.retailAmountKobo + delta;
  const grossProfitKobo = pricing.grossProfitKobo + delta;
  const grossMarginBps = retailAmountKobo > 0 ? Math.floor((grossProfitKobo * 10_000) / retailAmountKobo) : 0;
  return { ...pricing, convenienceFeeKobo, retailAmountKobo, grossProfitKobo, grossMarginBps };
}

// Append one immutable row to public.commission_earnings for a SETTLED utility
// payment. Idempotent on the utility transaction id (UNIQUE idempotency_key +
// ON CONFLICT DO NOTHING via upsert/ignoreDuplicates) so requeries/retries never
// double-count. BEST-EFFORT: any failure is logged and swallowed — it must never
// fail or reverse the customer's payment. Does NOT post to the ledger (the Go
// backend owns ledger posting; ledger_ref is left null for the backend to fill).
async function recordUtilityCommissionEarning(params: {
  transaction: UtilityTransactionRow;
  pricing: UtilityPricing;
  commission: ResolvedCommission;
}) {
  try {
    const { transaction, pricing, commission } = params;
    const config = commission.config;
    const service = config?.service ?? commission.service;
    // No mapped commission service (e.g. 'internet') → skip; legacy behavior only.
    if (!service) return;

    const grossAmountKobo = pricing.amountKobo;
    const commissionKobo = config ? Math.floor((grossAmountKobo * config.commission_bps) / 10_000) : 0;
    const platformChargeKobo = config ? Math.floor((grossAmountKobo * config.platform_charge_bps) / 10_000) : 0;
    const convenienceFeeKobo = pricing.convenienceFeeKobo;
    const fixedFeeKobo = config ? config.fixed_fee_kobo : 0;

    // revenue) fall back to the per-transaction gross profit already computed.
    const derivedRevenue = commissionKobo + platformChargeKobo + convenienceFeeKobo + fixedFeeKobo;
    const spotlightRevenueKobo = config && derivedRevenue > 0 ? derivedRevenue : pricing.grossProfitKobo;

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('commission_earnings')
      .upsert(
        {
          config_id: config?.id ?? null,
          service_category: 'Utility_Bills',
          service,
          service_subtype: config?.service_subtype ?? commission.subtype ?? '',
          gross_amount_kobo: grossAmountKobo,
          commission_kobo: commissionKobo,
          platform_charge_kobo: platformChargeKobo,
          convenience_fee_kobo: convenienceFeeKobo,
          fixed_fee_kobo: fixedFeeKobo,
          spotlight_revenue_kobo: spotlightRevenueKobo,
          currency: 'NGN',
          source_module: 'utility',
          source_ref: transaction.id,
          // TODO(ledger): the Go backend owns double-entry ledger posting for
          // commission. Populate ledger_ref here once that backend posts the
          // entry (or via a reconciliation job keyed on source_module+source_ref).
          ledger_ref: null,
          user_id: transaction.user_id,
          idempotency_key: transaction.id,
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      );
    if (error) {
      console.error('[utility] commission_earnings insert failed (payment unaffected):', error.message);
    }
  } catch (error) {
    console.error(
      '[utility] commission_earnings recording threw (payment unaffected):',
      error instanceof Error ? error.message : error,
    );
  }
}

function assertCategory(value: unknown): UtilityCategory {
  if (value === 'airtime' || value === 'data' || value === 'electricity' || value === 'cable_tv' || value === 'internet' || value === 'education') {
    return value;
  }
  throw new ApiError('Invalid utility category.', 400);
}

function assertString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(`${name} is required.`, 400);
  return value.trim();
}

async function addEvent(transactionId: string, eventType: string, message?: string, payload: Record<string, unknown> = {}) {
  const supabase = createAdminClient();
  await supabase.from('utility_transaction_events').insert({
    transaction_id: transactionId,
    event_type: eventType,
    message: message ?? null,
    payload,
  });
}

async function recordProviderAttempt(input: {
  transactionId: string;
  route: UtilityRouteCandidate;
  attemptNumber: number;
  requestIdempotencyKey: string;
}) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_provider_attempts')
    .insert({
      transaction_id: input.transactionId,
      provider_id: input.route.provider.id,
      provider_mapping_id: input.route.mapping.id,
      attempt_number: input.attemptNumber,
      request_idempotency_key: input.requestIdempotencyKey,
      status: 'started',
    })
    .select('*')
    .single();

  if (error) {
    console.error('[utility] failed to record provider attempt:', error);
    throw new ApiError('Failed to record provider attempt', 500);
  }
  return data as UtilityProviderAttemptRow;
}

async function finishProviderAttempt(
  attemptId: string,
  patch: {
    status: UtilityProviderAttemptRow['status'];
    startedAt?: string;
    timeoutMs?: number;
    providerReference?: string;
    message?: string;
    rawResponse?: Record<string, unknown>;
  },
) {
  const supabase = createAdminClient();
  const completedAt = new Date();
  const startedAt = patch.startedAt ? new Date(patch.startedAt) : null;
  await supabase.from('utility_provider_attempts').update({
    status: patch.status,
    provider_reference: patch.providerReference ?? null,
    message: patch.message ?? null,
    raw_response: patch.rawResponse ?? null,
    completed_at: completedAt.toISOString(),
    duration_ms: startedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : null,
    timeout_ms: patch.timeoutMs ?? null,
  }).eq('id', attemptId);
}

async function attemptProviderPurchase(input: {
  transactionId: string;
  idempotencyKey: string;
  route: UtilityRouteCandidate;
  attemptNumber: number;
  category: UtilityCategory;
  biller: UtilityBillerRow;
  product: UtilityProductRow;
  customerReference: string;
  pricing: UtilityPricing;
  metadata?: Record<string, unknown>;
}) {
  const attemptKey = `${input.idempotencyKey}:provider:${input.route.provider.id}:attempt:${input.attemptNumber}`;
  const attempt = await recordProviderAttempt({
    transactionId: input.transactionId,
    route: input.route,
    attemptNumber: input.attemptNumber,
    requestIdempotencyKey: attemptKey,
  });
  const adapter = getUtilityAdapter(input.route.provider.adapter_code);

  try {
    const timeoutMs = getUtilityProviderTimeoutMs(input.route.provider.config);
    const result = await withUtilityProviderTimeout(
      adapter.purchase({
        transactionId: input.transactionId,
        idempotencyKey: attemptKey,
        category: input.category,
        billerCode: input.biller.code,
        providerBillerCode: input.route.mapping.provider_biller_code,
        productCode: input.product.code,
        providerProductCode: input.route.mapping.provider_product_code,
        customerReference: input.customerReference,
        pricing: input.pricing,
        metadata: input.metadata,
      }),
      timeoutMs,
    );

    await finishProviderAttempt(attempt.id, {
      status: result.status === 'successful' ? 'successful' : result.status === 'pending' ? 'pending' : 'failed',
      startedAt: attempt.started_at,
      providerReference: result.providerReference,
      message: result.message,
      rawResponse: result.raw,
    });

    return result;
  } catch (error) {
    if (error instanceof UtilityProviderTimeoutError) {
      await finishProviderAttempt(attempt.id, {
        status: 'timeout',
        startedAt: attempt.started_at,
        timeoutMs: error.timeoutMs,
        message: error.message,
        rawResponse: { timeout_ms: error.timeoutMs },
      });
      return {
        status: 'pending',
        message: error.message,
        raw: { timeout: true, timeout_ms: error.timeoutMs },
      } satisfies UtilityPurchaseResult;
    }

    await finishProviderAttempt(attempt.id, {
      status: 'error',
      startedAt: attempt.started_at,
      message: error instanceof Error ? error.message : 'Provider adapter threw an unknown error.',
    });
    throw error;
  }
}

export async function listUtilityCategories() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('utility_category_settings')
    .select('*')
    .eq('enabled', true)
    .order('category', { ascending: true });

  const labels: Record<UtilityCategory, string> = {
    airtime: 'Airtime',
    data: 'Data',
    electricity: 'Electricity',
    cable_tv: 'Cable TV',
    internet: 'Internet',
    education: 'Education',
  };

  if (data && data.length > 0) {
    return (data as UtilityCategorySettingRow[]).map((row) => ({
      id: row.category,
      label: labels[row.category],
      availability_message: row.availability_message,
      daily_limit_kobo: row.daily_limit_kobo,
      min_amount_kobo: row.min_amount_kobo,
      max_amount_kobo: row.max_amount_kobo,
    }));
  }

  return [
    { id: 'airtime', label: 'Airtime' },
    { id: 'data', label: 'Data' },
    { id: 'electricity', label: 'Electricity' },
    { id: 'cable_tv', label: 'Cable TV' },
    { id: 'internet', label: 'Internet' },
    { id: 'education', label: 'Education' },
  ];
}

async function getCategorySetting(category: UtilityCategory) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_category_settings')
    .select('*')
    .eq('category', category)
    .maybeSingle();

  if (error) throw new ApiError('Failed to load utility category settings.', 500);
  return data as UtilityCategorySettingRow | null;
}

async function assertCategoryAvailableForPayment(
  userId: string,
  category: UtilityCategory,
  retailAmountKobo: number,
) {
  const setting = await getCategorySetting(category);
  if (!setting) return;

  if (!setting.enabled) {
    throw new ApiError(setting.availability_message || 'This utility category is currently unavailable.', 503);
  }

  if (setting.min_amount_kobo !== null && retailAmountKobo < setting.min_amount_kobo) {
    throw new ApiError(`Minimum category spend is ${setting.min_amount_kobo} kobo.`, 400);
  }

  if (setting.max_amount_kobo !== null && retailAmountKobo > setting.max_amount_kobo) {
    throw new ApiError(`Maximum category spend is ${setting.max_amount_kobo} kobo.`, 400);
  }

  if (setting.daily_limit_kobo === null) return;

  const supabase = createAdminClient();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('utility_transactions')
    .select('retail_amount_kobo')
    .eq('user_id', userId)
    .eq('category', category)
    .in('status', ['wallet_debited', 'provider_pending', 'successful', 'disputed'])
    .gte('created_at', start.toISOString());

  if (error) throw new ApiError('Failed to check utility daily limit.', 500);

  const usedToday = ((data ?? []) as Array<{ retail_amount_kobo: number }>).reduce(
    (sum, row) => sum + row.retail_amount_kobo,
    0,
  );

  if (usedToday + retailAmountKobo > setting.daily_limit_kobo) {
    throw new ApiError('Daily utility category limit exceeded.', 429);
  }
}

// VTPass `services` identifiers per category — used to fetch official provider
// logos (each service carries an `image` URL).
const VTPASS_LOGO_IDENTIFIER: Partial<Record<UtilityCategory, string>> = {
  electricity: 'electricity-bill',
  airtime: 'airtime',
  data: 'data',
  cable_tv: 'tv-subscription',
  education: 'education',
};

// Returns VTPass services (serviceID + name + image) for a category so clients
// can show real provider logos. Best-effort: returns [] when VTPass creds are
// absent or the call fails (clients fall back to brand logos).
export async function listUtilityProviderLogos(category: UtilityCategory): Promise<VtpassServiceInfo[]> {
  const identifier = VTPASS_LOGO_IDENTIFIER[category];
  if (!identifier) return [];
  try {
    return await fetchVtpassServices(identifier);
  } catch {
    return [];
  }
}

export async function listBillers(category?: UtilityCategory): Promise<UtilityBillerRow[]> {
  const supabase = createAdminClient();
  let query = supabase.from('utility_billers').select('*').eq('status', 'active').order('name', { ascending: true });
  if (category) query = query.eq('category', category);
  const { data, error } = await query;
  if (error) throw new ApiError('Failed to fetch utility billers.', 500);
  return (data ?? []) as UtilityBillerRow[];
}

export async function listProducts(input: { category?: UtilityCategory; billerId?: string }) {
  const supabase = createAdminClient();
  let query = supabase.from('utility_products').select('*').eq('status', 'active').order('name', { ascending: true });
  if (input.category) query = query.eq('category', input.category);
  if (input.billerId) query = query.eq('biller_id', input.billerId);
  const { data, error } = await query;
  if (error) throw new ApiError('Failed to fetch utility products.', 500);
  return (data ?? []) as UtilityProductRow[];
}

async function getBiller(id: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('utility_billers').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw new ApiError('Utility biller not found.', 404);
  return data as UtilityBillerRow;
}

async function getProduct(id: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('utility_products').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw new ApiError('Utility product not found.', 404);
  return data as UtilityProductRow;
}

async function getRouteCandidates(product: UtilityProductRow): Promise<UtilityRouteCandidate[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_provider_product_mappings')
    .select('*, utility_providers(*)')
    .eq('product_id', product.id)
    .eq('status', 'active');
  if (error) throw new ApiError('Failed to fetch utility provider mappings.', 500);

  const { data: rules } = await supabase
    .from('utility_routing_rules')
    .select('*')
    .eq('product_id', product.id)
    .eq('status', 'active');

  const priorityByProvider = new Map<string, number>(
    ((rules ?? []) as Array<{ provider_id: string; priority: number }>).map((rule) => [rule.provider_id, rule.priority]),
  );

  return (data ?? []).map((row: any) => ({
    provider: row.utility_providers as UtilityProviderRow,
    mapping: row as UtilityProductMappingRow,
    priority: priorityByProvider.get(row.provider_id as string) ?? row.utility_providers?.priority ?? 100,
  }));
}

export async function validateUtilityCustomer(input: {
  category: UtilityCategory;
  billerId: string;
  productId?: string;
  customerReference: string;
  metadata?: Record<string, unknown>;
}) {
  const biller = await getBiller(input.billerId);
  if (biller.category !== input.category) throw new ApiError('Biller does not support this category.', 400);

  // Resolve a route. If no product was supplied, fall back to the biller's first
  // active product so validation still reaches the provider (electricity billers
  // require validation and always have a variable product mapped).
  let product = input.productId ? await getProduct(input.productId) : null;
  if (!product) {
    const products = await listProducts({ category: input.category, billerId: input.billerId });
    product = products[0] ?? null;
  }
  const candidates = product ? await getRouteCandidates(product) : [];
  const selected = product && candidates.length > 0
    ? selectUtilityProvider(candidates, { category: input.category, product, amountKobo: product.amount_kobo ?? product.min_amount_kobo ?? 100 })
    : null;

  if (!selected) {
    // Sandbox safety net: when VTPass is in sandbox mode, validate via the VTPass
    // adapter's documented test-meter simulation EVEN IF no provider route is
    // seeded in this environment — so the documented test meters always validate
    // for testing. (serviceID is derived from the biller code, e.g.
    if (process.env.VTPASS_ENVIRONMENT === 'sandbox' && biller.requires_validation) {
      const adapter = getUtilityAdapter('vtpass');
      const result = await adapter.validateCustomer({
        category: input.category,
        billerCode: biller.code,
        providerBillerCode: biller.code.replace(/^vtpass-/, ''),
        customerReference: input.customerReference,
        metadata: input.metadata,
      });
      return { valid: result.valid, customer_name: result.customerName, message: result.message };
    }
    return {
      valid: !biller.requires_validation,
      customer_name: biller.requires_validation ? undefined : 'Unvalidated customer',
      message: biller.requires_validation ? 'No provider route configured for this biller. (Set VTPASS_ENVIRONMENT=sandbox to test with the sandbox meters.)' : 'Validation is not required for this biller.',
    };
  }

  const adapter = getUtilityAdapter(selected.provider.adapter_code);
  const result = await adapter.validateCustomer({
    category: input.category,
    billerCode: biller.code,
    providerBillerCode: selected.mapping.provider_biller_code,
    customerReference: input.customerReference,
    metadata: input.metadata,
  });

  return {
    valid: result.valid,
    customer_name: result.customerName,
    message: result.message,
  };
}

export async function quoteUtilityPayment(input: {
  category: UtilityCategory;
  billerId: string;
  productId: string;
  amountKobo?: number;
}) {
  const category = assertCategory(input.category);
  const biller = await getBiller(assertString(input.billerId, 'biller_id'));
  const product = await getProduct(assertString(input.productId, 'product_id'));
  if (biller.category !== category || product.category !== category || product.biller_id !== biller.id) {
    throw new ApiError('Biller and product do not match the requested category.', 400);
  }

  const amountKobo = product.amount_type === 'fixed' ? product.amount_kobo ?? undefined : input.amountKobo;
  const routes = getViableUtilityRoutes(await getRouteCandidates(product), {
    category,
    product,
    amountKobo: amountKobo ?? product.min_amount_kobo ?? 1,
  });
  const route = selectUtilityProvider(routes, {
    category,
    product,
    amountKobo: amountKobo ?? product.min_amount_kobo ?? 1,
  });
  const pricing = calculateUtilityPricing(product, route.mapping, amountKobo);
  return { biller, product, route, pricing };
}

export async function payUtility(userId: string, input: UtilityPayInput & { idempotencyKey: string }) {
  const category = assertCategory(input.category);
  const billerId = assertString(input.billerId, 'biller_id');
  const productId = assertString(input.productId, 'product_id');
  const customerReference = assertString(input.customerReference, 'customer_reference');
  const paymentSource = input.paymentSource ?? 'wallet';

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('utility_transactions')
    .select('*')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing) {
    const existingRow = existing as UtilityTransactionRow;
    // AUD-BILL-005: a non-terminal row means the original request died
    // mid-flight (or is still running — the recovery age gate leaves those
    // alone). Attempt recovery so a same-key retry converges the transaction
    // instead of replaying a phantom pending purchase forever.
    if (canRequeryUtilityStatus(existingRow.status)) {
      try {
        return { alreadyProcessed: true, transaction: await requeryUtilityTransaction(existingRow) };
      } catch {
        return { alreadyProcessed: true, transaction: existingRow };
      }
    }
    return { alreadyProcessed: true, transaction: existingRow };
  }

  const biller = await getBiller(billerId);
  const product = await getProduct(productId);
  if (biller.category !== category || product.category !== category || product.biller_id !== biller.id) {
    throw new ApiError('Biller and product do not match the requested category.', 400);
  }

  const amountKobo = product.amount_type === 'fixed' ? product.amount_kobo ?? undefined : input.amountKobo;
  const routes = getViableUtilityRoutes(await getRouteCandidates(product), {
    category,
    product,
    amountKobo: amountKobo ?? product.min_amount_kobo ?? 1,
  });
  const route = selectUtilityProvider(routes, {
    category,
    product,
    amountKobo: amountKobo ?? product.min_amount_kobo ?? 1,
  });
  // Commission module (REFERENCE integration): resolve the active rate row for
  // this utility (service, subtype). Best-effort — never throws.
  const commission = await resolveUtilityCommission(category, biller);
  // Prefer the commission_config convenience fee when a matching active config
  // exists; otherwise the pricing is returned unchanged (pure fallback).
  const pricing = applyCommissionConvenienceFee(
    calculateUtilityPricing(product, route.mapping, amountKobo),
    commission.config,
  );
  await assertCategoryAvailableForPayment(userId, category, pricing.retailAmountKobo);
  const adapter = getUtilityAdapter(route.provider.adapter_code);
  const validation: UtilityValidationResult = biller.requires_validation
    ? await adapter.validateCustomer({
        category,
        billerCode: biller.code,
        providerBillerCode: route.mapping.provider_biller_code,
        customerReference,
        metadata: input.metadata,
      })
    : { valid: true };

  if (!validation.valid) throw new ApiError(validation.message || 'Customer validation failed.', 400);

  const transactionId = crypto.randomUUID();
  const receipt = receiptNumber(transactionId);
  const insertPayload = {
    id: transactionId,
    user_id: userId,
    category,
    biller_id: biller.id,
    product_id: product.id,
    provider_id: route.provider.id,
    provider_mapping_id: route.mapping.id,
    customer_reference: customerReference,
    customer_name: validation.customerName ?? null,
    amount_kobo: pricing.amountKobo,
    convenience_fee_kobo: pricing.convenienceFeeKobo,
    retail_amount_kobo: pricing.retailAmountKobo,
    provider_cost_kobo: pricing.providerCostKobo,
    gross_profit_kobo: pricing.grossProfitKobo,
    gross_margin_bps: pricing.grossMarginBps,
    status: 'initiated',
    receipt_number: receipt,
    idempotency_key: input.idempotencyKey,
    payment_source: paymentSource,
    metadata: input.metadata ?? {},
  };

  const { data: inserted, error: insertError } = await supabase
    .from('utility_transactions')
    .insert(insertPayload)
    .select('*')
    .single();
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: duplicate } = await supabase
        .from('utility_transactions')
        .select('*')
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();
      if (duplicate) return { alreadyProcessed: true, transaction: duplicate as UtilityTransactionRow };
    }
    console.error('[utility] failed to create utility transaction:', insertError);
    throw new ApiError('Failed to create utility transaction', 500);
  }

  await addEvent(transactionId, 'initiated', 'Utility payment initiated.', { pricing });

  // AUD-BILL-005: the row version this writer provably owns. Every settle-path
  // write below CASes on it — a recovery/admin claim bumps updated_at, so a
  // claimed row refuses these writes instead of being resurrected.
  let ownedVersion = (inserted as UtilityTransactionRow).updated_at;

  if (paymentSource === 'wallet') {
    await debitWallet(userId, {
      amountKobo: pricing.retailAmountKobo,
      reference: receipt,
      idempotencyKey: `utility:${transactionId}:DEBIT`,
      description: `Utility payment ${receipt}`,
      metadata: { utility_transaction_id: transactionId, category, biller: biller.code },
    });

    const { data: debited } = await supabase.from('utility_transactions')
      .update({ status: 'wallet_debited', updated_at: new Date().toISOString() })
      .eq('id', transactionId)
      .eq('status', 'initiated')
      .eq('updated_at', ownedVersion)
      .select('*');
    const debitedRow = (debited ?? [])[0] as UtilityTransactionRow | undefined;
    if (!debitedRow) {
      // A settlement claim landed between the insert and the debit — the claim
      // winner owns the outcome INCLUDING compensating the debit just posted,
      // and the purchase loop must not run (a vend delivered after a refund
      // pays out twice). Loud, because THIS writer knows the debit posted even
      // if the claim winner's probe ran before the debit committed and saw no
      // money leg.
      await addEvent(transactionId, 'writer_outraced', 'A settlement claim landed between the wallet debit and fulfilment — the writer yields.');
      queueUtilityAdminAlert({
        title: 'Utility writer yielded after posting a debit',
        message: `${receipt} was claimed for settlement between its wallet debit and fulfilment — verify the claim winner compensated the posted debit.`,
        audience: 'support',
      });
      return { alreadyProcessed: false, transaction: await reloadUtilityTransaction(inserted as UtilityTransactionRow) };
    }
    ownedVersion = debitedRow.updated_at;
    await addEvent(transactionId, 'wallet_debited', 'Wallet debited for utility payment.');
  } else {
    await addEvent(transactionId, 'paystack_verified', 'Paystack payment verified for utility payment.', {
      payment_reference: input.metadata?.payment_reference,
    });
  }

  let providerResult: UtilityPurchaseResult | null = null;
  let fulfilledRoute = route;
  let lastProviderError: string | null = null;

  for (let index = 0; index < routes.length; index += 1) {
    const candidate = routes[index];
    fulfilledRoute = candidate;
    try {
      const result = await attemptProviderPurchase({
        transactionId,
        idempotencyKey: input.idempotencyKey,
        route: candidate,
        attemptNumber: index + 1,
        category,
        biller,
        product,
        customerReference,
        pricing,
        metadata: input.metadata,
      });

      await addEvent(transactionId, `provider_attempt_${result.status}`, result.message, {
        provider_id: candidate.provider.id,
        attempt_number: index + 1,
        raw: result.raw ?? {},
      });

      if (result.status === 'successful' || result.status === 'pending') {
        providerResult = result;
        fulfilledRoute = candidate;
        break;
      }

      lastProviderError = result.message ?? 'Provider failed transaction.';
    } catch (error) {
      // A thrown (non-result) error can carry fetch/network internals, and
      // lastProviderError lands in the customer-facing failure notification.
      // Timeout text is our own authored message; everything else collapses
      // to a fixed string with the real error kept in the server log/event.
      console.error('[utility] provider attempt threw:', error);
      lastProviderError = error instanceof UtilityProviderTimeoutError ? error.message : 'Provider attempt failed.';
      await addEvent(transactionId, 'provider_attempt_error', lastProviderError, {
        provider_id: candidate.provider.id,
        attempt_number: index + 1,
        raw_error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!providerResult) {
    providerResult = {
      status: 'failed',
      message: lastProviderError ?? 'All configured providers failed transaction.',
      raw: { failover_exhausted: true },
    };
  }

  const nextStatus = nextStatusFromProvider(providerResult.status);
  const patch = {
    status: nextStatus,
    provider_id: fulfilledRoute.provider.id,
    provider_mapping_id: fulfilledRoute.mapping.id,
    provider_reference: providerResult.providerReference ?? null,
    token: providerResult.token ?? null,
    provider_response: providerResult.raw ?? null,
    failure_reason: providerResult.status === 'failed' ? providerResult.message ?? 'Provider failed transaction.' : null,
    updated_at: new Date().toISOString(),
  };
  // AUD-BILL-005: the settle patch lands only while the row is still in a
  // pre-settle status at the version this writer owns — a settlement claim
  // flips the row to 'failed' and bumps updated_at, so a claimed row rejects
  // this write outright instead of being resurrected.
  const { data: settled } = await supabase.from('utility_transactions').update(patch).eq('id', transactionId)
    .in('status', ['initiated', 'wallet_debited'])
    .eq('updated_at', ownedVersion)
    .select('id');
  const settleWon = (settled ?? []).length > 0;
  await addEvent(transactionId, `provider_${providerResult.status}`, providerResult.message, {
    provider_id: fulfilledRoute.provider.id,
    raw: providerResult.raw ?? {},
  });

  if (!settleWon) {
    // Recovery or an admin claimed the row mid-purchase — the claim winner owns
    // the money legs. Record the verdict so reconciliation can see a vend that
    // raced settlement; a successful vend after settlement means the customer
    // may hold BOTH the vend and the compensation — escalate.
    await addEvent(transactionId, 'provider_outcome_after_claim', providerResult.message, {
      provider_id: fulfilledRoute.provider.id,
      outcome: providerResult.status,
    });
    if (providerResult.status !== 'failed') {
      queueUtilityAdminAlert({
        title: 'Provider vend landed after settlement claim',
        message: `${receipt} reported ${providerResult.status} after another process settled the transaction — verify whether the customer holds both the vend and the compensation.`,
        audience: 'support',
      });
    }
  } else if (providerResult.status === 'failed') {
    if (paymentSource === 'wallet') {
      await reverseWalletDebit(userId, {
        amountKobo: pricing.retailAmountKobo,
        reference: receipt,
        idempotencyKey: `utility:${transactionId}:REVERSAL_DEBIT`,
        description: `Utility payment reversal ${receipt}`,
        metadata: { utility_transaction_id: transactionId, category, biller: biller.code },
      });
      await addEvent(transactionId, 'wallet_reversed', 'Wallet debit reversed after provider failure.');
    } else {
      // The money for a 'paystack' source already left the customer's card/bank —
      // there is no wallet debit to reverse. It was captured by Paystack, so the
      // only place it can land back is the wallet (see settleTopupIntent for the
      // same "external payment -> wallet credit" shape). Without this, a provider
      // failure after a successful Paystack charge left the charge captured with
      // NOTHING refunded (found 2026-09-17 via a real stuck transaction).
      await creditWallet(userId, {
        amountKobo: pricing.retailAmountKobo,
        reference: receipt,
        idempotencyKey: `utility:${transactionId}:PAYSTACK_REFUND`,
        description: `Refund: utility payment ${receipt} (provider could not complete)`,
        metadata: {
          utility_transaction_id: transactionId,
          category,
          biller: biller.code,
          refund_reason: 'provider_failed',
          original_payment_source: 'paystack',
        },
      });
      await addEvent(transactionId, 'paystack_refunded', 'Paystack payment refunded to wallet after provider failure.');
    }
    await supabase.from('utility_transactions').update({ status: 'reversed', updated_at: new Date().toISOString() }).eq('id', transactionId);
  }

  const { data: finalRow } = await supabase.from('utility_transactions').select('*').eq('id', transactionId).maybeSingle();
  const transaction = (finalRow ?? inserted) as UtilityTransactionRow;

  // Record Spotlight commission for a SETTLED payment only (wallet debited &
  // provider succeeded/pending — NOT failed/reversed). Idempotent + best-effort:
  // it can never fail or reverse the customer's payment.
  if (transaction.status === 'successful' || transaction.status === 'provider_pending') {
    await recordUtilityCommissionEarning({ transaction, pricing, commission });
  }

  await notifyUtilityTransactionStatus(transaction, providerResult.message);
  if (transaction.status === 'provider_pending') {
    queueUtilityAdminAlert({
      title: 'Utility transaction pending confirmation',
      message: `${transaction.receipt_number ?? transaction.id} is pending provider confirmation.`,
      audience: 'support',
    });
  }
  return { alreadyProcessed: false, transaction };
}

export async function listUserUtilityTransactions(userId: string, opts: { limit?: number; offset?: number } = {}) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new ApiError('Failed to fetch utility transactions.', 500);
  return data ?? [];
}

export async function getUserUtilityTransaction(userId: string, transactionId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_transactions')
    .select('*')
    .eq('id', transactionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) throw new ApiError('Utility transaction not found.', 404);
  return data as UtilityTransactionRow;
}

export async function listUtilityTransactionAttempts(transactionId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_provider_attempts')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('attempt_number', { ascending: true });
  if (error) throw new ApiError('Failed to fetch utility provider attempts.', 500);
  return (data ?? []) as UtilityProviderAttemptRow[];
}

export async function requeryUtilityTransaction(transaction: UtilityTransactionRow) {
  if (!canRequeryUtilityStatus(transaction.status)) return transaction;

  // AUD-BILL-005: 'initiated'/'wallet_debited' rows never completed the
  // provider loop, so there is no provider state to requery — recover from the
  // provider-attempt evidence instead of asking a provider about a request_id
  // it cannot have.
  if (transaction.status !== 'provider_pending') {
    return recoverStuckUtilityTransaction(transaction);
  }
  // A provider_pending row with no recorded provider_reference can only be
  // requeried under a fabricated request id — the adapters derive one from the
  // CURRENT timestamp, so neither "failed" nor "successful" describes the real
  // vend. Attempt evidence decides instead.
  if (!transaction.provider_reference) {
    return recoverStuckUtilityTransaction(transaction);
  }

  const supabase = createAdminClient();
  const { data: provider } = await supabase.from('utility_providers').select('*').eq('id', transaction.provider_id).maybeSingle();
  if (!provider) throw new ApiError('Transaction provider not found.', 404);
  const adapter = getUtilityAdapter((provider as UtilityProviderRow).adapter_code);
  const providerRow = provider as UtilityProviderRow;
  const result = await withUtilityProviderTimeout(
    adapter.queryTransactionStatus({
      transactionId: transaction.id,
      providerReference: transaction.provider_reference,
      idempotencyKey: transaction.idempotency_key,
    }),
    getUtilityProviderTimeoutMs(providerRow.config),
  ).catch((error): import('./adapters/types').UtilityStatusResult => {
    if (error instanceof UtilityProviderTimeoutError) {
      return {
        status: 'pending' as const,
        providerReference: transaction.provider_reference ?? undefined,
        token: undefined,
        message: error.message,
        raw: { timeout: true, timeout_ms: error.timeoutMs },
      };
    }
    throw error;
  });
  const status = nextStatusFromProvider(result.status);

  // AUD-BILL-005: a definitive provider failure on a pending vend used to just
  // mark the row 'failed' and strand the debit. Compensate the money leg the
  // same way payUtility's own failure branch does — but only when the verdict
  // is authoritative (a real provider_reference was queried); a failed verdict
  // on a fabricated request id carries no evidence about the actual vend.
  if (status === 'failed') {
    return settleFailedUtilityTransaction(
      transaction,
      result.message ?? 'Provider failed transaction.',
      { authoritative: Boolean(transaction.provider_reference) },
    );
  }

  // AUD-BILL-005: CAS the verdict write on the observed version and the
  // requery-eligible status set — a settlement claim that landed while the
  // provider call was in flight bumps updated_at and moves the row terminal,
  // so a stale 'successful'/'pending' verdict must not resurrect a compensated
  // row.
  const { data: verdictRows } = await supabase.from('utility_transactions').update({
    status,
    provider_reference: result.providerReference ?? transaction.provider_reference,
    token: result.token ?? transaction.token,
    provider_response: result.raw ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', transaction.id)
    .in('status', ['initiated', 'wallet_debited', 'provider_pending'])
    .eq('updated_at', transaction.updated_at)
    .select('id');
  if ((verdictRows ?? []).length === 0) {
    await addEvent(transaction.id, 'provider_verdict_after_claim', `A settlement claim owns this row — discarding verdict ${status}.`);
    return reloadUtilityTransaction(transaction);
  }
  await addEvent(transaction.id, 'status_requery', result.message, { status });
  const { data } = await supabase.from('utility_transactions').select('*').eq('id', transaction.id).maybeSingle();
  const updated = (data ?? transaction) as UtilityTransactionRow;
  await notifyUtilityTransactionStatus(updated, result.message);
  return updated;
}

export async function reverseUtilityTransaction(transaction: UtilityTransactionRow, reason: string) {
  if (!canReverseUtilityTransaction(transaction.status)) throw new ApiError('Transaction is not eligible for reversal.', 400);
  // AUD-BILL-005: the automatic paths compensate under `REVERSAL_DEBIT` /
  // `PAYSTACK_REFUND` keys (and the Go plane under its own `<key>:reversal:*`
  // family) — different keys from this route's ADMIN_REVERSAL_* legs, so key
  // dedupe alone cannot stop a double refund when a crash left the status
  // 'failed' after compensation already posted. Probe every money leg the
  // transaction could have first; a posted compensation converges the status
  // without moving money, and a wallet-source row with NO debit leg at all is
  // an integrity anomaly that must never mint a reversal.
  const legs = await lookupUtilityMoneyLegs(transaction);
  if (transaction.payment_source === 'wallet' && !legs.debitPosted && !legs.compensationPosted) {
    throw new ApiError('No wallet debit exists for this transaction — nothing to reverse.', 409);
  }
  // AUD-BILL-005: serialise compensation behind the settlement claim — a
  // recoverer, the in-flight writer's auto-reverse, or a second admin all
  // probe the same ledger before posting, so without the claim two
  // compensators can both pass the probe and double-refund under different
  // key families.
  const claimed = transaction.status === 'failed'
    ? await claimFailedUtilityForReversal(transaction)
    : await claimUtilityForSettlement(transaction, `Admin reversal: ${reason}`);
  if (!claimed) {
    const current = await reloadUtilityTransaction(transaction);
    if (current.status === 'reversed') return current;
    throw new ApiError('This transaction is being settled by another process — retry shortly.', 409);
  }
  // Only a 'wallet' source ever debited the wallet ledger — reversing that
  // is a real REVERSAL_DEBIT. A 'paystack' source never touched the wallet,
  // so the equivalent action is a CREDIT (same helper payUtility's own
  // failure branch uses), not a reversal of something that never happened.
  if (legs.compensationPosted) {
    await addEvent(transaction.id, 'admin_reversal_skipped', `Compensation already posted for this transaction; skipping duplicate money leg. Reason: ${reason}`);
  } else if (transaction.payment_source === 'wallet') {
    await reverseWalletDebit(transaction.user_id, {
      amountKobo: transaction.retail_amount_kobo,
      reference: transaction.receipt_number ?? transaction.id,
      idempotencyKey: `utility:${transaction.id}:ADMIN_REVERSAL_DEBIT`,
      description: `Admin utility reversal: ${reason}`,
      metadata: { utility_transaction_id: transaction.id, reason },
    });
  } else {
    // The captured payment_reference is the proof a Paystack charge exists —
    // crediting a paystack-sourced row WITHOUT one mints unbacked funds (a
    // forged-source row is exactly how that anomaly arrives).
    const paymentRef = transaction.metadata?.payment_reference;
    if (typeof paymentRef !== 'string' || !paymentRef) {
      throw new ApiError('Paystack-sourced transaction has no captured payment reference — nothing proves funds were taken.', 409);
    }
    await creditWallet(transaction.user_id, {
      amountKobo: transaction.retail_amount_kobo,
      reference: transaction.receipt_number ?? transaction.id,
      idempotencyKey: `utility:${transaction.id}:ADMIN_REVERSAL_PAYSTACK_REFUND`,
      description: `Admin utility reversal (Paystack refund to wallet): ${reason}`,
      metadata: { utility_transaction_id: transaction.id, reason, original_payment_source: 'paystack' },
    });
  }
  const supabase = createAdminClient();
  await supabase.from('utility_transactions').update({
    status: 'reversed',
    failure_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq('id', transaction.id);
  await addEvent(transaction.id, 'admin_reversed', reason);
  const { data } = await supabase.from('utility_transactions').select('*').eq('id', transaction.id).maybeSingle();
  const updated = (data ?? transaction) as UtilityTransactionRow;
  await notifyUtilityTransactionStatus(updated, reason);
  return updated;
}

export async function createUtilityDispute(userId: string, transactionId: string, reason: string) {
  const transaction = await getUserUtilityTransaction(userId, transactionId);
  // AUD-BILL-005: 'disputed' is outside every claim, requery, and reversal set —
  // flipping a NON-terminal row to it freezes the row out of the sweep and
  // breaks the writer's settle CAS, stranding a debited wallet with no
  // compensator able to claim it. Disputes exist for delivered charges only.
  if (transaction.status !== 'successful') {
    throw new ApiError('Only a completed utility payment can be disputed.', 400);
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('utility_disputes').insert({
    transaction_id: transaction.id,
    user_id: userId,
    reason,
  }).select('*').single();
  if (error) throw new ApiError('Failed to create utility dispute.', 500);
  await supabase.from('utility_transactions').update({ status: 'disputed', updated_at: new Date().toISOString() }).eq('id', transaction.id);
  await addEvent(transaction.id, 'dispute_opened', reason);
  await notifyUtilityCustomer({ ...transaction, status: 'disputed' }, 'dispute_opened', reason);
  queueUtilityAdminAlert({
    title: 'Utility dispute opened',
    message: `${transaction.receipt_number ?? transaction.id}: ${reason}`,
    audience: 'support',
  });
  return data;
}

export async function listUtilityBeneficiaries(userId: string, category?: UtilityCategory) {
  const supabase = createAdminClient();
  let query = supabase
    .from('saved_utility_beneficiaries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (category) query = query.eq('category', category);
  const { data, error } = await query;
  if (error) throw new ApiError('Failed to fetch utility beneficiaries.', 500);
  return data ?? [];
}

export async function saveUtilityBeneficiary(userId: string, input: {
  category: UtilityCategory;
  billerId: string;
  label: string;
  customerReference: string;
  customerName?: string;
}) {
  const biller = await getBiller(input.billerId);
  if (biller.category !== input.category) throw new ApiError('Biller does not support this category.', 400);
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('saved_utility_beneficiaries').upsert({
    user_id: userId,
    category: input.category,
    biller_id: biller.id,
    label: input.label,
    customer_reference: input.customerReference,
    customer_name: input.customerName ?? null,
  }, { onConflict: 'user_id,biller_id,customer_reference' }).select('*').single();
  if (error) throw new ApiError('Failed to save utility beneficiary.', 500);
  return data;
}

export async function deleteUtilityBeneficiary(userId: string, beneficiaryId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('saved_utility_beneficiaries')
    .delete()
    .eq('id', beneficiaryId)
    .eq('user_id', userId);
  if (error) throw new ApiError('Failed to delete utility beneficiary.', 500);
}

type AdminTable =
  | 'utility_providers'
  | 'utility_billers'
  | 'utility_category_settings'
  | 'utility_products'
  | 'utility_provider_product_mappings'
  | 'utility_routing_rules';

function sanitizeProvider(row: Record<string, unknown>) {
  const { credentials: _credentials, ...safe } = row;
  return {
    ...safe,
    credentials_configured: providerCredentialsConfigured(row),
  };
}

function sanitizeAdminRows(table: AdminTable, rows: Record<string, unknown>[]) {
  return table === 'utility_providers' ? rows.map(sanitizeProvider) : rows;
}

export async function adminListUtilityTable(table: AdminTable, opts: { limit?: number; offset?: number } = {}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new ApiError(`Failed to list ${table}.`, 500);
  return sanitizeAdminRows(table, (data ?? []) as Record<string, unknown>[]);
}

export async function adminCreateUtilityRow(table: AdminTable, payload: Record<string, unknown>) {
  const supabase = createAdminClient();
  const protectedPayload = table === 'utility_providers' ? protectProviderCredentialsPayload(payload) : payload;
  const { data, error } = await supabase.from(table).insert(protectedPayload).select('*').single();
  if (error) {
    console.error(`[utility] failed to create ${table} row:`, error);
    throw new ApiError(`Failed to create ${table} row.`, 400);
  }
  return table === 'utility_providers' ? sanitizeProvider(data as Record<string, unknown>) : data;
}

export async function adminUpdateUtilityRow(table: AdminTable, id: string, payload: Record<string, unknown>) {
  const supabase = createAdminClient();
  const protectedPayload = table === 'utility_providers' ? protectProviderCredentialsPayload(payload) : payload;
  const keyColumn = table === 'utility_category_settings' ? 'category' : 'id';
  const { data, error } = await supabase
    .from(table)
    .update({ ...protectedPayload, updated_at: new Date().toISOString() })
    .eq(keyColumn, id)
    .select('*')
    .single();
  if (error) {
    console.error(`[utility] failed to update ${table} row:`, error);
    throw new ApiError(`Failed to update ${table} row.`, 400);
  }
  return table === 'utility_providers' ? sanitizeProvider(data as Record<string, unknown>) : data;
}

export async function adminListUtilityTransactions(opts: { limit?: number; offset?: number; status?: string } = {}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const supabase = createAdminClient();
  let query = supabase
    .from('utility_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (opts.status) query = query.eq('status', opts.status);
  const { data, error } = await query;
  if (error) throw new ApiError('Failed to list utility transactions.', 500);
  return data ?? [];
}

export async function adminGetUtilityTransaction(transactionId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('utility_transactions').select('*').eq('id', transactionId).maybeSingle();
  if (error || !data) throw new ApiError('Utility transaction not found.', 404);
  return data as UtilityTransactionRow;
}

export async function adminResolveUtilityDispute(transactionId: string, status: 'resolved' | 'rejected', resolutionNote: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_disputes')
    .update({ status, resolution_note: resolutionNote, updated_at: new Date().toISOString() })
    .eq('transaction_id', transactionId)
    .select('*')
    .single();
  if (error) throw new ApiError('Failed to resolve utility dispute.', 500);
  await addEvent(transactionId, 'dispute_resolved', resolutionNote, { status });
  const { data: transaction } = await supabase.from('utility_transactions').select('*').eq('id', transactionId).maybeSingle();
  if (transaction) {
    await notifyUtilityCustomer(transaction as UtilityTransactionRow, 'dispute_updated', resolutionNote);
  }
  return data;
}

export async function adminUtilityReport(type: 'profitability' | 'provider-performance' | 'reconciliation') {
  const supabase = createAdminClient();
  if (type === 'provider-performance') {
    const { data, error } = await supabase
      .from('utility_provider_attempts')
      .select('provider_id, status, duration_ms, timeout_ms, started_at')
      .range(0, 9999);
    if (error) throw new ApiError('Failed to build provider performance report.', 500);

    const grouped = new Map<string, {
      provider_id: string;
      attempts: number;
      successful: number;
      pending: number;
      failed: number;
      timeout: number;
      error: number;
      average_duration_ms: number;
      max_duration_ms: number;
      success_rate_bps: number;
    }>();

    for (const row of (data ?? []) as Array<{ provider_id: string; status: string; duration_ms: number | null }>) {
      const current = grouped.get(row.provider_id) ?? {
        provider_id: row.provider_id,
        attempts: 0,
        successful: 0,
        pending: 0,
        failed: 0,
        timeout: 0,
        error: 0,
        average_duration_ms: 0,
        max_duration_ms: 0,
        success_rate_bps: 0,
      };
      current.attempts += 1;
      current.successful += row.status === 'successful' ? 1 : 0;
      current.pending += row.status === 'pending' ? 1 : 0;
      current.failed += row.status === 'failed' ? 1 : 0;
      current.timeout += row.status === 'timeout' ? 1 : 0;
      current.error += row.status === 'error' ? 1 : 0;
      const duration = row.duration_ms ?? 0;
      current.average_duration_ms += duration;
      current.max_duration_ms = Math.max(current.max_duration_ms, duration);
      grouped.set(row.provider_id, current);
    }

    return Array.from(grouped.values()).map((row) => ({
      ...row,
      average_duration_ms: row.attempts > 0 ? Math.round(row.average_duration_ms / row.attempts) : 0,
      success_rate_bps: row.attempts > 0 ? Math.round((row.successful * 10_000) / row.attempts) : 0,
    }));
  }

  if (type === 'reconciliation') {
    const { data, error } = await supabase
      .from('utility_transactions')
      .select('id, receipt_number, category, provider_id, provider_reference, status, retail_amount_kobo, provider_cost_kobo, gross_profit_kobo, created_at')
      .order('created_at', { ascending: false })
      .range(0, 9999);
    if (error) throw new ApiError('Failed to build reconciliation report.', 500);
    return data ?? [];
  }

  const { data, error } = await supabase
    .from('utility_transactions')
    .select('category, provider_id, status, amount_kobo, retail_amount_kobo, provider_cost_kobo, gross_profit_kobo, created_at')
    .range(0, 9999);
  if (error) throw new ApiError('Failed to build utility report.', 500);

  const rows = (data ?? []) as Array<{
    category: UtilityCategory;
    provider_id: string | null;
    status: string;
    amount_kobo: number;
    retail_amount_kobo: number;
    provider_cost_kobo: number;
    gross_profit_kobo: number;
  }>;

  if (type === 'profitability') {
    return rows.reduce((summary, row) => {
      summary.total_transactions += 1;
      summary.gross_transaction_value_kobo += row.retail_amount_kobo;
      summary.provider_cost_kobo += row.provider_cost_kobo;
      summary.gross_profit_kobo += row.gross_profit_kobo;
      return summary;
    }, {
      total_transactions: 0,
      gross_transaction_value_kobo: 0,
      provider_cost_kobo: 0,
      gross_profit_kobo: 0,
    });
  }

  const grouped = new Map<string, { key: string; total: number; successful: number; pending: number; failed: number; gross_profit_kobo: number }>();
  for (const row of rows) {
    const key = row.category;
    const current = grouped.get(key) ?? { key, total: 0, successful: 0, pending: 0, failed: 0, gross_profit_kobo: 0 };
    current.total += 1;
    current.successful += row.status === 'successful' ? 1 : 0;
    current.pending += row.status === 'provider_pending' || row.status === 'wallet_debited' ? 1 : 0;
    current.failed += row.status === 'failed' || row.status === 'reversed' ? 1 : 0;
    current.gross_profit_kobo += row.gross_profit_kobo;
    grouped.set(key, current);
  }

  return Array.from(grouped.values());
}

export async function requeryPendingUtilityTransactions(limit = 25) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_transactions')
    .select('*')
    .in('status', ['initiated', 'wallet_debited', 'provider_pending'])
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));

  if (error) throw new ApiError('Failed to load pending utility transactions.', 500);

  const results = [];
  for (const transaction of (data ?? []) as UtilityTransactionRow[]) {
    try {
      const updated = await requeryUtilityTransaction(transaction);
      results.push({ id: transaction.id, ok: true, status: updated.status });
    } catch (error) {
      // ApiError messages are deliberate domain text; anything else may carry
      // adapter/fetch/PostgREST internals, so it is logged here and reported
      // generically — this array is returned verbatim in an admin response.
      if (!(error instanceof ApiError)) {
        console.error('[utility] requery failed for transaction', transaction.id, error);
      }
      results.push({
        id: transaction.id,
        ok: false,
        status: transaction.status,
        error: error instanceof ApiError ? error.message : 'Requery failed for this transaction.',
      });
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

export async function adminHealthCheckProvider(providerId: string) {
  const supabase = createAdminClient();
  const { data: provider, error } = await supabase.from('utility_providers').select('*').eq('id', providerId).maybeSingle();
  if (error || !provider) throw new ApiError('Utility provider not found.', 404);
  const result = await getUtilityAdapter((provider as UtilityProviderRow).adapter_code).healthCheck();
  await supabase.from('utility_providers').update({
    health_status: result.status,
    last_health_check_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', providerId);
  return result;
}

export async function adminImportUtilityProducts(products: Record<string, unknown>[]) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new ApiError('products must be a non-empty array.', 400);
  }

  const supabase = createAdminClient();
  const rows = products.map((product) => ({
    ...product,
    updated_at: new Date().toISOString(),
  }));
  const { data, error } = await supabase
    .from('utility_products')
    .upsert(rows, { onConflict: 'code' })
    .select('*');
  if (error) {
    console.error('[utility] failed to import utility products:', error);
    throw new ApiError('Failed to import utility products', 400);
  }
  return data ?? [];
}
