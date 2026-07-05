package commerce

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"math/big"
)

// ── Purchase / BNPL → entitlement state machine (state-machines.md §4) ────────
//
// States: cart → checkout → paid | bnpl_active → entitled → (refunded)
//
// Only the transitions below are legal. Illegal transitions are rejected with
// ErrIllegalTransition and audit-logged by the service. canOrder is PURE so it is
// unit-testable with no DB (commerce_test.go).

// Order states (match academy_orders.state CHECK constraint exactly).
const (
	OrderCart       = "cart"
	OrderCheckout   = "checkout"
	OrderPaid       = "paid"
	OrderBNPLActive = "bnpl_active"
	OrderEntitled   = "entitled"
	OrderRefunded   = "refunded"
)

// orderTransitions is the legal adjacency set for the purchase SM.
var orderTransitions = map[string]map[string]bool{
	OrderCart:       {OrderCheckout: true},
	OrderCheckout:   {OrderPaid: true, OrderBNPLActive: true},
	OrderPaid:       {OrderEntitled: true},
	OrderBNPLActive: {OrderEntitled: true},
	OrderEntitled:   {OrderRefunded: true},
	OrderRefunded:   {}, // terminal
}

// canOrder reports whether from→to is a legal purchase-SM transition. Pure.
func canOrder(from, to string) bool {
	targets, ok := orderTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// ── Access-card state machine (matches academy_access_cards.state) ────────────
//
// States: issued → allocated → activated, with issued → activated allowed
// (direct member activation of an un-allocated card), and void as an admin sink.

const (
	CardIssued    = "issued"
	CardAllocated = "allocated"
	CardActivated = "activated"
	CardVoid      = "void"
)

var cardTransitions = map[string]map[string]bool{
	CardIssued:    {CardAllocated: true, CardActivated: true, CardVoid: true},
	CardAllocated: {CardActivated: true, CardVoid: true},
	CardActivated: {}, // terminal (idempotent re-activation handled by replay, not transition)
	CardVoid:      {},
}

// canCard reports whether from→to is a legal access-card transition. Pure.
func canCard(from, to string) bool {
	targets, ok := cardTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// ── PIN hashing / verification (access cards) ─────────────────────────────────
// PINs are never stored in plaintext. We store a salted SHA-256 hash as
// "<saltHex>:<digestHex>" in academy_access_cards.pin_hash. Verification is
// constant-time. (A KDF like Argon2 is preferable for low-entropy secrets; SHA-256
// keeps the package dependency-free and the helper is swappable behind these two
// functions without touching call sites.)

// hashPIN produces a salted hash for storage. Deterministic per (pin, salt).
func hashPIN(pin string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	return hex.EncodeToString(salt) + ":" + hashPINWithSalt(pin, salt), nil
}

func hashPINWithSalt(pin string, salt []byte) string {
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(pin))
	return hex.EncodeToString(h.Sum(nil))
}

// verifyPIN checks a candidate pin against the stored "<saltHex>:<digestHex>" value
// in constant time. Returns false (never an error) for malformed stored hashes.
func verifyPIN(stored, candidate string) bool {
	saltHex, digestHex, ok := splitHash(stored)
	if !ok {
		return false
	}
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return false
	}
	want := hashPINWithSalt(candidate, salt)
	return subtle.ConstantTimeCompare([]byte(want), []byte(digestHex)) == 1
}

func splitHash(s string) (salt, digest string, ok bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			return s[:i], s[i+1:], i > 0 && i < len(s)-1
		}
	}
	return "", "", false
}

// randomPIN returns a numeric PIN of n digits (admin batch generation).
func randomPIN(n int) (string, error) {
	if n <= 0 {
		n = 6
	}
	const digits = "0123456789"
	out := make([]byte, n)
	for i := range out {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		if err != nil {
			return "", err
		}
		out[i] = digits[idx.Int64()]
	}
	return string(out), nil
}

// randomSerial returns a hex serial for an access card (batch generation).
func randomSerial(prefix string) (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(b), nil
}

// Sentinel errors mapped to stable snake_case codes / HTTP statuses by the handler.
var (
	ErrIllegalTransition       = errors.New("illegal_transition")
	ErrIdempotencyRequired     = errors.New("idempotency_key_required")
	ErrIdempotencyKeyReused    = errors.New("idempotency_key_reused")
	ErrNotFound                = errors.New("not_found")
	ErrInvalidAmount           = errors.New("invalid_amount")
	ErrEntitlementAlreadyGrant = errors.New("entitlement_already_granted")
	ErrAccessCardInvalid       = errors.New("access_card_invalid")
	ErrAccessCardConsumed      = errors.New("access_card_consumed")
	ErrCatalogItemInactive     = errors.New("catalog_item_inactive")
	ErrRefundNotEligible       = errors.New("refund_not_eligible")
)
