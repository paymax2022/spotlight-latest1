package telemedicine

import (
	"errors"
	"fmt"
)

// ErrQuoteMismatch is returned when the total a client quoted the patient
// disagrees with the server's own computation. The handler maps it to 409 so the
// app can re-read the doctor's quote instead of retrying a charge that would be
// wrong by construction.
var ErrQuoteMismatch = errors.New("telemedicine: booking quote is stale")

// PlatformFeeBp is the platform booking fee charged on a consultation, in basis
// points of the doctor's consultation fee (500 = 5%).
//
// This constant is the SINGLE authority for the rate. The mobile app used to carry
// its own copy and compute the fee client-side, which meant the wallet rail debited
// the consultation fee while the screen showed a higher total, and the card rail
// collected the difference with no ledger entry at all. The app now renders the
// quote this package returns and holds no rate of its own — see ADR-040.
const PlatformFeeBp = 500

// maxConsultFeeKobo bounds what this package will price. A consultation fee above
// ₦100,000,000 is data corruption, not a price, and pricing it risks overflowing
// the int64 total. Out-of-range fees produce an unpriceable quote (below) rather
// than a silently clamped one, so booking fails closed instead of charging a
// number nobody chose.
const maxConsultFeeKobo int64 = 10_000_000_000

// BookingQuote is the server-computed price breakdown for booking a consultation.
// It is what the client renders on the confirm screen and what BookAppointment
// escrows, so the amount displayed and the amount charged cannot diverge.
type BookingQuote struct {
	ConsultFeeKobo  int64 `json:"consult_fee_kobo"`
	PlatformFeeBp   int   `json:"platform_fee_bp"`
	PlatformFeeKobo int64 `json:"platform_fee_kobo"`
	TotalKobo       int64 `json:"total_kobo"`
}

// QuoteFor prices a consultation: the doctor's fee plus the platform booking fee.
//
// Money invariants held by every return value:
//   - integer arithmetic only, never floats (CLAUDE.md);
//   - the fee FLOORS — `c * bp / 10000` truncates, so a derived fee can never round
//     UP past its exact fraction and charge a kobo no rule entitles us to (this
//     mirrors restaurant.applyBp; the old client-side Math.round could round up);
//   - PlatformFeeKobo >= 0 and TotalKobo == ConsultFeeKobo + PlatformFeeKobo;
//   - no overflow: inputs that cannot be priced return the zero quote.
//
// A non-positive or out-of-range consultation fee yields a zero quote, which is
// unpriceable (see Priceable) and so cannot be mistaken for a free consultation.
func QuoteFor(consultFeeKobo int64) BookingQuote {
	return QuoteAt(consultFeeKobo, PlatformFeeBp)
}

// QuoteAt is QuoteFor at an explicit rate, used to honour the
// FEATURE_TELEMEDICINE_PLATFORM_FEE_ENABLED flag: the flag resolves to a rate of
// PlatformFeeBp when on and 0 when off, and a 0-bp quote is exactly the
// pre-ADR-040 behaviour — the patient pays the consultation fee alone and the
// booking escrows it alone. A negative rate is treated as 0 (never a discount).
func QuoteAt(consultFeeKobo int64, bp int) BookingQuote {
	if bp < 0 {
		bp = 0
	}
	if consultFeeKobo <= 0 || consultFeeKobo > maxConsultFeeKobo {
		return BookingQuote{PlatformFeeBp: bp}
	}
	feeKobo := consultFeeKobo * int64(bp) / 10000
	return BookingQuote{
		ConsultFeeKobo:  consultFeeKobo,
		PlatformFeeBp:   bp,
		PlatformFeeKobo: feeKobo,
		TotalKobo:       consultFeeKobo + feeKobo,
	}
}

// Priceable reports whether this quote represents a real, chargeable price.
// BookAppointment refuses to escrow an unpriceable quote — fail-closed, because a
// zero total would otherwise book a consultation for free.
func (q BookingQuote) Priceable() bool { return q.TotalKobo > 0 }

// validateExpectedTotal bounds the card rail. The Paystack gateway charges the
// amount the CLIENT computed, at the PSP, before this server escrows anything — so
// a client working from a stale quote (the doctor edited their fee after the
// confirm screen loaded) would put the charged and escrowed amounts back out of
// step, which is the exact defect ADR-040 removes.
//
// The client sends the total it quoted the patient. A disagreement rejects the
// booking before any money moves. Zero means the client did not quote a total
// (older clients), and skips the check rather than breaking them.
func validateExpectedTotal(expected, computed int64) error {
	if expected == 0 || expected == computed {
		return nil
	}
	return fmt.Errorf("%w: client quoted %d kobo, server computed %d kobo — re-read the doctor's booking quote",
		ErrQuoteMismatch, expected, computed)
}

// assertEscrowMatchesQuote guards the REPLAY path, which validateExpectedTotal
// cannot see.
//
// Escrow is idempotent on the Idempotency-Key: replaying a booking returns the
// settlement that already exists, escrowed at whatever the price was on the first
// attempt. But the quote is recomputed from the doctor's live consult_fee_kobo on
// every attempt, so a fee edit between attempts makes them disagree — and the
// appointment row is written from the quote. Recording a price that was never
// charged would put the patient's receipt, the platform's fee leg and the doctor's
// earnings figure all out of step with the money actually held in escrow.
//
// Unlike validateExpectedTotal there is no skip case: an escrowed amount always
// exists by the time this runs, so zero here means a broken settlement, not
// "unspecified".
func assertEscrowMatchesQuote(escrowedKobo, quotedKobo int64) error {
	if escrowedKobo == quotedKobo {
		return nil
	}
	return fmt.Errorf("%w: this booking was already escrowed for %d kobo, but now prices at %d kobo — start a new booking",
		ErrQuoteMismatch, escrowedKobo, quotedKobo)
}
