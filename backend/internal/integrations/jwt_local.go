package integrations

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"
)

// Local verification of Supabase access tokens (ADR-PR395).
//
// Every AuthUser call is otherwise a GoTrue GET /auth/v1/user round trip.
// Load testing showed GoTrue/Kong saturates before the API or Postgres — the
// per-request upstream call is the measured capacity ceiling (200 VU: ~50%
// 503 while Postgres was fine). When local verification is configured, AuthUser
// verifies the signature + exp locally instead: same 401 semantics (a token
// that fails local verification is definitively invalid — there is no
// transport failure mode), zero per-request network.
//
// Two verification materials, because Supabase signs with either:
//   - ES256 via asymmetric keys (GOTRUE_JWT_KEYS — default on current
//     Supabase): public key resolved from <supabase>/auth/v1/.well-known/jwks.json
//     by kid, fetched lazily and cached; refetched once on an unknown kid so
//     key rotation does not wedge the process.
//   - HS256 via the legacy shared JWT secret (SUPABASE_JWT_SECRET), for older
//     projects or tokens minted before key rotation.
//
// Revocation caveat (why this is opt-in via AUTH_JWT_LOCAL_VERIFY): local
// verification cannot see GoTrue-side logout/password-change until exp lapses.
// The platform_users status check in RequireAuthContext still runs per request,
// so suspended/locked/deleted accounts stay blocked; only GoTrue session
// revocation gets a staleness window bounded by the access-token TTL.

// SetJWTSecret enables local HS256 verification for legacy-signed tokens.
// Empty string disables it (ES256 via JWKS is independent of this).
func (c *SupabaseRestClient) SetJWTSecret(secret string) {
	c.jwtSecret = []byte(strings.TrimSpace(secret))
}

// EnableLocalJWTVerify turns on local token verification. It derives the JWKS
// endpoint from the client's Supabase base URL and optionally accepts an HS256
// secret. Called once at startup; safe to leave on for the process lifetime.
func (c *SupabaseRestClient) EnableLocalJWTVerify(hs256Secret string) {
	c.localVerify = true
	c.SetJWTSecret(hs256Secret)
}

type jwksKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// fetchJWKS pulls the signing keys. Called at most once per unknown-kid event;
// the result is cached under c.jwksMu.
func (c *SupabaseRestClient) fetchJWKS(ctx context.Context) (map[string]jwksKey, error) {
	u := strings.TrimRight(c.baseURL, "/") + "/auth/v1/.well-known/jwks.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	if c.apiKey != "" {
		req.Header.Set("Apikey", c.apiKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks fetch failed: %d", resp.StatusCode)
	}
	var doc struct {
		Keys []jwksKey `json:"keys"`
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	out := make(map[string]jwksKey, len(doc.Keys))
	for _, k := range doc.Keys {
		out[k.Kid] = k
	}
	return out, nil
}

// jwksFor returns the cached key set, fetching on first use. On a cache miss
// for the requested kid it refetches once (key rotation) before failing.
func (c *SupabaseRestClient) jwksFor(ctx context.Context, kid string) (jwksKey, error) {
	c.jwksMu.Lock()
	defer c.jwksMu.Unlock()
	if c.jwks == nil {
		keys, err := c.fetchJWKS(ctx)
		if err != nil {
			return jwksKey{}, fmt.Errorf("jwks unavailable: %w", err)
		}
		c.jwks = keys
	}
	k, ok := c.jwks[kid]
	if !ok {
		keys, err := c.fetchJWKS(ctx)
		if err != nil {
			return jwksKey{}, fmt.Errorf("jwks unavailable: %w", err)
		}
		c.jwks = keys
		k, ok = c.jwks[kid]
	}
	if !ok {
		return jwksKey{}, fmt.Errorf("unknown kid %q: %w", kid, ErrTokenInvalid)
	}
	return k, nil
}

func b64url(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

func (c *SupabaseRestClient) verifySignature(ctx context.Context, parts []string, alg, kid string) error {
	signingInput := []byte(parts[0] + "." + parts[1])
	sig, err := b64url(parts[2])
	if err != nil {
		return fmt.Errorf("malformed jwt signature: %w", ErrTokenInvalid)
	}
	digest := sha256.Sum256(signingInput)
	switch alg {
	case "HS256":
		if len(c.jwtSecret) == 0 {
			return fmt.Errorf("HS256 token but no JWT secret configured: %w", ErrTokenInvalid)
		}
		mac := hmac.New(sha256.New, c.jwtSecret)
		mac.Write(signingInput)
		if !hmac.Equal(sig, mac.Sum(nil)) {
			return fmt.Errorf("bad jwt signature: %w", ErrTokenInvalid)
		}
		return nil
	case "ES256":
		k, err := c.jwksFor(ctx, kid)
		if err != nil {
			return err
		}
		if k.Kty != "EC" || k.Crv != "P-256" {
			return fmt.Errorf("unexpected jwk for ES256: %w", ErrTokenInvalid)
		}
		xb, err := b64url(k.X)
		if err != nil {
			return fmt.Errorf("bad jwk x: %w", ErrTokenInvalid)
		}
		yb, err := b64url(k.Y)
		if err != nil {
			return fmt.Errorf("bad jwk y: %w", ErrTokenInvalid)
		}
		if len(sig) != 64 {
			return fmt.Errorf("bad ES256 signature length: %w", ErrTokenInvalid)
		}
		// Uncompressed SEC-1 point: 0x04 || X(32) || Y(32). ParseUncompressedPublicKey
		// is the non-deprecated way to build a key from raw coordinates (SA1019).
		point := make([]byte, 1, 65)
		point[0] = 4
		point = append(point, xb...)
		point = append(point, yb...)
		pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), point)
		if err != nil {
			return fmt.Errorf("bad jwk point: %w", ErrTokenInvalid)
		}
		r := new(big.Int).SetBytes(sig[:32])
		s := new(big.Int).SetBytes(sig[32:])
		if !ecdsa.Verify(pub, digest[:], r, s) {
			return fmt.Errorf("bad jwt signature: %w", ErrTokenInvalid)
		}
		return nil
	default:
		return fmt.Errorf("unsupported jwt alg %q: %w", alg, ErrTokenInvalid)
	}
}

func (c *SupabaseRestClient) verifyLocalJWT(ctx context.Context, token string) (map[string]any, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed jwt: %w", ErrTokenInvalid)
	}
	header, err := b64url(parts[0])
	if err != nil {
		return nil, fmt.Errorf("malformed jwt header: %w", ErrTokenInvalid)
	}
	var hdr struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(header, &hdr); err != nil {
		return nil, fmt.Errorf("malformed jwt header: %w", ErrTokenInvalid)
	}
	if err := c.verifySignature(ctx, parts, hdr.Alg, hdr.Kid); err != nil {
		return nil, err
	}
	payload, err := b64url(parts[1])
	if err != nil {
		return nil, fmt.Errorf("malformed jwt payload: %w", ErrTokenInvalid)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("malformed jwt claims: %w", ErrTokenInvalid)
	}
	now := time.Now().Unix()
	if exp, ok := claims["exp"].(float64); !ok || int64(exp) <= now {
		return nil, fmt.Errorf("jwt expired: %w", ErrTokenInvalid)
	}
	if nbf, ok := claims["nbf"].(float64); ok && int64(nbf) > now {
		return nil, fmt.Errorf("jwt not yet valid: %w", ErrTokenInvalid)
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return nil, fmt.Errorf("jwt missing sub: %w", ErrTokenInvalid)
	}
	// GoTrue's /auth/v1/user returns id at the top level; claims carry sub.
	claims["id"] = sub
	return claims, nil
}
