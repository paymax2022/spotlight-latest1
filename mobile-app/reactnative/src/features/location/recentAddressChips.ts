// ── When to show the standing "Recent addresses" chips ───────────────────────
//
// Saved addresses used to be reachable only by focusing an EMPTY address field,
// which surfaced them as a dropdown. That is invisible unless you already know
// it is there, and re-picking a place you have delivered to before is the common
// case — so the chips are a standing affordance under the input instead.
//
// Split out of the component (and kept dependency-free) because the interesting
// part is this predicate, not the markup: it is what decides whether the same
// list appears twice on screen, or lingers after the user has already chosen.

export interface RecentChipsState {
  /** The `enableRecents` prop — the caller's opt-out. */
  enabled: boolean;
  /** How many saved addresses exist. */
  count: number;
  /** A coordinate has been confirmed in this component. */
  hasPin: boolean;
  /** The parent already considers the address resolved (e.g. restored state). */
  resolved: boolean;
  /** The suggestion dropdown is on screen — it lists these same addresses. */
  dropdownVisible: boolean;
}

/**
 * Chips show only while the user still has a choice to make.
 *
 * Hidden once a place is confirmed (by this component's own pin, or by the
 * parent) — at that point the choice is made and the chips would compete with
 * the pin summary. Hidden while the dropdown is open, because it already lists
 * the same addresses and two copies on screen reads as a bug.
 */
export function shouldShowRecentChips(s: RecentChipsState): boolean {
  if (!s.enabled) return false;
  if (s.count <= 0) return false;
  if (s.hasPin || s.resolved) return false;
  if (s.dropdownVisible) return false;
  return true;
}
