import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { debitWallet, reverseWalletDebit } from '@/src/server/wallet/service';
import { calculateUtilityPricing } from './pricing';
import { getViableUtilityRoutes, selectUtilityProvider, type UtilityRouteCandidate } from './routing';
import { canRequeryUtilityStatus, canReverseUtilityTransaction, nextStatusFromProvider } from './status';
import { getUtilityAdapter } from './adapters/registry';
import { fetchVtpassServices, type VtpassServiceInfo } from './adapters/vtpass';
import type { UtilityValidationResult } from './adapters/types';
import {
  protectProviderCredentialsPayload,
  providerCredentialsConfigured,
} from './credentials';
import {
  getUtilityProviderTimeoutMs,
  UtilityProviderTimeoutError,
  withUtilityProviderTimeout,
} from './provider-timeout';
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

  if (error) throw new ApiError(`Failed to record provider attempt: ${error.message}`, 500);
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
    // 'vtpass-eko-electric' -> 'eko-electric'; the sandbox stub keys off the meter.)
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
  if (existing) return { alreadyProcessed: true, transaction: existing as UtilityTransactionRow };

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
  const pricing = calculateUtilityPricing(product, route.mapping, amountKobo);
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
    throw new ApiError(`Failed to create utility transaction: ${insertError.message}`, 500);
  }

  await addEvent(transactionId, 'initiated', 'Utility payment initiated.', { pricing });

  if (paymentSource === 'wallet') {
    await debitWallet(userId, {
      amountKobo: pricing.retailAmountKobo,
      reference: receipt,
      idempotencyKey: `utility:${transactionId}:DEBIT`,
      description: `Utility payment ${receipt}`,
      metadata: { utility_transaction_id: transactionId, category, biller: biller.code },
    });

    await supabase.from('utility_transactions').update({ status: 'wallet_debited', updated_at: new Date().toISOString() }).eq('id', transactionId);
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
      lastProviderError = error instanceof Error ? error.message : 'Provider attempt failed.';
      await addEvent(transactionId, 'provider_attempt_error', lastProviderError, {
        provider_id: candidate.provider.id,
        attempt_number: index + 1,
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
  await supabase.from('utility_transactions').update(patch).eq('id', transactionId);
  await addEvent(transactionId, `provider_${providerResult.status}`, providerResult.message, {
    provider_id: fulfilledRoute.provider.id,
    raw: providerResult.raw ?? {},
  });

  if (providerResult.status === 'failed' && paymentSource === 'wallet') {
    await reverseWalletDebit(userId, {
      amountKobo: pricing.retailAmountKobo,
      reference: receipt,
      idempotencyKey: `utility:${transactionId}:REVERSAL_DEBIT`,
      description: `Utility payment reversal ${receipt}`,
      metadata: { utility_transaction_id: transactionId, category, biller: biller.code },
    });
    await supabase.from('utility_transactions').update({ status: 'reversed', updated_at: new Date().toISOString() }).eq('id', transactionId);
    await addEvent(transactionId, 'wallet_reversed', 'Wallet debit reversed after provider failure.');
  }

  const { data: finalRow } = await supabase.from('utility_transactions').select('*').eq('id', transactionId).maybeSingle();
  const transaction = (finalRow ?? inserted) as UtilityTransactionRow;
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
  await supabase.from('utility_transactions').update({
    status,
    provider_reference: result.providerReference ?? transaction.provider_reference,
    token: result.token ?? transaction.token,
    provider_response: result.raw ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', transaction.id);
  await addEvent(transaction.id, 'status_requery', result.message, { status });
  const { data } = await supabase.from('utility_transactions').select('*').eq('id', transaction.id).maybeSingle();
  const updated = (data ?? transaction) as UtilityTransactionRow;
  await notifyUtilityTransactionStatus(updated, result.message);
  return updated;
}

export async function reverseUtilityTransaction(transaction: UtilityTransactionRow, reason: string) {
  if (!canReverseUtilityTransaction(transaction.status)) throw new ApiError('Transaction is not eligible for reversal.', 400);
  await reverseWalletDebit(transaction.user_id, {
    amountKobo: transaction.retail_amount_kobo,
    reference: transaction.receipt_number ?? transaction.id,
    idempotencyKey: `utility:${transaction.id}:ADMIN_REVERSAL_DEBIT`,
    description: `Admin utility reversal: ${reason}`,
    metadata: { utility_transaction_id: transaction.id, reason },
  });
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
  if (error) throw new ApiError(`Failed to create ${table} row: ${error.message}`, 400);
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
  if (error) throw new ApiError(`Failed to update ${table} row: ${error.message}`, 400);
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
      results.push({
        id: transaction.id,
        ok: false,
        status: transaction.status,
        error: error instanceof Error ? error.message : 'Unknown requery failure',
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
  if (error) throw new ApiError(`Failed to import utility products: ${error.message}`, 400);
  return data ?? [];
}
