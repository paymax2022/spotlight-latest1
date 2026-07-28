package crypto

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
)

// Ed25519 signing + hash-chaining for the Arena Merit ledger (NDC-2, NDC-6).
//
// Every merit entry is signed by an authorized scoring adapter over the canonical
// payload, and hash-chained per contestant so the ledger is tamper-evident and
// publicly verifiable. Adapter seeds come from config (base64 32-byte Ed25519
// seeds), never hard-coded. Verifiers hold only public keys, so an auditor can
// verify the whole ledger without any private key.

var (
	// ErrSeedLength is returned when an Ed25519 seed is not 32 bytes.
	ErrSeedLength = errors.New("crypto: ed25519 seed must decode to exactly 32 bytes")
	// ErrUnknownSigner is returned when verifying against an unregistered adapter id.
	ErrUnknownSigner = errors.New("crypto: no public key registered for signer id")
)

// Signer holds one authorized adapter's private key.
type Signer struct {
	id   string
	priv ed25519.PrivateKey
}

// NewSignerFromSeed builds a Signer from a base64-encoded 32-byte Ed25519 seed.
func NewSignerFromSeed(id, b64Seed string) (*Signer, error) {
	seed, err := base64.StdEncoding.DecodeString(b64Seed)
	if err != nil {
		return nil, fmt.Errorf("crypto: signer seed not valid base64: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, ErrSeedLength
	}
	return &Signer{id: id, priv: ed25519.NewKeyFromSeed(seed)}, nil
}

// ID returns the adapter identity this signer represents.
func (s *Signer) ID() string { return s.id }

// PublicKeyB64 returns the base64 public key (register it with a Verifier).
func (s *Signer) PublicKeyB64() string {
	pub := s.priv.Public().(ed25519.PublicKey)
	return base64.StdEncoding.EncodeToString(pub)
}

// Sign returns the Ed25519 signature over msg (the canonical payload bytes).
func (s *Signer) Sign(msg []byte) []byte {
	return ed25519.Sign(s.priv, msg)
}

// Verifier holds the public keys of every authorized adapter, keyed by id.
type Verifier struct {
	pubs map[string]ed25519.PublicKey
}

// NewVerifier returns an empty verifier registry.
func NewVerifier() *Verifier { return &Verifier{pubs: map[string]ed25519.PublicKey{}} }

// Register adds an adapter's base64 public key to the registry.
func (v *Verifier) Register(id, b64Pub string) error {
	pub, err := base64.StdEncoding.DecodeString(b64Pub)
	if err != nil {
		return fmt.Errorf("crypto: public key not valid base64: %w", err)
	}
	if len(pub) != ed25519.PublicKeySize {
		return errors.New("crypto: ed25519 public key must be 32 bytes")
	}
	v.pubs[id] = ed25519.PublicKey(pub)
	return nil
}

// Known reports whether an adapter id is registered (authorized).
func (v *Verifier) Known(id string) bool { _, ok := v.pubs[id]; return ok }

// Verify checks sig over msg for the given adapter id. Unknown id → false.
func (v *Verifier) Verify(id string, msg, sig []byte) bool {
	pub, ok := v.pubs[id]
	if !ok {
		return false
	}
	return ed25519.Verify(pub, msg, sig)
}

// ChainHash returns SHA-256(prev ‖ canonical) — the per-contestant chain link.
// The first entry uses a zero-length prev (genesis).
func ChainHash(prev, canonical []byte) []byte {
	h := sha256.New()
	h.Write(prev)
	h.Write(canonical)
	return h.Sum(nil)
}
