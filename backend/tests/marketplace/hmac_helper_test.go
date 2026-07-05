package marketplace_test

// ---------------------------------------------------------------------------
// hmacSHA512Hex is a test-only helper that computes an HMAC-SHA512 hex digest,
// used ONLY to produce a correctly-signed webhook body so
// chaos_error_taxonomy_test.go can assert mkt.VerifyHMAC ACCEPTS a valid
// signature (not just rejects invalid ones). This mirrors the documented
// algorithm in webhooks.go's VerifyHMAC doc comment ("HMAC-SHA512 hex
// signature") — it is testing the documented contract of the exported
// VerifyHMAC function, not reaching into unexported package internals.
// ---------------------------------------------------------------------------

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
)

func hmacSHA512Hex(secret string, body []byte) string {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
