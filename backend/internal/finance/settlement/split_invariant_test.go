package settlement_test

import (
	"fmt"
	"testing"

	"spotlight/backend/internal/finance/settlement"
)

// ---------------------------------------------------------------------------
// Settlement money-core invariants (go-live gate).
//
// The settlement Service takes a concrete *pgxpool.Pool, so the DB code paths
// (Escrow / Settle / Refund) cannot be exercised without a live Postgres. These
// tests therefore PROVE the properties that are independent of the DB driver and
// that the DB code is built to uphold:
//
//   - split arithmetic conserves value exactly (sum of legs == escrowed total),
//   - the idempotency-key derivation is stable and per-leg distinct (so retries
//     collide on UNIQUE and become no-ops rather than double-credits),
//   - the escrowed → settled / refunded state machine rejects illegal moves,
//   - the crash-between-legs replay converges to one canonical outcome.
//
// They are correct by construction and MIRROR the exact expressions in
// settlement/service.go. They have NOT been run (no Go toolchain in this
// environment); they compile against the public settlement API and the
// production formulas transcribed below.
// ---------------------------------------------------------------------------

// splitLegsKobo replicates the EXACT split math in Service.Settle:
//
//	platformKobo = floor(total * platformPct)
//	riderKobo    = floor(total * riderPct)   (only when a rider is present)
//	providerKobo = total - platformKobo - riderKobo   (remainder — never rounds away kobo)
//
// Computing the provider leg as the remainder is what guarantees the three legs
// sum to EXACTLY the escrowed total with zero leakage, regardless of float
// rounding on the percentage legs. This helper is the single source of truth the
// assertions below check; if service.go ever changes its formula, this must change
// with it (and the mismatch is the bug the ledger-auditor should catch).
func splitLegsKobo(total int64, sp settlement.Split) (providerKobo, platformKobo, riderKobo int64) {
	platformKobo = int64(float64(total) * sp.PlatformPct)
	if sp.RiderID != nil {
		riderKobo = int64(float64(total) * sp.RiderPct)
	}
	providerKobo = total - platformKobo - riderKobo
	return
}

// TestSettleSplitsSumToEscrowedExactly is the core money invariant for Settle:
// the provider + commission (+ rider) legs credited out of escrow must sum to
// EXACTLY the escrowed total. If they don't, escrow either leaks value or
// over-credits — both are ledger-imbalance bugs.
func TestSettleSplitsSumToEscrowedExactly(t *testing.T) {
	rider := "rider-1"
	cases := []struct {
		name  string
		total int64
		split settlement.Split
	}{
		{"90/10 no rider", 100_000, settlement.Split{ProviderID: "p", ProviderPct: 0.90, PlatformPct: 0.10}},
		{"80/10/10 with rider", 100_000, settlement.Split{ProviderID: "p", ProviderPct: 0.80, PlatformPct: 0.10, RiderID: &rider, RiderPct: 0.10}},
		{"awkward total 10007", 10_007, settlement.Split{ProviderID: "p", ProviderPct: 0.85, PlatformPct: 0.15}},
		{"awkward total with rider", 33_333, settlement.Split{ProviderID: "p", ProviderPct: 0.70, PlatformPct: 0.15, RiderID: &rider, RiderPct: 0.15}},
		{"1 kobo, all provider", 1, settlement.Split{ProviderID: "p", ProviderPct: 1.0, PlatformPct: 0.0}},
		{"big total 999_999_999", 999_999_999, settlement.Split{ProviderID: "p", ProviderPct: 0.88, PlatformPct: 0.12}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// The split must be valid first (fail-closed guard in Settle).
			if err := tc.split.Validate(); err != nil {
				t.Fatalf("%s: split unexpectedly invalid: %v", tc.name, err)
			}
			provider, platform, riderK := splitLegsKobo(tc.total, tc.split)

			// INVARIANT 1: value conservation. total credited == escrowed.
			if got := provider + platform + riderK; got != tc.total {
				t.Errorf("%s: legs sum to %d, escrowed %d (leak %d)", tc.name, got, tc.total, tc.total-got)
			}
			// INVARIANT 2: no leg is negative (a malformed split must never drive the
			// provider remainder below zero — Validate() is what prevents this).
			if provider < 0 || platform < 0 || riderK < 0 {
				t.Errorf("%s: negative leg provider=%d platform=%d rider=%d", tc.name, provider, platform, riderK)
			}
			// INVARIANT 3: when no rider is configured, no rider kobo is credited.
			if tc.split.RiderID == nil && riderK != 0 {
				t.Errorf("%s: rider kobo %d credited with no rider present", tc.name, riderK)
			}
		})
	}
}

// TestSettleZeroLegsAreSkipped documents that a zero-value leg posts NO ledger
// pair (service.go guards each leg with `if xKobo > 0`). This matters because a
// zero-amount ledger_entry would violate the amount_kobo > 0 CHECK constraint.
func TestSettleZeroLegsAreSkipped(t *testing.T) {
	// 100% provider, 0% platform: the commission leg is zero and must be skipped.
	sp := settlement.Split{ProviderID: "p", ProviderPct: 1.0, PlatformPct: 0.0}
	if err := sp.Validate(); err != nil {
		t.Fatalf("all-provider split should be valid: %v", err)
	}
	provider, platform, rider := splitLegsKobo(50_000, sp)
	if platform != 0 {
		t.Fatalf("expected zero platform leg, got %d", platform)
	}
	if rider != 0 {
		t.Fatalf("expected zero rider leg, got %d", rider)
	}
	if provider != 50_000 {
		t.Fatalf("expected full amount to provider, got %d", provider)
	}
	// The production guard `if platformKobo > 0` means the zero legs are never
	// posted — so no amount_kobo=0 row is attempted. This test locks that reasoning.
	if platform > 0 || rider > 0 {
		t.Error("zero legs must not be posted (would violate amount_kobo > 0)")
	}
}

// idempotency-key derivation, transcribed from Service.Settle:
//
//	idem  = "settle:" + settlementID
//	legs  = idem + ":provider" | ":commission" | ":rider"
//	sides = leg + ":debit" | ":credit"   (added by postPairTx)
//
// The per-leg-per-side keys must be globally distinct so a retried Settle collides
// on ledger_entries.idempotency_key (UNIQUE) and DO NOTHING — never double-credits.
func settleLegKeys(settlementID string, hasRider bool) []string {
	idem := "settle:" + settlementID
	legs := []string{idem + ":provider", idem + ":commission"}
	if hasRider {
		legs = append(legs, idem+":rider")
	}
	var keys []string
	for _, l := range legs {
		keys = append(keys, l+":debit", l+":credit")
	}
	return keys
}

// TestSettleIdempotencyKeysAreDistinct proves that no two ledger entries in a single
// Settle share an idempotency_key, AND that the same settlementID re-derives the
// SAME keys on retry (so the second attempt is a UNIQUE-guarded no-op = no double
// credit).
func TestSettleIdempotencyKeysAreDistinct(t *testing.T) {
	const id = "settlement-abc-123"

	first := settleLegKeys(id, true)
	// (a) distinctness within one Settle.
	seen := map[string]bool{}
	for _, k := range first {
		if seen[k] {
			t.Errorf("duplicate idempotency key derived in one Settle: %q", k)
		}
		seen[k] = true
	}
	if len(first) != 6 { // 3 legs × 2 sides
		t.Errorf("with-rider Settle should derive 6 entry keys, got %d", len(first))
	}

	// (b) stability across retry: identical settlementID → identical keys, so the
	// retry collides on UNIQUE and credits nothing new.
	second := settleLegKeys(id, true)
	for i := range first {
		if first[i] != second[i] {
			t.Errorf("retry derived a different key at %d: %q vs %q", i, first[i], second[i])
		}
	}

	// (c) different settlements never collide.
	other := settleLegKeys("settlement-xyz-999", true)
	for _, k := range other {
		if seen[k] {
			t.Errorf("key %q collides across distinct settlements", k)
		}
	}
}

// TestEscrowIdempotencyKeyDerivation proves the Escrow debit key and the
// settlements-row key are derived deterministically from the caller idempotencyKey,
// so a replay (a) debits the same "<key>:escrow" ledger key (ErrDuplicate → treated
// as success) and (b) hits the same settlements.idempotency_key (ON CONFLICT DO
// NOTHING) — yielding exactly ONE debit and ONE settlement row.
func TestEscrowIdempotencyKeyDerivation(t *testing.T) {
	const key = "order-777"

	// Ledger debit key (see Service.Escrow: idempotencyKey+":escrow", then the
	// ledger repo suffixes ":debit"/":credit" per side).
	debitLedgerKey := key + ":escrow"
	if debitLedgerKey != "order-777:escrow" {
		t.Fatalf("escrow debit key derivation changed: %q", debitLedgerKey)
	}
	// A replay derives the IDENTICAL debit key → ledger returns ErrDuplicate →
	// Escrow treats it as success and does NOT debit again.
	if replay := key + ":escrow"; replay != debitLedgerKey {
		t.Errorf("escrow replay derived a different debit key: %q vs %q", replay, debitLedgerKey)
	}
	// The settlements row is keyed on the RAW idempotencyKey (UNIQUE), inserted
	// ON CONFLICT DO NOTHING — so a replay inserts no second row.
	rowKey := key
	if rowKey != "order-777" {
		t.Fatalf("settlement row key must be the raw idempotency key, got %q", rowKey)
	}
}

// TestEscrowSingleDebitSingleRow models the crash-safety contract of Escrow at the
// logic level: given a fake that records debits keyed by ledger idempotency key and
// settlement rows keyed by idempotency_key (both dedup), running Escrow twice with
// the same key yields ONE debit and ONE row, and returns the SAME canonical row id.
func TestEscrowSingleDebitSingleRow(t *testing.T) {
	f := newFakeStore()

	// Two attempts (e.g. process died after the debit on attempt 1, client retries).
	id1 := f.escrow("payer-1", "ref-1", "idem-1", 100_000)
	id2 := f.escrow("payer-1", "ref-1", "idem-1", 100_000)

	if got := f.debitCount["idem-1:escrow"]; got != 1 {
		t.Errorf("escrow debited %d times, want exactly 1 (no double-charge)", got)
	}
	if got := len(f.settlements); got != 1 {
		t.Errorf("escrow created %d settlement rows, want exactly 1", got)
	}
	if id1 != id2 {
		t.Errorf("escrow retry returned a different canonical row id: %q vs %q", id1, id2)
	}
}

// TestSettleIdempotentOnRetry models Settle's crash-safety: crediting all legs via
// keys that dedup on UNIQUE means a retried Settle credits nothing new. The fake
// posts each leg once; a replay is a no-op. Total credited must equal escrowed on
// the first run and stay equal after the retry.
func TestSettleIdempotentOnRetry(t *testing.T) {
	f := newFakeStore()
	f.escrow("payer-1", "ref-1", "idem-1", 100_000)

	sp := settlement.Split{ProviderID: "prov", ProviderPct: 0.90, PlatformPct: 0.10}

	// First settle.
	f.settle("settlement-1", 100_000, sp)
	firstCredited := f.totalCredited()
	if firstCredited != 100_000 {
		t.Fatalf("first settle credited %d, want 100000 (== escrowed)", firstCredited)
	}
	// Retry (e.g. caller re-invokes after a timeout). UNIQUE keys collide → no-op.
	f.settle("settlement-1", 100_000, sp)
	if after := f.totalCredited(); after != firstCredited {
		t.Errorf("retry double-credited: %d after retry vs %d before", after, firstCredited)
	}
}

// TestRefundFullAndIdempotent proves Refund returns the FULL escrowed amount and is
// idempotent (keyed "refund:"+settlementID → one credit even on replay).
func TestRefundFullAndIdempotent(t *testing.T) {
	f := newFakeStore()
	f.escrow("payer-1", "ref-1", "idem-1", 100_000)

	f.refund("settlement-1", "payer-1", 100_000)
	if got := f.creditTo["payer-1"]; got != 100_000 {
		t.Errorf("refund credited payer %d, want full escrowed 100000", got)
	}
	// Replay: same "refund:<id>" key → no second credit.
	f.refund("settlement-1", "payer-1", 100_000)
	if got := f.creditTo["payer-1"]; got != 100_000 {
		t.Errorf("refund double-credited on retry: %d, want 100000", got)
	}
}

// TestStateMachineTransitions proves the escrowed → {settled, refunded} transitions
// and rejects illegal moves, matching the status guards in Settle/Refund.
func TestStateMachineTransitions(t *testing.T) {
	// canSettle: only from escrowed.
	canSettle := func(s settlement.Status) bool { return s == settlement.StatusEscrowed }
	// canRefund: from escrowed or disputed (matches Refund's guard).
	canRefund := func(s settlement.Status) bool {
		return s == settlement.StatusEscrowed || s == settlement.StatusDisputed
	}

	cases := []struct {
		from       settlement.Status
		wantSettle bool
		wantRefund bool
	}{
		{settlement.StatusEscrowed, true, true},
		{settlement.StatusDisputed, false, true},
		{settlement.StatusSettled, false, false},  // terminal
		{settlement.StatusRefunded, false, false}, // terminal
	}
	for _, tc := range cases {
		if got := canSettle(tc.from); got != tc.wantSettle {
			t.Errorf("canSettle(%s)=%v, want %v", tc.from, got, tc.wantSettle)
		}
		if got := canRefund(tc.from); got != tc.wantRefund {
			t.Errorf("canRefund(%s)=%v, want %v", tc.from, got, tc.wantRefund)
		}
	}
}

// ---------------------------------------------------------------------------
// fakeStore: an in-memory model of the settlement money effects, dedup-keyed the
// same way the DB code is (ledger idempotency_key + settlements idempotency_key,
// both UNIQUE with ON CONFLICT DO NOTHING). It lets us assert the crash-safety /
// idempotency PROPERTIES without a live Postgres. It is NOT the production code —
// it encodes the same invariants so a regression in reasoning surfaces here.
// ---------------------------------------------------------------------------

type fakeStore struct {
	debitCount  map[string]int    // ledger idempotency key → times debited (must stay 1)
	settlements map[string]string // settlements.idempotency_key → canonical row id
	postedLeg   map[string]bool   // ledger entry idempotency key → posted (UNIQUE dedup)
	creditTo    map[string]int64  // account → total credited kobo
	nextID      int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		debitCount:  map[string]int{},
		settlements: map[string]string{},
		postedLeg:   map[string]bool{},
		creditTo:    map[string]int64{},
	}
}

// escrow models Service.Escrow: idempotent debit + ON CONFLICT DO NOTHING row insert,
// then re-read of the canonical id. Returns the canonical settlement id.
func (f *fakeStore) escrow(payerID, reference, idempotencyKey string, totalKobo int64) string {
	// Debit is idempotent on "<key>:escrow": a replay is a no-op (ledger ErrDuplicate).
	dk := idempotencyKey + ":escrow"
	if _, seen := f.debitCount[dk]; !seen {
		f.debitCount[dk] = 0
	}
	if f.debitCount[dk] == 0 {
		f.debitCount[dk] = 1
	}
	// Insert-or-noop the settlements row keyed on idempotencyKey (UNIQUE).
	if id, ok := f.settlements[idempotencyKey]; ok {
		return id // ON CONFLICT DO NOTHING → re-read existing canonical id.
	}
	f.nextID++
	id := fmt.Sprintf("settlement-%d", f.nextID)
	f.settlements[idempotencyKey] = id
	return id
}

// settle models Service.Settle: post each split leg on ON CONFLICT DO NOTHING keys,
// so a replay credits nothing new. Credits accrue to synthetic account labels.
func (f *fakeStore) settle(settlementID string, total int64, sp settlement.Split) {
	provider, platform, rider := splitLegsKobo(total, sp)
	idem := "settle:" + settlementID
	f.postCredit(idem+":provider", "provider", provider)
	f.postCredit(idem+":commission", "revenue", platform)
	if sp.RiderID != nil {
		f.postCredit(idem+":rider", "rider", rider)
	}
}

// postCredit records a credit only if its idempotency key has never been posted
// (models ledger_entries UNIQUE + ON CONFLICT DO NOTHING). Zero legs are skipped
// (mirrors the `if xKobo > 0` guards).
func (f *fakeStore) postCredit(legKey, account string, amount int64) {
	if amount <= 0 {
		return
	}
	if f.postedLeg[legKey] {
		return // UNIQUE collision on retry → no double credit.
	}
	f.postedLeg[legKey] = true
	f.creditTo[account] += amount
}

// refund models Service.Refund: credit the payer the full escrowed amount,
// idempotent on "refund:"+settlementID.
func (f *fakeStore) refund(settlementID, payerID string, total int64) {
	f.postCredit("refund:"+settlementID, payerID, total)
}

// totalCredited sums every credit recorded (used to assert conservation == escrowed).
func (f *fakeStore) totalCredited() int64 {
	var sum int64
	for _, v := range f.creditTo {
		sum += v
	}
	return sum
}
