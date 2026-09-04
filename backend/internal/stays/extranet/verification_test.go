package extranet

import "testing"

func TestBvnLast4(t *testing.T) {
	cases := map[string]string{
		"12345678901": "8901",
		"123":         "",
		"":            "",
	}
	for in, want := range cases {
		if got := bvnLast4(in); got != want {
			t.Errorf("bvnLast4(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestKybDecisionStatus(t *testing.T) {
	cases := []struct {
		decision string
		want     VerificationItemStatus
		ok       bool
	}{
		{"approve", VerifApproved, true},
		{"reject", VerifRejected, true},
		{"needs_changes", VerifNeedsChanges, true},
		{"approved", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := kybDecisionStatus(c.decision)
		if got != c.want || ok != c.ok {
			t.Errorf("kybDecisionStatus(%q) = (%q, %v), want (%q, %v)", c.decision, got, ok, c.want, c.ok)
		}
	}
}

func TestToBusinessVerification_DefaultsPendingAndMasksBVN(t *testing.T) {
	bv := toBusinessVerification(kyb{
		LegalName:   "Lekki Grand Hospitality Ltd",
		DirectorBVN: "12345678901",
		// KYCStatus / BusinessDocStatus left zero-value.
	})
	if bv.KYCStatus != VerifPending || bv.BusinessDocStatus != VerifPending {
		t.Errorf("expected pending defaults, got kyc=%q doc=%q", bv.KYCStatus, bv.BusinessDocStatus)
	}
	if bv.DirectorBVNLast4 != "8901" {
		t.Errorf("expected only last-4 BVN, got %q", bv.DirectorBVNLast4)
	}
	if bv.LegalName != "Lekki Grand Hospitality Ltd" {
		t.Errorf("expected legal name passthrough, got %q", bv.LegalName)
	}
}

func TestStatusIf(t *testing.T) {
	if statusIf(true) != VerifApproved {
		t.Errorf("statusIf(true) should be approved")
	}
	if statusIf(false) != VerifInProgress {
		t.Errorf("statusIf(false) should be in_progress")
	}
}

func TestVerificationDetail(t *testing.T) {
	if got := verificationDetail(VerifPending, "hint"); got != "hint" {
		t.Errorf("expected hint text for pending, got %q", got)
	}
	if got := verificationDetail(VerifApproved, "hint"); got != "" {
		t.Errorf("expected no detail for approved, got %q", got)
	}
}
