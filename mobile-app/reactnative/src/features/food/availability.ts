// ── Restaurant & Delivery — is this kitchen still there? ─────────────────────
//
// Used to decide whether to drop a kitchen's food from the cart, so the bar is
// deliberately high: ONLY a 404 counts as "gone".
//
// A 500, a timeout, a dropped connection or an aborted request all mean "we do
// not know", and must leave the cart alone. Deleting someone's food because the
// server hiccuped once would be a worse bug than the stale lines this exists to
// remove — the food is recoverable only by the customer noticing and re-adding
// it, and they have no reason to suspect anything went missing.

/** What a by-id restaurant fetch tells us about the kitchen. */
export type RestaurantAvailability = 'available' | 'gone' | 'unknown';

/** The shape of a react-query result this reads — kept structural, not imported. */
export interface AvailabilityInput {
  isSuccess?: boolean;
  isError?: boolean;
  error?: unknown;
}

/** HTTP status off an axios-style rejection, if there is one. */
function statusOf(error: unknown): number | undefined {
  const res = (error as { response?: { status?: unknown } } | null | undefined)?.response;
  const status = res?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Classify one fetch.
 *
 * Pending/paused queries report neither success nor error and land on 'unknown',
 * which is correct: a query that has not answered yet is not evidence a kitchen
 * was deleted. (React Query pauses retries while the tab is hidden, so 'pending'
 * can persist for a long time.)
 */
export function classifyAvailability(r: AvailabilityInput | undefined | null): RestaurantAvailability {
  if (!r) return 'unknown';
  if (r.isSuccess) return 'available';
  if (r.isError) return statusOf(r.error) === 404 ? 'gone' : 'unknown';
  return 'unknown';
}

/**
 * The ids that are provably gone, in the order given.
 *
 * `results` is positional against `ids` — the same contract useQueries has.
 */
export function goneRestaurantIds(ids: string[], results: (AvailabilityInput | undefined)[]): string[] {
  return ids.filter((id, i) => Boolean(id) && classifyAvailability(results[i]) === 'gone');
}
