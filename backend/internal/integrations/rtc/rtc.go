package rtc

import (
	"errors"
	"strings"
	"time"
)

// rtc.go — provider-agnostic RTC token Issuer.
//
// Dispatches to the Agora (AccessToken2) or VideoSDK (HS256 JWT) builders.
// All secrets (Agora App Certificate, VideoSDK secret) live SERVER-SIDE in the
// Issuer and are NEVER returned to a caller — only the signed short-lived token,
// channel, uid, provider and expiry leave this package.
//
// Disabled-fallback contract: when the credentials for the requested provider are
// absent, Token returns ("", zero-time, ErrRTCNotConfigured). Callers MUST surface
// an explicit "not configured" status and a clearly-empty token — NEVER a fabricated
// or placeholder token.

// ErrRTCNotConfigured indicates the requested provider has no server-side credentials.
var ErrRTCNotConfigured = errors.New("rtc: provider not configured")

// ErrUnknownProvider indicates an unrecognised provider string.
var ErrUnknownProvider = errors.New("rtc: unknown provider")

// Provider identifiers (mirror the mobile CallProvider union: 'agora' | 'videosdk').
const (
	ProviderAgora    = "agora"
	ProviderVideoSDK = "videosdk"
)

// Config carries the server-side RTC credentials.
type Config struct {
	AgoraAppID          string
	AgoraAppCertificate string
	VideoSDKAPIKey      string
	VideoSDKSecret      string
}

// Issuer mints RTC tokens for the configured providers.
type Issuer struct {
	cfg Config
}

// NewIssuer constructs an Issuer from the RTC credentials.
func NewIssuer(cfg Config) *Issuer { return &Issuer{cfg: cfg} }

// Enabled reports whether the Issuer has complete credentials for the provider.
func (i *Issuer) Enabled(provider string) bool {
	switch strings.ToLower(provider) {
	case ProviderAgora:
		return i.cfg.AgoraAppID != "" && i.cfg.AgoraAppCertificate != ""
	case ProviderVideoSDK:
		return i.cfg.VideoSDKAPIKey != "" && i.cfg.VideoSDKSecret != ""
	default:
		return false
	}
}

// Token mints a short-lived RTC token for the provider, scoped to channel/uid.
// Returns ErrRTCNotConfigured (with empty token + zero expiry) when the provider
// lacks credentials — callers must NOT fabricate a token in that case.
func (i *Issuer) Token(provider, channel, uid string, ttl time.Duration) (string, time.Time, error) {
	if ttl <= 0 {
		ttl = time.Hour
	}
	switch strings.ToLower(provider) {
	case ProviderAgora:
		if !i.Enabled(ProviderAgora) {
			return "", time.Time{}, ErrRTCNotConfigured
		}
		tok, err := BuildAgoraRTCToken(i.cfg.AgoraAppID, i.cfg.AgoraAppCertificate, channel, uid, ttl)
		if err != nil {
			return "", time.Time{}, err
		}
		return tok, time.Now().Add(ttl), nil
	case ProviderVideoSDK:
		if !i.Enabled(ProviderVideoSDK) {
			return "", time.Time{}, ErrRTCNotConfigured
		}
		tok, err := BuildVideoSDKToken(i.cfg.VideoSDKAPIKey, i.cfg.VideoSDKSecret, ttl)
		if err != nil {
			return "", time.Time{}, err
		}
		return tok, time.Now().Add(ttl), nil
	default:
		return "", time.Time{}, ErrUnknownProvider
	}
}
