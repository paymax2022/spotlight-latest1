import { getRequiredEnv } from '@/lib/config';

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

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
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

type PaystackMetadataField = {
  display_name: string;
  variable_name: string;
  value: string;
};

export type PaystackTransactionConfig = {
  key: string;
  email: string;
  amount: number;
  currency?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  metadata?: {
    custom_fields?: PaystackMetadataField[];
  };
  onSuccess?: (transaction: { reference: string; id: number; message: string }) => void;
  onCancel?: () => void;
  onError?: (error: { message: string }) => void;
};

type PaystackConstructor = new () => {
  newTransaction(config: PaystackTransactionConfig): void;
};

declare global {
  interface Window {
    PaystackPop?: PaystackConstructor;
  }
}

let paystackScriptPromise: Promise<PaystackConstructor> | null = null;

export function loadPaystackClient(): Promise<PaystackConstructor> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Paystack can only be loaded in the browser'));
  }

  if (window.PaystackPop) {
    return Promise.resolve(window.PaystackPop);
  }

  if (paystackScriptPromise) {
    return paystackScriptPromise;
  }

  paystackScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-paystack-inline="true"]'
    );

    if (existingScript) {
      existingScript.addEventListener('load', () => {
        if (window.PaystackPop) {
          resolve(window.PaystackPop);
          return;
        }

        reject(new Error('Paystack script loaded but SDK was unavailable'));
      });

      existingScript.addEventListener('error', () => {
        reject(new Error('Failed to load Paystack payment SDK'));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.async = true;
    script.dataset.paystackInline = 'true';

    script.onload = () => {
      if (window.PaystackPop) {
        resolve(window.PaystackPop);
        return;
      }

      reject(new Error('Paystack script loaded but SDK was unavailable'));
    };

    script.onerror = () => {
      reject(new Error('Failed to load Paystack payment SDK'));
    };

    document.head.appendChild(script);
  });

  return paystackScriptPromise;
}
