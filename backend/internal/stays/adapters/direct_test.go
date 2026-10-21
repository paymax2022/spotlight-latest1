package adapters

import (
	"errors"
	"testing"
	"time"
)

// TestHasHeadroom pins the oversell guard arithmetic (sold + rooms <= total) that
// the DB enforces under a row lock. This is the invariant that makes the direct
// rail oversell-impossible; a regression here would silently allow overselling.
func TestHasHeadroom(t *testing.T) {
	cases := []struct {
		name               string
		sold, rooms, total int
		want               bool
	}{
		{"exact fit", 8, 2, 10, true},
		{"headroom to spare", 3, 1, 10, true},
		{"empty inventory sells first room", 0, 1, 1, true},
		{"one over the top", 9, 2, 10, false},
		{"sold out, request one", 10, 1, 10, false},
		{"no inventory at all", 0, 1, 0, false},
		{"zero rooms is invalid", 5, 0, 10, false},
		{"negative rooms is invalid", 5, -1, 10, false},
		{"negative sold is invalid", -1, 1, 10, false},
		{"large block exact fit", 0, 25, 25, true},
		{"large block over by one", 0, 26, 25, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := hasHeadroom(c.sold, c.rooms, c.total); got != c.want {
				t.Fatalf("hasHeadroom(sold=%d, rooms=%d, total=%d) = %v, want %v",
					c.sold, c.rooms, c.total, got, c.want)
			}
		})
	}
}

// TestNightsBetween verifies the stay-night expansion: [check_in, check_out) with
// the check-out date excluded (it is not an occupied night). A wrong night set
// would lock/decrement the wrong availability rows.
func TestNightsBetween(t *testing.T) {
	d := func(s string) time.Time {
		t.Helper()
		v, err := time.Parse("2006-01-02", s)
		if err != nil {
			t.Fatalf("parse %q: %v", s, err)
		}
		return v
	}
	t.Run("three-night stay", func(t *testing.T) {
		got := nightsBetween(d("2026-09-10"), d("2026-09-13"))
		want := []string{"2026-09-10", "2026-09-11", "2026-09-12"}
		assertNights(t, got, want)
	})
	t.Run("single night", func(t *testing.T) {
		got := nightsBetween(d("2026-09-10"), d("2026-09-11"))
		assertNights(t, got, []string{"2026-09-10"})
	})
	t.Run("same day is zero nights", func(t *testing.T) {
		if got := nightsBetween(d("2026-09-10"), d("2026-09-10")); len(got) != 0 {
			t.Fatalf("expected 0 nights, got %v", got)
		}
	})
	t.Run("inverted range is zero nights", func(t *testing.T) {
		if got := nightsBetween(d("2026-09-13"), d("2026-09-10")); len(got) != 0 {
			t.Fatalf("expected 0 nights for inverted range, got %v", got)
		}
	})
}

// TestBookTokenRoundTrip verifies the availability context survives the encode/
// decode that carries it from Prebook to Book (which has no dates on its request).
func TestBookTokenRoundTrip(t *testing.T) {
	in := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	out := time.Date(2026, 9, 13, 0, 0, 0, 0, time.UTC)
	tok := encodeBookToken("room-uuid-123", in, out, 2, time.Now().Add(bookTokenTTL))

	rt, ci, co, rooms, err := decodeBookToken(tok)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if rt != "room-uuid-123" {
		t.Fatalf("room_type_id = %q, want room-uuid-123", rt)
	}
	if !ci.Equal(in) || !co.Equal(out) {
		t.Fatalf("dates = %s..%s, want %s..%s", ci, co, in, out)
	}
	if rooms != 2 {
		t.Fatalf("rooms = %d, want 2", rooms)
	}

	if _, _, _, _, err := decodeBookToken("garbage"); err == nil {
		t.Fatal("expected error decoding malformed token")
	}
	if _, _, _, _, err := decodeBookToken("bedbank:v1:x:2026-09-10:2026-09-11:1:nonce"); err == nil {
		t.Fatal("expected error decoding foreign-prefix token")
	}
}

// TestBookTokenExpiryEnforced pins PAY-011: the advertised 10-minute hold expiry
// is enforced at consume time — a stale token refuses rather than capturing at
// the old price, and pre-v2 (timestamp-less) tokens are malformed.
func TestBookTokenExpiryEnforced(t *testing.T) {
	in := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	out := time.Date(2026, 9, 13, 0, 0, 0, 0, time.UTC)
	mint := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	tok := encodeBookToken("rt-1", in, out, 1, mint.Add(bookTokenTTL))

	if _, _, _, _, err := decodeBookTokenAt(tok, mint.Add(bookTokenTTL-time.Second)); err != nil {
		t.Fatalf("token inside TTL refused: %v", err)
	}
	if _, _, _, _, err := decodeBookTokenAt(tok, mint.Add(bookTokenTTL)); !errors.Is(err, ErrBookTokenExpired) {
		t.Fatalf("expired token: err = %v, want ErrBookTokenExpired", err)
	}
	if _, _, _, _, err := decodeBookTokenAt(tok, mint.Add(24*time.Hour)); !errors.Is(err, ErrBookTokenExpired) {
		t.Fatalf("stale token: err = %v, want ErrBookTokenExpired", err)
	}
	// v1 (no expiry segment) is rejected as malformed — the TTL must be bound.
	if _, _, _, _, err := decodeBookToken("direct:v1:rt-1:2026-09-10:2026-09-13:1:nonce"); err == nil {
		t.Fatal("v1 book_token must be refused — it carries no enforceable expiry")
	}
	// Forged expiry strings are rejected, not silently zeroed.
	if _, _, _, _, err := decodeBookToken("direct:v2:rt-1:2026-09-10:2026-09-13:1:notanumber:x"); err == nil {
		t.Fatal("bad expiry must fail")
	}
}

// TestComputePolicyRefundCutoff pins MOD-002: an explicit free-cancel deadline in
// the policy snapshot splits inside-window (full refund) from past-cutoff
// (penalty schedule); no declared deadline keeps the legacy always-penalty path.
func TestComputePolicyRefundCutoff(t *testing.T) {
	const gross = int64(50_000_00)
	checkIn := time.Date(2026, 12, 10, 0, 0, 0, 0, time.UTC)
	deadline := checkIn.Add(-48 * time.Hour) // 48h before check-in

	cases := []struct {
		name                    string
		policy                  map[string]any
		now                     time.Time
		wantRefund, wantPenalty int64
	}{
		{"hours-window inside → full refund despite penalty keys",
			map[string]any{"refundable": true, "free_cancel_hours_before_checkin": float64(48), "penalty_percent": float64(50)},
			deadline.Add(-time.Minute), gross, 0},
		{"hours-window past cutoff → penalty applies",
			map[string]any{"refundable": true, "free_cancel_hours_before_checkin": float64(48), "penalty_percent": float64(50)},
			deadline.Add(time.Minute), gross - gross/2, gross / 2},
		{"absolute deadline inside → full refund",
			map[string]any{"refundable": true, "free_cancel_deadline_at": deadline.Format(time.RFC3339), "penalty_kobo": float64(10_000_00)},
			deadline.Add(-time.Hour), gross, 0},
		{"absolute deadline past → penalty_kobo",
			map[string]any{"refundable": true, "free_cancel_deadline_at": deadline.Format(time.RFC3339), "penalty_kobo": float64(10_000_00)},
			deadline.Add(time.Hour), gross - 10_000_00, 10_000_00},
		{"no deadline key → penalty always in effect (legacy)",
			map[string]any{"refundable": true, "penalty_percent": float64(50)},
			deadline.Add(-time.Hour), gross - gross/2, gross / 2},
		{"malformed deadline → legacy penalty path",
			map[string]any{"refundable": true, "free_cancel_deadline_at": "not-a-date", "penalty_percent": float64(50)},
			deadline.Add(-time.Hour), gross - gross/2, gross / 2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotR, gotP := computePolicyRefund(gross, true, c.policy, checkIn, c.now)
			if gotR != c.wantRefund || gotP != c.wantPenalty {
				t.Fatalf("= (%d,%d), want (%d,%d)", gotR, gotP, c.wantRefund, c.wantPenalty)
			}
			if gotR+gotP != gross {
				t.Fatalf("refund+penalty %d+%d != gross %d", gotR, gotP, gross)
			}
		})
	}
}

// TestDeriveSupplierRefStable verifies a retried Book with the same idempotency key
// maps to the same supplier ref (so the decrement ledger keys on it idempotently).
func TestDeriveSupplierRefStable(t *testing.T) {
	a := deriveSupplierRef("idem-key-abc")
	b := deriveSupplierRef("idem-key-abc")
	if a != b {
		t.Fatalf("expected stable ref for same key: %q vs %q", a, b)
	}
	if c := deriveSupplierRef("idem-key-xyz"); c == a {
		t.Fatal("expected different ref for different key")
	}
	if deriveSupplierRef("") == deriveSupplierRef("") {
		t.Fatal("empty key should produce a random (non-equal) ref")
	}
}

// TestComputePolicyRefund pins the direct-rail cancellation refund semantics —
// the (refund, penalty) the booked policy allows.
func TestComputePolicyRefund(t *testing.T) {
	const gross = 50_000_00 // ₦50,000
	cases := []struct {
		name                    string
		gross                   int64
		refundable              bool
		policy                  map[string]any
		wantRefund, wantPenalty int64
	}{
		{"refundable, empty snapshot → full refund", gross, true, map[string]any{}, gross, 0},
		{"refundable, nil snapshot → full refund", gross, true, nil, gross, 0},
		{"non-refundable plan flag → zero refund, full penalty", gross, false, map[string]any{}, 0, gross},
		{"snapshot refundable=false overrides plan flag", gross, true, map[string]any{"refundable": false}, 0, gross},
		{"snapshot refundable=true overrides plan flag", gross, false, map[string]any{"refundable": true}, gross, 0},
		{"explicit penalty_kobo", gross, true, map[string]any{"penalty_kobo": float64(5_000_00)}, gross - 5_000_00, 5_000_00},
		{"penalty_bps (25%)", gross, true, map[string]any{"penalty_bps": float64(2500)}, gross - gross/4, gross / 4},
		{"penalty_percent (10%)", gross, true, map[string]any{"penalty_percent": float64(10)}, gross - gross/10, gross / 10},
		{"penalty_kobo wins over bps/percent", gross, true, map[string]any{"penalty_kobo": float64(1_000_00), "penalty_bps": float64(5000), "penalty_percent": float64(50)}, gross - 1_000_00, 1_000_00},
		{"penalty clamps at gross (never negative refund)", gross, true, map[string]any{"penalty_kobo": float64(99_000_00)}, 0, gross},
		{"penalty clamps at zero (never negative penalty)", gross, true, map[string]any{"penalty_kobo": float64(-1)}, gross, 0},
		{"zero gross → zero refund/penalty", 0, true, map[string]any{}, 0, 0},
		{"non-refundable zero gross → zero", 0, false, map[string]any{}, 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotR, gotP := computePolicyRefund(c.gross, c.refundable, c.policy, time.Time{}, time.Now())
			if gotR != c.wantRefund || gotP != c.wantPenalty {
				t.Fatalf("computePolicyRefund(%d, %v, %v) = (%d,%d), want (%d,%d)",
					c.gross, c.refundable, c.policy, gotR, gotP, c.wantRefund, c.wantPenalty)
			}
			// Invariant: refund + penalty == gross.
			if c.gross > 0 && gotR+gotP != c.gross {
				t.Fatalf("refund+penalty %d+%d != gross %d", gotR, gotP, c.gross)
			}
		})
	}
}

func assertNights(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("nights = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("nights[%d] = %q, want %q (full: %v)", i, got[i], want[i], got)
		}
	}
}
