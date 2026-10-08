import { ApiError } from '@/src/lib/api/responses';
import { verifyHmacSha512Hex } from '@/src/lib/crypto/hmac';

const PAYSTACK_BASE = 'https://api.paystack.co';

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new ApiError('Paystack is not configured', 500);
  return key;
}

function paystackHeaders() {
  return {
    Authorization: `Bearer ${getSecretKey()}`,
    'Content-Type': 'application/json',
  };
}

interface InitializePaymentInput {
  reference: string;
  email: string;
  amount: number;       // kobo
  currency: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export async function initializePaystackPayment(input: InitializePaymentInput): Promise<string> {
  const body: Record<string, unknown> = {
    reference: input.reference,
    email: input.email,
    amount: input.amount,
    currency: input.currency,
    metadata: input.metadata ?? {},
  };

  if (input.callbackUrl) {
    body.callback_url = input.callbackUrl;
  }

  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: paystackHeaders(),
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { status: boolean; data?: { authorization_url: string }; message?: string };

  if (!json.status || !json.data?.authorization_url) {
    console.error('[voting/paystack] transaction initialize failed:', json);
    throw new ApiError('Paystack initialization failed', 502);
  }

  return json.data.authorization_url;
}

export interface PaystackVerificationResult {
  success: boolean;
  /** Raw gateway status: 'success' | 'pending' | 'failed' | 'abandoned' |
   *  'reversed' | 'processing' | 'queued' | 'ongoing' | null when the API
   *  itself didn't answer. Callers must treat only the terminal non-success
   *  values as durable failures — a 'pending' result is retriable. */
  gatewayStatus: string | null;
  providerReference: string | null;
  amountKobo: number;
  currency: string;
  paidAt: string | null;
  customerEmail: string | null;
  metadata: Record<string, unknown>;
}

export async function verifyPaystackPayment(reference: string): Promise<PaystackVerificationResult> {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: paystackHeaders(),
  });

  const json = (await res.json()) as {
    status: boolean;
    data?: {
      status: string;
      id: number;
      amount: number;
      currency: string;
      paid_at: string;
      customer: { email: string };
      metadata: Record<string, unknown>;
    };
    message?: string;
  };

  if (!json.status || !json.data) {
    return {
      success: false,
      gatewayStatus: null,
      providerReference: null,
      amountKobo: 0,
      currency: 'NGN',
      paidAt: null,
      customerEmail: null,
      metadata: {},
    };
  }

  const data = json.data;
  return {
    success: data.status === 'success',
    gatewayStatus: data.status ?? null,
    providerReference: String(data.id),
    amountKobo: data.amount,
    currency: data.currency ?? 'NGN',
    paidAt: data.paid_at ?? null,
    customerEmail: data.customer?.email ?? null,
    metadata: data.metadata ?? {},
  };
}

// Verify the webhook signature from Paystack (constant-time compare —
// `expected === signature` leaks prefix-match timing).
export function verifyPaystackWebhookSignature(rawBody: string, signature: string): boolean {
  return verifyHmacSha512Hex(rawBody, signature, getSecretKey());
}
