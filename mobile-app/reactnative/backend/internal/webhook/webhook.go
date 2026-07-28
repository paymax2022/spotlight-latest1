// Package webhook verifies inbound provider webhooks (Rule 7: every webhook
// verifies its signature and prevents replay). Stdlib-only HMAC-SHA256 over the
// raw request body, plus a timestamp-freshness window. Replay prevention (event
// de-dup) is handled by the caller via the repository's idempotency store.
package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"
)

// Verify reports whether `signature` (lowercase hex) is a valid HMAC-SHA256 of
// the raw body under `secret`. Constant-time comparison.
func Verify(secret string, body []byte, signature string) bool {
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// FreshTimestamp reports whether a unix-seconds timestamp string is within
// ±window of now — bounds replay of an otherwise-valid signed payload.
func FreshTimestamp(ts string, window time.Duration) bool {
	secs, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return false
	}
	delta := time.Since(time.Unix(secs, 0))
	if delta < 0 {
		delta = -delta
	}
	return delta <= window
}
