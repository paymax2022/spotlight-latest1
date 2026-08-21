package telemedicine

import (
	"errors"
	"testing"
)

// These lock the two guards a ledger-auditor review added to the ADR-044 work.
// Both defend the same money invariant from different sides: the amount the
// appointment RECORDS must equal the amount that was actually ESCROWED. Correct
// fee arithmetic does not give you that — the original implementation computed the
// fee perfectly and still recorded a price that was never charged on replay.

// assertEscrowMatchesQuote guards the idempotent-replay path.
//
// The bug it prevents: Escrow is idempotent on the Idempotency-Key, so a replay
// returns the settlement escrowed on the FIRST attempt, while BookAppointment
// recomputes the quote from the doctor's live consult_fee_kobo. If the doctor
// edited their fee in between, the appointment row would be written from the fresh
// quote against a settlement holding a different amount. Concretely: escrow holds
// 367_500 (₦3,500 consult), the doctor raises to ₦5,000, the replay records
// fee 500_000 / platform 25_000 / total 525_000. The patient's receipt claims
// 525_000 for a 367_500 charge; Settle then books a 25_000 platform fee against an
// escrow that only ever received 17_500 of fee; and the doctor's dashboard reports
// 425_000 earned against an actual payout of 291_125 — short by 133_875 kobo.
func TestAssertEscrowMatchesQuote(t *testing.T) {
	cases := []struct {
		name             string
		escrowed, quoted int64
		wantErr          bool
	}{
		{"first attempt — quote is what was escrowed", 367_500, 367_500, false},
		{"replay after the doctor raised their fee", 367_500, 525_000, true},
		{"replay after the doctor lowered their fee", 367_500, 210_000, true},
		{"off by a single kobo is still a mismatch", 367_500, 367_501, true},
		// No skip case: unlike the client-supplied expected total, an escrowed
		// amount always exists here. Zero means a broken settlement, and treating
		// it as "unspecified" would record a real price against no money at all.
		{"zero escrow is not a free pass", 0, 367_500, true},
		{"zero on both sides is not a booking but is not a mismatch", 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := assertEscrowMatchesQuote(tc.escrowed, tc.quoted)
			if tc.wantErr && err == nil {
				t.Fatalf("escrowed=%d quoted=%d: expected a mismatch error, got nil — the appointment would record a price that was never charged",
					tc.escrowed, tc.quoted)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("escrowed=%d quoted=%d: unexpected error %v", tc.escrowed, tc.quoted, err)
			}
			// The handler maps this to 409 so the client re-quotes instead of
			// retrying an amount that is wrong by construction.
			if tc.wantErr && !errors.Is(err, ErrQuoteMismatch) {
				t.Fatalf("error must wrap ErrQuoteMismatch so the handler can return 409, got %v", err)
			}
		})
	}
}

// The two guards are deliberately NOT the same function. validateExpectedTotal
// skips when the client sent nothing (older clients must keep working);
// assertEscrowMatchesQuote never skips (the escrow always exists). Collapsing them
// would either break old clients or open a hole where a zero escrow silently
// accepts any quote.
func TestGuardsDifferOnZero(t *testing.T) {
	if err := validateExpectedTotal(0, 367_500); err != nil {
		t.Fatalf("a client that quoted nothing must still be able to book, got %v", err)
	}
	if err := assertEscrowMatchesQuote(0, 367_500); err == nil {
		t.Fatal("a zero escrow must never accept a non-zero quote — that records a price against money that never moved")
	}
}
