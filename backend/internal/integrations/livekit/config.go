// Package livekit is the server-side integration with a self-hosted LiveKit SFU: it mints
// short-lived join tokens, manages rooms through LiveKit's server API and verifies LiveKit's
// signed webhooks. The API secret never leaves this package and is never logged or returned.
//
// Production notes live in docs/runbooks/livekit.md; the decisions are in ADR-PR789.
package livekit

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	// DefaultTokenTTL is how long a join token is valid for. A token only has to be valid when
	// the client connects; an established session keeps running after it expires.
	DefaultTokenTTL = 10 * time.Minute
	// MaxTokenTTL caps any requested lifetime, so a bug or a hostile caller cannot mint a
	// long-lived credential.
	MaxTokenTTL = 6 * time.Hour
	// DefaultEmptyTimeout is how long an empty room is kept before LiveKit closes it.
	DefaultEmptyTimeout = 5 * time.Minute
	// DefaultMaxParticipants bounds a room so one session cannot exhaust the SFU.
	DefaultMaxParticipants uint32 = 200

	// minSecretLen is LiveKit's own minimum for an API secret.
	minSecretLen = 32

	// MaxNameLen bounds room names and identities; MaxDisplayNameLen bounds display names.
	MaxNameLen        = 128
	MaxDisplayNameLen = 64
)

var (
	// ErrNotConfigured means no LiveKit credentials are present. Callers must surface "not
	// configured" and never substitute a fabricated token.
	ErrNotConfigured = errors.New("livekit: not configured")
	// ErrInvalidConfig means credentials are present but unusable (bad URL, short secret...).
	ErrInvalidConfig = errors.New("livekit: invalid configuration")
	// ErrInvalidRequest means a token or room request was malformed.
	ErrInvalidRequest = errors.New("livekit: invalid request")
	// ErrBadWebhook means a webhook was unsigned, forged, tampered with, or malformed.
	ErrBadWebhook = errors.New("livekit: webhook rejected")
)

// Config carries the server-side LiveKit settings. Zero durations and limits mean "default".
type Config struct {
	// URL is the LiveKit server, e.g. wss://rtc.example.com. http(s) is accepted too.
	URL       string
	APIKey    string
	APISecret string

	TokenTTL        time.Duration
	EmptyTimeout    time.Duration
	MaxParticipants uint32
}

// Enabled reports whether every credential is present. It does not validate them.
func (c Config) Enabled() bool {
	return strings.TrimSpace(c.URL) != "" && strings.TrimSpace(c.APIKey) != "" && strings.TrimSpace(c.APISecret) != ""
}

func looksLikePlaceholder(s string) bool {
	u := strings.ToUpper(strings.TrimSpace(s))
	return strings.Contains(u, "CHANGE_ME") || strings.Contains(u, "CHANGEME") || strings.HasPrefix(u, "YOUR_") || strings.HasPrefix(u, "<")
}

// Validate checks the configuration. Errors name the setting, never the secret.
func (c Config) Validate() error {
	u, err := url.Parse(strings.TrimSpace(c.URL))
	switch {
	case strings.TrimSpace(c.URL) == "":
		return fmt.Errorf("%w: LIVEKIT_URL is required", ErrInvalidConfig)
	case err != nil || u.Host == "":
		return fmt.Errorf("%w: LIVEKIT_URL must be a URL with a host, e.g. wss://rtc.example.com", ErrInvalidConfig)
	case u.Scheme != "ws" && u.Scheme != "wss" && u.Scheme != "http" && u.Scheme != "https":
		return fmt.Errorf("%w: LIVEKIT_URL scheme must be ws, wss, http or https", ErrInvalidConfig)
	case u.User != nil:
		return fmt.Errorf("%w: LIVEKIT_URL must not embed credentials", ErrInvalidConfig)
	case strings.TrimSpace(c.APIKey) == "":
		return fmt.Errorf("%w: LIVEKIT_API_KEY is required", ErrInvalidConfig)
	case looksLikePlaceholder(c.APIKey):
		return fmt.Errorf("%w: LIVEKIT_API_KEY is still a placeholder", ErrInvalidConfig)
	case strings.TrimSpace(c.APISecret) == "":
		return fmt.Errorf("%w: LIVEKIT_API_SECRET is required", ErrInvalidConfig)
	case looksLikePlaceholder(c.APISecret):
		return fmt.Errorf("%w: LIVEKIT_API_SECRET is still a placeholder", ErrInvalidConfig)
	case len(c.APISecret) < minSecretLen:
		return fmt.Errorf("%w: LIVEKIT_API_SECRET must be at least %d characters", ErrInvalidConfig, minSecretLen)
	case c.TokenTTL < 0 || c.TokenTTL > MaxTokenTTL:
		return fmt.Errorf("%w: token TTL must be between 0 and %s", ErrInvalidConfig, MaxTokenTTL)
	case c.EmptyTimeout < 0:
		return fmt.Errorf("%w: empty-room timeout must not be negative", ErrInvalidConfig)
	}
	return nil
}

func (c Config) host() (scheme string, rest string) {
	u, _ := url.Parse(strings.TrimSpace(c.URL))
	return u.Scheme, strings.TrimRight(u.Host+u.EscapedPath(), "/")
}

// ServerURL is the http(s) form used for LiveKit's server API.
func (c Config) ServerURL() string {
	scheme, rest := c.host()
	switch scheme {
	case "wss", "https":
		return "https://" + rest
	default:
		return "http://" + rest
	}
}

// ClientURL is the ws(s) form clients connect to.
func (c Config) ClientURL() string {
	scheme, rest := c.host()
	switch scheme {
	case "wss", "https":
		return "wss://" + rest
	default:
		return "ws://" + rest
	}
}

// Host returns just the host (and port) for display; it never includes credentials.
func (c Config) Host() string {
	u, err := url.Parse(strings.TrimSpace(c.URL))
	if err != nil {
		return ""
	}
	return u.Host
}
