import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { errorResponse, handleApiError, ApiError } from '@/src/lib/api/responses';
import { payUtility, validateUtilityCustomer } from '@/src/server/utility/service';
import type { UtilityCategory } from '@/src/server/utility/types';
import { requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../v1/utility/_utils';

type BillerCategory = Extract<UtilityCategory, 'airtime' | 'data' | 'electricity' | 'cable_tv'>;

async function getBillerByCode(category: BillerCategory, code: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_billers')
    .select('id, code, category')
    .eq('category', category)
    .eq('code', code)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw new ApiError('Failed to resolve utility biller.', 500);
  if (!data) throw new ApiError('Selected service provider is not available.', 404);
  return data as { id: string; code: string; category: BillerCategory };
}

async function getFirstProductId(billerId: string, amountType?: 'fixed' | 'variable') {
  const supabase = createAdminClient();
  let query = supabase
    .from('utility_products')
    .select('id')
    .eq('biller_id', billerId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);

  if (amountType) query = query.eq('amount_type', amountType);

  const { data, error } = await query.maybeSingle();
  if (error) throw new ApiError('Failed to resolve utility product.', 500);
  if (!data?.id) throw new ApiError('Selected service product is not available.', 404);
  return String(data.id);
}

function responseFor(result: Awaited<ReturnType<typeof payUtility>>) {
  return NextResponse.json(
    {
      success: true,
      already_processed: result.alreadyProcessed,
      transaction: result.transaction,
      transactionId: result.transaction.id,
      transaction_id: result.transaction.id,
    },
    { status: result.alreadyProcessed ? 200 : 201 },
  );
}

function idempotencyKey(request: Request, body: Record<string, unknown>) {
  return request.headers.get('Idempotency-Key') || String(body.idempotencyKey || body.idempotency_key || '');
}

export async function legacyUtilityPurchase(request: Request, input: {
  category: BillerCategory;
  billerCode: (body: Record<string, unknown>) => string;
  customerReference: (body: Record<string, unknown>) => string;
  productId?: (body: Record<string, unknown>, billerId: string) => Promise<string> | string;
  amountKobo?: (body: Record<string, unknown>) => number | undefined;
  metadata?: (body: Record<string, unknown>) => Record<string, unknown>;
}) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, `legacy-${input.category}-pay`, user.id, 10, 60_000);
    if (limited) return limited;

    const body = await request.json() as Record<string, unknown>;
    const key = idempotencyKey(request, body);
    if (!key) return errorResponse('Idempotency-Key header is required for utility payments.', 400);

    const biller = await getBillerByCode(input.category, input.billerCode(body));
    const productId = input.productId
      ? await input.productId(body, biller.id)
      : await getFirstProductId(biller.id, input.amountKobo ? 'variable' : undefined);

    const result = await payUtility(user.id, {
      category: input.category,
      billerId: biller.id,
      productId,
      customerReference: input.customerReference(body),
      amountKobo: input.amountKobo?.(body),
      paymentSource: 'wallet',
      metadata: input.metadata?.(body) ?? {},
      idempotencyKey: key,
    });

    return responseFor(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function legacyUtilityValidation(request: Request, input: {
  category: BillerCategory;
  billerCode: (body: Record<string, unknown>) => string;
  customerReference: (body: Record<string, unknown>) => string;
  productId?: (body: Record<string, unknown>, billerId: string) => Promise<string> | string;
}) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, `legacy-${input.category}-validate`, user.id, 40, 60_000);
    if (limited) return limited;

    const body = await request.json() as Record<string, unknown>;
    const biller = await getBillerByCode(input.category, input.billerCode(body));
    const productId = input.productId ? await input.productId(body, biller.id) : await getFirstProductId(biller.id);
    const result = await validateUtilityCustomer({
      category: input.category,
      billerId: biller.id,
      productId,
      customerReference: input.customerReference(body),
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function firstProductId(billerId: string, amountType?: 'fixed' | 'variable') {
  return getFirstProductId(billerId, amountType);
}
