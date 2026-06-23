// Package connectverification provides the Phase 0 hooks that keep Connect
// verification data safe: a non-reversible identifier hasher (store-nothing-raw),
// log redaction, and a retention policy. Safety invariant 5 (dating/CLAUDE.md §28):
// verification data is encrypted/secured at rest with a defined retention policy
// and is NEVER logged. We never store raw document numbers or biometric payloads —
// only an HMAC hash (for dedup) plus a provider/storage reference.
package connectverification

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
)

// ErrNoPepper is returned when constructing a Hasher without a server-side pepper.
// Hashing fails closed rather than silently using an empty key.
var ErrNoPepper = errors.New("connect: verification pepper is required")

// Hasher turns sensitive verification identifiers into non-reversible,
// deduplicable references. Mirrors the KYC bvn_hash/nin_hash convention.
type Hasher struct{ pepper []byte }

// NewHasher builds a Hasher from a server-side pepper (config.ConnectVerificationPepper).
func NewHasher(pepper string) (*Hasher, error) {
	if strings.TrimSpace(pepper) == "" {
		return nil, ErrNoPepper
	}
	return &Hasher{pepper: []byte(pepper)}, nil
}

// HashDocument returns HMAC-SHA256(pepper, docType:userID:docNumber) as hex.
// Binding userID means the same document under two accounts yields different
// hashes, preventing cross-account correlation while staying deduplicable per user.
// The raw docNumber is never persisted or logged.
func (h *Hasher) HashDocument(docType, userID, docNumber string) string {
	mac := hmac.New(sha256.New, h.pepper)
	mac.Write([]byte(docType + ":" + userID + ":" + docNumber))
	return hex.EncodeToString(mac.Sum(nil))
}
