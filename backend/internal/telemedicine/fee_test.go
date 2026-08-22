package telemedicine

import (
	"encoding/json"
	"math"
	"testing"
)

// ─────────────────────────────────────────────────────────────────────────────
// Server-authoritative 5% platform booking fee (additive to the patient).
//
// These are PURE tests — no DB, no clock, no settlement service. They pin the
// quote arithmetic that every telemedicine booking is priced with:
//
//	platformFee = floor(consultFeeKobo × PlatformFeeBp / 10000)
//	total       = consultFeeKobo + platformFee
//
// The money bugs this file exists to prevent:
//   - a float-derived fee that rounds UP and over-charges the patient by a kobo,
//   - a fee the CLIENT computes (a compromised/stale app could quote ₦0 fee and
//     the card rail would charge that amount),
//   - overflow / sign inversion on extreme amounts,
//   - `FeeKobo` silently changing meaning (the doctor-earnings queries do
//     SUM(fee_kobo * 0.85) and would over-pay if the platform fee leaked into it).
//
// package telemedicine (not telemedicine_test) so validateExpectedTotal, an
// unexported guard, is reachable.
// ─────────────────────────────────────────────────────────────────────────────

// exactFeeNumerator is the fee's exact rational numerator over 10000:
// consultFeeKobo × PlatformFeeBp. Used to prove FLOOR semantics without floats.
func exactFeeNumerator(consultFeeKobo int64) int64 {
	return consultFeeKobo * int64(PlatformFeeBp)
}

// TestPlatformFeeBpIsFivePercent pins the rate itself. Money bug prevented: a
// silent rate change (500 -> 5000) would multiply every patient's fee by 10x
// with no other test failing.
func TestPlatformFeeBpIsFivePercent(t *testing.T) {
	if PlatformFeeBp != 500 {
		t.Fatalf("PlatformFeeBp = %d, want 500 (5%% in basis points)", PlatformFeeBp)
	}
}

// TestQuoteFor_KnownAmounts locks the exact kobo for representative consult fees,
// including several where the floor actually bites. Money bug prevented: a
// rounding change that over-charges the patient (or under-collects the platform)
// by a kobo on every single booking.
func TestQuoteFor_KnownAmounts(t *testing.T) {
	cases := []struct {
		name        string
		consultKobo int64
		wantFee     int64
		wantTotal   int64
	}{
		// ₦3,500 consult — the canonical case from the ADR.
		{"3500 naira consult", 350_000, 17_500, 367_500},
		// ₦333.33 — 16666650/10000 = 1666.665, floors to 1666 (NOT 1667).
		{"odd amount floors down", 333_33, 1_666, 34_999},
		// 1 kobo — 500/10000 = 0.05, floors to 0. Fee must not become 1.
		{"one kobo consult", 1, 0, 1},
		// 19 kobo — 9500/10000 = 0.95, floors to 0. The classic round-up trap.
		{"sub-kobo fee floors to zero", 19, 0, 19},
		// 99991 kobo — 49995500/10000 = 4999.55, floors to 4999.
		{"prime amount", 99_991, 4_999, 104_990},
		// 200 kobo — exact, no remainder.
		{"exact division", 200, 10, 210},
		// ₦1,000 consult — exact.
		{"1000 naira consult", 100_000, 5_000, 105_000},
		// ₦50,000 consult (specialist) — exact.
		{"50000 naira consult", 5_000_000, 250_000, 5_250_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := QuoteFor(tc.consultKobo)
			if q.ConsultFeeKobo != tc.consultKobo {
				t.Errorf("ConsultFeeKobo = %d, want %d (the quote must echo the consult fee unchanged)", q.ConsultFeeKobo, tc.consultKobo)
			}
			if q.PlatformFeeBp != PlatformFeeBp {
				t.Errorf("PlatformFeeBp = %d, want %d (the quote must disclose the rate it charged)", q.PlatformFeeBp, PlatformFeeBp)
			}
			if q.PlatformFeeKobo != tc.wantFee {
				t.Errorf("PlatformFeeKobo = %d, want %d", q.PlatformFeeKobo, tc.wantFee)
			}
			if q.TotalKobo != tc.wantTotal {
				t.Errorf("TotalKobo = %d, want %d", q.TotalKobo, tc.wantTotal)
			}
		})
	}
}

// TestQuoteFor_FloorsNeverRoundsUp proves, purely in integer arithmetic, that the
// fee is the FLOOR of the exact rational fraction: fee ≤ consult×bp/10000 <
// fee+1. Money bug prevented: any float/round/ceil implementation that charges
// the patient a kobo more than the disclosed 5%.
func TestQuoteFor_FloorsNeverRoundsUp(t *testing.T) {
	amounts := []int64{
		1, 19, 99, 100, 199, 200, 333_33, 350_000, 99_991, 1_000_003, 123_456_789,
	}
	for _, c := range amounts {
		q := QuoteFor(c)
		num := exactFeeNumerator(c) // consult × 500

		// Lower bound: fee never exceeds the exact fraction (never rounds UP).
		if q.PlatformFeeKobo*10000 > num {
			t.Errorf("consult=%d: fee %d exceeds the exact fraction %d/10000 — fee rounded UP", c, q.PlatformFeeKobo, num)
		}
		// Upper bound: fee is the LARGEST such whole kobo (never truncates further).
		if (q.PlatformFeeKobo+1)*10000 <= num {
			t.Errorf("consult=%d: fee %d is more than one kobo below the exact fraction %d/10000 — fee under-collected", c, q.PlatformFeeKobo, num)
		}
	}
}

// TestQuoteFor_TotalIsAlwaysSumOfParts is the additive invariant: the patient is
// charged exactly consult + fee, never a third number. Money bug prevented: a
// total that silently diverges from its own breakdown, so the receipt and the
// card charge disagree.
func TestQuoteFor_TotalIsAlwaysSumOfParts(t *testing.T) {
	amounts := []int64{
		0, -1, -350_000, 1, 19, 333_33, 350_000, 99_991, 5_000_000, math.MaxInt64 / 10000,
	}
	for _, c := range amounts {
		q := QuoteFor(c)
		if q.PlatformFeeKobo < 0 {
			t.Errorf("consult=%d: PlatformFeeKobo = %d, must never be negative (a negative fee would CREDIT the patient at settlement)", c, q.PlatformFeeKobo)
		}
		if q.TotalKobo != q.ConsultFeeKobo+q.PlatformFeeKobo {
			t.Errorf("consult=%d: TotalKobo = %d, want ConsultFeeKobo(%d)+PlatformFeeKobo(%d)=%d",
				c, q.TotalKobo, q.ConsultFeeKobo, q.PlatformFeeKobo, q.ConsultFeeKobo+q.PlatformFeeKobo)
		}
	}
}

// TestQuoteFor_NonPositiveConsultIsUnpriceable covers zero and negative consult
// fees. Money bug prevented: a corrupt (negative) consult row producing a phantom
// fee, a negative fee that inverts the platform leg at settlement, or a negative
// TOTAL reaching Escrow — a negative escrow debit is a credit, i.e. minting money
// for the patient. The quote must collapse to an unpriceable zero so booking fails
// closed instead of charging a number nobody chose.
func TestQuoteFor_NonPositiveConsultIsUnpriceable(t *testing.T) {
	for _, c := range []int64{0, -1, -350_000, math.MinInt64 / 10000} {
		q := QuoteFor(c)
		if q.PlatformFeeKobo != 0 {
			t.Errorf("consult=%d: PlatformFeeKobo = %d, want 0 (non-positive consult fee must never be charged a platform fee)", c, q.PlatformFeeKobo)
		}
		if q.TotalKobo != 0 {
			t.Errorf("consult=%d: TotalKobo = %d, want 0 (a non-positive consult must never yield an escrowable total)", c, q.TotalKobo)
		}
		if q.Priceable() {
			t.Errorf("consult=%d: quote reports itself priceable (%+v) — booking must fail closed", c, q)
		}
	}
}

// TestQuoteFor_ExtremeConsultDoesNotOverflow guards the multiply-then-divide
// order at the top of the range. Money bug prevented: `consult × 500` overflowing
// int64 wraps the fee to a huge NEGATIVE number, which would sail past a naive
// `fee >= 0` check downstream and invert the escrow. The implementation refuses to
// price anything above maxConsultFeeKobo, so the requirement is: never overflow,
// never a negative fee, never a wrapped total — fail closed instead.
func TestQuoteFor_ExtremeConsultDoesNotOverflow(t *testing.T) {
	extremes := []int64{
		maxConsultFeeKobo + 1,
		math.MaxInt64 / 10000, // widest input a bp helper is ever asked to survive
		math.MaxInt64 / 500,
		math.MaxInt64,
	}
	for _, c := range extremes {
		q := QuoteFor(c)
		if q.PlatformFeeKobo < 0 {
			t.Errorf("consult=%d: fee overflowed to %d (negative)", c, q.PlatformFeeKobo)
		}
		if q.TotalKobo < 0 {
			t.Errorf("consult=%d: TotalKobo wrapped to %d (negative) — overflow", c, q.TotalKobo)
		}
		if q.Priceable() {
			t.Errorf("consult=%d: out-of-range fee produced a chargeable quote %+v — must fail closed", c, q)
		}
	}
}

// TestQuoteFor_PricingCeilingBoundary pins the exact cap. Money bug prevented: an
// off-by-one at the ceiling either refusing a legitimate top-of-range consultation
// (booking outage) or admitting an unbounded fee that the ceiling exists to stop.
func TestQuoteFor_PricingCeilingBoundary(t *testing.T) {
	atCap := QuoteFor(maxConsultFeeKobo)
	if !atCap.Priceable() {
		t.Fatalf("consult at the cap (%d) must still be priceable, got %+v", maxConsultFeeKobo, atCap)
	}
	wantFee := maxConsultFeeKobo * int64(PlatformFeeBp) / 10000
	if atCap.PlatformFeeKobo != wantFee || atCap.TotalKobo != maxConsultFeeKobo+wantFee {
		t.Fatalf("quote at the cap = %+v, want fee %d / total %d", atCap, wantFee, maxConsultFeeKobo+wantFee)
	}
	if over := QuoteFor(maxConsultFeeKobo + 1); over.Priceable() {
		t.Fatalf("consult one kobo over the cap produced a chargeable quote %+v", over)
	}
}

// TestValidateExpectedTotal_RejectsClientMismatch is the card-rail guard. The
// mobile client charges the card the amount IT computed; if that disagrees with
// the server's authoritative quote the booking must be refused BEFORE any money
// moves. Money bug prevented: a stale or tampered client quoting ₦0 platform fee
// (or an inflated one), charging the patient one amount and escrowing another.
func TestValidateExpectedTotal_RejectsClientMismatch(t *testing.T) {
	cases := []struct {
		name       string
		expected   int64 // what the client quoted
		computed   int64 // what the server computed
		wantReject bool
	}{
		{"client did not quote (zero = opt out)", 0, 367_500, false},
		{"client agrees exactly", 367_500, 367_500, false},
		{"client omitted the platform fee", 350_000, 367_500, true},
		{"client is one kobo low", 367_499, 367_500, true},
		{"client is one kobo high", 367_501, 367_500, true},
		{"client quotes a stale (cheaper) doctor price", 105_000, 367_500, true},
		{"client quotes a negative total", -367_500, 367_500, true},
		{"both zero (free consult, client agrees)", 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateExpectedTotal(tc.expected, tc.computed)
			if tc.wantReject && err == nil {
				t.Fatalf("validateExpectedTotal(%d, %d) = nil, want an error — a mismatched client total must block the booking before escrow",
					tc.expected, tc.computed)
			}
			if !tc.wantReject && err != nil {
				t.Fatalf("validateExpectedTotal(%d, %d) = %v, want nil", tc.expected, tc.computed, err)
			}
		})
	}
}

// TestBookAppointmentRequest_CarriesExpectedTotal pins the request wire field the
// guard reads. Money bug prevented: the field being dropped from the DTO (as
// happened with restaurant PlaceOrder's promo/surge fields), which would silently
// disable the card-rail mismatch guard while every other test still passes.
func TestBookAppointmentRequest_CarriesExpectedTotal(t *testing.T) {
	var req BookAppointmentRequest
	if err := json.Unmarshal([]byte(`{"doctor_id":"doc-1","idempotency_key":"k1","expected_total_kobo":367500}`), &req); err != nil {
		t.Fatalf("unmarshal BookAppointmentRequest: %v", err)
	}
	if req.ExpectedTotalKobo != 367_500 {
		t.Fatalf("ExpectedTotalKobo = %d, want 367500 (json tag must be expected_total_kobo)", req.ExpectedTotalKobo)
	}
}

// TestAppointment_FeeKoboStaysConsultOnly locks the field semantics on the wire.
// FeeKobo must keep meaning "consultation fee only" because the doctor-earnings
// queries compute SUM(fee_kobo * 0.85); the additive platform fee lives in its
// own column. Money bug prevented: folding the platform fee into fee_kobo would
// pay every doctor 85% of the PLATFORM's cut too, on every historical row.
func TestAppointment_FeeKoboStaysConsultOnly(t *testing.T) {
	appt := Appointment{
		FeeKobo:         350_000, // consultation only
		PlatformFeeKobo: 17_500,
		TotalKobo:       367_500,
	}
	if appt.FeeKobo+appt.PlatformFeeKobo != appt.TotalKobo {
		t.Fatalf("FeeKobo(%d)+PlatformFeeKobo(%d) != TotalKobo(%d)", appt.FeeKobo, appt.PlatformFeeKobo, appt.TotalKobo)
	}
	blob, err := json.Marshal(appt)
	if err != nil {
		t.Fatalf("marshal Appointment: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(blob, &wire); err != nil {
		t.Fatalf("unmarshal Appointment wire: %v", err)
	}
	for key, want := range map[string]float64{
		"fee_kobo":          350_000,
		"platform_fee_kobo": 17_500,
		"total_kobo":        367_500,
	} {
		got, ok := wire[key]
		if !ok {
			t.Errorf("appointment JSON is missing %q", key)
			continue
		}
		if got.(float64) != want {
			t.Errorf("appointment JSON %q = %v, want %v", key, got, want)
		}
	}
}

// TestDoctor_BookingQuoteIsOptional pins the doctor-detail wire contract: the
// server-computed quote rides along so the app never derives the fee itself, and
// it is omitted (not null-priced) when absent. Money bug prevented: the app
// falling back to its own hard-coded 5% and drifting from the server.
func TestDoctor_BookingQuoteIsOptional(t *testing.T) {
	q := QuoteFor(350_000)
	d := Doctor{ConsultFeeKobo: 350_000, Booking: &q}
	blob, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("marshal Doctor: %v", err)
	}
	var wire struct {
		Booking *BookingQuote `json:"booking"`
	}
	if err := json.Unmarshal(blob, &wire); err != nil {
		t.Fatalf("unmarshal Doctor wire: %v", err)
	}
	if wire.Booking == nil {
		t.Fatalf("doctor JSON dropped the booking quote")
	}
	if wire.Booking.TotalKobo != 367_500 || wire.Booking.PlatformFeeKobo != 17_500 {
		t.Fatalf("booking quote on the wire = %+v, want fee 17500 / total 367500", *wire.Booking)
	}

	// With no quote attached the key must be absent entirely (omitempty), so a
	// client can distinguish "no quote" from "quote of zero".
	bare, err := json.Marshal(Doctor{ConsultFeeKobo: 350_000})
	if err != nil {
		t.Fatalf("marshal bare Doctor: %v", err)
	}
	var bareWire map[string]any
	if err := json.Unmarshal(bare, &bareWire); err != nil {
		t.Fatalf("unmarshal bare Doctor: %v", err)
	}
	if _, present := bareWire["booking"]; present {
		t.Fatalf("doctor JSON emitted %q with no quote attached — must be omitempty", "booking")
	}
}
