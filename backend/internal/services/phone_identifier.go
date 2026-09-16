package services

import "strings"

// NormalizePhone reduces a Nigerian phone number to its 10-digit national significant
// number, so the same subscriber matches however they typed it.
//
// Stored numbers are NOT normalised in this database — one row holds "8159491618" with
// no country code and no leading zero, while apps commonly submit "08159491618" or
// "+2348159491618". Comparing raw strings would fail to find the account and look, to
// the user, exactly like a wrong password.
//
// Returns "" when the input cannot be a Nigerian mobile number, which callers must
// treat as "no match" rather than falling back to a looser comparison.
func NormalizePhone(raw string) string {
	var digits strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	d := digits.String()
	switch {
	case strings.HasPrefix(d, "234") && len(d) == 13: // +234 815 949 1618
		d = d[3:]
	case strings.HasPrefix(d, "0") && len(d) == 11: // 0815 949 1618
		d = d[1:]
	}
	if len(d) != 10 {
		return ""
	}
	return d
}

// LooksLikeEmail is a deliberately loose check used only to choose which lookup to run.
// Authentication itself is unchanged, so a wrong guess here costs a failed match, never
// a wrong sign-in.
func LooksLikeEmail(s string) bool {
	return strings.Contains(s, "@")
}
