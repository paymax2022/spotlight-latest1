package maps

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"testing"
	"time"
)

// ── Encryptor tests (DB-free) ─────────────────────────────────────────────────

func TestAESEncryptor_RoundTrip(t *testing.T) {
	key := make([]byte, 32) // AES-256
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("key gen: %v", err)
	}
	enc, err := NewAESEncryptor(key)
	if err != nil {
		t.Fatalf("new aes: %v", err)
	}
	plaintext := []byte("10 Awolowo Road, Ikoyi, Lagos\n{\"city\":\"Lagos\"}")

	ct, err := enc.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if bytes.Equal(ct, plaintext) {
		t.Fatalf("ciphertext must not equal plaintext (PII left in the clear)")
	}
	pt, err := enc.Decrypt(ct)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(pt, plaintext) {
		t.Fatalf("round-trip mismatch: got %q want %q", pt, plaintext)
	}
}

func TestAESEncryptor_NonceIsRandom(t *testing.T) {
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	enc, _ := NewAESEncryptor(key)
	a, _ := enc.Encrypt([]byte("same plaintext"))
	b, _ := enc.Encrypt([]byte("same plaintext"))
	if bytes.Equal(a, b) {
		t.Fatalf("two encryptions of the same plaintext must differ (random nonce)")
	}
}

func TestAESEncryptor_RejectsBadKey(t *testing.T) {
	if _, err := NewAESEncryptor(make([]byte, 7)); !errors.Is(err, ErrEncryptorKeySize) {
		t.Fatalf("expected ErrEncryptorKeySize for a 7-byte key, got %v", err)
	}
}

func TestAESEncryptor_RejectsTampered(t *testing.T) {
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	enc, _ := NewAESEncryptor(key)
	ct, _ := enc.Encrypt([]byte("authenticated payload"))
	ct[len(ct)-1] ^= 0xFF // flip a ciphertext byte → GCM auth must fail
	if _, err := enc.Decrypt(ct); err == nil {
		t.Fatalf("tampered ciphertext must fail authentication")
	}
}

func TestAESEncryptor_EmptyInput(t *testing.T) {
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	enc, _ := NewAESEncryptor(key)
	ct, err := enc.Encrypt(nil)
	if err != nil || len(ct) != 0 {
		t.Fatalf("empty plaintext must encrypt to empty, got ct=%v err=%v", ct, err)
	}
	pt, err := enc.Decrypt(nil)
	if err != nil || len(pt) != 0 {
		t.Fatalf("empty ciphertext must decrypt to empty, got pt=%v err=%v", pt, err)
	}
}

func TestNoopEncryptor_PassThrough(t *testing.T) {
	var enc Encryptor = NoopEncryptor{}
	in := []byte("plain")
	out, err := enc.Encrypt(in)
	if err != nil || !bytes.Equal(out, in) {
		t.Fatalf("noop encrypt must pass through, got %q err=%v", out, err)
	}
	back, err := enc.Decrypt(out)
	if err != nil || !bytes.Equal(back, in) {
		t.Fatalf("noop decrypt must pass through, got %q err=%v", back, err)
	}
}

// ── Gazetteer construction / nil-safety (DB-free) ──────────────────────────────

func TestNewGazetteer_DefaultsToNoopEncryptor(t *testing.T) {
	// nil encryptor must not panic and must yield a working store.
	g := NewGazetteer(nil, nil)
	if g == nil || g.enc == nil {
		t.Fatalf("NewGazetteer must default a nil encryptor to NoopEncryptor")
	}
}

func TestGazetteer_NilPoolIsSafe(t *testing.T) {
	g := NewGazetteer(nil, NoopEncryptor{})
	ctx := context.Background()

	if _, ok, err := g.Lookup(ctx, "10 awolowo road ikoyi", "gcpuvpk"); ok || err != nil {
		t.Fatalf("nil-pool Lookup must be a safe miss, got ok=%v err=%v", ok, err)
	}
	if _, ok, err := g.ReverseLookup(ctx, "gcpuvpk", 6.45, 3.39); ok || err != nil {
		t.Fatalf("nil-pool ReverseLookup must be a safe miss, got ok=%v err=%v", ok, err)
	}
	if err := g.Upsert(ctx, GazetteerEntry{NormalizedAddr: "x", Lat: 6.45, Lng: 3.39}); err != nil {
		t.Fatalf("nil-pool Upsert must be a no-op, got %v", err)
	}
}

func TestGazetteer_EmptyAddressLookupMisses(t *testing.T) {
	g := NewGazetteer(nil, NoopEncryptor{})
	if _, ok, _ := g.Lookup(context.Background(), "", "cell"); ok {
		t.Fatalf("empty normalized address must miss without a query")
	}
}

func TestGazetteer_ImplementsStore(t *testing.T) {
	// Exact interface conformance (compile-time + explicit).
	var _ GazetteerStore = (*Gazetteer)(nil)
	var _ GazetteerStore = NewGazetteer(nil, nil)
}

// ── PII payload + null helpers ─────────────────────────────────────────────────

func TestGazetteerPII_PacksAddressAndComponents(t *testing.T) {
	e := GazetteerEntry{NormalizedAddr: "10 awolowo road ikoyi", Components: `{"city":"Lagos"}`}
	got := string(gazetteerPII(e))
	if want := "10 awolowo road ikoyi\n{\"city\":\"Lagos\"}"; got != want {
		t.Fatalf("PII payload mismatch:\n got %q\nwant %q", got, want)
	}
	if gazetteerPII(GazetteerEntry{}) != nil {
		t.Fatalf("empty entry must produce a nil PII payload (nothing to encrypt)")
	}
}

func TestPIIIsEncryptedAtRest(t *testing.T) {
	// The payload handed to the Encryptor must be the PII bytes; with a real AES
	// encryptor the resulting at-rest blob must not contain the plaintext address.
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	enc, _ := NewAESEncryptor(key)
	e := GazetteerEntry{NormalizedAddr: "10 awolowo road ikoyi", Components: `{"city":"Lagos"}`}
	blob, err := enc.Encrypt(gazetteerPII(e))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if bytes.Contains(blob, []byte("awolowo")) {
		t.Fatalf("encrypted_pii blob leaks plaintext address")
	}
}

func TestNullUUID(t *testing.T) {
	if nullUUID("") != nil {
		t.Fatalf("empty id must map to SQL NULL")
	}
	if got := nullUUID("abc"); got != "abc" {
		t.Fatalf("non-empty id must pass through, got %v", got)
	}
}

func TestNullableTime(t *testing.T) {
	if nullableTime(time.Time{}) != nil {
		t.Fatalf("zero time must map to SQL NULL (so column default applies)")
	}
	ts := time.Date(2026, 6, 27, 0, 0, 0, 0, time.UTC)
	if got := nullableTime(ts); got != any(ts) {
		t.Fatalf("set time must pass through, got %v", got)
	}
}

func TestNzSource(t *testing.T) {
	if got := nzSource(""); got != "user_saved" {
		t.Fatalf("empty source must default to user_saved, got %q", got)
	}
	if got := nzSource("courier_pin"); got != "courier_pin" {
		t.Fatalf("set source must pass through, got %q", got)
	}
}
