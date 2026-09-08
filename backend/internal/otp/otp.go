// Package otp issues, stores and verifies one-time email codes.
//
// Nothing outside this package knows how a code is generated, hashed or stored.
// Callers see Issue and Verify and a small set of sentinel errors.
package otp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"
)

var (
	ErrNotFound        = errors.New("otp: not found")
	ErrExpired         = errors.New("otp: expired")
	ErrTooManyAttempts = errors.New("otp: too many attempts")
	ErrRateLimited     = errors.New("otp: rate limited")
	ErrInvalidCode     = errors.New("otp: invalid code")
	ErrInvalidLength   = errors.New("otp: invalid length")
	ErrNoPepper        = errors.New("otp: pepper is required")
	ErrUnknownPurpose  = errors.New("otp: unknown purpose")
)

// Generate returns a numeric code of the given length from a CSPRNG.
//
// crypto/rand, never math/rand. math/rand's global source is seeded
// deterministically in some configurations and its output is reproducible from a
// handful of observations — for a login credential that is a full compromise of
// the mechanism, and it is the single most common defect in OTP code.
//
// Digits are appended one at a time so a leading zero survives. Generating an
// integer and formatting it is where six-digit codes silently become five:
// strconv.Itoa(51) is "51", not "000051".
func Generate(length int) (string, error) {
	if length < 4 || length > 10 {
		return "", ErrInvalidLength
	}
	var sb strings.Builder
	sb.Grow(length)
	ten := big.NewInt(10)
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, ten)
		if err != nil {
			return "", err
		}
		sb.WriteByte(byte('0' + n.Int64()))
	}
	return sb.String(), nil
}

// Hash returns HMAC-SHA256(pepper, value) as hex.
//
// Not bcrypt: verification sits in a latency-sensitive path and a deliberately
// slow KDF there is a denial-of-service surface of its own. Not a bare SHA-256
// either: the entire keyspace of a six-digit code is one million entries, so an
// unkeyed digest is reversed by a table built in seconds. HMAC with a
// server-side pepper is fast AND useless to anyone who takes the database
// without also taking the environment.
//
// This mirrors connect/verification.Hasher, the existing house pattern for the
// same problem.
func Hash(value string, pepper []byte) string {
	m := hmac.New(sha256.New, pepper)
	m.Write([]byte(value))
	return hex.EncodeToString(m.Sum(nil))
}

// Equal compares two hex digests in constant time.
//
// Never `==`. Go's string comparison short-circuits at the first differing byte;
// the timing signal is small but it is real and it accumulates over many
// requests into a byte-by-byte recovery of the stored digest.
func Equal(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}

// normalizeEmail is the single definition of identity for a code. Issue and
// Verify must agree on it exactly, or a code issued to "User@x.com " can never
// be verified by "user@x.com".
func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
