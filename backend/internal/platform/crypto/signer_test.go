package crypto

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func newSeedB64(t *testing.T) string {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(seed)
}

func TestSignVerify(t *testing.T) {
	s, err := NewSignerFromSeed("theory-exam", newSeedB64(t))
	if err != nil {
		t.Fatal(err)
	}
	v := NewVerifier()
	if err := v.Register(s.ID(), s.PublicKeyB64()); err != nil {
		t.Fatal(err)
	}
	msg := []byte(`{"contestant":"c1","stage":"THEORY_B1","normalized":88.5}`)
	sig := s.Sign(msg)
	if !v.Verify("theory-exam", msg, sig) {
		t.Fatal("valid signature must verify")
	}
	// Tampered payload must fail.
	if v.Verify("theory-exam", []byte(`{"normalized":99}`), sig) {
		t.Fatal("tampered payload must not verify")
	}
	// Unknown/unauthorized adapter id must fail (merit write is unreachable).
	if v.Verify("rogue-adapter", msg, sig) {
		t.Fatal("unregistered adapter must not verify")
	}
}

func TestChainHash_TamperEvident(t *testing.T) {
	e1 := []byte("entry-1")
	e2 := []byte("entry-2")
	genesis := []byte{}
	h1 := ChainHash(genesis, e1)
	h2 := ChainHash(h1, e2)
	// Recomputing with the same inputs is stable.
	if !bytes.Equal(h2, ChainHash(ChainHash(genesis, e1), e2)) {
		t.Fatal("chain must be deterministic")
	}
	// Altering an earlier entry breaks every downstream link.
	h1b := ChainHash(genesis, []byte("entry-1-altered"))
	if bytes.Equal(h2, ChainHash(h1b, e2)) {
		t.Fatal("altering an earlier entry must change the chain head")
	}
}

func TestBadSeed(t *testing.T) {
	short := base64.StdEncoding.EncodeToString(make([]byte, 16))
	if _, err := NewSignerFromSeed("x", short); err != ErrSeedLength {
		t.Fatalf("want ErrSeedLength, got %v", err)
	}
}
