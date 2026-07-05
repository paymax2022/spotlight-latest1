package connecttrust_test

import (
	"testing"

	connecttrust "spotlight/backend/internal/connect/trust"
)

func testThresholds() connecttrust.Thresholds {
	return connecttrust.Thresholds{
		FinancialTerms:   []string{"gift card", "crypto", "send money"},
		OffPlatformTerms: []string{"whatsapp", "telegram"},
		HarassmentTerms:  []string{"kill yourself", "worthless"},
		FlagToCase:       2,
		EscalateScore:    5,
	}
}

// TestScanCleanMessage: a benign message produces no flag.
func TestScanCleanMessage(t *testing.T) {
	d := connecttrust.Scan("Hey, want to grab coffee on Saturday?", testThresholds())
	if d.Flagged {
		t.Fatalf("clean message must not flag, got %+v", d)
	}
	if d.Warning != "" {
		t.Errorf("clean message must have no warning")
	}
}

// TestScanFinancialSolicitation: money/scam terms flag with reason codes + warning.
func TestScanFinancialSolicitation(t *testing.T) {
	d := connecttrust.Scan("Can you send money via a gift card please?", testThresholds())
	if !d.Flagged {
		t.Fatal("financial solicitation must flag")
	}
	if d.PrimaryCategory() != connecttrust.CategoryFinancial {
		t.Errorf("expected financial category, got %q", d.PrimaryCategory())
	}
	if len(d.ReasonCodes) == 0 {
		t.Error("flag must carry reason codes for moderators")
	}
	if d.Warning == "" {
		t.Error("financial flag must surface an inline warning")
	}
	if d.Score <= 0 {
		t.Error("financial flag must carry a positive severity score")
	}
}

// TestScanOffPlatform: redirection to another app flags off_platform.
func TestScanOffPlatform(t *testing.T) {
	d := connecttrust.Scan("add me on WhatsApp", testThresholds())
	if !d.Flagged || d.PrimaryCategory() != connecttrust.CategoryOffPlatform {
		t.Fatalf("off-platform must flag as off_platform, got %+v", d)
	}
}

// TestScanHarassment: abusive content flags harassment and weighs heavy.
func TestScanHarassment(t *testing.T) {
	d := connecttrust.Scan("you are worthless", testThresholds())
	if !d.Flagged || d.PrimaryCategory() != connecttrust.CategoryHarassment {
		t.Fatalf("harassment must flag, got %+v", d)
	}
}

// TestScanCaseInsensitiveAndStableCodes: matching ignores case and reason codes
// are deterministic/sorted (so moderator filters are stable).
func TestScanCaseInsensitiveAndStableCodes(t *testing.T) {
	d1 := connecttrust.Scan("SEND MONEY now on TELEGRAM", testThresholds())
	d2 := connecttrust.Scan("send money now on telegram", testThresholds())
	if !d1.Flagged || !d2.Flagged {
		t.Fatal("both must flag")
	}
	if len(d1.ReasonCodes) != len(d2.ReasonCodes) {
		t.Fatalf("reason codes must be deterministic: %v vs %v", d1.ReasonCodes, d2.ReasonCodes)
	}
	for i := range d1.ReasonCodes {
		if d1.ReasonCodes[i] != d2.ReasonCodes[i] {
			t.Errorf("reason codes must be sorted/stable: %v vs %v", d1.ReasonCodes, d2.ReasonCodes)
		}
	}
}

// TestScanEmptyThresholdsNeverPanics: missing config => no flag (fails open for
// term matching; the caller treats a config *error* as fail-closed separately).
func TestScanEmptyThresholds(t *testing.T) {
	d := connecttrust.Scan("send money gift card", connecttrust.Thresholds{})
	if d.Flagged {
		t.Error("with no configured terms, nothing should match")
	}
}
