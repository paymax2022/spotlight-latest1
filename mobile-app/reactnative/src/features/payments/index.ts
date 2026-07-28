// Shared checkout payments: a uniform "pay with wallet OR card (Paystack)" flow
// any module can drop into its pay/confirm action.
//
// Usage in a module:
//   const pay = usePurchasePayment();
//   // render once: <PaymentSheet controller={pay} />
//   // on the pay button:
//   pay.start({ amountKobo, title: 'Pay for order', charge: async () => myMutateAsync(args) });
export { default as PaymentSheet } from './PaymentSheet';
export { usePurchasePayment } from './usePurchasePayment';
export type { PurchaseController, PurchaseRequest, PayMethod, PayPhase } from './usePurchasePayment';
export { startCardTopup, getTopupStatus, waitForTopup } from './api';
export type { TopupStatus } from './api';
// Direct Paystack gateway (Inline SDK) — charges an amount, not a wallet top-up.
export { usePaystackGateway } from './usePaystackGateway';
export { PAYSTACK_PUBLIC_KEY } from './paystackGateway';
export type { PaystackChargeArgs, PaystackGatewayController, PaystackMetaField } from './paystackGateway';
