package healthinsurance

import "testing"

// TS-13 PM-002 (eligibility/coverage/copay computed correctly) + PM-007 (insurer +
// copay + wallet split correctness, reconciles). Pure, deterministic, integer
// minor-unit (kobo) math — no floats, value-conserving.

func TestBasicCoinsurance(t *testing.T) {
	s := Compute(1000_00, Policy{CoveragePercent: 80})
	if s.InsurerKobo != 800_00 || s.PatientKobo != 200_00 {
		t.Fatalf("80%% cover of ₦1000 → insurer 800, patient 200; got %+v", s)
	}
}

func TestCopayThenCoinsurance(t *testing.T) {
	s := Compute(1000_00, Policy{CoveragePercent: 80, CopayKobo: 20_00})
	// copay 20; remaining 980; insurer 80% = 784; patient = 20 + 196 = 216.
	if s.CopayKobo != 20_00 || s.InsurerKobo != 784_00 || s.PatientKobo != 216_00 {
		t.Fatalf("copay+coinsurance wrong: %+v", s)
	}
}

func TestDeductibleFirst(t *testing.T) {
	s := Compute(1000_00, Policy{CoveragePercent: 80, DeductibleKobo: 100_00})
	// deductible 100 (patient); coverable 900; insurer 720; patient = 100 + 180 = 280.
	if s.DeductibleKobo != 100_00 || s.InsurerKobo != 720_00 || s.PatientKobo != 280_00 {
		t.Fatalf("deductible split wrong: %+v", s)
	}
}

func TestCoverageCap(t *testing.T) {
	s := Compute(1000_00, Policy{CoveragePercent: 80, CoverageCapKobo: 500_00})
	// 80% = 800 but capped at 500; patient absorbs the rest.
	if s.InsurerKobo != 500_00 || s.PatientKobo != 500_00 {
		t.Fatalf("cap not applied: %+v", s)
	}
}

func TestEdges(t *testing.T) {
	if s := Compute(1000_00, Policy{CoveragePercent: 0}); s.InsurerKobo != 0 || s.PatientKobo != 1000_00 {
		t.Fatalf("0%% cover → patient pays all: %+v", s)
	}
	if s := Compute(1000_00, Policy{CoveragePercent: 100}); s.InsurerKobo != 1000_00 || s.PatientKobo != 0 {
		t.Fatalf("100%% cover → patient pays 0: %+v", s)
	}
	// copay larger than the charge is clamped to the charge (never negative).
	if s := Compute(10_00, Policy{CoveragePercent: 80, CopayKobo: 50_00}); s.CopayKobo != 10_00 || s.InsurerKobo != 0 || s.PatientKobo != 10_00 {
		t.Fatalf("copay>charge must clamp: %+v", s)
	}
	// non-positive charge → all zero.
	if s := Compute(0, Policy{CoveragePercent: 80}); s.InsurerKobo != 0 || s.PatientKobo != 0 {
		t.Fatalf("zero charge → zero split: %+v", s)
	}
	// coverage percent is clamped to [0,100].
	if s := Compute(1000_00, Policy{CoveragePercent: 150}); s.InsurerKobo != 1000_00 {
		t.Fatalf("over-100%% coverage must clamp to full: %+v", s)
	}
}

// PM-002/007 escrow half: the patient escrows only their out-of-pocket portion;
// an uninsured patient escrows the full charge; a fully-covered charge holds 0.
func TestPatientHold(t *testing.T) {
	// Uninsured → hold the full charge (current full-pay behaviour).
	if hold, s := PatientHold(1000_00, Policy{CoveragePercent: 80}, false); hold != 1000_00 || s.PatientKobo != 1000_00 {
		t.Fatalf("uninsured must escrow the full charge: hold=%d %+v", hold, s)
	}
	// Insured 80% + ₦20 copay → patient escrows copay + coinsurance.
	hold, s := PatientHold(1000_00, Policy{CoveragePercent: 80, CopayKobo: 20_00}, true)
	if hold != 216_00 || s.InsurerKobo != 784_00 {
		t.Fatalf("insured patient escrows only their portion: hold=%d %+v", hold, s)
	}
	if s.InsurerKobo+hold != 1000_00 {
		t.Fatalf("hold + insurer receivable must equal the charge: %+v", s)
	}
	// Fully covered → escrow nothing from the patient.
	if hold, _ := PatientHold(1000_00, Policy{CoveragePercent: 100}, true); hold != 0 {
		t.Fatalf("a fully-covered charge must hold 0 from the patient, got %d", hold)
	}
}

// PM-007: the split always reconciles to the charge exactly (no drift), and the
// patient breakdown sums to the patient total — for odd amounts / rounding too.
func TestSplitReconciles(t *testing.T) {
	cases := []struct {
		charge int64
		p      Policy
	}{
		{999, Policy{CoveragePercent: 33}},
		{100_01, Policy{CoveragePercent: 70, CopayKobo: 3_33, DeductibleKobo: 7_77}},
		{1, Policy{CoveragePercent: 50}},
		{123_45, Policy{CoveragePercent: 80, CoverageCapKobo: 40_00}},
		{50_00_00, Policy{CoveragePercent: 90, CopayKobo: 100_00, DeductibleKobo: 250_00, CoverageCapKobo: 3000_00}},
	}
	for _, c := range cases {
		s := Compute(c.charge, c.p)
		if s.InsurerKobo+s.PatientKobo != c.charge {
			t.Errorf("value not conserved for %d/%+v: insurer %d + patient %d != %d", c.charge, c.p, s.InsurerKobo, s.PatientKobo, c.charge)
		}
		if s.CopayKobo+s.DeductibleKobo+s.CoinsuranceKobo != s.PatientKobo {
			t.Errorf("patient breakdown doesn't sum for %d/%+v: %+v", c.charge, c.p, s)
		}
		if s.InsurerKobo < 0 || s.PatientKobo < 0 {
			t.Errorf("negative split for %d/%+v: %+v", c.charge, c.p, s)
		}
	}
}
