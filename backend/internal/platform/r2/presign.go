// Package r2 issues presigned Cloudflare R2 (S3-compatible) URLs using only the
// Go standard library — no aws-sdk dependency. It implements AWS Signature V4
// query-string presigning (the "X-Amz-*" query params form), which R2 accepts on
// its S3 API endpoint.
//
// Security model:
//   - Credentials (access key / secret) are SERVER-SIDE ONLY and never shipped to
//     a client. The presigner mints a short-lived URL the client uses for a single
//     PUT (upload) or GET (download); the client never sees the secret.
//   - Object keys are chosen by the backend (callers pass a key prefix + the
//     server derives the final key), so a client cannot overwrite arbitrary
//     objects.
//
// Reference: AWS SigV4 "Authenticating Requests: Using Query Parameters".
package r2

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

// UnsignedPayload is the SigV4 sentinel allowing a presigned URL whose body is not
// known at signing time (correct for browser/mobile PUT uploads).
const UnsignedPayload = "UNSIGNED-PAYLOAD"

// ErrNotConfigured is returned when the presigner is built without complete creds.
var ErrNotConfigured = errors.New("r2: presigner is not configured")

// Config holds the server-side R2/S3 connection settings.
type Config struct {
	// AccountEndpoint is the R2 S3 API base, e.g.
	// "https://<accountid>.r2.cloudflarestorage.com". No trailing slash, no bucket.
	AccountEndpoint string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	// Region: R2 ignores region but SigV4 requires one; "auto" is the R2 convention.
	Region string
}

// Presigner mints presigned R2 URLs. A zero-value or incompletely-configured
// Presigner reports Configured()==false and returns ErrNotConfigured, so callers
// can fail closed without panicking.
type Presigner struct {
	cfg  Config
	host string // host portion of AccountEndpoint (for the Host header in canonical request)
}

// New builds a Presigner. It validates the endpoint but does not dial anything.
// When required fields are missing it returns a Presigner whose Configured() is
// false (and every Presign* call returns ErrNotConfigured) rather than an error,
// so wiring code can degrade gracefully when R2 env is absent.
func New(cfg Config) *Presigner {
	if cfg.Region == "" {
		cfg.Region = "auto"
	}
	p := &Presigner{cfg: cfg}
	if u, err := url.Parse(cfg.AccountEndpoint); err == nil {
		p.host = u.Host
	}
	return p
}

// Configured reports whether all required fields are present.
func (p *Presigner) Configured() bool {
	return p != nil && p.cfg.AccountEndpoint != "" && p.host != "" &&
		p.cfg.Bucket != "" && p.cfg.AccessKeyID != "" && p.cfg.SecretAccessKey != ""
}

// PresignPut returns a presigned URL the client may PUT to, valid for expiry.
// contentType, when non-empty, is bound into the signature via a signed header so
// the client MUST send exactly that Content-Type (prevents type smuggling).
func (p *Presigner) PresignPut(key, contentType string, expiry time.Duration) (string, error) {
	return p.presign("PUT", key, contentType, expiry, time.Now().UTC())
}

// PresignGet returns a presigned URL the client may GET, valid for expiry.
func (p *Presigner) PresignGet(key string, expiry time.Duration) (string, error) {
	return p.presign("GET", key, "", expiry, time.Now().UTC())
}

// presign builds the SigV4 query-string-presigned URL. now is injectable for tests.
func (p *Presigner) presign(method, key, contentType string, expiry time.Duration, now time.Time) (string, error) {
	if !p.Configured() {
		return "", ErrNotConfigured
	}
	if strings.TrimSpace(key) == "" {
		return "", errors.New("r2: object key is required")
	}
	if expiry <= 0 || expiry > 7*24*time.Hour {
		// SigV4 caps presigned expiry at 7 days.
		expiry = 15 * time.Minute
	}

	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	scope := dateStamp + "/" + p.cfg.Region + "/s3/aws4_request"

	// Canonical URI: /<bucket>/<key>, each path segment percent-encoded.
	canonicalURI := "/" + encodePath(p.cfg.Bucket) + "/" + encodePath(key)

	// Signed headers: always host; add content-type for PUT when provided.
	signedHeaders := "host"
	canonicalHeaders := "host:" + p.host + "\n"
	if method == "PUT" && contentType != "" {
		signedHeaders = "content-type;host"
		canonicalHeaders = "content-type:" + contentType + "\nhost:" + p.host + "\n"
	}

	// Query params (must be sorted for the canonical query string).
	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", p.cfg.AccessKeyID+"/"+scope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", int(expiry.Seconds())))
	q.Set("X-Amz-SignedHeaders", signedHeaders)
	canonicalQuery := encodeQuery(q)

	canonicalRequest := strings.Join([]string{
		method,
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		UnsignedPayload,
	}, "\n")

	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hashHex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKey(p.cfg.SecretAccessKey, dateStamp, p.cfg.Region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	q.Set("X-Amz-Signature", signature)
	return p.cfg.AccountEndpoint + canonicalURI + "?" + encodeQuery(q), nil
}

// ── SigV4 primitives ─────────────────────────────────────────────────────────

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func hashHex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func deriveSigningKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	return hmacSHA256(kService, []byte("aws4_request"))
}

// encodePath percent-encodes a path component per SigV4 rules (RFC 3986
// unreserved chars are left as-is; '/' inside a key is NOT encoded so nested
// prefixes work, matching S3's canonicalisation).
func encodePath(p string) string {
	var b strings.Builder
	for _, seg := range strings.Split(p, "/") {
		if b.Len() > 0 {
			b.WriteByte('/')
		}
		b.WriteString(encodeSegment(seg))
	}
	return b.String()
}

func encodeSegment(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if isUnreserved(c) {
			b.WriteByte(c)
		} else {
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}

// encodeQuery builds a canonical query string: keys sorted, values RFC-3986
// percent-encoded (url.Values.Encode uses '+' for spaces which SigV4 rejects).
func encodeQuery(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		for _, v := range q[k] {
			parts = append(parts, encodeSegment(k)+"="+encodeSegment(v))
		}
	}
	return strings.Join(parts, "&")
}

func isUnreserved(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
		(c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~'
}
