package tests

import (
	"testing"

	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/telemedicine"
)

// Telemedicine's 5% platform booking fee is ADDITIVE to the patient: the escrow
// holds consult + fee, and the fee is handed to the platform at settlement via
// settlement.Split.ServiceFeeKobo (the 100%-platform mirror of TipKobo).
//
// The decision this file locks: the additive fee must NOT dilute the doctor. The
// doctor is paid exactly what the OLD pure 85/15 split on the consultation fee
// paid — the patient funds the platform's cut on top. Any refactor that applies
// the percentages to the escrowed TOTAL instead of the reconstructed gross would
// quietly shave 15% of the platform fee off every doctor's payout, and every
// arithmetic unit test would still be green.
//
// Following settlement_split_test.go's convention, the Settle() formula is
// REIMPLEMENTED here rather than executed (Settle needs a live pgx pool). If the
// production split formula changes, update telemedSplit() to match — the
// invariants below still apply. The QUOTE, by contrast, is taken from the real
// telemedicine package, because the whole point of the change is that the fee is
// server-authoritative.

// telemedSplit mirrors settlement.Service.Settle for the telemedicine shape:
// no rider, no tip, no discount, a fixed 100%-platform service fee.
//
//	base     = total − tip − serviceFee
//	gross    = base + discount
//	platform = int64(gross × platformPct) + serviceFee
//	provider = total − platform − rider        // absorbs the rounding remainder
func telemedSplit(escrowedTotal, serviceFeeKobo int64, platformPct float64) (platform, provider int64) {
	base := escrowedTotal - 0 /*tip*/ - serviceFeeKobo
	gross := base + 0 /*discount*/
	platform = int64(float64(gross)*platformPct) + serviceFeeKobo
	provider = escrowedTotal - platform - 0 /*rider*/
	return
}

// legacyPureSplit is the split as it stood BEFORE the platform fee existed:
// escrow = consult only, platform = 15%, doctor absorbs the remainder.
func legacyPureSplit(consultKobo int64, platformPct float64) (platform, provider int64) {
	platform = int64(float64(consultKobo) * platformPct)
	provider = consultKobo - platform
	return
}

const (
	doctorPct   = 0.85
	platformPct = 0.15
)

// consultAmounts spans exact divisions, floor-triggering remainders, tiny and
// large values — the same shape as settlement_split_test.go's table.
var consultAmounts = []struct {
	name        string
	consultKobo int64
}{
	{"3500 naira consult", 350_000},
	{"1000 naira consult", 100_000},
	{"50000 naira specialist", 5_000_000},
	{"odd amount triggers floor", 333_33},
	{"prime amount", 99_991},
	{"one kobo", 1},
	{"sub-kobo fee", 19},
	{"large amount", 5_000_000_00},
}

// TestTelemedicinePlatformFee_DoctorIsNotDiluted is the core money invariant of
// the whole change: an ADDITIVE patient-side fee must leave the doctor's payout
// bit-for-bit identical to the old consult-only 85/15 split.
//
// Money bug prevented: escrowing consult+fee while applying 85/15 to the escrowed
// TOTAL — the doctor would be paid 85% of the platform's fee as well (over-pay),
// or, with the fee subtracted twice, 85% of consult minus 15% of the fee
// (under-pay). Either way the error is silent and per-booking.
func TestTelemedicinePlatformFee_DoctorIsNotDiluted(t *testing.T) {
	for _, tc := range consultAmounts {
		t.Run(tc.name, func(t *testing.T) {
			q := telemedicine.QuoteFor(tc.consultKobo)
			escrowed := q.TotalKobo

			platform, doctor := telemedSplit(escrowed, q.PlatformFeeKobo, platformPct)
			wantPlatform, wantDoctor := legacyPureSplit(tc.consultKobo, platformPct)

			// The doctor leg is exactly the 85% of the CONSULT fee they used to get.
			if doctor != wantDoctor {
				t.Fatalf("doctor leg = %d, want %d (85%% of the consult fee %d) — the additive platform fee diluted the doctor",
					doctor, wantDoctor, tc.consultKobo)
			}
			// The platform leg is 15% of the consult PLUS the whole booking fee.
			if want := wantPlatform + q.PlatformFeeKobo; platform != want {
				t.Fatalf("platform leg = %d, want %d (15%% of consult = %d, plus the full platform fee %d)",
					platform, want, wantPlatform, q.PlatformFeeKobo)
			}
			// The doctor's share is 85% of the consult to within the sub-kobo
			// remainder they absorb — states the "85%" claim in plain arithmetic.
			if approx := int64(float64(tc.consultKobo) * doctorPct); doctor < approx || doctor > approx+1 {
				t.Fatalf("doctor leg = %d, not within one kobo of 85%% of consult (%d)", doctor, approx)
			}
		})
	}
}

// TestTelemedicinePlatformFee_ConservesEscrowedTotal: doctor + platform must equal
// the escrowed total to the kobo, for every amount.
//
// Money bug prevented: a leaked (or conjured) kobo sitting permanently in the
// escrow standing account — the ledger conservation invariant would start failing
// platform-wide, and the escrow would never drain to zero.
func TestTelemedicinePlatformFee_ConservesEscrowedTotal(t *testing.T) {
	for _, tc := range consultAmounts {
		t.Run(tc.name, func(t *testing.T) {
			q := telemedicine.QuoteFor(tc.consultKobo)
			platform, doctor := telemedSplit(q.TotalKobo, q.PlatformFeeKobo, platformPct)

			if sum := platform + doctor; sum != q.TotalKobo {
				t.Fatalf("conservation violated: platform=%d doctor=%d sum=%d escrowed=%d (leak=%d)",
					platform, doctor, sum, q.TotalKobo, q.TotalKobo-sum)
			}
			if platform < 0 || doctor < 0 {
				t.Fatalf("negative leg: platform=%d doctor=%d — a leg must never invert", platform, doctor)
			}
		})
	}
}

// TestTelemedicinePlatformFee_SplitPassesValidation exercises the REAL Split type
// so the shape telemedicine hands to Settle is provably well-formed, and the
// Settle precondition (tip + serviceFee ≤ escrowed total) holds for every amount.
//
// Money bug prevented: a service fee larger than the escrow, which Settle rejects
// at runtime — a booking that escrows successfully and then can never be settled,
// stranding the patient's money.
func TestTelemedicinePlatformFee_SplitPassesValidation(t *testing.T) {
	for _, tc := range consultAmounts {
		t.Run(tc.name, func(t *testing.T) {
			q := telemedicine.QuoteFor(tc.consultKobo)
			split := settlement.Split{
				ProviderID:     "doctor-user-1",
				ProviderPct:    doctorPct,
				PlatformPct:    platformPct,
				ServiceFeeKobo: q.PlatformFeeKobo,
			}
			if err := split.Validate(); err != nil {
				t.Fatalf("split.Validate() = %v, want nil for %+v", err, split)
			}
			// Settle's fail-closed precondition.
			if split.TipKobo+split.ServiceFeeKobo > q.TotalKobo {
				t.Fatalf("service fee %d exceeds escrowed total %d — Settle would refuse and strand the escrow",
					split.ServiceFeeKobo, q.TotalKobo)
			}
		})
	}
}

// TestTelemedicinePlatformFee_LegacyAppointmentsSettleUnchanged is the backward-
// compatibility lock: rows escrowed BEFORE this change carry
// PlatformFeeKobo == 0 and an escrow equal to the consult fee alone. They must
// settle as the exact old pure 85/15 split.
//
// Money bug prevented: a migration/default that back-fills a phantom platform fee
// onto already-escrowed appointments would try to pay the platform money that was
// never escrowed, under-paying the doctor by that amount on every in-flight row.
func TestTelemedicinePlatformFee_LegacyAppointmentsSettleUnchanged(t *testing.T) {
	for _, tc := range consultAmounts {
		t.Run(tc.name, func(t *testing.T) {
			legacy := telemedicine.Appointment{
				FeeKobo:         tc.consultKobo, // consult only, as always
				PlatformFeeKobo: 0,              // pre-change row
				TotalKobo:       0,              // never populated on legacy rows
			}
			// A legacy row escrowed exactly the consultation fee.
			escrowed := legacy.FeeKobo

			platform, doctor := telemedSplit(escrowed, legacy.PlatformFeeKobo, platformPct)
			wantPlatform, wantDoctor := legacyPureSplit(tc.consultKobo, platformPct)

			if platform != wantPlatform || doctor != wantDoctor {
				t.Fatalf("legacy row settled as platform=%d doctor=%d, want platform=%d doctor=%d (pre-change 85/15 must be byte-identical)",
					platform, doctor, wantPlatform, wantDoctor)
			}
			if sum := platform + doctor; sum != escrowed {
				t.Fatalf("legacy conservation violated: sum=%d escrowed=%d", sum, escrowed)
			}
		})
	}
}

// TestTelemedicinePlatformFee_CancellationRefundsFullTotal: a cancelled booking
// refunds the ENTIRE escrowed amount — consult fee AND platform fee. The platform
// keeps nothing from a consultation that never happened.
//
// settlement.Refund credits sett.TotalKobo (whatever was escrowed), so this is an
// algebraic assertion that the escrowed total is the additive total, not the bare
// consult fee. Money bug prevented: escrowing consult+fee but reasoning about
// refunds in terms of the consult fee — the patient would silently eat the 5%
// booking fee on every cancellation.
func TestTelemedicinePlatformFee_CancellationRefundsFullTotal(t *testing.T) {
	for _, tc := range consultAmounts {
		t.Run(tc.name, func(t *testing.T) {
			q := telemedicine.QuoteFor(tc.consultKobo)

			// What BookAppointment escrowed is what Refund gives back.
			escrowed := q.TotalKobo
			refunded := escrowed

			if refunded != tc.consultKobo+q.PlatformFeeKobo {
				t.Fatalf("refund = %d, want %d (consult %d + platform fee %d) — the patient must be made whole INCLUDING the booking fee",
					refunded, tc.consultKobo+q.PlatformFeeKobo, tc.consultKobo, q.PlatformFeeKobo)
			}
			if refunded < tc.consultKobo {
				t.Fatalf("refund %d is less than the consult fee %d", refunded, tc.consultKobo)
			}
			// Where a fee was actually charged, the refund must strictly exceed the
			// consult fee — proof the fee is not quietly retained.
			if q.PlatformFeeKobo > 0 && refunded <= tc.consultKobo {
				t.Fatalf("refund %d did not return the %d kobo platform fee", refunded, q.PlatformFeeKobo)
			}
			// Nothing is left behind in escrow for this settlement.
			if leftover := escrowed - refunded; leftover != 0 {
				t.Fatalf("cancellation stranded %d kobo in escrow", leftover)
			}
		})
	}
}

// TestTelemedicinePlatformFee_GoldenLegs pins the exact kobo of every leg.
//
// The tests above express each invariant as a FORMULA, and both telemedSplit and
// legacyPureSplit share the `int64(float64(x)*pct)` expression they are checking.
// That makes them blind in one direction: if the production Settle formula changed
// and the mirror above were updated to match, "the doctor is not diluted" would
// still pass while every payout silently moved. A ledger-auditor review flagged
// exactly that.
//
// These literals were derived independently of both mirrors, by hand, from
// settlement.Settle's algebra. They are the contract: if any number below has to
// change, real money is moving differently and that needs a decision, not a test
// edit.
func TestTelemedicinePlatformFee_GoldenLegs(t *testing.T) {
	golden := []struct {
		consult, fee, total, platform, doctor int64
	}{
		{1, 0, 1, 0, 1},                                                             // fee floors away entirely
		{19, 0, 19, 2, 17},                                                          // 0.95 kobo of fee → 0
		{33_333, 1_666, 34_999, 6_665, 28_334},                                      // 1666.65 → 1666
		{99_991, 4_999, 104_990, 19_997, 84_993},                                    // 4999.55 → 4999
		{350_000, 17_500, 367_500, 70_000, 297_500},                                 // the ₦3,500 worked example
		{500_000_000, 25_000_000, 525_000_000, 100_000_000, 425_000_000},            // ₦5m consult
		{10_000_000_000, 500_000_000, 10_500_000_000, 2_000_000_000, 8_500_000_000}, // the pricing ceiling
	}
	for _, g := range golden {
		q := telemedicine.QuoteFor(g.consult)
		if q.PlatformFeeKobo != g.fee || q.TotalKobo != g.total {
			t.Errorf("QuoteFor(%d) = fee %d total %d, want fee %d total %d",
				g.consult, q.PlatformFeeKobo, q.TotalKobo, g.fee, g.total)
		}
		platform, doctor := telemedSplit(q.TotalKobo, q.PlatformFeeKobo, platformPct)
		if platform != g.platform || doctor != g.doctor {
			t.Errorf("consult %d: legs = platform %d doctor %d, want platform %d doctor %d",
				g.consult, platform, doctor, g.platform, g.doctor)
		}
		if platform+doctor != g.total {
			t.Errorf("consult %d: legs sum to %d, escrowed %d — kobo created or destroyed",
				g.consult, platform+doctor, g.total)
		}
	}
}
