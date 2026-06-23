package connectverification_test

import (
	"testing"
	"time"

	connectverification "spotlight/backend/internal/connect/verification"
)

func TestNewHasherRequiresPepper(t *testing.T) {
	if _, err := connectverification.NewHasher(""); err == nil {
		t.Error("empty pepper must fail closed")
	}
	if _, err := connectverification.NewHasher("   "); err == nil {
		t.Error("whitespace pepper must fail closed")
	}
	if _, err := connectverification.NewHasher("s3cret-pepper"); err != nil {
		t.Errorf("valid pepper should succeed, got %v", err)
	}
}

func TestHashDeterministicAndNonReversible(t *testing.T) {
	h, _ := connectverification.NewHasher("s3cret-pepper")
	a := h.HashDocument("NIN", "user-1", "12345678901")
	b := h.HashDocument("NIN", "user-1", "12345678901")
	if a != b {
		t.Error("hash must be deterministic for identical inputs")
	}
	if a == "" || len(a) != 64 {
		t.Errorf("expected 64-hex-char sha256 hmac, got len %d", len(a))
	}
	// Raw value must never appear in the hash output.
	if contains(a, "12345678901") {
		t.Error("hash leaks the raw document number")
	}
}

func TestHashBindsUserAndDoc(t *testing.T) {
	h, _ := connectverification.NewHasher("pepper")
	base := h.HashDocument("NIN", "user-1", "111")
	if base == h.HashDocument("NIN", "user-2", "111") {
		t.Error("same document under different users must hash differently")
	}
	if base == h.HashDocument("NIN", "user-1", "222") {
		t.Error("different documents must hash differently")
	}
	if base == h.HashDocument("BVN", "user-1", "111") {
		t.Error("different document types must hash differently")
	}
}

func TestRedactNeverLeaks(t *testing.T) {
	secret := "1990-05-04"
	if got := connectverification.Redact(secret); got == secret || contains(got, "1990") {
		t.Errorf("Redact leaked the value: %q", got)
	}
	if connectverification.Redact("") != "" {
		t.Error("Redact of empty should stay empty")
	}
	m := connectverification.RedactFields(map[string]any{"dob": "1990-05-04", "age": 35}, "dob")
	if m["dob"] == "1990-05-04" {
		t.Error("RedactFields did not redact dob")
	}
	if m["age"] != 35 {
		t.Error("RedactFields must not touch non-sensitive keys")
	}
}

func TestRetentionPolicy(t *testing.T) {
	now := time.Date(2026, time.June, 22, 0, 0, 0, 0, time.UTC)
	p := connectverification.RetentionPolicy{Days: 365}
	old := now.AddDate(-2, 0, 0)
	recent := now.AddDate(0, 0, -10)
	if !p.Expired(old, now) {
		t.Error("2-year-old evidence must be expired under 365-day retention")
	}
	if p.Expired(recent, now) {
		t.Error("10-day-old evidence must not be expired")
	}
	// Zero/negative retention = never purge.
	if (connectverification.RetentionPolicy{Days: 0}).Expired(old, now) {
		t.Error("zero retention must mean no purge")
	}
}

func contains(s, sub string) bool {
	return len(sub) > 0 && len(s) >= len(sub) && indexOf(s, sub) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
