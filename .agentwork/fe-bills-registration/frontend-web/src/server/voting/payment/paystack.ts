import { ApiError } from '@/src/lib/api/responses';

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
    throw new ApiError(`Paystack initialization failed: ${json.message ?? 'unknown error'}`, 502);
  }

  return json.data.authorization_url;
}

export interface PaystackVerificationResult {
  success: boolean;
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
    providerReference: String(data.id),
    amountKobo: data.amount,
    currency: data.currency ?? 'NGN',
    paidAt: data.paid_at ?? null,
    customerEmail: data.customer?.email ?? null,
    metadata: data.metadata ?? {},
  };
}

// Verify the webhook signature from Paystack
export function verifyPaystackWebhookSignature(rawBody: string, signature: string): boolean {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const secret = getSecretKey();
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  return expected === signature;
}
