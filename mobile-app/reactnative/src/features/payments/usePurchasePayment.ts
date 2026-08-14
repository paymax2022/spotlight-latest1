import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getWallet } from '@/api/wallet.api';
import { getSpendLimit } from '@/api/tiers.api';
import { useAuthStore } from '@/store/authStore';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { usePaystackGateway } from './usePaystackGateway';
import type { PaystackGatewayController } from './paystackGateway';
import { verifyPin } from '@/features/transfers/api';
import {
  WALLET_PIN_REQUIRED,
  requiresPin,
  cardTopupBlockedReason,
  cardOutcome,
  evaluateSpendLimit,
  type PayMethod,
  type SpendDecision,
} from './paymentFlow';
import { startCardTopup, waitForTopup } from './api';
import { extractAccessCode } from './paystackGateway';

export type { PayMethod };
export type PayPhase =
  | 'idle'
  | 'checking'        // resolving the caller's KYC spend allowance
  | 'blocked'         // the KYC tier will not permit this spend — no rail can succeed
  | 'pin'             // collecting the wallet transaction PIN
  | 'initializing'    // card: server is opening the top-up transaction
  | 'charging'        // verifying PIN / running the module's wallet charge
  | 'awaiting'        // user is on the Paystack gateway
  | 'confirming'      // card: waiting for the webhook to credit the wallet
  | 'done'
  | 'error';

// How long a fetched spend allowance stays fresh. Short, because the number moves
// with every wallet debit the customer makes elsewhere in the app.
const SPEND_LIMIT_STALE_MS = 15_000;
const SPEND_LIMIT_KEY = ['tiers', 'spend-limit'] as const;

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
  /**
   * Optional module-specific card handler. When provided, the card rail runs
   * this INSTEAD of the built-in Paystack client gateway — for modules whose
   * card payment is a server-initiated redirect (e.g. bill payments:
   * initiate*Paystack → authorizationUrl → Linking.openURL). The module owns
   * the redirect + return; `charge` is then only invoked for the wallet rail.
   */
  onCard?: () => Promise<void>;
}

export interface PurchaseController<T = unknown> {
  visible: boolean;
  phase: PayPhase;
  error: string | null;
  request: PurchaseRequest<T> | null;
  walletKobo: number;
  walletLoading: boolean;
  /**
   * Set when the caller's KYC tier will not permit this spend on ANY rail (Tier 0
   * wallet, or today's daily limit). The sheet renders the reason instead of the
   * payment options — nothing here can succeed, so offering a card charge would
   * only take the customer's money before the server refuses the order.
   */
  spendBlock: Extract<SpendDecision, { allowed: false }> | null;
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
  const [spendBlock, setSpendBlock] = useState<Extract<SpendDecision, { allowed: false }> | null>(null);

  const gateway = usePaystackGateway();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const walletQ = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: getWallet,
    enabled: visible,
    staleTime: 15_000,
  });
  // Wallet.balance is in naira (major units) in the app model — normalise to kobo.
  const walletKobo = Math.round((walletQ.data?.balance ?? 0) * 100);

  // Warm the spend allowance as soon as the sheet opens, so the common case costs
  // no extra wait when the user taps a rail. runPay re-reads it through the same
  // cache key, so this is a prefetch — never the authority on its own.
  useQuery({
    queryKey: SPEND_LIMIT_KEY,
    queryFn: getSpendLimit,
    enabled: visible,
    staleTime: SPEND_LIMIT_STALE_MS,
  });

  const close = useCallback(() => {
    setVisible(false);
    setPhase('idle');
    setError(null);
    setRequest(null);
    setSpendBlock(null);
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

  // Resolves the caller's KYC spend allowance and decides whether this purchase can
  // proceed. Reads through the same query cache the sheet warms on open, so the
  // common path is a cache hit; a cold or stale cache fetches once.
  //
  // An allowance that cannot be read is treated as "unknown" and ALLOWED — the
  // server gate still refuses the debit, so failing closed here would block checkout
  // on a network hiccup while protecting nothing.
  const checkSpendAllowed = useCallback(
    async (amountKobo: number): Promise<SpendDecision> => {
      try {
        const limit = await queryClient.fetchQuery({
          queryKey: SPEND_LIMIT_KEY,
          queryFn: getSpendLimit,
          staleTime: SPEND_LIMIT_STALE_MS,
        });
        return evaluateSpendLimit(limit, amountKobo);
      } catch {
        return { allowed: true };
      }
    },
    [queryClient],
  );

  // Runs a chosen method against an explicit request, so it can be triggered both
  // from the in-sheet chooser (`pay`) and auto-run from `start` when a method is
  // preselected — without depending on the async `request` state.
  const runPay = useCallback(
    async (req: PurchaseRequest<T>, method: PayMethod) => {
      setError(null);
      setSpendBlock(null);

      // ── KYC spend pre-check — MUST stay ahead of both rails ──────────────────
      // The card rail tops the wallet up first and only then runs the module's
      // wallet charge, so without this a Tier 0 customer would pay real money into
      // a wallet the tier gate forbids them from spending: the funds are recorded
      // and recoverable, but the order still fails and their money is parked.
      // The wallet rail is checked too — no point collecting a PIN for a debit that
      // cannot land.
      setPhase('checking');
      const decision = await checkSpendAllowed(req.amountKobo);
      if (!decision.allowed) {
        setSpendBlock(decision);
        setError(decision.message);
        setPhase('blocked');
        setVisible(true);
        return;
      }
      setPhase('idle');

      if (method === 'card') {
        // Module-specific card flow (e.g. a server-initiated Paystack redirect)
        // takes precedence over the built-in gateway. It owns redirect + return.
        if (req.onCard) {
          setPhase('awaiting');
          setVisible(false);
          try {
            await req.onCard();
          } catch (e) {
            setVisible(true);
            setPhase('error');
            setError(e instanceof Error ? e.message : 'Could not start the card payment.');
          }
          return;
        }
        // Card = top up the wallet for the exact amount, wait for the webhook to
        // credit it, then run the module's ordinary wallet charge. Net wallet
        // change is zero and the money moves on ONE ledger.
        //
        // Previously this opened a client-initialized charge for req.amountKobo
        // and then ran the module's charge anyway — which debits the wallet. The
        // customer paid twice, and if the wallet was short the debit failed after
        // the card had been charged, destroying the PSP money outright.

        // Refuse amounts the top-up rail cannot carry BEFORE opening any gateway.
        const blocked = cardTopupBlockedReason(req.amountKobo);
        if (blocked) { setPhase('error'); setError(blocked); return; }

        setPhase('initializing');
        let topup: { authorizationUrl: string; reference: string };
        try {
          topup = await startCardTopup(req.amountKobo);
        } catch (e) {
          setPhase('error');
          setError(e instanceof Error ? e.message : 'Could not start the card payment.');
          return;
        }

        // The server owns this transaction (it set the Idempotency-Key, the amount
        // and the wallet_topup metadata the webhook matches on). We only resume it,
        // so the client cannot alter what is charged. No access code means we
        // cannot resume the SERVER's transaction — fail closed rather than fall
        // back to a client-initialized charge, which is the broken path.
        const accessCode = extractAccessCode(topup.authorizationUrl);
        if (!accessCode) {
          setPhase('error');
          setError('Could not start the card payment securely. Please try your wallet.');
          return;
        }

        setPhase('awaiting');
        setVisible(false);
        gateway.open({
          email: req.email ?? user?.email ?? 'customer@paymax.app',
          amountKobo: req.amountKobo,
          domain: req.domain ?? 'checkout',
          reference: topup.reference,
          accessCode,
          onSuccess: async () => {
            setVisible(true);
            // A client success callback is not proof of payment. Wait for the
            // webhook to credit the wallet; only then may the module charge run.
            setPhase('confirming');
            const credited = await waitForTopup(topup.reference);
            if (cardOutcome(credited) !== 'charge') {
              setPhase('error');
              setError(
                'Your payment went through but is still being confirmed. It will land in your wallet — ' +
                'no money is lost. Please finish this purchase from your wallet in a moment.',
              );
              return;
            }
            try {
              await finalize(req, 'card');
            } catch (e) {
              setPhase('error');
              setError(
                (e instanceof Error ? e.message : 'We could not complete your order.') +
                ' Your payment is safe in your wallet — you can retry from there.',
              );
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
    [gateway, user, finalize, walletCharge, checkSpendAllowed],
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
    setSpendBlock(null);
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
    spendBlock,
    start,
    pay,
    submitPin,
    close,
    GatewaySheet: gateway.Sheet,
  };
}
