package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func testKey(t *testing.T) string {
	t.Helper()
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(k)
}

func TestRoundTrip(t *testing.T) {
	c, err := NewCipherFromBase64Key(testKey(t))
	if err != nil {
		t.Fatal(err)
	}
	pt := []byte("selfie-bytes + BVN 22222222222")
	aad := []byte("check:abc123")
	ct, err := c.Encrypt(pt, aad)
	if err != nil {
		t.Fatal(err)
	}
	if ct == string(pt) {
		t.Fatal("ciphertext must not equal plaintext")
	}
	got, err := c.Decrypt(ct, aad)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(pt) {
		t.Fatalf("round-trip mismatch: %q", got)
	}
}

func TestTamperDetected(t *testing.T) {
	c, _ := NewCipherFromBase64Key(testKey(t))
	ct, _ := c.Encrypt([]byte("secret"), nil)
	raw, _ := base64.StdEncoding.DecodeString(ct)
	raw[len(raw)-1] ^= 0xFF // flip a tag bit
	if _, err := c.Decrypt(base64.StdEncoding.EncodeToString(raw), nil); err == nil {
		t.Fatal("tampered ciphertext must fail authentication")
	}
}

func TestWrongAADFails(t *testing.T) {
	c, _ := NewCipherFromBase64Key(testKey(t))
	ct, _ := c.Encrypt([]byte("secret"), []byte("aad-1"))
	if _, err := c.Decrypt(ct, []byte("aad-2")); err == nil {
		t.Fatal("mismatched AAD must fail")
	}
}

func TestBadKeyLength(t *testing.T) {
	short := base64.StdEncoding.EncodeToString(make([]byte, 16))
	if _, err := NewCipherFromBase64Key(short); err != ErrKeyLength {
		t.Fatalf("want ErrKeyLength, got %v", err)
	}
}
