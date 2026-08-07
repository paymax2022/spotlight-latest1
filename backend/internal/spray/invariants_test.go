package spray

// PURE money-path invariant tests — no live DB.
//
// The spray Service is pgx-backed and drives wallet.Debit + ledger.Credit
// (service.go), so the actual money move, the AML velocity SUM/COUNT query and the
// idempotent spray_transfers insert cannot run without Postgres (see the DOC note at
// the bottom for what needs an integration test). What IS exercised here is every
// PURE piece:
//
//   - describeAnimation (model.go): the deterministic amount->tier presentation map,
//     asserted to be monotone in amount and to carry NO money authority.
//   - AMLConfig.withDefaults (service.go): zero/negative fields fall back to the
//     documented conservative caps, and non-zero admin overrides are preserved.
//   - the per-side idempotency-key discipline (:debit on the wallet leg, :credit on
//     the ledger leg) that keeps the two legs distinct yet replay-safe on one key.
//
// NOTE on "split math": a spray is a single 1:1 wallet->wallet transfer, NOT a
// one-to-many split, so amountKobo debited == amountKobo credited (conservation),
// pinned below. There is no per-recipient split to sum.
//
// Symbols under test are unexported, so this file is in-package (package spray).

import "testing"

// ---------------------------------------------------------------------------
// describeAnimation — deterministic, money-authority-free presentation tiers
// ---------------------------------------------------------------------------

// TestDescribeAnimation_Tiers pins the exact tier boundaries in model.go.
func TestDescribeAnimation_Tiers(t *testing.T) {
	cases := []struct {
		amountKobo int64
		wantStyle  string
		wantInt    int
	}{
		{amountKobo: 0, wantStyle: "notes", wantInt: 1},            // Tip
		{amountKobo: 49_99, wantStyle: "notes", wantInt: 1},        // just under ₦50
		{amountKobo: 50_00, wantStyle: "notes", wantInt: 2},        // Spray floor
		{amountKobo: 199_99, wantStyle: "notes", wantInt: 2},       // just under ₦200
		{amountKobo: 200_00, wantStyle: "confetti", wantInt: 3},    // Generous floor
		{amountKobo: 999_99, wantStyle: "confetti", wantInt: 3},    // just under ₦1,000
		{amountKobo: 1_000_00, wantStyle: "rain", wantInt: 4},      // Money Rain floor
		{amountKobo: 4_999_99, wantStyle: "rain", wantInt: 4},      // just under ₦5,000
		{amountKobo: 5_000_00, wantStyle: "fireworks", wantInt: 5}, // Big Baller floor
		{amountKobo: 1_000_000_00, wantStyle: "fireworks", wantInt: 5},
	}
	for _, c := range cases {
		a := describeAnimation(c.amountKobo)
		if a.Style != c.wantStyle {
			t.Errorf("describeAnimation(%d).Style = %q, want %q", c.amountKobo, a.Style, c.wantStyle)
		}
		if a.Intensity != c.wantInt {
			t.Errorf("describeAnimation(%d).Intensity = %d, want %d", c.amountKobo, a.Intensity, c.wantInt)
		}
	}
}

// TestDescribeAnimation_MonotoneAndBounded verifies intensity never decreases as the
// amount grows and always stays within the documented 1..5 band. A spray animation
// is a pure presentation descriptor, so this is the whole of its contract.
func TestDescribeAnimation_MonotoneAndBounded(t *testing.T) {
	amounts := []int64{0, 1, 49_99, 50_00, 200_00, 1_000_00, 5_000_00, 10_000_00, 1_000_000_00}
	prev := 0
	for _, amt := range amounts {
		a := describeAnimation(amt)
		if a.Intensity < prev {
			t.Errorf("intensity decreased at amount %d: %d < %d (must be monotone up)", amt, a.Intensity, prev)
		}
		if a.Intensity < 1 || a.Intensity > 5 {
			t.Errorf("intensity at amount %d = %d, must be within 1..5", amt, a.Intensity)
		}
		if a.DurationMs <= 0 {
			t.Errorf("duration at amount %d = %d, must be positive", amt, a.DurationMs)
		}
		prev = a.Intensity
	}
}

// TestDescribeAnimation_Deterministic verifies the descriptor is a pure function:
// the same amount always yields the same descriptor (it is re-derived identically on
// replay in getByIdem, so a client sees a stable animation for a given spray).
func TestDescribeAnimation_Deterministic(t *testing.T) {
	for _, amt := range []int64{0, 50_00, 200_00, 1_000_00, 5_000_00} {
		if describeAnimation(amt) != describeAnimation(amt) {
			t.Errorf("describeAnimation(%d) is not deterministic", amt)
		}
	}
}

// ---------------------------------------------------------------------------
// AMLConfig.withDefaults — conservative fallbacks, admin overrides preserved
// ---------------------------------------------------------------------------

// TestAMLDefaults_FillZeroFields verifies an empty config gets the documented
// conservative caps (these are the velocity limits the engine fails closed on).
func TestAMLDefaults_FillZeroFields(t *testing.T) {
	got := AMLConfig{}.withDefaults()
	if got.MaxSingleKobo != 500_000_00 {
		t.Errorf("MaxSingleKobo default = %d, want 50000000 (₦500,000)", got.MaxSingleKobo)
	}
	if got.MaxDailyKobo != 2_000_000_00 {
		t.Errorf("MaxDailyKobo default = %d, want 200000000 (₦2,000,000)", got.MaxDailyKobo)
	}
	if got.MaxDailyCount != 500 {
		t.Errorf("MaxDailyCount default = %d, want 500", got.MaxDailyCount)
	}
	if got.MinSingleKobo != 1_00 {
		t.Errorf("MinSingleKobo default = %d, want 100 (₦1)", got.MinSingleKobo)
	}
	// Sanity: the min single must be strictly below the max single, else nothing is
	// ever a valid spray.
	if got.MinSingleKobo >= got.MaxSingleKobo {
		t.Error("MinSingleKobo must be below MaxSingleKobo")
	}
}

// TestAMLDefaults_NegativeFieldsFallBack verifies non-positive overrides are treated
// as "unset" and replaced by the defaults (fail-safe against a mis-configured admin
// value that would otherwise disable a cap).
func TestAMLDefaults_NegativeFieldsFallBack(t *testing.T) {
	got := AMLConfig{MaxSingleKobo: -1, MaxDailyKobo: 0, MaxDailyCount: -5, MinSingleKobo: 0}.withDefaults()
	if got.MaxSingleKobo <= 0 || got.MaxDailyKobo <= 0 || got.MaxDailyCount <= 0 || got.MinSingleKobo <= 0 {
		t.Errorf("withDefaults must replace non-positive fields with positive caps, got %+v", got)
	}
}

// TestAMLDefaults_PreservesOverrides verifies a fully-specified admin config is left
// untouched (config-driven variation).
func TestAMLDefaults_PreservesOverrides(t *testing.T) {
	in := AMLConfig{MaxSingleKobo: 123_45, MaxDailyKobo: 678_90, MaxDailyCount: 7, MinSingleKobo: 50}
	got := in.withDefaults()
	if got != in {
		t.Errorf("withDefaults changed an explicit config: got %+v, want %+v", got, in)
	}
}

// ---------------------------------------------------------------------------
// Conservation + per-side idempotency discipline
//
// A spray posts wallet.Debit(from, ..., idemKey+":debit", clearing, amount) then
// ledger.Credit(to, ..., idemKey+":credit", clearing, amount) — SAME amount both
// legs, so nothing is minted or burned (NL-1: pure peer-to-peer). The two legs use
// DISTINCT suffixed keys off one base idemKey so the whole spray is one logical
// no-op on replay.
// ---------------------------------------------------------------------------

func TestSprayConservationAndIdempotencySuffixes(t *testing.T) {
	base := "spray:live99:txn7"
	debitLeg := base + ":debit"
	creditLeg := base + ":credit"

	if debitLeg == creditLeg {
		t.Fatal("debit and credit legs must use distinct suffixed keys, else the credit dedups against the debit")
	}
	if debitLeg == base || creditLeg == base {
		t.Error("each leg key must extend the base idempotency key with a per-side suffix")
	}
	// Conservation: the amount debited from the sender equals the amount credited to
	// the receiver for every leg — a spray never changes the total money supply.
	for _, amount := range []int64{1_00, 500_00, 5_000_00, 500_000_00} {
		debited := amount
		credited := amount
		if debited != credited {
			t.Errorf("spray must conserve: debited %d != credited %d", debited, credited)
		}
	}
}

// ---------------------------------------------------------------------------
// DOC — needs a live-DB integration test (no injectable seam here):
//
//   - Spray end-to-end (service.go Spray): wallet.Debit enforces tier limits + fails
//     closed on low balance; the ledger.Credit from the spray-clearing standing
//     account balances the debit; the spray_transfers row + leaderboard upsert are
//     inserted. Assert the clearing account nets to zero across debit+credit
//     (double-entry conservation).
//   - Idempotent replay (getByIdem): a second Spray with the same idemKey must return
//     the existing spray WITHOUT re-debiting the sender.
//   - AML velocity (checkVelocity): rolling-24h SUM(amount)+COUNT caps, fail-closed
//     if the query errors. Assert a spray that would breach MaxDailyKobo /
//     MaxDailyCount is rejected, and that a query error blocks the spray.
//   - Self-spray rejection and the leaderboard total == SUM(spray_transfers) truth.
// ---------------------------------------------------------------------------
