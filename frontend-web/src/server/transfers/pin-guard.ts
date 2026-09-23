/**
 * Transaction-PIN guard for the Next.js-native transfer services.
 *
 * WAL-001 (see docs/qa/wallet-test-plan.md §7): initiateWalletToWallet() and
 * initiateWalletToBank() moved money with NO transaction-PIN check at all —
 * the mobile Send/Withdraw screens (PaymentActionScreen) never collected or
 * sent a PIN, and neither server function ever looked for one. This directly
 * contradicts CLAUDE.md's documented security model ("wallet debits are
 * PIN-gated server-side") and the sibling Go-backend transfer paths
 * (InitiateBank/InitiateBankToBank/InitiatePaymax in
 * backend/internal/finance/transfers/service.go), which DO verify the PIN
 * fail-closed via pin.go before any money movement.
 *
 * Rather than re-implement the bcrypt + 5-attempt/15-minute lockout state
 * machine a second time in TypeScript against the same user_transaction_pin
 * table (a second implementation is exactly how the two would drift), this
 * calls the Go backend's own already-correct, already-tested endpoint:
 * POST /api/finance/transfers/pin/verify. One state machine, one source of
 * truth, reused from both the Go-native and the Next-native transfer paths.
 */
import { ApiError } from '@/src/lib/api/responses';
import { GO_BACKEND_URL } from '@/src/lib/go-backend';

/**
 * Verify the caller's transaction PIN against the Go backend before any
 * wallet debit. Fail-closed: any non-2xx response (not set, wrong, locked,
 * network/backend error) throws and the caller MUST NOT proceed.
 *
 * @param authHeader  The original request's `Authorization: Bearer <jwt>`
 *                     header, forwarded verbatim so the Go backend identifies
 *                     the same user.
 * @param pin          The raw PIN submitted by the client.
 */
export async function requireTransactionPin(
  authHeader: string | null | undefined,
  pin: unknown,
): Promise<void> {
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
    throw new ApiError('A valid transaction PIN is required', 400);
  }
  if (!authHeader) {
    throw new ApiError('Unauthorized', 401);
  }

  let res: Response;
  try {
    res = await fetch(`${GO_BACKEND_URL}/api/finance/transfers/pin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ pin }),
    });
  } catch {
    // Network/backend failure — fail closed, never treat as "verified".
    throw new ApiError('Could not verify transaction PIN. Please try again.', 503);
  }

  if (res.ok) return;

  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    attempts_remaining?: number;
  };

  if (body.code === 'pin_not_set') {
    throw new ApiError('You have not set a transaction PIN yet.', 403);
  }
  if (body.code === 'pin_locked') {
    throw new ApiError('Your transaction PIN is locked. Try again later.', 403);
  }
  if (body.code === 'pin_invalid') {
    const remaining = body.attempts_remaining;
    throw new ApiError(
      typeof remaining === 'number'
        ? `Incorrect PIN. ${remaining} attempt(s) remaining.`
        : 'Incorrect PIN.',
      403,
    );
  }
  throw new ApiError('Could not verify transaction PIN.', 403);
}
