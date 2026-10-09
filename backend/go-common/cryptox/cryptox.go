// Package cryptox replaces the token/signature helpers copy-pasted across
// internal modules (randToken, randHex, sign). All randomness comes from
// crypto/rand — never math/rand — because every caller here is a credential,
// nonce, or reference generation site.
package cryptox

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strings"
)

// RandBytes returns n cryptographically random bytes. It panics only if the
// OS entropy source fails — which is already unrecoverable at request time,
// matching how the copy-pasted callers treated rand.Read errors.
func RandBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("cryptox: entropy failure: %v", err))
	}
	return b
}

// RandHex returns 2n lowercase hex chars from n random bytes — replaces both
// randHex(n) (n bytes → 2n chars) and randToken() (16 bytes → 32 chars).
func RandHex(n int) string {
	return hex.EncodeToString(RandBytes(n))
}

// Token returns a 32-char lowercase hex token (16 random bytes) — the exact
// drop-in for the copied randToken() implementations.
func Token() string {
	return RandHex(16)
}

// HMACSHA256Hex signs the parts joined by "|" — the credential `sign` shape:
// mac over "cid|window|nonce". Pass the fields in the order the verifier
// reconstructs them.
func HMACSHA256Hex(secret string, parts ...string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprint(mac, strings.Join(parts, "|"))
	return hex.EncodeToString(mac.Sum(nil))
}

// HMACSHA512Hex is HMACSHA256Hex with SHA-512 — the Paystack webhook
// verification shape (HMAC-SHA512 over the raw body).
func HMACSHA512Hex(secret string, payload []byte) string {
	mac := hmac.New(sha512.New, []byte(secret))
	_, _ = mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyHMACSHA512 constant-time-compares a hex signature against the
// HMAC-SHA512 of payload — webhook verification without leaking via early exit.
func VerifyHMACSHA512(secret string, payload []byte, signature string) bool {
	want := HMACSHA512Hex(secret, payload)
	return subtle.ConstantTimeCompare([]byte(want), []byte(signature)) == 1
}

// SHA256Hex returns the hex SHA-256 of s — for deterministic lookup keys
// (token digests, dedupe keys) where the raw value must not be stored.
func SHA256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// SHA256HexBytes is SHA256Hex over bytes — body-hash and idempotency-fingerprint
// paths.
func SHA256HexBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// ConstantTimeEqual compares two strings without early-exit — for comparing
// secrets, signatures, and API keys where a timing side channel matters.
func ConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// Fingerprint returns the first 12 hex chars of SHA-256(s) — the short,
// non-reversible identifier used in logs for API keys and tokens (enough to
// correlate, not enough to reverse or brute-force).
func Fingerprint(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:12]
}

// RandUint returns a uniform random uint64 below bound (rejection-sampled —
// never mod-biased, which matters when bound is small, e.g. picking winners).
func RandUint(bound uint64) uint64 {
	if bound == 0 {
		return 0
	}
	var b [8]byte
	limit := ^uint64(0) - (^uint64(0) % bound)
	for {
		if _, err := rand.Read(b[:]); err != nil {
			panic(fmt.Sprintf("cryptox: entropy failure: %v", err))
		}
		v := uint64(b[0]) | uint64(b[1])<<8 | uint64(b[2])<<16 | uint64(b[3])<<24 |
			uint64(b[4])<<32 | uint64(b[5])<<40 | uint64(b[6])<<48 | uint64(b[7])<<56
		if v < limit {
			return v % bound
		}
	}
}
