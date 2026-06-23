/**
 * Billing / VAS API client — maps to /api/v1/utility/* generic biller model.
 *
 * All amounts sent to the server are in kobo (integer).
 * All amounts received from the server (amount_kobo, retail_amount_kobo) are in kobo.
 * Converted to naira in mappers / formatCurrency for display.
 */
import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { CablePackage, CableProvider, DataPlan, Disco, Network, ValidationResult } from '@/types/billing';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ApiRecord = Record<string, unknown>;

function asRecord(v: unknown): ApiRecord {
  return typeof v === 'object' && v !== null ? (v as ApiRecord) : {};
}

function mapBillerToNetwork(b: ApiRecord): Network {
  return {
    id: String(b.id ?? ''),
    name: String(b.name ?? ''),
    code: String(b.code ?? ''),
    logoUrl: b.logo_url ? String(b.logo_url) : undefined,
    isActive: b.status !== 'disabled',
  };
}

function mapBillerToDisco(b: ApiRecord): Disco {
  const meta = asRecord(b.metadata ?? b.dynamic_fields ?? {});
  return {
    id: String(b.id ?? ''),
    name: String(b.name ?? ''),
    code: String(b.code ?? ''),
    supportsPrepaid: meta.supports_prepaid !== false,
    supportsPostpaid: meta.supports_postpaid !== false,
    isActive: b.status !== 'disabled',
  };
}

function mapBillerToCableProvider(b: ApiRecord): CableProvider {
  return {
    id: String(b.id ?? ''),
    name: String(b.name ?? ''),
    code: String(b.code ?? ''),
    logoUrl: b.logo_url ? String(b.logo_url) : undefined,
    isActive: b.status !== 'disabled',
  };
}

function mapProductToDataPlan(p: ApiRecord): DataPlan {
  const meta = asRecord(p.metadata ?? {});
  return {
    id: String(p.id ?? ''),
    networkCode: String(p.biller_id ?? ''),
    name: String(p.name ?? ''),
    allowance: String(meta.allowance ?? p.name ?? ''),
    validity: String(meta.validity ?? ''),
    sellingPrice: p.amount_kobo != null ? Number(p.amount_kobo) / 100 : 0,
    providerCode: String(p.code ?? ''),
    isActive: p.status !== 'disabled',
  };
}

function mapProductToCablePackage(p: ApiRecord): CablePackage {
  const meta = asRecord(p.metadata ?? {});
  return {
    id: String(p.id ?? ''),
    providerCode: String(p.biller_id ?? ''),
    name: String(p.name ?? ''),
    duration: String(meta.duration ?? meta.validity ?? '30 days'),
    sellingPrice: p.amount_kobo != null ? Number(p.amount_kobo) / 100 : 0,
    providerCodeValue: String(p.code ?? ''),
    isActive: p.status !== 'disabled',
  };
}

function mapValidationResult(data: ApiRecord): ValidationResult {
  return {
    customerName: String(data.customerName ?? data.customer_name ?? ''),
    customerAddress: data.customerAddress ?? data.customer_address
      ? String(data.customerAddress ?? data.customer_address)
      : undefined,
    meterNumber: data.meterNumber ?? data.meter_number
      ? String(data.meterNumber ?? data.meter_number)
      : undefined,
    smartCardNumber: data.smartCardNumber ?? data.smart_card_number
      ? String(data.smartCardNumber ?? data.smart_card_number)
      : undefined,
    discoName: data.discoName ?? data.disco_name
      ? String(data.discoName ?? data.disco_name)
      : undefined,
    providerName: data.providerName ?? data.provider_name
      ? String(data.providerName ?? data.provider_name)
      : undefined,
    currentBouquet: data.currentBouquet ?? data.current_bouquet
      ? String(data.currentBouquet ?? data.current_bouquet)
      : undefined,
    minimumAmount: data.minimumAmount ?? data.minimum_amount
      ? Number(data.minimumAmount ?? data.minimum_amount)
      : undefined,
    maximumAmount: data.maximumAmount ?? data.maximum_amount
      ? Number(data.maximumAmount ?? data.maximum_amount)
      : undefined,
  };
}

/** Extract the transaction ID from a /api/v1/utility/pay response */
function extractTransactionId(data: ApiRecord): string {
  const tx = asRecord(data.transaction ?? data);
  return String(tx.id ?? tx.transactionId ?? tx.transaction_id ?? '');
}

// ---------------------------------------------------------------------------
// Airtime
// ---------------------------------------------------------------------------

export async function getAirtimeNetworks(): Promise<Network[]> {
  const response = await api.get('/api/v1/utility/billers', { params: { category: 'AIRTIME' } });
  const data = response.data?.data ?? response.data;
  return (Array.isArray(data?.billers) ? data.billers : []).map((b: ApiRecord) => mapBillerToNetwork(b));
}

export async function buyAirtime(payload: {
  networkCode: string;
  phoneNumber: string;
  amount: number;       // naira
  paymentMethod: 'WALLET';
  idempotencyKey: string;
}) {
  const response = await api.post(
    '/api/v1/utility/pay',
    {
      category: 'AIRTIME',
      biller_id: payload.networkCode,
      customer_reference: payload.phoneNumber,
      amount_kobo: Math.round(payload.amount * 100),
    },
    { headers: { 'Idempotency-Key': payload.idempotencyKey } },
  );
  const data = response.data?.data ?? response.data;
  return { transactionId: extractTransactionId(asRecord(data)), ...asRecord(data) };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export async function getDataNetworks(): Promise<Network[]> {
  const response = await api.get('/api/v1/utility/billers', { params: { category: 'DATA' } });
  const data = response.data?.data ?? response.data;
  return (Array.isArray(data?.billers) ? data.billers : []).map((b: ApiRecord) => mapBillerToNetwork(b));
}

export async function getDataPlans(networkCode: string): Promise<DataPlan[]> {
  const response = await api.get('/api/v1/utility/products', {
    params: { category: 'DATA', biller: networkCode },
  });
  const data = response.data?.data ?? response.data;
  return (Array.isArray(data?.products) ? data.products : []).map((p: ApiRecord) => mapProductToDataPlan(p));
}

export async function buyData(payload: {
  networkCode: string;
  phoneNumber: string;
  planId: string;
  paymentMethod: 'WALLET';
  idempotencyKey: string;
}) {
  const response = await api.post(
    '/api/v1/utility/pay',
    {
      category: 'DATA',
      biller_id: payload.networkCode,
      product_id: payload.planId,
      customer_reference: payload.phoneNumber,
    },
    { headers: { 'Idempotency-Key': payload.idempotencyKey } },
  );
  const data = response.data?.data ?? response.data;
  return { transactionId: extractTransactionId(asRecord(data)), ...asRecord(data) };
}

// ---------------------------------------------------------------------------
// Electricity
// ---------------------------------------------------------------------------

export async function getElectricityDiscos(): Promise<Disco[]> {
  const response = await api.get('/api/v1/utility/billers', { params: { category: 'ELECTRICITY' } });
  const data = response.data?.data ?? response.data;
  return (Array.isArray(data?.billers) ? data.billers : []).map((b: ApiRecord) => mapBillerToDisco(b));
}

export async function validateMeter(payload: {
  discoCode: string;
  meterNumber: string;
  meterType: 'PREPAID' | 'POSTPAID';
}): Promise<ValidationResult> {
  const response = await api.post('/api/v1/utility/validate', {
    category: 'ELECTRICITY',
    biller_id: payload.discoCode,
    customer_reference: payload.meterNumber,
    metadata: { meter_type: payload.meterType },
  });
  const data = response.data?.data ?? response.data;
  return mapValidationResult(asRecord(data));
}

export async function payElectricity(payload: {
  discoCode: string;
  meterNumber: string;
  meterType: 'PREPAID' | 'POSTPAID';
  amount: number;         // naira
  customerPhone: string;
  customerEmail?: string;
  paymentMethod: 'WALLET';
  idempotencyKey: string;
}) {
  const response = await api.post(
    '/api/v1/utility/pay',
    {
      category: 'ELECTRICITY',
      biller_id: payload.discoCode,
      customer_reference: payload.meterNumber,
      amount_kobo: Math.round(payload.amount * 100),
      metadata: {
        meter_type: payload.meterType,
        customer_phone: payload.customerPhone,
        customer_email: payload.customerEmail,
      },
    },
    { headers: { 'Idempotency-Key': payload.idempotencyKey } },
  );
  const data = response.data?.data ?? response.data;
  return { transactionId: extractTransactionId(asRecord(data)), ...asRecord(data) };
}

// ---------------------------------------------------------------------------
// Cable TV
// ---------------------------------------------------------------------------

export async function getCableProviders(): Promise<CableProvider[]> {
  const response = await api.get('/api/v1/utility/billers', { params: { category: 'CABLE_TV' } });
  const data = response.data?.data ?? response.data;
  return (Array.isArray(data?.billers) ? data.billers : []).map((b: ApiRecord) => mapBillerToCableProvider(b));
}

export async function getCablePackages(providerCode: string): Promise<CablePackage[]> {
  const response = await api.get('/api/v1/utility/products', {
    params: { category: 'CABLE_TV', biller: providerCode },
  });
  const data = response.data?.data ?? response.data;
  return (Array.isArray(data?.products) ? data.products : []).map((p: ApiRecord) => mapProductToCablePackage(p));
}

export async function validateCable(payload: {
  providerCode: string;
  smartCardNumber: string;
}): Promise<ValidationResult> {
  const response = await api.post('/api/v1/utility/validate', {
    category: 'CABLE_TV',
    biller_id: payload.providerCode,
    customer_reference: payload.smartCardNumber,
  });
  const data = response.data?.data ?? response.data;
  return mapValidationResult(asRecord(data));
}

export async function payCable(payload: {
  providerCode: string;
  smartCardNumber: string;
  packageId: string;
  customerPhone: string;
  customerEmail?: string;
  paymentMethod: 'WALLET';
  idempotencyKey: string;
}) {
  const response = await api.post(
    '/api/v1/utility/pay',
    {
      category: 'CABLE_TV',
      biller_id: payload.providerCode,
      product_id: payload.packageId,
      customer_reference: payload.smartCardNumber,
      metadata: {
        customer_phone: payload.customerPhone,
        customer_email: payload.customerEmail,
      },
    },
    { headers: { 'Idempotency-Key': payload.idempotencyKey } },
  );
  const data = response.data?.data ?? response.data;
  return { transactionId: extractTransactionId(asRecord(data)), ...asRecord(data) };
}
