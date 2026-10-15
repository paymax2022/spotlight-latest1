package cryptoprov

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ErrBadSignature is returned for any webhook whose signature does not verify.
// It is deliberately generic so an attacker learns nothing about which check failed.
var ErrBadSignature = errors.New("cryptoprov: webhook signature invalid")

// DefaultReplayWindow bounds how old a signed timestamp may be.
const DefaultReplayWindow = 5 * time.Minute

// VerifyHMACSignature checks a `t=<ts>,s=<hex>` header where
// s = HMAC-SHA256(secret, "<t>.<body>"). It tries the raw body first, then the
// compacted JSON form, because providers sign either depending on serialisation.
//
// The timestamp unit is accepted as seconds or milliseconds (values >= 1e12 are
// read as ms). The sandbox checklist must settle the real unit before go-live.
//
// Fails closed: an empty secret, a malformed header, a stale timestamp or a
// mismatch all return ErrBadSignature. Comparison is constant time.
func VerifyHMACSignature(secret, header string, body []byte, now time.Time, window time.Duration) error {
	if secret == "" {
		return ErrBadSignature
	}
	tRaw, sig, err := parseSignatureHeader(header)
	if err != nil {
		return ErrBadSignature
	}
	ts, err := strconv.ParseInt(tRaw, 10, 64)
	if err != nil {
		return ErrBadSignature
	}
	sentAt := time.Unix(ts, 0)
	if ts >= 1e12 {
		sentAt = time.UnixMilli(ts)
	}
	if skew := now.Sub(sentAt); skew > window || skew < -window {
		return ErrBadSignature
	}
	want, err := hex.DecodeString(sig)
	if err != nil {
		return ErrBadSignature
	}
	for _, candidate := range bodyCandidates(body) {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(tRaw + "."))
		mac.Write(candidate)
		if hmac.Equal(mac.Sum(nil), want) {
			return nil
		}
	}
	return ErrBadSignature
}

func parseSignatureHeader(h string) (ts, sig string, err error) {
	for _, part := range strings.Split(h, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			return "", "", fmt.Errorf("malformed part")
		}
		switch k {
		case "t":
			ts = v
		case "s":
			sig = v
		}
	}
	if ts == "" || sig == "" {
		return "", "", fmt.Errorf("missing t or s")
	}
	return ts, sig, nil
}

// bodyCandidates returns the raw body and, when different, its compacted JSON form.
func bodyCandidates(body []byte) [][]byte {
	out := [][]byte{body}
	var buf bytes.Buffer
	if json.Valid(body) && json.Compact(&buf, body) == nil && !bytes.Equal(buf.Bytes(), body) {
		out = append(out, buf.Bytes())
	}
	return out
}
