/**
 * The wallet-tier refusals that a different PIN cannot fix.
 *
 * A Tier-0 member who types the right PIN still gets a 403: the wallet itself is
 * switched off until they verify. Before this, the PIN sheet printed that sentence
 * under the dots and offered nothing else, so the customer had to dismiss the
 * sheet and go find the KYC screen themselves — from a screen whose whole purpose
 * was to move money.
 *
 * Match on the machine code, not the wording (same rule `TransferScreen` follows
 * for `pin_not_set`). The Next.js tier gate now emits the codes the Go rail has
 * always emitted — `wallet_disabled`, `daily_limit_exceeded` — see
 * frontend-web/src/server/tiers/service.ts.
 *
 * The wording fallback exists only so the button also works against a backend
 * that is still mid-rollout and returns prose without a code. It is deliberately
 * narrow: "KYC" or "unverified" only. A broader match on "verify" would catch
 * `Could not verify transaction PIN.` and hang a KYC button on a plain PIN error.
 */

export interface KycBlock {
  /** Server wording, shown as-is under the PIN dots. */
  message: string;
  /** Label for the call-to-action that opens the KYC flow. */
  label: string;
}

/** Codes that mean "your tier is what is blocking this, not your PIN". */
const KYC_CODES = new Set(['wallet_disabled', 'daily_limit_exceeded']);

const KYC_WORDING = /\bkyc\b|unverified/i;

function errorText(data: Record<string, unknown> | undefined): string {
  // Next.js answers `{ error }`, Go answers `{ message }`; both are handled the
  // same way by src/utils/errorMapper.ts, so read them in the same order here.
  for (const key of ['message', 'error'] as const) {
    const value = data?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Returns the KYC call-to-action for a failed transfer request, or null when the
 * failure is something else (wrong PIN, no balance, unknown recipient) and the
 * sheet should just show its message.
 */
export function kycBlockFor(err: unknown): KycBlock | null {
  const response = (err as { response?: { status?: unknown; data?: Record<string, unknown> } })
    ?.response;
  if (!response) return null;

  const message = errorText(response.data);
  const code = typeof response.data?.code === 'string' ? response.data.code : undefined;

  const isKycBlock =
    (code !== undefined && KYC_CODES.has(code)) ||
    // Only a tier refusal arrives as a 403 with this wording; a non-403 that
    // happens to mention verification is not our call to make.
    (response.status === 403 && message !== '' && KYC_WORDING.test(message));

  if (!isKycBlock) return null;

  return {
    message: message || 'Verify your identity to use your wallet for transfers.',
    // 'Raise my limit' for an upgrade, 'Verify my account' for a first
    // verification — the same copy PaymentSheet.tsx uses for the same two cases.
    label: code === 'daily_limit_exceeded' || /daily limit/i.test(message) ? 'Raise my limit' : 'Verify my account',
  };
}
