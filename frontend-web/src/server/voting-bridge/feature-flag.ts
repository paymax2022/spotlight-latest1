/**
 * Bridge feature flag — controls whether votes go through the bridge layer
 * (KYC gate, idempotency, outbox) or directly to the legacy vote service.
 *
 * When false, the v2 routes fall through to the original service functions,
 * enabling gradual rollout without a hard cutover.
 */
export function isBridgeEnabled(): boolean {
  return process.env.VOTES_BRIDGE_ENABLED === 'true';
}
