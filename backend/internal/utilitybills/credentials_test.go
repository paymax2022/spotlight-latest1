package utilitybills

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

// The whole point of credentials.go is that rows encrypted by the Node
// implementation keep decrypting here. These tests pin the three things that
// could silently break that: which key-derivation branch a given
// UTILITY_PROVIDER_CREDENTIALS_KEY takes, how base64 is decoded, and the
// separate-auth-tag envelope layout.

func TestDeriveCredentialsKey_HexBranch(t *testing.T) {
	// 64 hex chars → decoded as hex, NOT hashed and NOT base64-decoded.
	raw := strings.Repeat("ab", 32) // 64 chars
	got, err := DeriveCredentialsKey(raw)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	want, _ := hex.DecodeString(raw)
	if string(got) != string(want) {
		t.Fatalf("hex branch: got %x want %x", got, want)
	}
	if len(got) != 32 {
		t.Fatalf("hex branch produced %d bytes, want 32", len(got))
	}
}

func TestDeriveCredentialsKey_HexBranchIsCaseInsensitive(t *testing.T) {
	// credentials.ts uses /^[a-f0-9]{64}$/i — the `i` flag matters.
	upper := strings.Repeat("AB", 32)
	got, err := DeriveCredentialsKey(upper)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	want, _ := hex.DecodeString(upper)
	if string(got) != string(want) {
		t.Fatalf("uppercase hex took the wrong branch: got %x want %x", got, want)
	}
}

func TestDeriveCredentialsKey_Base64Branch(t *testing.T) {
	keyBytes := make([]byte, 32)
	for i := range keyBytes {
		keyBytes[i] = byte(i * 7)
	}
	raw := base64.StdEncoding.EncodeToString(keyBytes)
	got, err := DeriveCredentialsKey(raw)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if string(got) != string(keyBytes) {
		t.Fatalf("base64 branch: got %x want %x", got, keyBytes)
	}
}

func TestDeriveCredentialsKey_PassphraseBranch(t *testing.T) {
	raw := "not hex, not 32 base64 bytes — just a passphrase"
	got, err := DeriveCredentialsKey(raw)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	want := sha256.Sum256([]byte(raw))
	if string(got) != string(want[:]) {
		t.Fatalf("passphrase branch: got %x want %x", got, want)
	}
}

func TestDeriveCredentialsKey_EmptyIsAnError(t *testing.T) {
	if _, err := DeriveCredentialsKey(""); !errors.Is(err, ErrCredentialsKeyMissing) {
		t.Fatalf("empty key: got %v want ErrCredentialsKeyMissing", err)
	}
}

// A 64-char string that is valid hex is ALSO valid base64 input. The TS source
// checks hex FIRST, so the ordering is load-bearing: taking the base64 branch
// would derive completely different key bytes from the same configured value.
func TestDeriveCredentialsKey_HexWinsOverBase64(t *testing.T) {
	raw := strings.Repeat("ab", 32)
	viaHex, _ := hex.DecodeString(raw)
	got, err := DeriveCredentialsKey(raw)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if string(got) != string(viaHex) {
		t.Fatalf("hex/base64 ordering regressed: got %x want %x", got, viaHex)
	}
}

func TestNodeBase64Decode_SkipsInvalidCharacters(t *testing.T) {
	keyBytes := make([]byte, 32)
	for i := range keyBytes {
		keyBytes[i] = byte(200 - i)
	}
	clean := base64.StdEncoding.EncodeToString(keyBytes)

	// Node skips whitespace, newlines and stray punctuation rather than erroring —
	// an operator pasting a wrapped key into a .env file is the realistic case.
	dirty := clean[:10] + "\n " + clean[10:20] + "\t" + clean[20:]
	got := nodeBase64Decode(dirty)
	if string(got) != string(keyBytes) {
		t.Fatalf("lenient decode: got %x want %x", got, keyBytes)
	}
}

func TestNodeBase64Decode_URLSafeAlphabet(t *testing.T) {
	// Pick bytes that force '+' and '/' in standard base64, then feed the URL-safe
	// spelling — Node accepts both in 'base64' mode.
	raw := []byte{0xfb, 0xff, 0xbf, 0xfb, 0xef, 0xbe}
	std := base64.StdEncoding.EncodeToString(raw)
	if !strings.ContainsAny(std, "+/") {
		t.Fatalf("test fixture no longer exercises +/: %q", std)
	}
	urlSafe := strings.NewReplacer("+", "-", "/", "_").Replace(std)
	if got := nodeBase64Decode(urlSafe); string(got) != string(raw) {
		t.Fatalf("url-safe decode: got %x want %x", got, raw)
	}
}

func TestNodeBase64Decode_TruncatedFinalGroup(t *testing.T) {
	raw := []byte{0x01, 0x02, 0x03, 0x04}
	std := base64.StdEncoding.EncodeToString(raw) // "AQIDBA=="
	// Strip the padding: Node decodes the 6-char remainder just fine.
	if got := nodeBase64Decode(strings.TrimRight(std, "=")); string(got) != string(raw) {
		t.Fatalf("unpadded decode: got %x want %x", got, raw)
	}
}

func TestEncryptDecryptCredentials_RoundTrip(t *testing.T) {
	key, err := DeriveCredentialsKey(strings.Repeat("0f", 32))
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	secrets := map[string]any{
		"api_key":    "vt-live-abc123",
		"public_key": "PK_xyz",
		"nested":     map[string]any{"note": "kept verbatim"},
	}
	env, err := EncryptCredentials(key, secrets)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !env.Encrypted || env.Algorithm != CredentialsAlgorithm || env.KeyID != CredentialsKeyID {
		t.Fatalf("envelope header wrong: %+v", env)
	}
	// The IV must be 12 bytes (GCM standard nonce) and the tag 16.
	if iv := nodeBase64Decode(env.IV); len(iv) != 12 {
		t.Fatalf("iv is %d bytes, want 12", len(iv))
	}
	if tag := nodeBase64Decode(env.Tag); len(tag) != 16 {
		t.Fatalf("tag is %d bytes, want 16", len(tag))
	}

	out, err := DecryptCredentials(key, env)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if out["api_key"] != "vt-live-abc123" || out["public_key"] != "PK_xyz" {
		t.Fatalf("round trip lost fields: %#v", out)
	}
}

func TestEncryptCredentials_FreshIVPerCall(t *testing.T) {
	// GCM's security collapses if an IV is ever reused with the same key. This
	// pins that EncryptCredentials generates a new one every call rather than, say,
	// deriving it from the payload.
	key, _ := DeriveCredentialsKey(strings.Repeat("0f", 32))
	a, err := EncryptCredentials(key, map[string]any{"k": "v"})
	if err != nil {
		t.Fatalf("encrypt a: %v", err)
	}
	b, err := EncryptCredentials(key, map[string]any{"k": "v"})
	if err != nil {
		t.Fatalf("encrypt b: %v", err)
	}
	if a.IV == b.IV {
		t.Fatal("IV reused across calls — GCM key/IV pair must never repeat")
	}
	if a.Ciphertext == b.Ciphertext {
		t.Fatal("identical ciphertext for identical plaintext — IV is not being mixed in")
	}
}

func TestDecryptCredentials_WrongKeyFails(t *testing.T) {
	key, _ := DeriveCredentialsKey(strings.Repeat("0f", 32))
	other, _ := DeriveCredentialsKey(strings.Repeat("f0", 32))
	env, err := EncryptCredentials(key, map[string]any{"api_key": "secret"})
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := DecryptCredentials(other, env); err == nil {
		t.Fatal("decrypt with the wrong key succeeded — the auth tag is not being checked")
	}
}

func TestDecryptCredentials_TamperedCiphertextFails(t *testing.T) {
	key, _ := DeriveCredentialsKey(strings.Repeat("0f", 32))
	env, _ := EncryptCredentials(key, map[string]any{"api_key": "secret"})

	ct := nodeBase64Decode(env.Ciphertext)
	ct[0] ^= 0xff
	env.Ciphertext = base64.StdEncoding.EncodeToString(ct)

	if _, err := DecryptCredentials(key, env); err == nil {
		t.Fatal("tampered ciphertext decrypted — GCM integrity is not enforced")
	}
}

func TestIsEncryptedCredentials(t *testing.T) {
	cases := []struct {
		name string
		json string
		want bool
	}{
		{"our envelope", `{"encrypted":true,"algorithm":"aes-256-gcm","iv":"x","tag":"y","ciphertext":"z"}`, true},
		{"plaintext object", `{"api_key":"abc"}`, false},
		{"encrypted false", `{"encrypted":false,"algorithm":"aes-256-gcm"}`, false},
		{"other algorithm", `{"encrypted":true,"algorithm":"aes-128-gcm"}`, false},
		{"null", `null`, false},
		{"empty", ``, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsEncryptedCredentials([]byte(tc.json)); got != tc.want {
				t.Fatalf("got %t want %t", got, tc.want)
			}
		})
	}
}

func TestDecryptCredentialsJSON_AbsentCredentialsIsNotAnError(t *testing.T) {
	key, _ := DeriveCredentialsKey(strings.Repeat("0f", 32))
	// A provider row with credentials NULL (or a legacy plaintext object) must fall
	// back to process-level env configuration, not fail the whole purchase.
	for _, raw := range []string{"", "null", `{"api_key":"legacy-plaintext"}`} {
		out, err := DecryptCredentialsJSON(key, []byte(raw))
		if err != nil {
			t.Fatalf("raw=%q: unexpected error %v", raw, err)
		}
		if out != nil {
			t.Fatalf("raw=%q: expected nil credentials, got %#v", raw, out)
		}
	}
}

func TestCredentialString(t *testing.T) {
	creds := map[string]any{"api_key": "abc", "count": 3}
	if got := CredentialString(creds, "api_key"); got != "abc" {
		t.Fatalf("api_key: got %q", got)
	}
	if got := CredentialString(creds, "count"); got != "" {
		t.Fatalf("non-string value should be empty, got %q", got)
	}
	if got := CredentialString(nil, "api_key"); got != "" {
		t.Fatalf("nil map should be empty, got %q", got)
	}
}
