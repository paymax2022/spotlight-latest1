import { createSupabaseClient } from '@/lib/supabase';
import { api } from '@/api/client';
import {
  mapNetworkFromApi,
  mapCableProviderFromApi,
  mapMeterValidationFromApi,
  mapSmartCardValidationFromApi,
} from '@/api/mappers/billing.mapper';
import {
  Network,
  DataPlan,
  Disco,
  MeterValidation,
  CableProvider,
  CablePackage,
  SmartCardValidation,
  EducationProvider,
  EducationProduct,
  MeterType,
} from '@/types/billing';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Meta = Record<string, unknown>;
type UtilityCategory = 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'education';

async function getProductsByBillerCode(
  billerCode: string,
): Promise<Array<{ id: string; name: string; code: string; amount_kobo: number | null; amount_type: string; metadata: Meta | null }>> {
  const supabase = createSupabaseClient();
  const { data: biller, error: billerErr } = await supabase
    .from('utility_billers')
    .select('id')
    .eq('code', billerCode)
    .maybeSingle();

  if (billerErr) throw billerErr;
  if (!biller) return [];

  const { data: products, error: prodErr } = await supabase
    .from('utility_products')
    .select('id, name, code, amount_kobo, amount_type, metadata')
    .eq('biller_id', biller.id)
    .eq('status', 'active');

  if (prodErr) throw prodErr;
  return (products ?? []) as Array<{ id: string; name: string; code: string; amount_kobo: number | null; amount_type: string; metadata: Meta | null }>;
}

function koboToNaira(value?: number | null): number {
  return Number(value ?? 0) / 100;
}

async function getBillerIdByCode(billerCode: string, category: UtilityCategory): Promise<string> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('utility_billers')
    .select('id')
    .eq('code', billerCode)
    .eq('category', category)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Selected service provider is not available.');
  return String(data.id);
}

async function getFirstActiveProductId(billerId: string, amountType?: 'fixed' | 'variable'): Promise<string> {
  const supabase = createSupabaseClient();
  let query = supabase
    .from('utility_products')
    .select('id')
    .eq('biller_id', billerId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);

  if (amountType) query = query.eq('amount_type', amountType);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Selected service product is not available.');
  return String(data.id);
}

function normalizeUtilityPaymentResponse(raw: unknown): Record<string, unknown> {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const transaction = (typeof data.transaction === 'object' && data.transaction !== null ? data.transaction : {}) as Record<string, unknown>;
  const transactionId = String(data.transactionId ?? data.transaction_id ?? transaction.id ?? '');
  return { ...data, transaction, transactionId, transaction_id: transactionId };
}

async function postUtilityPayment(input: {
  category: UtilityCategory;
  billerId: string;
  productId: string;
  customerReference: string;
  amountKobo?: number;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const res = await api.post('/api/v1/utility/pay', {
    category: input.category,
    biller_id: input.billerId,
    product_id: input.productId,
    customer_reference: input.customerReference,
    amount_kobo: input.amountKobo,
    metadata: input.metadata ?? {},
  }, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
  return normalizeUtilityPaymentResponse(res.data?.data ?? res.data);
}

async function postUtilityPaystackInitiation(input: {
  category: UtilityCategory;
  billerId: string;
  productId: string;
  customerReference: string;
  amountKobo?: number;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<{ authorizationUrl: string; paymentReference: string }> {
  const res = await api.post('/api/v1/utility/paystack/initiate', {
    category: input.category,
    biller_id: input.billerId,
    product_id: input.productId,
    customer_reference: input.customerReference,
    amount_kobo: input.amountKobo,
    metadata: input.metadata ?? {},
  }, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return {
    authorizationUrl: String(data.authorizationUrl ?? data.authorization_url ?? ''),
    paymentReference: String(data.paymentReference ?? data.payment_reference ?? ''),
  };
}

// ─── Paystack intent status (bills) ─────────────────────────────────────────
// A utility Paystack payment creates a `utility_paystack_intents` row keyed by
// its payment_reference; the Paystack webhook flips its status to
// 'completed'/'failed' and links transaction_id → the utility_transactions row.
// The in-app SDK checkout polls this to know when to route to the transaction
// status screen. RLS scopes the row to the owner.
export interface UtilityPaystackIntent {
  reference: string;
  status: 'pending' | 'completed' | 'failed' | string;
  transactionId: string | null;
  failureReason?: string;
}

export async function getUtilityPaystackIntent(reference: string): Promise<UtilityPaystackIntent> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('utility_paystack_intents')
    .select('payment_reference, status, transaction_id, failure_reason')
    .eq('payment_reference', reference)
    .eq('user_id', user.id)
    .single();

  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    reference:     String(r.payment_reference ?? reference),
    status:        String(r.status ?? 'pending'),
    transactionId: r.transaction_id ? String(r.transaction_id) : null,
    failureReason: r.failure_reason ? String(r.failure_reason) : undefined,
  };
}

async function postUtilityValidation(input: {
  category: UtilityCategory;
  billerId: string;
  productId?: string;
  customerReference: string;
  metadata?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const res = await api.post('/api/v1/utility/validate', {
    category: input.category,
    biller_id: input.billerId,
    product_id: input.productId,
    customer_reference: input.customerReference,
    metadata: input.metadata ?? {},
  });
  return (res.data?.data ?? res.data) as Record<string, unknown>;
}

// ─── Provider logos (VTPass `image`) ────────────────────────────────────────

export interface ProviderLogoInfo { serviceID: string; name: string; image?: string }

// Fetches official provider logos (serviceID + image) for a category from VTPass
// via the backend. Returns [] on failure — callers fall back to brand logos.
export async function getProviderLogos(category: UtilityCategory): Promise<ProviderLogoInfo[]> {
  try {
    const res = await api.get(`/api/v1/utility/logos?category=${category}`);
    const data = (res.data?.data ?? res.data) as { services?: ProviderLogoInfo[] };
    return data.services ?? [];
  } catch {
    return [];
  }
}

// Resolves a provider/biller (by code or name) to its VTPass logo image URL.
// Biller codes look like 'vtpass-eko-electric' / 'vtpass-mtn-airtime'; VTPass
// serviceIDs are 'eko-electric' / 'mtn' / 'mtn-data' / 'dstv' / 'waec'.
export function resolveProviderImage(
  services: ProviderLogoInfo[],
  code: string,
  name: string,
): string | undefined {
  const stripped = (code || '').replace(/^vtpass-/, '').toLowerCase();
  const byId = services.find((s) => {
    const sid = (s.serviceID || '').toLowerCase();
    return !!sid && (sid === stripped || stripped.startsWith(sid) || sid.startsWith(stripped));
  });
  if (byId?.image) return byId.image;
  const first = (name || '').toLowerCase().split(' ')[0];
  if (first) {
    const byName = services.find((s) => (s.name || '').toLowerCase().includes(first));
    if (byName?.image) return byName.image;
  }
  return undefined;
}

// ─── Airtime ─────────────────────────────────────────────────────────────────

export async function getAirtimeNetworks(): Promise<Network[]> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('utility_billers')
    .select('id, name, code, status')
    .eq('category', 'airtime')
    .eq('status', 'active');

  if (error) throw error;
  return (data ?? []).map((row) => mapNetworkFromApi(row));
}

export interface AirtimePurchasePayload {
  networkCode: string;
  phoneNumber: string;
  amount: number;
  paymentMethod: 'WALLET';
  idempotencyKey: string;
  transactionPin: string;
}

export async function purchaseAirtime(payload: AirtimePurchasePayload): Promise<Record<string, unknown>> {
  const billerId = await getBillerIdByCode(payload.networkCode, 'airtime');
  const productId = await getFirstActiveProductId(billerId, 'variable');
  return postUtilityPayment({
    category: 'airtime',
    billerId,
    productId,
    customerReference: payload.phoneNumber,
    amountKobo: Math.round(payload.amount * 100),
    metadata: {
      customer_phone: payload.phoneNumber,
      payment_method: payload.paymentMethod,
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

export async function initiateAirtimePaystack(payload: Omit<AirtimePurchasePayload, 'paymentMethod' | 'transactionPin'>): Promise<{ authorizationUrl: string; paymentReference: string }> {
  const billerId = await getBillerIdByCode(payload.networkCode, 'airtime');
  const productId = await getFirstActiveProductId(billerId, 'variable');
  return postUtilityPaystackInitiation({
    category: 'airtime',
    billerId,
    productId,
    customerReference: payload.phoneNumber,
    amountKobo: Math.round(payload.amount * 100),
    metadata: {
      customer_phone: payload.phoneNumber,
      payment_method: 'PAYSTACK',
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

// ─── Data ─────────────────────────────────────────────────────────────────────

export async function getDataNetworks(): Promise<Network[]> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('utility_billers')
    .select('id, name, code, status')
    .eq('category', 'data')
    .eq('status', 'active');

  if (error) throw error;
  return (data ?? []).map((row) => mapNetworkFromApi(row));
}

export async function getDataPlans(billerCode: string): Promise<DataPlan[]> {
  const rows = await getProductsByBillerCode(billerCode);
  return rows.map((p) => {
    const meta = (p.metadata ?? {}) as Meta;
    return {
      id:           String(p.id),
      networkCode:  billerCode,
      name:         String(p.name),
      allowance:    String(meta.allowance ?? p.name),
      validity:     String(meta.validity ?? ''),
      sellingPrice: koboToNaira(Number(p.amount_kobo)),
      providerCode: String(p.code),
      isActive:     true,
    };
  });
}

export interface DataPurchasePayload {
  networkCode: string;
  phoneNumber: string;
  planId: string;
  paymentMethod: 'WALLET';
  idempotencyKey: string;
  transactionPin: string;
}

export async function purchaseData(payload: DataPurchasePayload): Promise<Record<string, unknown>> {
  const billerId = await getBillerIdByCode(payload.networkCode, 'data');
  return postUtilityPayment({
    category: 'data',
    billerId,
    productId: payload.planId,
    customerReference: payload.phoneNumber,
    metadata: {
      customer_phone: payload.phoneNumber,
      payment_method: payload.paymentMethod,
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

export async function initiateDataPaystack(payload: Omit<DataPurchasePayload, 'paymentMethod' | 'transactionPin'>): Promise<{ authorizationUrl: string; paymentReference: string }> {
  const billerId = await getBillerIdByCode(payload.networkCode, 'data');
  return postUtilityPaystackInitiation({
    category: 'data',
    billerId,
    productId: payload.planId,
    customerReference: payload.phoneNumber,
    metadata: {
      customer_phone: payload.phoneNumber,
      payment_method: 'PAYSTACK',
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

// ─── Electricity ──────────────────────────────────────────────────────────────

export async function getElectricityDiscos(): Promise<Disco[]> {
  const supabase = createSupabaseClient();
  // NOTE: utility_billers has no `metadata` column — selecting it makes PostgREST
  // reject the whole query, which previously left the DISCO grid silently empty.
  // Prepaid/postpaid support defaults to true (per-product meter type is chosen
  // in the form), matching the other biller-list queries above.
  const { data, error } = await supabase
    .from('utility_billers')
    .select('id, name, code, status')
    .eq('category', 'electricity')
    .eq('status', 'active');

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id:               String(row.id),
    name:             String(row.name),
    code:             String(row.code),
    supportsPrepaid:  true,
    supportsPostpaid: true,
    isActive:         true,
  }));
}

export async function validateMeter(payload: {
  discoCode: string;
  meterNumber: string;
  meterType: MeterType;
}): Promise<MeterValidation> {
  const billerId = await getBillerIdByCode(payload.discoCode, 'electricity');
  const productId = await getFirstActiveProductId(billerId, 'variable');
  const data = await postUtilityValidation({
    category: 'electricity',
    billerId,
    productId,
    customerReference: payload.meterNumber,
    // VTPass needs the meter type (prepaid/postpaid) to verify an electricity meter.
    metadata: { type: payload.meterType.toLowerCase() },
  });
  return mapMeterValidationFromApi({
    ...data,
    meter_number: payload.meterNumber,
    disco_name: payload.discoCode,
  });
}

export interface ElectricityPayPayload {
  discoCode: string;
  meterNumber: string;
  meterType: MeterType;
  amount: number;
  customerPhone: string;
  customerEmail?: string;
  paymentMethod: 'WALLET';
  idempotencyKey: string;
  transactionPin: string;
}

export async function payElectricity(payload: ElectricityPayPayload): Promise<Record<string, unknown>> {
  const billerId = await getBillerIdByCode(payload.discoCode, 'electricity');
  const productId = await getFirstActiveProductId(billerId, 'variable');
  return postUtilityPayment({
    category: 'electricity',
    billerId,
    productId,
    customerReference: payload.meterNumber,
    amountKobo: Math.round(payload.amount * 100),
    metadata: {
      meter_type: payload.meterType,
      customer_phone: payload.customerPhone,
      customer_email: payload.customerEmail,
      payment_method: payload.paymentMethod,
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

export async function initiateElectricityPaystack(payload: Omit<ElectricityPayPayload, 'paymentMethod' | 'transactionPin'>): Promise<{ authorizationUrl: string; paymentReference: string }> {
  const billerId = await getBillerIdByCode(payload.discoCode, 'electricity');
  const productId = await getFirstActiveProductId(billerId, 'variable');
  return postUtilityPaystackInitiation({
    category: 'electricity',
    billerId,
    productId,
    customerReference: payload.meterNumber,
    amountKobo: Math.round(payload.amount * 100),
    metadata: {
      meter_type: payload.meterType,
      customer_phone: payload.customerPhone,
      customer_email: payload.customerEmail,
      payment_method: 'PAYSTACK',
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

// ─── Cable TV ─────────────────────────────────────────────────────────────────

export async function getCableProviders(): Promise<CableProvider[]> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('utility_billers')
    .select('id, name, code, status')
    .eq('category', 'cable_tv')
    .eq('status', 'active');

  if (error) throw error;
  return (data ?? []).map((row) => mapCableProviderFromApi(row));
}

export async function getCablePackages(billerCode: string): Promise<CablePackage[]> {
  const rows = await getProductsByBillerCode(billerCode);
  return rows.map((p) => {
    const meta = (p.metadata ?? {}) as Meta;
    return {
      id:                String(p.id),
      providerCode:      billerCode,
      name:              String(p.name),
      duration:          String(meta.duration ?? meta.validity ?? '30 days'),
      sellingPrice:      koboToNaira(Number(p.amount_kobo)),
      providerCodeValue: String(p.code),
      isActive:          true,
    };
  });
}

export async function validateSmartCard(payload: {
  providerCode: string;
  smartCardNumber: string;
}): Promise<SmartCardValidation> {
  const billerId = await getBillerIdByCode(payload.providerCode, 'cable_tv');
  const productId = await getFirstActiveProductId(billerId);
  const data = await postUtilityValidation({
    category: 'cable_tv',
    billerId,
    productId,
    customerReference: payload.smartCardNumber,
  });
  return mapSmartCardValidationFromApi({
    ...data,
    smart_card_number: payload.smartCardNumber,
    provider_name: payload.providerCode,
  });
}

export interface CablePayPayload {
  providerCode: string;
  smartCardNumber: string;
  packageId: string;
  customerPhone: string;
  customerEmail?: string;
  paymentMethod: 'WALLET';
  idempotencyKey: string;
  transactionPin: string;
}

export async function payCable(payload: CablePayPayload): Promise<Record<string, unknown>> {
  const billerId = await getBillerIdByCode(payload.providerCode, 'cable_tv');
  return postUtilityPayment({
    category: 'cable_tv',
    billerId,
    productId: payload.packageId,
    customerReference: payload.smartCardNumber,
    metadata: {
      customer_phone: payload.customerPhone,
      customer_email: payload.customerEmail,
      payment_method: payload.paymentMethod,
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

export async function initiateCablePaystack(payload: Omit<CablePayPayload, 'paymentMethod' | 'transactionPin'>): Promise<{ authorizationUrl: string; paymentReference: string }> {
  const billerId = await getBillerIdByCode(payload.providerCode, 'cable_tv');
  return postUtilityPaystackInitiation({
    category: 'cable_tv',
    billerId,
    productId: payload.packageId,
    customerReference: payload.smartCardNumber,
    metadata: {
      customer_phone: payload.customerPhone,
      customer_email: payload.customerEmail,
      payment_method: 'PAYSTACK',
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

// ─── Education ────────────────────────────────────────────────────────────────

const EDUCATION_COLORS: Record<string, { accent: string; bg: string }> = {
  WAEC:    { accent: '#7C3AED', bg: 'rgba(124,58,237,0.10)' },
  NECO:    { accent: '#340075', bg: 'rgba(52,0,117,0.08)' },
  JAMB:    { accent: '#0051D5', bg: 'rgba(0,81,213,0.08)' },
  DEFAULT: { accent: '#340075', bg: 'rgba(52,0,117,0.08)' },
};

export async function getEducationProviders(): Promise<EducationProvider[]> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('utility_billers')
    .select('id, name, code, status')
    .eq('category', 'education')
    .eq('status', 'active');

  if (error) throw error;
  return (data ?? []).map((row) => {
    const name = String(row.name ?? '');
    const colorKey = name.toUpperCase().includes('WAEC') ? 'WAEC'
      : name.toUpperCase().includes('NECO') ? 'NECO'
        : name.toUpperCase().includes('JAMB') ? 'JAMB'
          : 'DEFAULT';
    const clr = EDUCATION_COLORS[colorKey] ?? EDUCATION_COLORS.DEFAULT;
    return {
      id:       String(row.id),
      name,
      code:     String(row.code),
      isActive: true,
      accent:   clr.accent,
      bg:       clr.bg,
    };
  });
}

export async function getEducationProducts(billerCode: string): Promise<EducationProduct[]> {
  const rows = await getProductsByBillerCode(billerCode);
  return rows.map((p) => {
    const meta = (p.metadata ?? {}) as Meta;
    return {
      id:                String(p.id),
      providerCode:      billerCode,
      name:              String(p.name),
      sellingPrice:      koboToNaira(Number(p.amount_kobo)),
      providerCodeValue: String(p.code),
      isActive:          true,
      meta:              String(meta.validity ?? meta.duration ?? 'Instant PIN'),
    };
  });
}

export interface EducationPayPayload {
  providerCode: string;
  productId: string;
  customerReference: string;
  customerPhone: string;
  paymentMethod: 'WALLET';
  idempotencyKey: string;
  transactionPin: string;
}

export async function payEducation(payload: EducationPayPayload): Promise<Record<string, unknown>> {
  const billerId = await getBillerIdByCode(payload.providerCode, 'education');
  return postUtilityPayment({
    category: 'education',
    billerId,
    productId: payload.productId,
    customerReference: payload.customerReference,
    metadata: {
      customer_phone: payload.customerPhone,
      payment_method: payload.paymentMethod,
    },
    idempotencyKey: payload.idempotencyKey,
  });
}

export async function initiateEducationPaystack(payload: Omit<EducationPayPayload, 'paymentMethod' | 'transactionPin'>): Promise<{ authorizationUrl: string; paymentReference: string }> {
  const billerId = await getBillerIdByCode(payload.providerCode, 'education');
  return postUtilityPaystackInitiation({
    category: 'education',
    billerId,
    productId: payload.productId,
    customerReference: payload.customerReference,
    metadata: {
      customer_phone: payload.customerPhone,
      payment_method: 'PAYSTACK',
    },
    idempotencyKey: payload.idempotencyKey,
  });
}
