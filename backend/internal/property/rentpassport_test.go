package property

// ---------------------------------------------------------------------------
// Pure, DB-free unit tests for the rent-passport scoring formula and the
// on-time-ratio / realtor-tolerance control flow documented in rentpassport.go
// and docs/qa/modules/property.md §3/§7.
//
// computeRentScore is exercised directly (same package, unexported function).
// The on-time-ratio accumulation and the estate-vs-realtor error-tolerance
// asymmetry are NOT their own functions — they are inlined in
// GetRentPassport, which needs a live *pgxpool.Pool to run at all. Rather than
// skip them, this file TRANSCRIBES the exact branches from GetRentPassport
// (cited by line range below) into small local helpers driven by fake
// query results, following the same "transcribed invariant" convention used
// in backend/tests/association/money_invariants_test.go for logic a live
// driver call would otherwise hide from a DB-free suite. Any drift between
// the helper here and the cited production code is the bug a reviewer should
// catch — see also context_test.go / property_money_invariant_test.go for the
// live-DB counterparts that exercise the real SQL.
// ---------------------------------------------------------------------------

import (
	"errors"
	"testing"
	"time"
)

// ── computeRentScore ──────────────────────────────────────────────────────

func TestComputeRentScore_ZeroComparablePaymentsScoresZero(t *testing.T) {
	// rentpassport.go L180-182: comparable==0 short-circuits to 0, regardless
	// of onTimeRate or tenure — fail-closed, absence is not good credit.
	cases := []struct {
		name       string
		onTimeRate float64
		oldest     *time.Time
	}{
		{"no rate, no tenure", 0, nil},
		{"nonzero rate ignored when comparable=0", 1.0, nil},
		{"long tenure ignored when comparable=0", 1.0, ptrTime(time.Now().Add(-40 * 30 * 24 * time.Hour))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := computeRentScore(tc.onTimeRate, 0, tc.oldest)
			if got != 0 {
				t.Errorf("computeRentScore(%v, 0, %v) = %d, want 0", tc.onTimeRate, tc.oldest, got)
			}
		})
	}
}

func TestComputeRentScore_BaseRoundingFromOnTimeRate(t *testing.T) {
	// rentpassport.go L183: base := int(onTimeRate*90 + 0.5) — i.e. round-half-up
	// then TRUNCATE (Go int() truncates toward zero). No tenure (oldest=nil) so
	// score == base exactly.
	cases := []struct {
		onTimeRate float64
		wantBase   int
	}{
		{1.0, 90},  // perfect punctuality -> full 90 base points
		{0.0, 0},   // int(0.5) truncates to 0
		{0.5, 45},  // int(45.5) truncates to 45, NOT 46 — pins the truncation behavior
		{0.9, 81},  // int(81.5) truncates to 81
		{0.99, 89}, // int(89.6+0.5=89.6... ) int(89.6)=89
	}
	for _, tc := range cases {
		got := computeRentScore(tc.onTimeRate, 1, nil)
		if got != tc.wantBase {
			t.Errorf("computeRentScore(%v, 1, nil) = %d, want base %d", tc.onTimeRate, got, tc.wantBase)
		}
	}
}

func TestComputeRentScore_TenureBuckets(t *testing.T) {
	// rentpassport.go L184-191: tenure = min(10, (months/6)*2), months computed
	// from time.Since(*oldest) truncated to whole months of 30 days. Uses
	// onTimeRate=0 (comparable=1, so base=int(0+0.5)=0) to isolate the tenure
	// contribution — score should equal tenure exactly.
	cases := []struct {
		name       string
		months     int
		wantTenure int
	}{
		{"under 6 months: no tenure credit", 5, 0},
		{"exactly 6 months: first bucket", 6, 2},
		{"11 months: still first bucket", 11, 2},
		{"12 months: second bucket", 12, 4},
		{"18 months: third bucket", 18, 6},
		{"24 months: fourth bucket", 24, 8},
		{"30 months: capped at 10", 30, 10},
		{"way beyond 30 months: still capped at 10", 60, 10},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			oldest := monthsAgo(tc.months)
			got := computeRentScore(0, 1, &oldest)
			if got != tc.wantTenure {
				t.Errorf("months=%d: computeRentScore(0,1,oldest) = %d, want tenure %d", tc.months, got, tc.wantTenure)
			}
		})
	}
}

func TestComputeRentScore_ClampAt100(t *testing.T) {
	// rentpassport.go L196-198: score is clamped to <=100. Under the documented
	// formula base<=90 and tenure<=10 so the natural ceiling is exactly 100
	// (perfect punctuality + 30+ months tenure) — assert that combination lands
	// on 100, AND separately drive the clamp branch directly with an
	// out-of-contract onTimeRate>1.0 to prove the clamp fires even if a future
	// caller ever passes a malformed ratio.
	oldest := monthsAgo(36)
	got := computeRentScore(1.0, 1, &oldest)
	if got != 100 {
		t.Errorf("perfect rate + long tenure = %d, want 100", got)
	}

	got = computeRentScore(1.5, 1, &oldest) // out-of-contract input
	if got != 100 {
		t.Errorf("out-of-range onTimeRate=1.5: computeRentScore = %d, want clamped 100", got)
	}
}

func TestComputeRentScore_NegativeGuard(t *testing.T) {
	// rentpassport.go L192-195: score<0 is clamped to 0. base can go negative if
	// onTimeRate is negative (int(-90+0.5) = int(-89.5) = -89, Go truncates
	// toward zero) — a malformed/negative ratio must never produce a negative
	// score.
	got := computeRentScore(-1.0, 5, nil)
	if got != 0 {
		t.Errorf("computeRentScore(-1.0, 5, nil) = %d, want clamped to 0", got)
	}
	if got < 0 {
		t.Fatalf("score must never be negative, got %d", got)
	}
}

// monthsAgo returns a timestamp far enough in the past that
// time.Since(oldest).Hours()/(24*30), truncated to int, equals exactly m — a
// small negative buffer (an extra minute further back) absorbs the few
// microseconds of real elapsed time between constructing the fixture and
// computeRentScore's own time.Since call, so the truncation never rounds down
// to m-1 at an exact bucket boundary.
func monthsAgo(m int) time.Time {
	return time.Now().Add(-time.Duration(m)*30*24*time.Hour - time.Minute)
}

func ptrTime(t time.Time) *time.Time { return &t }

// ── On-time ratio: NULL due date exclusion ────────────────────────────────
//
// Transcribed from rentpassport.go L93-100 (estate loop) / L142-148 (realtor
// loop) — both loops share the identical shape:
//
//	if due != nil {
//	    comparable++
//	    if !paidAt.After(*due) { met++ }
//	}
//
// A payment with a NULL due date contributes to NEITHER comparable NOR met —
// it must not be silently counted as "on time" just because it has nothing to
// be late against.

type onTimeRow struct {
	paidAt time.Time
	due    *time.Time
}

// accumulateOnTime mirrors the cited branches exactly.
func accumulateOnTime(rows []onTimeRow) (comparable, met int) {
	for _, r := range rows {
		if r.due != nil {
			comparable++
			if !r.paidAt.After(*r.due) {
				met++
			}
		}
	}
	return comparable, met
}

func TestOnTimeRatio_ExcludesNullDueDateRows(t *testing.T) {
	now := time.Now()
	dueYesterday := now.Add(-24 * time.Hour)
	dueTomorrow := now.Add(24 * time.Hour)

	rows := []onTimeRow{
		{paidAt: now, due: nil},              // no due date: must NOT count toward comparable or met
		{paidAt: now, due: nil},              // second NULL-due row, same rule
		{paidAt: now, due: &dueTomorrow},      // paid before due -> on time
		{paidAt: now, due: &dueYesterday},     // paid after due -> comparable but NOT on time
	}

	comparable, met := accumulateOnTime(rows)
	if comparable != 2 {
		t.Fatalf("comparable = %d, want 2 (the two NULL-due rows must be excluded)", comparable)
	}
	if met != 1 {
		t.Fatalf("met = %d, want 1 (only the paid-before-due row)", met)
	}

	rate := float64(met) / float64(comparable)
	if rate != 0.5 {
		t.Errorf("onTimeRate = %v, want 0.5 — a NULL-due row miscounted would skew this", rate)
	}
}

func TestOnTimeRatio_AllNullDueRowsYieldZeroComparable(t *testing.T) {
	// Mirrors PROPERTY-UNIT-009: a user whose only payments carry no due date
	// must land on comparable==0, which is exactly the input that fails
	// computeRentScore closed to 0 (see TestComputeRentScore_ZeroComparablePaymentsScoresZero).
	rows := []onTimeRow{
		{paidAt: time.Now(), due: nil},
		{paidAt: time.Now(), due: nil},
	}
	comparable, met := accumulateOnTime(rows)
	if comparable != 0 || met != 0 {
		t.Fatalf("comparable=%d met=%d, want 0,0 when every row has a NULL due date", comparable, met)
	}
}

func TestOnTimeRatio_PaidExactlyOnDueDateCountsAsOnTime(t *testing.T) {
	// "!paidAt.After(*due)" — paidAt == due is NOT after due, so it counts as
	// on-time. Boundary case worth pinning explicitly.
	due := time.Now()
	rows := []onTimeRow{{paidAt: due, due: &due}}
	comparable, met := accumulateOnTime(rows)
	if comparable != 1 || met != 1 {
		t.Fatalf("paid exactly on due date: comparable=%d met=%d, want 1,1", comparable, met)
	}
}

// ── Realtor-schema-absent tolerance asymmetry ─────────────────────────────
//
// Transcribed from GetRentPassport (rentpassport.go):
//   - estate query error (L79-81): `if err != nil { return nil, fmt.Errorf(...) }`
//     — FATAL, the whole passport request fails.
//   - realtor query error (L129, L167): `if err == nil { ...loop... }` with NO
//     else branch — a non-nil err is silently swallowed and the function
//     continues as if the user simply had no realtor history.
//
// This is a real, deliberate asymmetry per docs/qa/modules/property.md §6
// ("Fail-closed on dependency error") — it must NOT be "fixed" into symmetry
// without that being a deliberate, reviewed decision. Exercising the true
// "realtor tables absent" case against a live Postgres would require DROPping
// realtor_payments/realtor_invoices/realtor_leases on the shared local
// Supabase instance, which the additive-only migration iron rule and the
// shared-worktree safety rule both forbid (see CLAUDE.md "Brownfield safety"
// and the "Don't Hot-Patch Shared Worktree" memory note) — so this transcribed
// control-flow test is the safe, faithful proxy. See
// property_money_invariant_test.go for the live-DB estate+realtor happy-path
// sum, which proves the two sources compose correctly when both succeed.

// buildPassportErrorHandling mirrors ONLY the error-handling shape of
// GetRentPassport's two query blocks (not the actual SQL/scan), returning
// whether the overall call fails and whether the realtor block ran at all.
func buildPassportErrorHandling(estateErr, realtorErr error) (overallErr error, realtorBlockRan bool) {
	if estateErr != nil {
		return estateErr, false // L80: fatal, return immediately
	}
	if realtorErr == nil {
		return nil, true // realtor query succeeded: loop would run
	}
	return nil, false // L129 `if err == nil` with no else: swallowed, tolerated
}

func TestRealtorToleranceAsymmetry_EstateErrorIsFatal(t *testing.T) {
	err, ran := buildPassportErrorHandling(errors.New("estate_payments: relation does not exist"), nil)
	if err == nil {
		t.Fatal("an estate-payments query error must be FATAL (GetRentPassport must return the error)")
	}
	if ran {
		t.Fatal("realtor block should never run once the estate query has already failed")
	}
}

func TestRealtorToleranceAsymmetry_RealtorErrorIsTolerated(t *testing.T) {
	err, ran := buildPassportErrorHandling(nil, errors.New("realtor_payments: relation does not exist"))
	if err != nil {
		t.Fatalf("a realtor-payments query error must be TOLERATED (treated as no realtor history), got error: %v", err)
	}
	if ran {
		t.Fatal("the realtor loop must not run when the realtor query itself errored")
	}
}

func TestRealtorToleranceAsymmetry_BothSucceed(t *testing.T) {
	err, ran := buildPassportErrorHandling(nil, nil)
	if err != nil {
		t.Fatalf("both sources succeeding must not error, got %v", err)
	}
	if !ran {
		t.Fatal("realtor block must run when its query succeeded")
	}
}
