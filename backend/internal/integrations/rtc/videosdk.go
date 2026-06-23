package rtc

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"
)

// videosdk.go — VideoSDK.live JWT (HS256) builder.
//
// Mints a VideoSDK auth token per https://docs.videosdk.live/api-reference/realtime-communication/intro
// header  : {"alg":"HS256","typ":"JWT"}
// payload : {"apikey":<apiKey>,"permissions":["allow_join"],"version":2,"iat":<now>,"exp":<now+ttl>}
// signed with the project SECRET via HMAC-SHA256, base64url (no padding), dot-joined.
// stdlib only.

// ErrVideoSDKMissingCreds is returned when the API key or secret is empty.
var ErrVideoSDKMissingCreds = errors.New("rtc/videosdk: api key and secret required")

// b64url is base64 URL encoding without padding (JWT standard).
func b64url(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

// BuildVideoSDKToken mints an HS256 VideoSDK token valid for ttl. stdlib only.
func BuildVideoSDKToken(apiKey, secret string, ttl time.Duration) (string, error) {
	if apiKey == "" || secret == "" {
		return "", ErrVideoSDKMissingCreds
	}
	now := time.Now()

	header := map[string]any{"alg": "HS256", "typ": "JWT"}
	payload := map[string]any{
		"apikey":      apiKey,
		"permissions": []string{"allow_join"},
		"version":     2,
		"iat":         now.Unix(),
		"exp":         now.Add(ttl).Unix(),
	}

	hb, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	pb, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	signingInput := b64url(hb) + "." + b64url(pb)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	sig := b64url(mac.Sum(nil))

	return signingInput + "." + sig, nil
}
