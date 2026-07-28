package marketplace

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
)

// VerifyHMAC reports whether sigHex is a valid HMAC-SHA512 (hex-encoded)
// signature of body under secret. It is the gate that runs BEFORE any handler
// logic on inbound logistics/payments webhooks.
//
// Fail-closed by contract: an empty secret, an empty signature, or a
// non-hex-decodable signature all return false. The final comparison is
// constant-time (hmac.Equal) to avoid timing side channels.
func VerifyHMAC(secret string, body []byte, sigHex string) bool {
	if secret == "" || sigHex == "" {
		return false
	}
	sig, err := hex.DecodeString(sigHex)
	if err != nil {
		return false
	}
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal(sig, mac.Sum(nil))
}
