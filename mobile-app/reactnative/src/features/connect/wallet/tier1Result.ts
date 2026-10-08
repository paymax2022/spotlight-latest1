import type { UpgradeResult } from './types';

/** `data` of POST /kyc/tier1 — see SubmitTier1 in backend kyc_connect_handler.go. */
export interface Tier1ServerResponse {
  ok?: boolean;
  tier?: number;
  checkStatus?: string;
  message?: string;
}

const FALLBACK_FAILED = "We couldn't verify that BVN/NIN. Check the number and try again.";

/**
 * The server answers 201 even when the identity check came back FAILED, so the
 * HTTP status says nothing about the outcome — `checkStatus` does. Only an
 * explicit PASSED is a success; a FAILED check throws so the screen shows the
 * failure instead of navigating on as if the tier had been granted; anything
 * else (REVIEW / PENDING / INITIATED, or a response from an older server that
 * has no checkStatus) is "not verified yet", never "verified".
 */
export function toTier1Result(data: Tier1ServerResponse | undefined): UpgradeResult {
  const status = String(data?.checkStatus ?? '').toUpperCase();
  const message = data?.message?.trim() ?? '';

  if (status === 'FAILED') {
    throw new Error(message || FALLBACK_FAILED);
  }
  if (status === 'PASSED') {
    return { ok: true, reviewState: 'passed', targetTier: 1, message: message || 'Tier 1 verified.' };
  }
  return {
    ok: true,
    reviewState: 'pending',
    targetTier: 1,
    message: message || 'Verification in progress — this can take a few minutes.',
  };
}
