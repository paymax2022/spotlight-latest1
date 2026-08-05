import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getWallet } from '@/api/wallet.api';
import { useAuthStore } from '@/store/authStore';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { usePaystackGateway } from './usePaystackGateway';
import type { PaystackGatewayController } from './paystackGateway';
import { verifyPin } from '@/features/transfers/api';
import { WALLET_PIN_REQUIRED, requiresPin, type PayMethod } from './paymentFlow';

export type { PayMethod };
export type PayPhase =
  | 'idle'
  | 'pin'             // collecting the wallet transaction PIN
  | 'charging'        // verifying PIN / running the module's wallet charge
  | 'awaiting'        // user is on the Paystack gateway
  | 'done'
  | 'error';

export interface PurchaseRequest<T = unknown> {
  amountKobo: number;
  title?: string;
  /**
   * The module's charge / fulfilment, told which rail confirmed the payment.
   * `pin` is the verified 4-digit wallet PIN when the wallet rail is used —
   * modules whose debit endpoint enforces the PIN server-side (e.g. bill
   * payments) forward it; modules without server enforcement ignore it.
   */
  charge: (method: PayMethod, pin?: string) => Promise<T>;
  onPaid?: (result: T, method: PayMethod) => void;
  /** Customer email for the card gateway (falls back to the signed-in user). */
  email?: string;
  /** What is being paid for, sent in Paystack metadata (e.g. 'food_order'). */
  domain?: string;
  /**
   * Preselected payment method. When set, the sheet skips its wallet/card
   * chooser and runs this method immediately. Omit it to show the two-option
   * modal (the default for every checkout).
   */
  method?: PayMethod;
}

export interface PurchaseController<T = unknown> {
  visible: boolean;
  phase: PayPhase;
  error: string | null;
  request: PurchaseRequest<T> | null;
  walletKobo: number;
  walletLoading: boolean;
  /** Open the payment sheet for a purchase. */
  start: (req: PurchaseRequest<T>) => void;
  /** Run a chosen method. */
  pay: (method: PayMethod) => Promise<void>;
  /** Submit the wallet transaction PIN — verifies it, then runs the charge. */
  submitPin: (pin: string) => Promise<void>;
  close: () => void;
  /** Render inside <PaymentSheet> — hosts the Paystack gateway on native. */
  GatewaySheet: PaystackGatewayController['Sheet'];
}

// usePurchasePayment gives every checkout a uniform two-option flow:
//   • Pay with Wallet         → the module's wallet charge runs directly.
//   • Pay with Card / Transfer → the Paystack gateway SDK charges the amount,
//                                then the module's fulfilment runs on success.
// Pair it with <PaymentSheet controller={...} />.
export function usePurchasePayment<T = unknown>(): PurchaseController<T> {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<PayPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<PurchaseRequest<T> | null>(null);

  const gateway = usePaystackGateway();
  const user = useAuthStore((s) => s.user);

  const walletQ = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: getWallet,
    enabled: visible,
    staleTime: 15_000,
  });
  // Wallet.balance is in naira (major units) in the app model — normalise to kobo.
  const walletKobo = Math.round((walletQ.data?.balance ?? 0) * 100);

  const close = useCallback(() => {
    setVisible(false);
    setPhase('idle');
    setError(null);
    setRequest(null);
  }, []);

  const finalize = useCallback(async (req: PurchaseRequest<T>, method: PayMethod, pin?: string) => {
    setPhase('charging');
    const result = await req.charge(method, pin);
    setPhase('done');
    req.onPaid?.(result, method);
    setVisible(false);
  }, []);

  // Runs the module's wallet charge + fulfilment, surfacing errors in-sheet.
  // `pin` is forwarded to charge for modules with server-side PIN enforcement.
  const walletCharge = useCallback(
    async (req: PurchaseRequest<T>, pin?: string) => {
      try {
        await finalize(req, 'wallet', pin);
      } catch (e) {
        setPhase('error');
        setError(e instanceof Error ? e.message : 'Payment failed. Please try again.');
      }
    },
    [finalize],
  );

  // Runs a chosen method against an explicit request, so it can be triggered
  // both from the in-sheet chooser (`pay`) and auto-run from `start` when a
  // method is preselected — without depending on the async `request` state.
  const runPay = useCallback(
    async (req: PurchaseRequest<T>, method: PayMethod) => {
      setError(null);

      if (method === 'card') {
        // Hand off to the Paystack gateway SDK; fulfilment runs on its success.
        setPhase('awaiting');
        setVisible(false);
        gateway.open({
          email: req.email ?? user?.email ?? 'customer@paymax.app',
          amountKobo: req.amountKobo,
          domain: req.domain ?? 'checkout',
          reference: `${req.domain ?? 'checkout'}-${generateIdempotencyKey()}`,
          onSuccess: async () => {
            try {
              await finalize(req, 'card');
            } catch (e) {
              setVisible(true);
              setPhase('error');
              setError(e instanceof Error ? e.message : 'We could not complete your order after payment.');
            }
          },
          onCancel: () => { setVisible(true); setPhase('idle'); },
          onError: (message) => { setVisible(true); setPhase('error'); setError(message); },
        });
        return;
      }

      // Wallet: gate on the 4-digit transaction PIN (uniform across all modules),
      // then charge. The sheet renders the PIN entry during the 'pin' phase and
      // calls submitPin(); the kill-switch flag skips straight to the charge.
      if (requiresPin('wallet', WALLET_PIN_REQUIRED)) {
        setPhase('pin');
        return;
      }
      await walletCharge(req);
    },
    [gateway, user, finalize, walletCharge],
  );

  // Verify the entered PIN centrally (POST /transfers/pin/verify), then charge.
  // Wrong PIN returns to the 'pin' phase with an error; the wallet is never hit.
  const submitPin = useCallback(
    async (pin: string) => {
      const req = request;
      if (!req) return;
      setError(null);
      setPhase('charging');
      try {
        await verifyPin(pin);
      } catch {
        setPhase('pin');
        setError('Incorrect PIN. Please try again.');
        return;
      }
      await walletCharge(req, pin);
    },
    [request, walletCharge],
  );

  const start = useCallback((req: PurchaseRequest<T>) => {
    setRequest(req);
    setError(null);
    setPhase('idle');
    setVisible(true);
    if (req.method) void runPay(req, req.method);
  }, [runPay]);

  const pay = useCallback(
    (method: PayMethod) => (request ? runPay(request, method) : Promise.resolve()),
    [request, runPay],
  );

  return {
    visible,
    phase,
    error,
    request,
    walletKobo,
    walletLoading: walletQ.isLoading,
    start,
    pay,
    submitPin,
    close,
    GatewaySheet: gateway.Sheet,
  };
}
