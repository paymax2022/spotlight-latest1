package loyalty

// PURE money-path invariant tests — no live DB.
//
// The loyalty Service is pgx-backed and delegates all points movement to
// points.Service (service.go: AwardFor -> points.Earn, Redeem -> points.Redeem), so
// the earn/burn ledger, the tier re-evaluation transaction and the redemption insert
// cannot run without Postgres + the points module (see the DOC note at the bottom for
// what needs an integration test). Loyalty owns NO points ledger of its own, so the
// "no negative balance / burn <= balance" invariants live in the points package, not
// here — this file exercises what loyalty DOES own purely:
//
//   - rank(Tier) (service.go): the tier ordering that drives (a) monotonic
//     no-downgrade tier re-evaluation and (b) MinTier reward gating. This is the
//     single pure comparator both money-adjacent paths depend on.
//
// It also documents a real ordering bug found while reading (see the BUG note and
// TestRank_BlackTierIsUnordered).
//
// Symbols under test are unexported, so this file is in-package (package loyalty).

import "testing"

// ---------------------------------------------------------------------------
// rank(Tier) — the tier comparator
// ---------------------------------------------------------------------------

// TestRank_Ordering verifies the P1/P2 tiers are strictly ascending: TIER1 < TIER2
// < TIER3. This ordering is what makes tier re-evaluation MONOTONIC (a member is
// never auto-downgraded: tierForTx refuses any candidate whose rank < the current
// tier) and what gates rewards (Redeem refuses when rank(member) < rank(MinTier)).
func TestRank_Ordering(t *testing.T) {
	if !(rank(Tier1) < rank(Tier2) && rank(Tier2) < rank(Tier3)) {
		t.Errorf("tiers must be strictly ascending: TIER1=%d TIER2=%d TIER3=%d",
			rank(Tier1), rank(Tier2), rank(Tier3))
	}
}

// TestRank_MonotonicNoDowngrade mirrors the tierForTx guard `rank(candidate) <
// rank(cur)` => keep cur. It proves that once a member reaches a higher tier, a
// re-evaluation that computes a LOWER-ranked candidate leaves them where they are.
func TestRank_MonotonicNoDowngrade(t *testing.T) {
	keep := func(candidate, cur Tier) Tier {
		if rank(candidate) < rank(cur) {
			return cur
		}
		return candidate
	}
	if got := keep(Tier1, Tier3); got != Tier3 {
		t.Errorf("a TIER3 member must not be downgraded to a TIER1 candidate, got %s", got)
	}
	if got := keep(Tier2, Tier2); got != Tier2 {
		t.Errorf("equal-rank candidate must be accepted, got %s", got)
	}
	if got := keep(Tier3, Tier1); got != Tier3 {
		t.Errorf("an upgrade candidate must be accepted, got %s", got)
	}
}

// TestRank_MinTierGating mirrors both catalog-gate call sites: Redeem rejects when
// `rank(member) < rank(MinTier)` and ListCatalog surfaces an item when
// `rank(member) >= rank(MinTier)`. This is the reward-eligibility comparator.
func TestRank_MinTierGating(t *testing.T) {
	eligible := func(member, minTier Tier) bool { return rank(member) >= rank(minTier) }

	if eligible(Tier1, Tier2) {
		t.Error("a TIER1 member must NOT be eligible for a TIER2-gated reward")
	}
	if !eligible(Tier2, Tier2) {
		t.Error("an exact-tier member must be eligible (>= is inclusive)")
	}
	if !eligible(Tier3, Tier1) {
		t.Error("a TIER3 member must be eligible for a TIER1-gated reward")
	}
}

// ---------------------------------------------------------------------------
// rank(TierBlack) is now the highest tier (above TIER3), fixing the latent defect
// where BLACK fell through to 0 and a MinTier=BLACK reward gate would admit EVERY
// member (rank(anyTier) >= 0). BLACK membership is also tracked in a separate table
// (black.go); this asserts the comparator itself is correct + fail-closed.
// ---------------------------------------------------------------------------

func TestRank_BlackTierIsHighest(t *testing.T) {
	// BLACK must outrank every real tier.
	if !(rank(TierBlack) > rank(Tier3)) {
		t.Errorf("BLACK must be the highest tier: rank(BLACK)=%d, rank(TIER3)=%d",
			rank(TierBlack), rank(Tier3))
	}
	// A non-Black member must NOT clear a BLACK-gated reward (>= comparator).
	for _, member := range []Tier{Tier1, Tier2, Tier3} {
		if rank(member) >= rank(TierBlack) {
			t.Errorf("%s member must not be eligible for a MinTier=BLACK gate", member)
		}
	}
	// A Black member clears a Black gate.
	if !(rank(TierBlack) >= rank(TierBlack)) {
		t.Error("a BLACK member must be eligible for a MinTier=BLACK gate")
	}
}

// TestRank_UnknownTierIsZero verifies an unrecognised tier value ranks 0 (fail-safe
// for the comparator inputs — an unknown member tier can never spoof a high rank).
func TestRank_UnknownTierIsZero(t *testing.T) {
	if rank(Tier("PLATINUM_TYPO")) != 0 {
		t.Error("an unknown tier must rank 0, never a positive (spoofable) value")
	}
}

// ---------------------------------------------------------------------------
// DOC — needs a live-DB integration test (no injectable seam here):
//
//   - AwardFor (service.go): resolves the module/trigger -> rule_key binding, then
//     points.Earn awards points and ReevaluateTier upgrades the tier in one tx. The
//     "earn adds points, never negative" and "burn <= balance" invariants live in the
//     points package (loyalty owns no points ledger) — assert them there.
//   - Idempotent award: points.Earn must be keyed so a replayed module trigger does
//     not double-award. Assert against the points ledger + Postgres.
//   - ReevaluateTier: lifetime = current + delta, tierForTx returns the highest tier
//     whose threshold_points <= lifetime but never below current (monotonic). Needs
//     the loyalty_tiers table.
//   - Redeem (service.go): MinTier gate, points.Redeem debit (fail-closed on
//     insufficient points — the "burn <= balance" guard), and a PENDING loyalty_
//     redemptions insert. Assert the debit and the PENDING fulfilment are atomic and
//     that a replay does not double-burn.
// ---------------------------------------------------------------------------
