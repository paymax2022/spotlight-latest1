package kycverify

import (
	"strings"
	"testing"

	"spotlight/backend/internal/provider"
)

// passResult builds a PASSED ID-number data-match result whose flattened
// ExtractedFields carry the provider's record phone (as mapIDNumber would).
func passResult(fields map[string]string) provider.KycCheckResult {
	return provider.KycCheckResult{
		Status:          provider.KycPassed,
		Match:           true,
		Confidence:      100,
		Terminal:        true,
		ExtractedFields: fields,
	}
}

// A NIN whose registered phone matches the account's verified phone is genuine
// ownership — the gate must leave the PASS untouched so the tier elevates.
func TestOwnershipGate_NINMatchPasses(t *testing.T) {
	res := passResult(map[string]string{"first_name": "AMAKA", "phone_number": "08159491618"})
	got := applyOwnershipGate(res, "nin", "08159491618", true)
	if got.Status != provider.KycPassed {
		t.Fatalf("matching phone must stay PASSED, got %s (reason %q)", got.Status, got.Reason)
	}
}

// The account phone and the record phone are the same number in different
// layouts (+234… vs 0…). The repo's canonical NSN normalization must collapse
// them so a legitimate user is not blocked by formatting.
func TestOwnershipGate_MatchAcrossPhoneFormats(t *testing.T) {
	res := passResult(map[string]string{"phone_number": "+2348159491618"})
	got := applyOwnershipGate(res, "nin", "08159491618", true)
	if got.Status != provider.KycPassed {
		t.Fatalf("same number across formats must match, got %s", got.Status)
	}
}

// A BVN record carries phone_number1/phone_number2; a match on EITHER proves
// ownership.
func TestOwnershipGate_BVNSecondaryPhoneMatches(t *testing.T) {
	res := passResult(map[string]string{"phone_number1": "08030000000", "phone_number2": "08159491618"})
	got := applyOwnershipGate(res, "bvn", "08159491618", true)
	if got.Status != provider.KycPassed {
		t.Fatalf("match on phone_number2 must pass, got %s", got.Status)
	}
}

// The ID is real but registered to a DIFFERENT phone than the account. The gate
// must FAIL the check (no tier, no identity persisted) and return a reason that
// reveals only the last 4 digits of the record phone, masking the rest — the
// agreed memory-jog hint.
func TestOwnershipGate_MismatchFailsWithMaskedHint(t *testing.T) {
	res := passResult(map[string]string{"first_name": "AMAKA", "phone_number": "08159491618"})
	got := applyOwnershipGate(res, "nin", "08021234567", true)
	if got.Status != provider.KycFailed {
		t.Fatalf("mismatch must FAIL, got %s", got.Status)
	}
	if got.Match {
		t.Fatal("a failed ownership check must not report Match=true")
	}
	if !strings.Contains(got.Reason, "1618") {
		t.Fatalf("reason must reveal the record phone's last 4 digits: %q", got.Reason)
	}
	// The full record phone must NEVER appear — only the last 4 are disclosed.
	if strings.Contains(got.Reason, "08159491618") || strings.Contains(got.Reason, "8159491618") {
		t.Fatalf("reason leaked the full record phone: %q", got.Reason)
	}
	if !strings.Contains(got.Reason, "•") {
		t.Fatalf("reason must mask the leading digits: %q", got.Reason)
	}
}

// An account with no verified phone cannot prove ownership — hard block. The
// reason must direct the user to add/verify their phone (actionable), never a
// masked hint (there is nothing to compare against).
func TestOwnershipGate_NoVerifiedAccountPhoneBlocks(t *testing.T) {
	res := passResult(map[string]string{"phone_number": "08159491618"})
	// phone present on the account row but NOT verified.
	got := applyOwnershipGate(res, "nin", "08159491618", false)
	if got.Status != provider.KycFailed {
		t.Fatalf("unverified account phone must block, got %s", got.Status)
	}
	if strings.Contains(got.Reason, "1618") {
		t.Fatalf("no-account-phone block must not leak record digits: %q", got.Reason)
	}
}

// Account phone column is blank → block, regardless of the verified flag.
func TestOwnershipGate_BlankAccountPhoneBlocks(t *testing.T) {
	res := passResult(map[string]string{"phone_number": "08159491618"})
	got := applyOwnershipGate(res, "nin", "", true)
	if got.Status != provider.KycFailed {
		t.Fatalf("blank account phone must block, got %s", got.Status)
	}
}

// A phone-bearing ID type whose provider record carries NO phone is
// indeterminate → hard block (we cannot prove ownership either way).
func TestOwnershipGate_PhoneBearingButNoRecordPhoneBlocks(t *testing.T) {
	res := passResult(map[string]string{"first_name": "AMAKA"}) // no phone field
	got := applyOwnershipGate(res, "nin", "08159491618", true)
	if got.Status != provider.KycFailed {
		t.Fatalf("missing record phone on a NIN must block, got %s", got.Status)
	}
}

// passport/drivers_license/pvc carry no phone on their provider record and are
// NOT NG Tier-1 IDs — they are exempt and must pass through the gate unchanged.
func TestOwnershipGate_PhonelessIDTypesExempt(t *testing.T) {
	for _, idType := range []string{"passport", "drivers_license", "dl", "pvc"} {
		res := passResult(map[string]string{"first_name": "AMAKA"})
		got := applyOwnershipGate(res, idType, "", false)
		if got.Status != provider.KycPassed {
			t.Fatalf("%s must be exempt and stay PASSED, got %s", idType, got.Status)
		}
	}
}

// The gate only ever acts on a PASSED result — a FAILED or REVIEW result from
// the provider flows through untouched (never upgraded, never re-reasoned).
func TestOwnershipGate_NonPassUntouched(t *testing.T) {
	for _, st := range []provider.KycCheckStatus{provider.KycFailed, provider.KycReview, provider.KycPending} {
		res := provider.KycCheckResult{Status: st, Reason: "provider said so", ExtractedFields: map[string]string{"phone_number": "08159491618"}}
		got := applyOwnershipGate(res, "nin", "08021234567", true)
		if got.Status != st {
			t.Fatalf("non-pass %s must be untouched, got %s", st, got.Status)
		}
		if got.Reason != "provider said so" {
			t.Fatalf("non-pass reason must be preserved, got %q", got.Reason)
		}
	}
}

// The masked last-4 hint is disclosed ONLY on a mismatch (where the caller has
// already proven a verified phone of their own). Both BLOCK paths — no verified
// account phone, and a record with no phone — must return a generic reason with
// NO digits at all, so a caller who has proven no phone can never read back any
// record phone digits. Locks the residual-disclosure boundary (see ADR-PR726).
func TestOwnershipGate_BlockPathsRevealNoDigits(t *testing.T) {
	// No verified account phone: record has a phone, but the caller proved none.
	noAccount := applyOwnershipGate(passResult(map[string]string{"phone_number": "08159491618"}), "nin", "08159491618", false)
	// No record phone: a phone-bearing ID whose record carries no phone.
	noRecord := applyOwnershipGate(passResult(map[string]string{"first_name": "AMAKA"}), "nin", "08159491618", true)

	for name, got := range map[string]provider.KycCheckResult{"no-account-phone": noAccount, "no-record-phone": noRecord} {
		if got.Status != provider.KycFailed {
			t.Fatalf("%s: expected FAILED, got %s", name, got.Status)
		}
		if strings.ContainsAny(got.Reason, "0123456789") {
			t.Fatalf("%s: block reason must contain NO digits, got %q", name, got.Reason)
		}
	}
}

// maskPhone keeps the last 4 digits and masks every preceding digit, so an
// 11-digit local number shows as 7 bullets + 4 digits.
func TestMaskPhone(t *testing.T) {
	cases := map[string]string{
		"08159491618":   "•••••••1618",
		"+2348159491618": "•••••••••1618",
		"1234":          "1234", // too short to meaningfully mask
		"":              "",
	}
	for in, want := range cases {
		if got := maskPhone(in); got != want {
			t.Fatalf("maskPhone(%q) = %q, want %q", in, got, want)
		}
	}
}

// isPhoneBearingIDType is case-insensitive and recognizes the NG ID types that
// return a registered phone.
func TestIsPhoneBearingIDType(t *testing.T) {
	for _, yes := range []string{"nin", "NIN", "bvn", "vnin", " nin "} {
		if !isPhoneBearingIDType(yes) {
			t.Fatalf("%q should be phone-bearing", yes)
		}
	}
	for _, no := range []string{"passport", "drivers_license", "dl", "pvc", "phone", ""} {
		if isPhoneBearingIDType(no) {
			t.Fatalf("%q should NOT be phone-bearing", no)
		}
	}
}
