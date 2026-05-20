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
