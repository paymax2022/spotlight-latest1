package commerce

import (
	"context"
	"testing"
)

// These tests are PURE — no DB, no pgx. They exercise the guarded state machines,
// PIN hashing/verification, the rail idempotency contract, request-hash determinism
// and the deterministic offline-sync classification. The DB-bound service methods
// (PayNow/Refund/Activate) are validated indirectly via the invariants their building
// blocks guarantee (single charge per idemKey, single entitlement, reversible refund,
// replay-safe sync) which the integration suite then asserts end-to-end against pgx.

// ── Purchase state machine: allowed + illegal transitions ───────────────────────

func TestCanOrder_AllowedTransitions(t *testing.T) {
	allowed := [][2]string{
		{OrderCart, OrderCheckout},
		{OrderCheckout, OrderPaid},
		{OrderCheckout, OrderBNPLActive},
		{OrderPaid, OrderEntitled},
		{OrderBNPLActive, OrderEntitled},
		{OrderEntitled, OrderRefunded},
	}
	for _, tr := range allowed {
		if !canOrder(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be allowed", tr[0], tr[1])
		}
	}
}

func TestCanOrder_IllegalTransitions(t *testing.T) {
	illegal := [][2]string{
		{OrderCart, OrderPaid},        // skip checkout
		{OrderCart, OrderEntitled},    // skip everything
		{OrderCheckout, OrderEntitled}, // skip payment
		{OrderPaid, OrderBNPLActive},  // cannot switch rail after paying
		{OrderRefunded, OrderEntitled}, // terminal
		{OrderRefunded, OrderRefunded}, // terminal self-loop
		{OrderEntitled, OrderPaid},    // backwards
		{"bogus", OrderCheckout},      // unknown source
	}
	for _, tr := range illegal {
		if canOrder(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be ILLEGAL", tr[0], tr[1])
		}
	}
}

// ── Access-card state machine ────────────────────────────────────────────────────

func TestCanCard_Transitions(t *testing.T) {
	if !canCard(CardIssued, CardActivated) {
		t.Error("issued→activated should be allowed (direct member activation)")
	}
	if !canCard(CardIssued, CardAllocated) {
		t.Error("issued→allocated should be allowed")
	}
	if !canCard(CardAllocated, CardActivated) {
		t.Error("allocated→activated should be allowed")
	}
	if canCard(CardActivated, CardActivated) {
		t.Error("activated→activated must be illegal (replay handled by idem, not SM)")
	}
	if canCard(CardVoid, CardActivated) {
		t.Error("void→activated must be illegal")
	}
	if canCard(CardActivated, CardAllocated) {
		t.Error("activated→allocated must be illegal (no going back)")
	}
}

// ── PIN hash / verify (access cards) ────────────────────────────────────────────

func TestPIN_VerifyRoundTrip(t *testing.T) {
	stored, err := hashPIN("123456")
	if err != nil {
		t.Fatalf("hashPIN: %v", err)
	}
	if stored == "123456" {
		t.Fatal("PIN stored in plaintext — must be hashed")
	}
	if !verifyPIN(stored, "123456") {
		t.Error("correct PIN should verify")
	}
	if verifyPIN(stored, "000000") {
		t.Error("wrong PIN must be rejected")
	}
	if verifyPIN("", "123456") {
		t.Error("empty stored hash must not verify")
	}
	if verifyPIN("nocolon", "123456") {
		t.Error("malformed stored hash must not verify")
	}
}

func TestPIN_SaltedUnique(t *testing.T) {
	a, _ := hashPIN("4242")
	b, _ := hashPIN("4242")
	if a == b {
		t.Error("same PIN should produce different stored hashes (random salt)")
	}
	if !verifyPIN(a, "4242") || !verifyPIN(b, "4242") {
		t.Error("both salted hashes must verify the same PIN")
	}
}

func TestRandomPIN_Length(t *testing.T) {
	p, err := randomPIN(6)
	if err != nil {
		t.Fatalf("randomPIN: %v", err)
	}
	if len(p) != 6 {
		t.Errorf("expected 6 digits, got %d (%q)", len(p), p)
	}
	for _, r := range p {
		if r < '0' || r > '9' {
			t.Errorf("non-digit in PIN: %q", p)
		}
	}
	// Default when n<=0.
	d, _ := randomPIN(0)
	if len(d) != 6 {
		t.Errorf("default PIN length should be 6, got %d", len(d))
	}
}

// ── Rail idempotency contract (no vendor leak) ──────────────────────────────────

func TestStubPaymentRail_IdempotentRef(t *testing.T) {
	r := StubPaymentRail{}
	ctx := context.Background()
	ref1, err := r.Charge(ctx, "user-1", "order-1", "idem-abc", 5000)
	if err != nil {
		t.Fatalf("charge: %v", err)
	}
	ref2, err := r.Charge(ctx, "user-1", "order-1", "idem-abc", 5000)
	if err != nil {
		t.Fatalf("charge replay: %v", err)
	}
	if ref1 != ref2 {
		t.Errorf("same idemKey must yield same ref: %q != %q", ref1, ref2)
	}
}

func TestStubBNPLRail_IdempotentRef(t *testing.T) {
	r := StubBNPLRail{}
	ctx := context.Background()
	ref1, _ := r.StartPlan(ctx, "u", "order-1", "idem-xyz", 9000)
	ref2, _ := r.StartPlan(ctx, "u", "order-1", "idem-xyz", 9000)
	if ref1 != ref2 {
		t.Errorf("BNPL idempotent ref mismatch: %q != %q", ref1, ref2)
	}
}

// requestHash binds an idemKey to its request body: same inputs → same hash,
// different inputs → different hash. This is what rejects key-reuse with a different
// body (ErrIdempotencyKeyReused) and accepts a true replay (PayNow idempotency:
// double call = one charge, one entitlement).
func TestRequestHash_Deterministic(t *testing.T) {
	a := requestHash(scopePayNow, "user-1", "order-1")
	b := requestHash(scopePayNow, "user-1", "order-1")
	if a != b {
		t.Error("requestHash must be deterministic for identical inputs")
	}
	c := requestHash(scopePayNow, "user-1", "order-2")
	if a == c {
		t.Error("requestHash must differ when the order changes (rejects key reuse)")
	}
	d := requestHash(scopeRefund, "order-1")
	if a == d {
		t.Error("different scopes must not collide")
	}
}

// ── Offline sync determinism / replay-safety ────────────────────────────────────

func TestClassifySync_KnownAndUnknown(t *testing.T) {
	for _, k := range []string{"progress", "attempt_queued", "reward_eligible"} {
		if got := classifySync(k); got != "accepted" {
			t.Errorf("kind %q: expected accepted, got %q", k, got)
		}
	}
	// Determinism: same input twice → same output.
	if classifySync("progress") != classifySync("progress") {
		t.Error("classifySync must be deterministic")
	}
	for _, k := range []string{"", "money_move", "bogus"} {
		if got := classifySync(k); got != "rejected" {
			t.Errorf("kind %q: expected rejected (server-authoritative), got %q", k, got)
		}
	}
}

// splitHash edge cases (verifyPIN relies on it).
func TestSplitHash(t *testing.T) {
	cases := []struct {
		in         string
		salt, dig  string
		ok         bool
	}{
		{"ab:cd", "ab", "cd", true},
		{":cd", "", "cd", false},
		{"ab:", "ab", "", false},
		{"nocolon", "", "", false},
		{"", "", "", false},
	}
	for _, tc := range cases {
		s, d, ok := splitHash(tc.in)
		if ok != tc.ok {
			t.Errorf("splitHash(%q) ok=%v want %v", tc.in, ok, tc.ok)
		}
		if ok && (s != tc.salt || d != tc.dig) {
			t.Errorf("splitHash(%q)=(%q,%q) want (%q,%q)", tc.in, s, d, tc.salt, tc.dig)
		}
	}
}

// pick (rail ref derivation) must prefer the idemKey so the synthetic ref is stable
// per idempotency key — the determinism guarantee the stub rails rely on.
func TestPick(t *testing.T) {
	if pick("idem", "ref") != "idem" {
		t.Error("pick must prefer the non-empty first arg (idemKey)")
	}
	if pick("", "ref") != "ref" {
		t.Error("pick must fall back to the second arg")
	}
}
