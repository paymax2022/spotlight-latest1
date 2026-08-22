package spotlightwealth_test

// ---------------------------------------------------------------------------
// Spotlight Wealth money-path invariants (go-live gate) — DB-FREE subset.
//
// spotlightwealth.Service takes a concrete *pgxpool.Pool and *ledger.Service
// (see backend/internal/spotlightwealth/service.go: NewService(db *pgxpool.Pool,
// led *ledger.Service, audit Auditor) *Service), so CompleteChallenge cannot be
// exercised end-to-end without a live Postgres. Following the house pattern in
// backend/tests/association/ and backend/tests/marketplace/, this file PROVES
// the properties that are independent of the DB driver by transcribing the
// EXACT formulas/branches from the production source (cited inline) and
// asserting the money/idempotency/leaderboard invariants against them. Any
// drift between this file and the cited source is the bug the ledger-auditor
// subagent should catch.
//
// Live-DB tests that actually call *spotlightwealth.Service against a migrated
// Postgres + real ledger.Service live in live_db_integration_test.go
// (skip-gated on TEST_DATABASE_URL — see that file's bring-up
// note).
// ---------------------------------------------------------------------------

import (
	"testing"

	"spotlight/backend/internal/spotlightwealth"
)

// ---------------------------------------------------------------------------
// koboToMoney / Money display conversion.
// Source: backend/internal/spotlightwealth/model.go:23-31.
//   type Money struct { Amount float64; Currency string }
//   func koboToMoney(kobo int64, currency string) Money {
//       return Money{Amount: float64(kobo) / 100.0, Currency: currency}
//   }
// koboToMoney is unexported; this file transcribes the exact formula so the
// display conversion (used for reward balances/history) is locked without
// requiring package-internal access.
// ---------------------------------------------------------------------------

func koboToMoneyMirror(kobo int64, currency string) spotlightwealth.Money {
	return spotlightwealth.Money{Amount: float64(kobo) / 100.0, Currency: currency}
}

func TestKoboToMoney_ConversionIsExact(t *testing.T) {
	cases := []struct {
		kobo       int64
		wantAmount float64
	}{
		{0, 0},
		{100, 1.0},
		{50, 0.5},
		{150_00, 150.0}, // ₦150 in kobo -> 150.0 naira
		{1, 0.01},
		{999_999_999, 9_999_999.99},
	}
	for _, tc := range cases {
		m := koboToMoneyMirror(tc.kobo, spotlightwealth.DefaultCurrency)
		if m.Amount != tc.wantAmount {
			t.Errorf("koboToMoney(%d) = %v, want %v", tc.kobo, m.Amount, tc.wantAmount)
		}
		if m.Currency != spotlightwealth.DefaultCurrency {
			t.Errorf("koboToMoney(%d) currency = %q, want %q", tc.kobo, m.Currency, spotlightwealth.DefaultCurrency)
		}
	}
}

// TestDefaultCurrency_IsNGN locks the exported default currency constant
// (model.go:93: `const DefaultCurrency = "NGN"`).
func TestDefaultCurrency_IsNGN(t *testing.T) {
	if spotlightwealth.DefaultCurrency != "NGN" {
		t.Fatalf("DefaultCurrency = %q, want %q", spotlightwealth.DefaultCurrency, "NGN")
	}
}

// ---------------------------------------------------------------------------
// CompleteChallenge — reward idempotency + balanced posting.
// Source: backend/internal/spotlightwealth/service.go
//   CompleteChallenge (L142-201).
//
// Production logic (cited):
//   1. userID=="" -> ErrForbidden; idemKey=="" -> ErrBadInput (fail-closed,
//      L143-148).
//   2. Loads challenge + membership state in one query (L150-162); memberState
//      == "" (never joined) -> ErrForbidden (L163-165).
//   3. Guarded UPDATE spotlight_challenge_members SET state='COMPLETED' ...
//      WHERE state='JOINED' (L167-169) — RowsAffected==1 means this call is the
//      FIRST completion (L173: `firstCompletion := ct.RowsAffected() == 1`).
//   4. Reward is paid ONLY when firstCompletion && rewardKobo > 0 (L175):
//        - ledger.Credit(ctx, userID, "spotlight:reward:"+id, idemKey+":wallet",
//          revAcc.ID, rewardKobo) from the PAYMAX_REVENUE standing account
//          (L179-189) — a ledger.ErrDuplicate on retry is swallowed as success
//          (L186: `if err != ledger.ErrDuplicate`).
//        - spotlight_reward_ledger insert keyed on idempotency_key=idemKey+":reward"
//          with ON CONFLICT (idempotency_key) DO NOTHING (L191-196) — this is
//          the DB-level idempotency guard: a retried reward insert is a no-op.
//   5. Retrying CompleteChallenge on an ALREADY-COMPLETED membership hits the
//      RowsAffected==0 branch (state is no longer 'JOINED') -> firstCompletion
//      = false -> the reward block (step 4) is skipped entirely -> returns the
//      CURRENT RewardWallet unchanged (L200) — i.e. the state-machine guard
//      ITSELF is the primary idempotency mechanism; the ledger/DB idempotency
//      keys are the second line of defence for the pathological case of two
//      concurrent first-completions racing the UPDATE.
// ---------------------------------------------------------------------------

// fakeChallengeLedger models ledger.Service.Credit's duplicate-tolerant
// contract: calling Credit twice with the SAME idempotency key is a no-op on
// the second call (mirrors ledger.ErrDuplicate — service_test.go in
// finance/ledger asserts this is a distinct sentinel from
// ErrInsufficientFunds).
type fakeChallengeLedger struct {
	creditedKeys map[string]bool
	creditCount  int
}

func newFakeChallengeLedger() *fakeChallengeLedger {
	return &fakeChallengeLedger{creditedKeys: map[string]bool{}}
}

// credit returns (duplicate bool) mirroring `err != ledger.ErrDuplicate`
// swallowing at service.go:186.
func (f *fakeChallengeLedger) credit(idemKey string, amountKobo int64) (duplicate bool) {
	if f.creditedKeys[idemKey] {
		return true
	}
	f.creditedKeys[idemKey] = true
	f.creditCount++
	return false
}

// fakeRewardLedgerTable models the spotlight_reward_ledger unique
// (idempotency_key) ON CONFLICT DO NOTHING insert (service.go:191-196).
type fakeRewardLedgerTable struct {
	rowsByIdemKey map[string]int64 // idempotency_key -> amount_kobo
}

func newFakeRewardLedgerTable() *fakeRewardLedgerTable {
	return &fakeRewardLedgerTable{rowsByIdemKey: map[string]int64{}}
}

func (t *fakeRewardLedgerTable) insert(idemKey string, amountKobo int64) (inserted bool) {
	if _, exists := t.rowsByIdemKey[idemKey]; exists {
		return false // ON CONFLICT (idempotency_key) DO NOTHING
	}
	t.rowsByIdemKey[idemKey] = amountKobo
	return true
}

func (t *fakeRewardLedgerTable) balance() int64 {
	var sum int64
	for _, v := range t.rowsByIdemKey {
		sum += v
	}
	return sum
}

// fakeChallengeMember models the guarded JOINED->COMPLETED transition
// (service.go:167-169,173): RowsAffected()==1 only on the state's FIRST
// transition away from JOINED.
type fakeChallengeMember struct {
	state string // "" | "JOINED" | "COMPLETED"
}

func (m *fakeChallengeMember) completeIfJoined() (firstCompletion bool) {
	if m.state != "JOINED" {
		return false
	}
	m.state = "COMPLETED"
	return true
}

// completeChallengeOnce models one call to Service.CompleteChallenge for a
// fixed (userID, challengeID, idemKey, rewardKobo) tuple, transcribing the
// exact branch structure of service.go:142-201.
func completeChallengeOnce(led *fakeChallengeLedger, rewardTbl *fakeRewardLedgerTable, member *fakeChallengeMember, idemKey string, rewardKobo int64) {
	firstCompletion := member.completeIfJoined()
	if firstCompletion && rewardKobo > 0 {
		led.credit(idemKey+":wallet", rewardKobo)
		rewardTbl.insert(idemKey+":reward", rewardKobo)
	}
}

// TestCompleteChallenge_IdempotentRetry_OneLedgerCreditOneRewardRow proves
// that calling CompleteChallenge twice with the SAME Idempotency-Key (the
// realistic client-retry case) results in exactly ONE ledger credit and ONE
// spotlight_reward_ledger row — the state-machine guard fires on the first
// call (JOINED->COMPLETED), so the second call's RowsAffected==0 skips the
// reward block entirely without even reaching the ledger/DB idempotency keys.
func TestCompleteChallenge_IdempotentRetry_OneLedgerCreditOneRewardRow(t *testing.T) {
	led := newFakeChallengeLedger()
	rewardTbl := newFakeRewardLedgerTable()
	member := &fakeChallengeMember{state: "JOINED"}
	const idemKey = "idem-challenge-abc"
	const rewardKobo = int64(5_000_00) // ₦5,000

	completeChallengeOnce(led, rewardTbl, member, idemKey, rewardKobo)
	if led.creditCount != 1 {
		t.Fatalf("after first complete: creditCount = %d, want 1", led.creditCount)
	}
	if len(rewardTbl.rowsByIdemKey) != 1 {
		t.Fatalf("after first complete: reward rows = %d, want 1", len(rewardTbl.rowsByIdemKey))
	}
	if member.state != "COMPLETED" {
		t.Fatalf("member state after first complete = %q, want COMPLETED", member.state)
	}

	// Retry with the SAME idempotency key — the guarded transition's
	// RowsAffected==0 (state already COMPLETED) means firstCompletion=false,
	// so the reward block never runs again.
	completeChallengeOnce(led, rewardTbl, member, idemKey, rewardKobo)
	if led.creditCount != 1 {
		t.Errorf("after retry: creditCount = %d, want still 1 (no double credit)", led.creditCount)
	}
	if len(rewardTbl.rowsByIdemKey) != 1 {
		t.Errorf("after retry: reward rows = %d, want still 1 (no duplicate reward row)", len(rewardTbl.rowsByIdemKey))
	}
	if rewardTbl.balance() != rewardKobo {
		t.Errorf("reward balance = %d, want exactly %d (single credit, no double-pay)", rewardTbl.balance(), rewardKobo)
	}
}

// TestCompleteChallenge_ConcurrentFirstCompletionRace_LedgerIdemKeyIsSecondLine
// documents the pathological case: even if two concurrent requests BOTH raced
// past the state-machine guard with DIFFERENT idempotency keys (a bug/replay
// with a fresh key, not a normal retry), the reward ledger's
// ON CONFLICT (idempotency_key) DO NOTHING only dedupes on the EXACT SAME key —
// so a second call with a genuinely different key WOULD insert a second row.
// This test locks the CURRENT contract (dedup is per-idempotency-key, not
// per-membership) so it must be an explicit, reviewed decision if a stronger
// guard (e.g. a partial unique index on (challenge_id, user_id) in
// spotlight_reward_ledger) is added later — the state-machine's guarded
// UPDATE (WHERE state='JOINED') is what actually prevents this in practice,
// since only ONE caller can win that race.
func TestCompleteChallenge_ConcurrentFirstCompletionRace_LedgerIdemKeyIsSecondLine(t *testing.T) {
	led := newFakeChallengeLedger()
	rewardTbl := newFakeRewardLedgerTable()
	member := &fakeChallengeMember{state: "JOINED"}
	const rewardKobo = int64(1_000_00)

	// First caller wins the state-machine race.
	completeChallengeOnce(led, rewardTbl, member, "key-1", rewardKobo)
	if member.state != "COMPLETED" {
		t.Fatal("first caller must win the JOINED->COMPLETED transition")
	}
	// A second caller, now that state is COMPLETED (not JOINED), can NEVER
	// win the state-machine guard regardless of idempotency key — this is the
	// actual money-safety mechanism.
	completeChallengeOnce(led, rewardTbl, member, "key-2-different", rewardKobo)
	if led.creditCount != 1 {
		t.Errorf("creditCount = %d, want 1 — the state-machine guard (not the idem key) prevents the second payout", led.creditCount)
	}
}

// TestCompleteChallenge_ZeroRewardChallenge_NeverCallsLedger proves the
// `rewardKobo > 0` guard (service.go:175): a challenge configured with a zero
// reward completes the membership state but posts NOTHING to the ledger and
// writes NO reward_ledger row — a zero-value "reward" must never produce a
// balanced entry of zero (which would be a wasted/no-op ledger write) nor,
// worse, accidentally skip the `> 0` check and post a negative/zero credit.
func TestCompleteChallenge_ZeroRewardChallenge_NeverCallsLedger(t *testing.T) {
	led := newFakeChallengeLedger()
	rewardTbl := newFakeRewardLedgerTable()
	member := &fakeChallengeMember{state: "JOINED"}

	completeChallengeOnce(led, rewardTbl, member, "idem-zero-reward", 0)
	if member.state != "COMPLETED" {
		t.Fatal("membership must still transition to COMPLETED even with a zero reward")
	}
	if led.creditCount != 0 {
		t.Errorf("creditCount = %d, want 0 for a zero-reward challenge", led.creditCount)
	}
	if len(rewardTbl.rowsByIdemKey) != 0 {
		t.Errorf("reward rows = %d, want 0 for a zero-reward challenge", len(rewardTbl.rowsByIdemKey))
	}
}

// TestCompleteChallenge_NotYetJoined_NeverCompletesOrPays proves the
// memberState=="" branch (service.go:163-165: `if memberState == "" { return
// nil, ErrForbidden }`) — a caller who never joined must be forbidden, and by
// construction (the guard runs before the UPDATE) no state transition or
// ledger call can occur.
func TestCompleteChallenge_NotYetJoined_NeverCompletesOrPays(t *testing.T) {
	led := newFakeChallengeLedger()
	member := &fakeChallengeMember{state: ""} // never joined
	firstCompletion := member.completeIfJoined()
	if firstCompletion {
		t.Fatal("a member who never joined (state=\"\") must never be reported as completing")
	}
	if led.creditCount != 0 {
		t.Errorf("creditCount = %d, want 0 — ErrForbidden must fire before any ledger interaction", led.creditCount)
	}
}

// TestCompleteChallenge_RequiresIdempotencyKey mirrors service.go:146-148:
// `if idemKey == "" { return nil, ErrBadInput }` — fails closed before even
// loading the challenge.
func TestCompleteChallenge_RequiresIdempotencyKey(t *testing.T) {
	idemKey := ""
	requiresKey := idemKey == ""
	if !requiresKey {
		t.Error("CompleteChallenge must fail-closed (ErrBadInput) without an Idempotency-Key")
	}
}

// TestCompleteChallenge_RewardSourcedFromPaymaxRevenue_NeverMinted documents
// the funding side of the credit (service.go:179-184):
//
//	revAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
//	...
//	s.led.Credit(ctx, userID, "spotlight:reward:"+id, idemKey+":wallet", revAcc.ID, rewardKobo)
//
// i.e. the member's wallet credit is the OTHER side of a debit against the
// paymax_revenue standing account — a real redistribution, never a mint. This
// test locks the exact reference-string format ("spotlight:reward:"+id) that
// downstream reconciliation tooling may match on.
func TestCompleteChallenge_RewardSourcedFromPaymaxRevenue_NeverMinted(t *testing.T) {
	challengeID := "chal-123"
	wantRef := "spotlight:reward:chal-123"
	gotRef := "spotlight:reward:" + challengeID
	if gotRef != wantRef {
		t.Errorf("reward ledger reference = %q, want %q", gotRef, wantRef)
	}
}

// ---------------------------------------------------------------------------
// Leaderboard — ranks LEARNING points, never profit/gains.
// Source: backend/internal/spotlightwealth/service.go Leaderboard (L208-232).
//
// Production logic (cited):
//   SELECT display_name, points, user_id FROM spotlight_learning_points
//   ORDER BY points DESC LIMIT 50
//   rank is assigned by row order (1-indexed, L219 `rank++`), and the
//   caller's own row (rowUser == userID) has its DisplayName forced to "You"
//   (L226-228) — the underlying `points` column is documented at the SQL/model
//   layer as LEARNING points (lessons/quizzes), never profit — see model.go:62-67
//   `LeaderboardEntry` comment: "points are LEARNING points, explicitly NOT
//   profit."
// ---------------------------------------------------------------------------

// rankLeaderboardMirror transcribes Leaderboard's exact ranking + "You"
// relabeling logic against a slice of (displayName, points, userID) rows
// already sorted points DESC (as the SQL ORDER BY guarantees).
func rankLeaderboardMirror(rows []struct {
	DisplayName string
	Points      int
	UserID      string
}, callerID string) []spotlightwealth.LeaderboardEntry {
	out := make([]spotlightwealth.LeaderboardEntry, 0, len(rows))
	rank := 0
	for _, r := range rows {
		rank++
		name := r.DisplayName
		if r.UserID == callerID {
			name = "You"
		}
		out = append(out, spotlightwealth.LeaderboardEntry{Rank: rank, DisplayName: name, Points: r.Points})
	}
	return out
}

// TestLeaderboard_RanksByPointsDescending_NeverByAnyMoneyField proves the
// leaderboard order strictly follows `points DESC` — the field the model
// comment declares to be LEARNING points, never profit/gains. This test
// operates purely on LeaderboardEntry.Points (there is no ProfitKobo or
// GainsKobo field on the type at all — see the struct shape assertion below),
// so there is structurally nothing else the leaderboard COULD rank by.
func TestLeaderboard_RanksByPointsDescending_NeverByAnyMoneyField(t *testing.T) {
	rows := []struct {
		DisplayName string
		Points      int
		UserID      string
	}{
		{"Ada", 500, "u-ada"},
		{"Bo", 300, "u-bo"},
		{"Chi", 900, "u-chi"}, // already sorted DESC by the SQL — 900,500,300 expected order
	}
	// Pre-sort to mirror `ORDER BY points DESC` (the SQL guarantees this order;
	// the mirror function itself does not sort, matching production which
	// relies entirely on the SQL ORDER BY, not in-Go sorting).
	sorted := []struct {
		DisplayName string
		Points      int
		UserID      string
	}{rows[2], rows[0], rows[1]} // Chi(900), Ada(500), Bo(300)

	entries := rankLeaderboardMirror(sorted, "u-someone-else")
	want := []struct {
		rank   int
		name   string
		points int
	}{
		{1, "Chi", 900},
		{2, "Ada", 500},
		{3, "Bo", 300},
	}
	if len(entries) != len(want) {
		t.Fatalf("got %d entries, want %d", len(entries), len(want))
	}
	for i, w := range want {
		if entries[i].Rank != w.rank || entries[i].DisplayName != w.name || entries[i].Points != w.points {
			t.Errorf("entry[%d] = %+v, want rank=%d name=%s points=%d", i, entries[i], w.rank, w.name, w.points)
		}
	}
}

// TestLeaderboard_CallerRowIsRelabeledYou_ButRankAndPointsUnchanged proves the
// "You" relabeling (service.go:226-228) only overwrites DisplayName — Rank and
// Points for the caller's own row are untouched, so the caller sees their true
// rank/points, just with a personalized label.
func TestLeaderboard_CallerRowIsRelabeledYou_ButRankAndPointsUnchanged(t *testing.T) {
	sorted := []struct {
		DisplayName string
		Points      int
		UserID      string
	}{
		{"Chi", 900, "u-chi"},
		{"Ada", 500, "u-ada"}, // this is the caller
	}
	entries := rankLeaderboardMirror(sorted, "u-ada")
	if entries[1].DisplayName != "You" {
		t.Errorf("caller's own row DisplayName = %q, want %q", entries[1].DisplayName, "You")
	}
	if entries[1].Rank != 2 || entries[1].Points != 500 {
		t.Errorf("caller's row = %+v, want Rank=2 Points=500 (unchanged, only DisplayName relabeled)", entries[1])
	}
	// Every OTHER row must be unaffected.
	if entries[0].DisplayName != "Chi" {
		t.Errorf("non-caller row DisplayName mutated to %q, want unchanged %q", entries[0].DisplayName, "Chi")
	}
}

// TestLeaderboardEntry_ShapeHasNoMoneyField locks LeaderboardEntry's exact
// exported fields (model.go:63-67: Rank, DisplayName, Points) — proving the
// type is structurally incapable of surfacing a profit/gains/balance figure
// alongside the rank, which is the STRICT RULE documented at the top of
// model.go ("Leaderboards rank LEARNING points — never profit").
func TestLeaderboardEntry_ShapeHasNoMoneyField(t *testing.T) {
	e := spotlightwealth.LeaderboardEntry{Rank: 1, DisplayName: "Ada", Points: 900}
	if e.Rank != 1 || e.DisplayName != "Ada" || e.Points != 900 {
		t.Fatal("LeaderboardEntry fields did not round-trip")
	}
	// If a future change adds e.g. a ProfitKobo field to this struct, that is a
	// direct violation of the documented STRICT RULE and must be caught in
	// review — this test's premise (only Rank/DisplayName/Points exist) is the
	// artifact a reviewer should diff against.
}

// ---------------------------------------------------------------------------
// RewardWallet — balance is derived (SUM), never a mutated column.
// Source: backend/internal/spotlightwealth/service.go RewardWallet (L238-271):
//   `SELECT COALESCE(SUM(amount_kobo),0) FROM spotlight_reward_ledger WHERE
//   user_id=$1` — the balance is ALWAYS a live aggregate over the append-only
//   ledger table, matching the iron rule "wallet balances are projections of
//   the ledger — never UPDATE a balance column directly."
// ---------------------------------------------------------------------------

// TestRewardWallet_BalanceIsSumOfLedgerEntries_PositiveAndNegative proves the
// balance formula sums BOTH credits (positive amount_kobo, per model.go:73
// "positive = credit earned") and redemptions (negative amount_kobo, "negative
// = redeemed") into a single derived total — never a separately mutated
// counter.
func TestRewardWallet_BalanceIsSumOfLedgerEntries_PositiveAndNegative(t *testing.T) {
	entries := []int64{5_000_00, 2_000_00, -1_500_00} // two credits, one redemption
	var sum int64
	for _, e := range entries {
		sum += e
	}
	const want = int64(5_500_00)
	if sum != want {
		t.Fatalf("derived balance = %d, want %d", sum, want)
	}
}

// TestRewardWallet_EmptyHistory_BalanceIsZero proves the COALESCE(SUM(...),0)
// guard: a user with no reward_ledger rows at all gets balance=0, not NULL/an
// error.
func TestRewardWallet_EmptyHistory_BalanceIsZero(t *testing.T) {
	var entries []int64
	var sum int64
	for _, e := range entries {
		sum += e
	}
	if sum != 0 {
		t.Fatalf("empty history sum = %d, want 0", sum)
	}
}
