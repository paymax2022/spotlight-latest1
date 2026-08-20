package services

import "testing"

// TestNormalizePhoneAcceptsTheFormatsUsersActuallyType. The stored value in this
// database has no country code and no leading zero, so every common input shape must
// reduce to the same 10 digits or the account is simply not found.
func TestNormalizePhoneAcceptsTheFormatsUsersActuallyType(t *testing.T) {
	const want = "8159491618"
	for _, in := range []string{
		"8159491618", "08159491618", "+2348159491618", "234 815 949 1618",
		"0815-949-1618", " (0815) 949 1618 ",
	} {
		if got := NormalizePhone(in); got != want {
			t.Errorf("NormalizePhone(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestNormalizePhoneRejectsNonNumbers: anything that cannot be a Nigerian mobile must
// return "" so the caller treats it as no-match instead of comparing loosely.
func TestNormalizePhoneRejectsNonNumbers(t *testing.T) {
	for _, in := range []string{"", "123", "abcdefghij", "+1 415 555 0100", "081594916180000"} {
		if got := NormalizePhone(in); got != "" {
			t.Errorf("NormalizePhone(%q) = %q, want \"\"", in, got)
		}
	}
}

func TestLooksLikeEmail(t *testing.T) {
	if !LooksLikeEmail("a@b.com") || LooksLikeEmail("08159491618") {
		t.Error("email detection should split on the presence of '@'")
	}
}
