package restaurant

import "testing"

func TestKYBCanTransition(t *testing.T) {
	legal := []struct{ from, to KYBStatus }{
		{KYBDraft, KYBSubmitted},
		{KYBSubmitted, KYBUnderReview},
		{KYBSubmitted, KYBApproved},
		{KYBSubmitted, KYBRejected},
		{KYBSubmitted, KYBNeedsInfo},
		{KYBUnderReview, KYBApproved},
		{KYBUnderReview, KYBRejected},
		{KYBUnderReview, KYBNeedsInfo},
		{KYBNeedsInfo, KYBSubmitted}, // resubmit
		{KYBNeedsInfo, KYBApproved},
		{KYBRejected, KYBSubmitted}, // re-apply
	}
	for _, c := range legal {
		if !kybCanTransition(c.from, c.to) {
			t.Errorf("expected %s→%s allowed", c.from, c.to)
		}
	}
	illegal := []struct{ from, to KYBStatus }{
		{KYBDraft, KYBApproved},      // can't approve a draft directly
		{KYBDraft, KYBUnderReview},   // must be submitted first
		{KYBApproved, KYBRejected},   // approved is terminal
		{KYBApproved, KYBSubmitted},  // terminal
		{KYBSubmitted, KYBSubmitted}, // same-state
		{KYBRejected, KYBApproved},   // must re-submit first
	}
	for _, c := range illegal {
		if kybCanTransition(c.from, c.to) {
			t.Errorf("expected %s→%s rejected", c.from, c.to)
		}
	}
}

func fullSoleProp() KYB {
	return KYB{
		LegalName: "Mama Put Ltd", BusinessType: "sole_proprietor",
		ContactEmail: "owner@mamaput.ng", ContactPhone: "08012345678",
		BankCode: "058", AccountNumber: "0123456789", AccountName: "Mama Put",
	}
}

func TestValidateKYBForSubmit_SolePropOK(t *testing.T) {
	if p := validateKYBForSubmit(fullSoleProp(), nil); len(p) != 0 {
		t.Fatalf("a complete sole-proprietor KYB should submit cleanly, got %v", p)
	}
}

func TestValidateKYBForSubmit_RegisteredNeedsRCAndCert(t *testing.T) {
	k := fullSoleProp()
	k.BusinessType = "limited_company"
	// Missing RC number AND the certificate doc → two problems.
	p := validateKYBForSubmit(k, nil)
	if !hasProblem(p, "rc_number") || !hasProblem(p, "cac_certificate") {
		t.Fatalf("registered business must require rc_number + cac_certificate, got %v", p)
	}
	// Supply both → clean.
	k.RCNumber = "RC1234567"
	if p := validateKYBForSubmit(k, map[string]bool{"cac_certificate": true}); len(p) != 0 {
		t.Fatalf("registered business with RC + certificate should submit cleanly, got %v", p)
	}
}

func TestValidateKYBForSubmit_FieldChecks(t *testing.T) {
	cases := []struct {
		name  string
		mut   func(*KYB)
		field string
	}{
		{"missing legal name", func(k *KYB) { k.LegalName = "" }, "legal_name"},
		{"bad email", func(k *KYB) { k.ContactEmail = "not-an-email" }, "contact_email"},
		{"missing phone", func(k *KYB) { k.ContactPhone = "" }, "contact_phone"},
		{"short account number", func(k *KYB) { k.AccountNumber = "12345" }, "account_number"},
		{"non-numeric account number", func(k *KYB) { k.AccountNumber = "12345abcde" }, "account_number"},
		{"missing bank code", func(k *KYB) { k.BankCode = "" }, "bank_code"},
		{"invalid business type", func(k *KYB) { k.BusinessType = "cooperative" }, "business_type"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			k := fullSoleProp()
			c.mut(&k)
			if p := validateKYBForSubmit(k, nil); !hasProblem(p, c.field) {
				t.Fatalf("expected a %q problem, got %v", c.field, p)
			}
		})
	}
}

func TestNUBANAndEmail(t *testing.T) {
	for _, ok := range []string{"0123456789", "9999999999"} {
		if !isNUBAN(ok) {
			t.Errorf("%q should be a valid NUBAN", ok)
		}
	}
	for _, bad := range []string{"", "123", "01234567890", "12345678a9"} {
		if isNUBAN(bad) {
			t.Errorf("%q should be an invalid NUBAN", bad)
		}
	}
	for _, ok := range []string{"a@b.co", "owner@mama.put.ng"} {
		if !looksLikeEmail(ok) {
			t.Errorf("%q should look like an email", ok)
		}
	}
	for _, bad := range []string{"", "no-at", "a@b", "a b@c.co", "@b.co", "a@.co"} {
		if looksLikeEmail(bad) {
			t.Errorf("%q should NOT look like an email", bad)
		}
	}
}

func hasProblem(ps []string, substr string) bool {
	for _, p := range ps {
		if len(p) >= len(substr) && containsFold(p, substr) {
			return true
		}
	}
	return false
}

func containsFold(s, sub string) bool {
	// simple case-sensitive contains is enough here (messages are lowercase field keys)
	return indexOf(s, sub) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
