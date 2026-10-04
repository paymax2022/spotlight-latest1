package rtc

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// Fake credentials. Deliberately short and non-random-shaped so the secret
// scanner reads them as fixtures, not a leaked key.
const (
	testAPIKey = "videosdk_test_key"
	testSecret = "videosdk_test_secret"
)

// decodeSegment base64url-decodes one JWT segment (no padding).
func decodeSegment(t *testing.T, seg string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		t.Fatalf("segment %q is not base64url: %v", seg, err)
	}
	return b
}

// TestVideoSDKTokenSignsAndPacks proves the token is a structurally valid HS256
// JWT whose signature actually verifies against the secret — i.e. the signing
// input is header.payload and not some other concatenation, which is the bug the
// signature exists to catch.
func TestVideoSDKTokenSignsAndPacks(t *testing.T) {
	tok, err := BuildVideoSDKToken(testAPIKey, testSecret, time.Hour)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d segments, want 3 (header.payload.signature)", len(parts))
	}
	if strings.Contains(tok, "=") {
		t.Error("token contains '=' — JWT segments must be unpadded base64url")
	}

	var header map[string]any
	if err := json.Unmarshal(decodeSegment(t, parts[0]), &header); err != nil {
		t.Fatalf("header: %v", err)
	}
	if header["alg"] != "HS256" || header["typ"] != "JWT" {
		t.Errorf("header = %v, want alg=HS256 typ=JWT", header)
	}

	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	wantSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if parts[2] != wantSig {
		t.Errorf("signature = %q, want HMAC-SHA256 over header.payload = %q", parts[2], wantSig)
	}
}

// TestVideoSDKTokenClaims pins the payload VideoSDK validates server-side, and
// that exp tracks the requested ttl.
func TestVideoSDKTokenClaims(t *testing.T) {
	const ttl = 30 * time.Minute
	before := time.Now().Add(ttl).Unix()
	tok, err := BuildVideoSDKToken(testAPIKey, testSecret, ttl)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	after := time.Now().Add(ttl).Unix()

	var payload struct {
		APIKey      string   `json:"apikey"`
		Permissions []string `json:"permissions"`
		Version     int      `json:"version"`
		Iat         int64    `json:"iat"`
		Exp         int64    `json:"exp"`
	}
	if err := json.Unmarshal(decodeSegment(t, strings.Split(tok, ".")[1]), &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}

	if payload.APIKey != testAPIKey {
		t.Errorf("apikey = %q, want %q", payload.APIKey, testAPIKey)
	}
	if payload.Version != 2 {
		t.Errorf("version = %d, want 2", payload.Version)
	}
	if len(payload.Permissions) != 1 || payload.Permissions[0] != "allow_join" {
		t.Errorf("permissions = %v, want [allow_join]", payload.Permissions)
	}
	if payload.Exp < before || payload.Exp > after {
		t.Errorf("exp = %d, want within [%d,%d] for a %s ttl", payload.Exp, before, after, ttl)
	}
	if payload.Exp-payload.Iat != int64(ttl/time.Second) {
		t.Errorf("exp-iat = %d, want %d", payload.Exp-payload.Iat, int64(ttl/time.Second))
	}
}

// TestVideoSDKMissingCreds confirms the disabled path returns the sentinel and
// never a partial token.
func TestVideoSDKMissingCreds(t *testing.T) {
	for _, tc := range []struct{ name, key, secret string }{
		{"empty key", "", testSecret},
		{"empty secret", testAPIKey, ""},
		{"both empty", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tok, err := BuildVideoSDKToken(tc.key, tc.secret, time.Hour)
			if !errors.Is(err, ErrVideoSDKMissingCreds) {
				t.Errorf("err = %v, want ErrVideoSDKMissingCreds", err)
			}
			if tok != "" {
				t.Errorf("token = %q — a token must never be fabricated without creds", tok)
			}
		})
	}
}

// TestIssuerVideoSDKOnly locks the surviving provider contract: VideoSDK is the
// only provider this Issuer knows, an unconfigured issuer refuses with
// ErrRTCNotConfigured, and a legacy "agora" value is refused as unknown rather
// than silently swapped for a VideoSDK token.
func TestIssuerVideoSDKOnly(t *testing.T) {
	configured := NewIssuer(Config{VideoSDKAPIKey: testAPIKey, VideoSDKSecret: testSecret})
	unconfigured := NewIssuer(Config{})

	if !configured.Enabled(ProviderVideoSDK) {
		t.Error("configured issuer should report VideoSDK enabled")
	}
	if unconfigured.Enabled(ProviderVideoSDK) {
		t.Error("issuer without creds must not report VideoSDK enabled")
	}
	if configured.Enabled("agora") {
		t.Error("agora is no longer a supported provider — Enabled must be false")
	}
	if configured.Enabled("") {
		t.Error("empty provider must not be enabled")
	}

	tok, exp, err := configured.Token(ProviderVideoSDK, "appointment-1", "42", time.Hour)
	if err != nil {
		t.Fatalf("configured Token: %v", err)
	}
	if tok == "" || exp.IsZero() {
		t.Error("configured issuer must return a token and an expiry")
	}

	for _, tc := range []struct {
		name, provider string
		issuer         *Issuer
		wantErr        error
	}{
		{"unconfigured", ProviderVideoSDK, unconfigured, ErrRTCNotConfigured},
		{"legacy agora", "agora", configured, ErrUnknownProvider},
		{"unknown", "livekit", configured, ErrUnknownProvider},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tok, exp, err := tc.issuer.Token(tc.provider, "appointment-1", "42", time.Hour)
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("err = %v, want %v", err, tc.wantErr)
			}
			if tok != "" {
				t.Errorf("token = %q, want empty on refusal", tok)
			}
			if !exp.IsZero() {
				t.Errorf("expiry = %v, want zero on refusal", exp)
			}
		})
	}
}

// TestIssuerDefaultTTL confirms a non-positive ttl is replaced by one hour rather
// than minting an already-expired (or never-expiring) token.
func TestIssuerDefaultTTL(t *testing.T) {
	issuer := NewIssuer(Config{VideoSDKAPIKey: testAPIKey, VideoSDKSecret: testSecret})
	_, exp, err := issuer.Token(ProviderVideoSDK, "appointment-1", "42", 0)
	if err != nil {
		t.Fatalf("Token: %v", err)
	}
	if got := time.Until(exp); got < 55*time.Minute || got > 65*time.Minute {
		t.Errorf("ttl = %s, want ~1h", got)
	}
}
