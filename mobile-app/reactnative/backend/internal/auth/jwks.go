// jwks.go adds an RS256 JWT verifier that validates tokens against a JWKS
// endpoint. Supabase projects can issue RS256 (asymmetric) tokens, in which case
// the service has no shared secret and must verify with the project's public key.
//
// Stdlib-only (crypto/rsa, crypto/x509-free, math/big for n/e decoding), so the
// dependency-free build keeps working. JWKSVerifier is a drop-in for the HS256
// Verify path: it produces the same Claims and the same typed errors, so the
// existing Middleware/ctx helpers in auth.go are reused unchanged.
package auth

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// JWKSVerifier fetches and caches a JSON Web Key Set, then verifies RS256 JWTs
// against the cached public keys (selected by the token's "kid").
type JWKSVerifier struct {
	url       string
	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
	ttl       time.Duration
	client    *http.Client
}

// NewJWKSVerifier returns a verifier that lazily fetches the JWKS at jwksURL and
// refreshes it once the cache TTL (~10m) lapses.
func NewJWKSVerifier(jwksURL string) *JWKSVerifier {
	return &JWKSVerifier{
		url:    jwksURL,
		keys:   map[string]*rsa.PublicKey{},
		ttl:    10 * time.Minute,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// jwk is one key in a JWKS document.
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

// Verify checks an RS256 JWT against the JWKS public keys and returns its claims.
// The algorithm is pinned to RS256 to prevent "alg" confusion / "none" attacks.
func (v *JWKSVerifier) Verify(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrMalformed
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return Claims{}, ErrMalformed
	}
	if header.Alg != "RS256" {
		return Claims{}, ErrAlg
	}

	key, err := v.keyFor(header.Kid)
	if err != nil {
		return Claims{}, err
	}

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	signed := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, signed[:], sig); err != nil {
		return Claims{}, ErrSignature
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	var c Claims
	if err := json.Unmarshal(payloadBytes, &c); err != nil {
		return Claims{}, ErrMalformed
	}
	if c.Exp != 0 && time.Now().Unix() >= c.Exp {
		return Claims{}, ErrExpired
	}
	if c.Sub == "" {
		return Claims{}, ErrNoSubject
	}
	return c, nil
}

// keyFor returns the cached public key for kid, refreshing the JWKS first if the
// cache is stale or the kid is unknown (handles key rotation).
func (v *JWKSVerifier) keyFor(kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	stale := time.Since(v.fetchedAt) >= v.ttl
	if _, ok := v.keys[kid]; !ok || stale {
		if err := v.refresh(); err != nil {
			// Tolerate a refresh failure if we still hold the requested key.
			if k, ok := v.keys[kid]; ok {
				return k, nil
			}
			return nil, err
		}
	}
	k, ok := v.keys[kid]
	if !ok {
		return nil, ErrSignature // unknown kid → cannot verify
	}
	return k, nil
}

// refresh fetches the JWKS and replaces the in-memory key cache. The caller holds
// v.mu.
func (v *JWKSVerifier) refresh() error {
	resp, err := v.client.Get(v.url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("jwks: unexpected status " + resp.Status)
	}

	var doc struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return err
	}

	keys := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" {
			continue
		}
		pub, err := rsaPublicKey(k.N, k.E)
		if err != nil {
			continue // skip malformed keys rather than failing the whole set
		}
		keys[k.Kid] = pub
	}
	if len(keys) == 0 {
		return errors.New("jwks: no usable RSA keys")
	}
	v.keys = keys
	v.fetchedAt = time.Now()
	return nil
}

// rsaPublicKey builds an *rsa.PublicKey from the base64url-encoded modulus (n) and
// exponent (e) fields of a JWK.
func rsaPublicKey(nStr, eStr string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nStr)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eStr)
	if err != nil {
		return nil, err
	}
	if len(nBytes) == 0 || len(eBytes) == 0 {
		return nil, errors.New("jwks: empty modulus or exponent")
	}

	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)
	if !e.IsInt64() || e.Int64() <= 0 {
		return nil, errors.New("jwks: invalid exponent")
	}
	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}
