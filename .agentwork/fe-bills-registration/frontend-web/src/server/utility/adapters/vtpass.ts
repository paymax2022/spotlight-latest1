import type {
  UtilityProviderAdapter,
  UtilityPurchaseRequest,
  UtilityPurchaseResult,
  UtilityStatusQueryRequest,
  UtilityStatusResult,
  UtilityValidationRequest,
} from './types';

type VtpassEnvironment = 'live' | 'sandbox';
type VtpassHttpMethod = 'GET' | 'POST';

interface VtpassCredentials {
  apiKey: string;
  publicKey?: string;
  secretKey?: string;
  baseUrl: string;
  environment: VtpassEnvironment;
}

interface VtpassResponse {
  code?: string | number;
  response_description?: string;
  requestId?: string;
  purchased_code?: string;
  token?: string;
  content?: {
    Customer_Name?: string;
    Customer_Number?: string;
    Customer_Type?: string;
    Address?: string;
    Meter_Number?: string;
    Meter_Type?: string;
    Status?: string;
    Due_Date?: string;
    WrongBillersCode?: boolean;
    transactions?: {
      status?: string;
      transactionId?: string;
      product_name?: string;
      unique_element?: string;
    };
  };
  contents?: {
    balance?: number;
  };
  [key: string]: unknown;
}

function readCredentials(): VtpassCredentials {
  const environment = (process.env.VTPASS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'live') satisfies VtpassEnvironment;
  const apiKey = process.env.VTPASS_API_KEY;
  const publicKey = process.env.VTPASS_PUBLIC_KEY;
  const secretKey = process.env.VTPASS_SECRET_KEY;
  const baseUrl = process.env.VTPASS_BASE_URL
    || (environment === 'sandbox' ? 'https://sandbox.vtpass.com/api' : 'https://vtpass.com/api');

  if (!apiKey) throw new Error('VTPASS_API_KEY is required for the VTPass utility adapter.');

  return { apiKey, publicKey, secretKey, baseUrl, environment };
}

function authHeaders(method: VtpassHttpMethod, credentials = readCredentials()) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'api-key': credentials.apiKey,
  };

  if (method === 'GET') {
    if (!credentials.publicKey) throw new Error('VTPASS_PUBLIC_KEY is required for VTPass GET requests.');
    headers['public-key'] = credentials.publicKey;
  } else {
    if (!credentials.secretKey) throw new Error('VTPASS_SECRET_KEY is required for VTPass POST requests.');
    headers['secret-key'] = credentials.secretKey;
  }

  return headers;
}

function lagosRequestPrefix(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}`;
}

export function vtpassRequestId(idempotencyKey: string, date = new Date()) {
  const suffix = idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-20) || Math.random().toString(36).slice(2);
  return `${lagosRequestPrefix(date)}${suffix}`;
}

function endpoint(path: string, credentials = readCredentials()) {
  return `${credentials.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

async function vtpassFetch(path: string, method: VtpassHttpMethod, body?: Record<string, unknown>): Promise<VtpassResponse> {
  const credentials = readCredentials();
  const response = await fetch(endpoint(path, credentials), {
    method,
    headers: authHeaders(method, credentials),
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      code: response.status,
      response_description: `VTPass HTTP ${response.status}`,
      raw: payload,
    };
  }

  return payload as VtpassResponse;
}

function asNaira(kobo: number) {
  return Math.max(1, Math.round(kobo / 100));
}

function serviceId(request: UtilityValidationRequest | UtilityPurchaseRequest) {
  return request.providerBillerCode || request.billerCode;
}

function metadataString(metadata: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function phoneFor(request: UtilityPurchaseRequest) {
  return metadataString(request.metadata, ['phone', 'customerPhone', 'customer_phone'])
    || (request.category === 'airtime' || request.category === 'data' ? request.customerReference : undefined)
    || request.customerReference;
}

function normalizeProviderStatus(payload: VtpassResponse): UtilityPurchaseResult['status'] {
  const code = String(payload.code ?? '').toLowerCase();
  const description = String(payload.response_description ?? '').toLowerCase();
  const transactionStatus = String(payload.content?.transactions?.status ?? '').toLowerCase();

  if (code === '000' && ['delivered', 'successful', 'success'].includes(transactionStatus)) return 'successful';
  if (code === '000' && !transactionStatus && description.includes('successful')) return 'successful';
  if (
    transactionStatus.includes('pending')
    || transactionStatus.includes('processing')
    || description.includes('pending')
    || description.includes('processing')
    || description.includes('timeout')
  ) return 'pending';

  return 'failed';
}

function tokenFrom(payload: VtpassResponse) {
  const directToken = typeof payload.token === 'string' ? payload.token : undefined;
  const purchasedCode = typeof payload.purchased_code === 'string' ? payload.purchased_code : undefined;
  return directToken || purchasedCode;
}

function normalizePurchase(payload: VtpassResponse, fallbackRequestId: string): UtilityPurchaseResult {
  const transaction = payload.content?.transactions;
  const status = normalizeProviderStatus(payload);
  return {
    status,
    providerReference: payload.requestId || transaction?.transactionId || fallbackRequestId,
    token: tokenFrom(payload),
    message: payload.response_description || transaction?.status || (status === 'failed' ? 'VTPass transaction failed.' : undefined),
    raw: payload,
  };
}

function purchasePayload(request: UtilityPurchaseRequest, requestId: string): Record<string, unknown> {
  const base = {
    request_id: requestId,
    serviceID: serviceId(request),
  };

  if (request.category === 'airtime') {
    return {
      ...base,
      amount: asNaira(request.pricing.amountKobo),
      phone: phoneFor(request),
    };
  }

  if (request.category === 'education') {
    return {
      ...base,
      variation_code: request.providerProductCode,
      amount: asNaira(request.pricing.amountKobo),
      quantity: Number(request.metadata?.quantity || 1),
      phone: phoneFor(request),
    };
  }

  if (request.category === 'electricity') {
    return {
      ...base,
      billersCode: request.customerReference,
      variation_code: metadataString(request.metadata, ['type', 'payment_type', 'paymentType']) || 'prepaid',
      amount: asNaira(request.pricing.amountKobo),
      phone: phoneFor(request),
    };
  }

  return {
    ...base,
    billersCode: request.customerReference,
    variation_code: request.providerProductCode,
    amount: asNaira(request.pricing.amountKobo),
    phone: phoneFor(request),
    ...(request.category === 'cable_tv'
      ? {
          subscription_type: metadataString(request.metadata, ['subscription_type', 'subscriptionType']) || 'change',
          quantity: Number(request.metadata?.quantity || 1),
        }
      : {}),
  };
}

export const vtpassUtilityAdapter: UtilityProviderAdapter = {
  code: 'vtpass',

  async validateCustomer(request: UtilityValidationRequest) {
    if (request.category === 'airtime' || request.category === 'data' || request.category === 'education') {
      return { valid: true, raw: { skipped: true, reason: 'VTPass does not require merchant verification for this category.' } };
    }

    const type = metadataString(request.metadata, ['type', 'payment_type', 'paymentType'])
      || (request.category === 'electricity' ? 'prepaid' : undefined);
    const payload = await vtpassFetch('merchant-verify', 'POST', {
      billersCode: request.customerReference,
      serviceID: serviceId(request),
      ...(type ? { type } : {}),
    });
    const valid = String(payload.code ?? '') === '000' && !payload.content?.WrongBillersCode;

    return {
      valid,
      customerName: payload.content?.Customer_Name || payload.content?.Customer_Number,
      message: valid ? 'Customer verified.' : payload.response_description || 'Customer verification failed.',
      raw: payload,
    };
  },

  async purchase(request: UtilityPurchaseRequest) {
    const requestId = vtpassRequestId(request.idempotencyKey);
    const payload = await vtpassFetch('pay', 'POST', purchasePayload(request, requestId));
    return normalizePurchase(payload, requestId);
  },

  async queryTransactionStatus(request: UtilityStatusQueryRequest): Promise<UtilityStatusResult> {
    const requestId = request.providerReference || vtpassRequestId(request.idempotencyKey);
    const payload = await vtpassFetch('requery', 'POST', { request_id: requestId });
    return normalizePurchase(payload, requestId);
  },

  async healthCheck() {
    try {
      const payload = await vtpassFetch('balance', 'GET');
      if (String(payload.code) === '1' && typeof payload.contents?.balance === 'number') {
        return { status: 'healthy' as const, message: `Balance: ${payload.contents.balance}` };
      }
      return { status: 'degraded' as const, message: payload.response_description || 'Unable to confirm VTPass balance.' };
    } catch (error) {
      return { status: 'down' as const, message: error instanceof Error ? error.message : 'VTPass health check failed.' };
    }
  },
};
