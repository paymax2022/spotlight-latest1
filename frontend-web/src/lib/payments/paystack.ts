import { getRequiredEnv } from '@/lib/config/env';

export interface PaystackVerificationResult {
  reference: string;
  amountKobo: number;
  status: string;
  currency: string;
  paidAt: string | null;
  customerEmail: string | null;
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data?: {
    reference?: string;
    amount?: number;
    status?: string;
    currency?: string;
    paid_at?: string | null;
    customer?: {
      email?: string | null;
    } | null;
  };
}

export async function verifyPaystackTransaction(
  reference: string
): Promise<PaystackVerificationResult> {
  const secretKey = getRequiredEnv('PAYSTACK_SECRET_KEY');

  const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  const payload = (await response.json()) as PaystackVerifyResponse;

  if (!response.ok || !payload.status || !payload.data?.reference) {
    throw new Error(payload.message || 'Unable to verify Paystack transaction');
  }

  return {
    reference: payload.data.reference,
    amountKobo: payload.data.amount ?? 0,
    status: payload.data.status ?? 'unknown',
    currency: payload.data.currency ?? 'NGN',
    paidAt: payload.data.paid_at ?? null,
    customerEmail: payload.data.customer?.email ?? null,
  };
}
