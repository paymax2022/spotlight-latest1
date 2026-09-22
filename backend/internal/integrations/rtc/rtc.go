package rtc

import (
	"errors"
	"strings"
	"time"
)

// rtc.go — RTC token Issuer.
//
// VideoSDK (HS256 JWT) is the only supported provider. All secrets (the VideoSDK
// secret) live SERVER-SIDE in the Issuer and are NEVER returned to a caller — only
// the signed short-lived token, channel, uid, provider and expiry leave this package.
//
// Disabled-fallback contract: when the credentials for the requested provider are
// absent, Token returns ("", zero-time, ErrRTCNotConfigured). Callers MUST surface
// an explicit "not configured" status and a clearly-empty token — NEVER a fabricated
// or placeholder token. A provider string this Issuer does not know (e.g. a legacy
// session persisted as "agora") is refused with ErrUnknownProvider, which the call
// paths surface as rtcConfigured=false — fail-closed, never a substitute token.

// ErrRTCNotConfigured indicates the requested provider has no server-side credentials.
var ErrRTCNotConfigured = errors.New("rtc: provider not configured")

// ErrUnknownProvider indicates an unrecognised provider string.
var ErrUnknownProvider = errors.New("rtc: unknown provider")

// Provider identifiers (mirror the mobile CallProvider union: 'videosdk').
const (
	ProviderVideoSDK = "videosdk"
)

// Config carries the server-side RTC credentials.
type Config struct {
	VideoSDKAPIKey string
	VideoSDKSecret string
}

// Issuer mints RTC tokens for the configured provider.
type Issuer struct {
	cfg Config
}

// NewIssuer constructs an Issuer from the RTC credentials.
func NewIssuer(cfg Config) *Issuer { return &Issuer{cfg: cfg} }

// Enabled reports whether the Issuer has complete credentials for the provider.
// An unknown provider (e.g. a legacy "agora" value) is never enabled.
func (i *Issuer) Enabled(provider string) bool {
	if strings.ToLower(provider) != ProviderVideoSDK {
		return false
	}
	return i.cfg.VideoSDKAPIKey != "" && i.cfg.VideoSDKSecret != ""
}

// Token mints a short-lived RTC token for the provider, scoped to channel/uid.
// Returns ErrRTCNotConfigured (with empty token + zero expiry) when the provider
// lacks credentials — callers must NOT fabricate a token in that case.
//
// channel and uid are accepted but not embedded: a VideoSDK JWT carries the API
// key, not the room, and the client pairs it with the meeting id. They stay in the
// signature because callers own the room identity (channel = appointment/session
// id, uid persisted per user) and echo both back to the client.
func (i *Issuer) Token(provider, channel, uid string, ttl time.Duration) (string, time.Time, error) {
	if ttl <= 0 {
		ttl = time.Hour
	}
	if strings.ToLower(provider) != ProviderVideoSDK {
		return "", time.Time{}, ErrUnknownProvider
	}
	if !i.Enabled(ProviderVideoSDK) {
		return "", time.Time{}, ErrRTCNotConfigured
	}
	tok, err := BuildVideoSDKToken(i.cfg.VideoSDKAPIKey, i.cfg.VideoSDKSecret, ttl)
	if err != nil {
		return "", time.Time{}, err
	}
	return tok, time.Now().Add(ttl), nil
}
