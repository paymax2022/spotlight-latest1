// Package healthcoverage is a pure, deterministic health-billing coverage engine:
// it splits a charge into the insurer-covered amount and the patient's
// out-of-pocket (copay + deductible + coinsurance), in integer minor units (kobo)
// with no floats and exact value conservation (test plan PM-002/PM-007).
//
// The health payment path is escrow full-pay today; this is the split math health
// billing applies once insurance eligibility is wired. The claim-adjudication
// lifecycle (PM-003) lives in the separate internal/insurance/claims module.
package healthinsurance

// Policy is a patient's coverage terms for a charge.
type Policy struct {
	CoveragePercent int   // insurer's coinsurance share of the covered remainder (0..100)
	CopayKobo       int64 // fixed patient copay applied first
	DeductibleKobo  int64 // patient pays up to this (remaining deductible) before coinsurance
	CoverageCapKobo int64 // max the insurer will cover for this charge (0 = uncapped)
}

// Split is the computed breakdown. Invariants (guaranteed by construction):
//   - InsurerKobo + PatientKobo == ChargeKobo (value conservation, PM-007)
//   - CopayKobo + DeductibleKobo + CoinsuranceKobo == PatientKobo
type Split struct {
	ChargeKobo      int64 `json:"chargeKobo"`
	InsurerKobo     int64 `json:"insurerKobo"`
	PatientKobo     int64 `json:"patientKobo"`
	CopayKobo       int64 `json:"copayKobo"`
	DeductibleKobo  int64 `json:"deductibleKobo"`
	CoinsuranceKobo int64 `json:"coinsuranceKobo"`
}

// Compute splits `charge` per the policy. Order of application: fixed copay
// (patient) → deductible (patient) → the insurer covers CoveragePercent of the
// remainder up to the cap, patient pays the coinsurance and any over-cap. The
// patient absorbs the rounding remainder so the split always reconciles exactly.
func Compute(charge int64, p Policy) Split {
	if charge <= 0 {
		return Split{}
	}
	pct := p.CoveragePercent
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}

	copay := clamp(p.CopayKobo, 0, charge)
	afterCopay := charge - copay

	deductible := clamp(p.DeductibleKobo, 0, afterCopay)
	coverable := afterCopay - deductible

	// Insurer's coinsurance share of the covered remainder (integer floor), then cap.
	insurer := coverable * int64(pct) / 100
	if p.CoverageCapKobo > 0 && insurer > p.CoverageCapKobo {
		insurer = p.CoverageCapKobo
	}

	// Patient absorbs the rest (coinsurance + over-cap + rounding), so
	// insurer + patient == charge exactly.
	coinsurance := coverable - insurer
	return Split{
		ChargeKobo:      charge,
		InsurerKobo:     insurer,
		PatientKobo:     copay + deductible + coinsurance,
		CopayKobo:       copay,
		DeductibleKobo:  deductible,
		CoinsuranceKobo: coinsurance,
	}
}

func clamp(v, lo, hi int64) int64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
