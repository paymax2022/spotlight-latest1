package kycverify

import (
	"strings"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/services"
)

// NIN/BVN ownership gate (FEATURE_KYC_OWNERSHIP_GATE).
//
// A Dojah ID-number data-match proves an ID is REAL and authentic — NOT that the
// person submitting it owns it. Without an ownership check, any valid NIN/BVN
// reaches Tier 1, and (once the provider-verified name/DOB are persisted onto the
// profile, ADR-PR722) a submitted NIN becomes a one-shot NIN→identity disclosure
// oracle. This gate binds the submitted ID to the caller: a PASSED ID-number
// check is only honoured when the phone registered to the ID matches the
// account's own verified phone. It is applied UPSTREAM of the check-status write
// in RunCheck, so a block stops BOTH tier elevation and identity persistence in
// one place. See ADR-PR726.
//
// All logic here is pure (no DB, no network) and unit-tested; the single DB read
// (the account's verified phone) happens in RunCheck and is passed in.

// User-facing block reasons. These ride in Check.Reason, which the member check
// response returns (ExtractedFields are scrubbed by the handler) and the mobile
// failure screen renders verbatim. They must never contain third-party PII
// beyond the agreed masked last-4 hint.
const (
	msgOwnershipNoAccountPhone = "Add and verify your phone number on your account before completing identity verification."
	msgOwnershipNoRecordPhone  = "We couldn't confirm this ID belongs to you. Please contact support."
)

// recordPhoneKeys are the flattened Dojah entity keys that may carry the phone
// registered to an ID. NIN returns phone_number; BVN-full returns
// phone_number1/phone_number2. The rest are defensive aliases across providers.
var recordPhoneKeys = []string{
	"phone_number", "phone_number1", "phone_number2",
	"phoneNumber", "phone", "mobile", "msisdn",
}

// isPhoneBearingIDType reports whether an ID type's provider record carries a
// registered phone to match against. Only the NG Tier-1 identity numbers do;
// passport / drivers_license / pvc structurally do not and are exempt (the gate
// passes them through unchanged rather than blocking a flow it cannot evaluate).
func isPhoneBearingIDType(idType string) bool {
	switch strings.ToLower(strings.TrimSpace(idType)) {
	case "nin", "bvn", "vnin":
		return true
	default:
		return false
	}
}

// applyOwnershipGate downgrades a PASSED ID-number result to FAILED when the
// caller has not proven ownership of the submitted ID. It acts ONLY on a PASSED
// result; a non-pass result, or an exempt (phone-less) ID type, is returned
// unchanged. accountPhone/accountVerified describe the caller's user_profiles
// phone state (read in RunCheck). Pure.
func applyOwnershipGate(res provider.KycCheckResult, idType, accountPhone string, accountVerified bool) provider.KycCheckResult {
	if res.Status != provider.KycPassed {
		return res
	}
	if !isPhoneBearingIDType(idType) {
		return res // exempt: no phone on record to match
	}

	recordPhones := extractRecordPhones(res.ExtractedFields)
	if len(recordPhones) == 0 {
		return blockOwnership(res, msgOwnershipNoRecordPhone)
	}

	acct := services.NormalizePhone(accountPhone)
	if !accountVerified || acct == "" {
		return blockOwnership(res, msgOwnershipNoAccountPhone)
	}

	for _, rp := range recordPhones {
		if n := services.NormalizePhone(rp); n != "" && n == acct {
			return res // ownership proven — PASS stands
		}
	}

	// The ID is real but registered to a different phone. Fail, and reveal only
	// the masked last-4 of the first record phone to jog the user's memory.
	return blockOwnership(res, mismatchReason(maskPhone(recordPhones[0])))
}

// blockOwnership turns a PASS into a terminal FAIL carrying a user-facing reason,
// clearing Match so a blocked check never reports a positive data-match.
func blockOwnership(res provider.KycCheckResult, reason string) provider.KycCheckResult {
	res.Status = provider.KycFailed
	res.Match = false
	res.Terminal = true
	res.Reason = reason
	return res
}

// mismatchReason is the user-facing message for a phone mismatch, embedding the
// masked record-phone hint.
func mismatchReason(masked string) string {
	return "The phone number registered to this ID (" + masked + ") doesn't match your account. Verify that number on your account, then try again."
}

// extractRecordPhones returns the non-empty phone values present on a flattened
// provider ID record, de-duplicated, in key order.
func extractRecordPhones(fields map[string]string) []string {
	if len(fields) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, k := range recordPhoneKeys {
		if v := strings.TrimSpace(fields[k]); v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

// maskPhone keeps the last 4 digits of a phone and masks every preceding digit
// with a bullet, so an 11-digit local number renders as "•••••••1618". A number
// with 4 or fewer digits is returned as-is (nothing meaningful to mask). This is
// the only phone disclosure the gate makes.
func maskPhone(raw string) string {
	digits := make([]rune, 0, len(raw))
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) == 0 {
		return ""
	}
	if len(digits) <= 4 {
		return string(digits)
	}
	return strings.Repeat("•", len(digits)-4) + string(digits[len(digits)-4:])
}
