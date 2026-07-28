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

// ── Sandbox simulation (inline with VTPass docs) ────────────────────────────
// VTPass publishes fixed sandbox meter numbers that deterministically simulate
// outcomes (https://vtpass.com/documentation/eko-electricity-ekedc-payment-api/).
// When VTPASS_ENVIRONMENT=sandbox we honour these locally so meter validation +
// purchase work for testing WITHOUT live credentials or a network round-trip.
// Live mode is unchanged (always calls the real VTPass API).
const SANDBOX_METERS = {
  PREPAID: '1111111111111', // Successful — Prepaid (token vended)
  POSTPAID: '1010101010101', // Successful — Postpaid
} as const;
// Purchase-only simulation codes from the VTPass EKEDC sandbox table.
const SANDBOX_PENDING_METER = '201000000000';
const SANDBOX_UNEXPECTED_METER = '500000000000';
const SANDBOX_NO_RESPONSE_METER = '400000000000';
const SANDBOX_TIMEOUT_METER = '300000000000';

function isSandboxEnv(): boolean {
  return process.env.VTPASS_ENVIRONMENT === 'sandbox';
}

// Doc-accurate merchant-verify response for the two valid sandbox meters; null
// for any other meter (which VTPass sandbox treats as a failed validation).
function sandboxVerify(billersCode: string): VtpassResponse | null {
  if (billersCode === SANDBOX_METERS.PREPAID || billersCode === SANDBOX_METERS.POSTPAID) {
    const meterType = billersCode === SANDBOX_METERS.PREPAID ? 'PREPAID' : 'POSTPAID';
    return {
      code: '000',
      response_description: 'Customer verified.',
      content: {
        Customer_Name: 'Eko Electric Customer',
        Customer_Number: billersCode,
        Customer_Type: meterType,
        Address: '21a New Road Avenue',
        Meter_Number: billersCode,
        Meter_Type: meterType,
        WrongBillersCode: false,
      },
    };
  }
  return null;
}

// Doc-accurate purchase simulation for the VTPass EKEDC sandbox billersCode table.
function sandboxPurchase(request: UtilityPurchaseRequest, requestId: string): UtilityPurchaseResult {
  const meter = request.customerReference;
  const base = { providerReference: requestId };

  if (meter === SANDBOX_METERS.PREPAID) {
    return {
      ...base,
      status: 'successful',
      token: '1178-6621-9027-6821-0244', // sandbox prepaid token
      message: 'TRANSACTION SUCCESSFUL',
      raw: { code: '000', sandbox: true, meter_type: 'PREPAID' },
    };
  }
  if (meter === SANDBOX_METERS.POSTPAID) {
    return { ...base, status: 'successful', message: 'TRANSACTION SUCCESSFUL', raw: { code: '000', sandbox: true, meter_type: 'POSTPAID' } };
  }
  if (meter === SANDBOX_PENDING_METER || meter === SANDBOX_TIMEOUT_METER) {
    return { ...base, status: 'pending', message: 'Transaction is processing.', raw: { sandbox: true, simulated: meter === SANDBOX_TIMEOUT_METER ? 'timeout' : 'pending' } };
  }
  if (meter === SANDBOX_UNEXPECTED_METER || meter === SANDBOX_NO_RESPONSE_METER) {
    return { ...base, status: 'failed', message: 'Provider returned an unexpected/no response.', raw: { sandbox: true, simulated: 'anomaly' } };
  }
  return { ...base, status: 'failed', message: 'Sandbox: meter not recognised (use 1111111111111 / 1010101010101).', raw: { sandbox: true, simulated: 'failed' } };
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

export interface VtpassServiceInfo {
  serviceID: string;
  name: string;
  image?: string;
}

// Fetch the VTPass service list for an identifier ('electricity-bill', 'airtime',
// 'data', 'tv-subscription', 'education'). Each entry carries the official
// provider logo `image` URL hosted on VTPass. Requires VTPass GET credentials
// (api-key + public-key); callers should treat failures as "no logos".
export async function fetchVtpassServices(identifier: string): Promise<VtpassServiceInfo[]> {
  const payload = await vtpassFetch(`services?identifier=${encodeURIComponent(identifier)}`, 'GET');
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        serviceID: String(r.serviceID ?? ''),
        name: String(r.name ?? ''),
        image: typeof r.image === 'string' ? r.image : undefined,
      };
    })
    .filter((s) => s.serviceID);
}

export const vtpassUtilityAdapter: UtilityProviderAdapter = {
  code: 'vtpass',

  async validateCustomer(request: UtilityValidationRequest) {
    if (request.category === 'airtime' || request.category === 'data' || request.category === 'education') {
      return { valid: true, raw: { skipped: true, reason: 'VTPass does not require merchant verification for this category.' } };
    }

    // Sandbox: validate against VTPass's documented test meter numbers locally so
    // testing works without live credentials. Any other meter fails, exactly as
    // the sandbox does ("use any number apart from the one provided to simulate a
    // failed meter number validation").
    if (isSandboxEnv()) {
      const stub = sandboxVerify(request.customerReference);
      if (stub) {
        return {
          valid: true,
          customerName: stub.content?.Customer_Name,
          message: 'Customer verified.',
          raw: stub,
        };
      }
      return {
        valid: false,
        message: 'Meter number could not be validated. (Sandbox: use 1111111111111 for prepaid or 1010101010101 for postpaid.)',
        raw: { code: '012', content: { WrongBillersCode: true } },
      };
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

    // Sandbox: simulate the documented EKEDC purchase outcomes by meter number so
    // end-to-end testing (debit → token) works without live credentials.
    if (isSandboxEnv()) {
      return sandboxPurchase(request, requestId);
    }

    const payload = await vtpassFetch('pay', 'POST', purchasePayload(request, requestId));
    return normalizePurchase(payload, requestId);
  },

  async queryTransactionStatus(request: UtilityStatusQueryRequest): Promise<UtilityStatusResult> {
    const requestId = request.providerReference || vtpassRequestId(request.idempotencyKey);
    if (isSandboxEnv()) {
      return { status: 'successful', providerReference: requestId, message: 'TRANSACTION SUCCESSFUL', raw: { sandbox: true } };
    }
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
