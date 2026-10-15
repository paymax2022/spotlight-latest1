package livekit

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/livekit/protocol/auth"
	lkproto "github.com/livekit/protocol/livekit"
	"github.com/twitchtv/twirp"
)

// Role is what a participant may do in a room. Every role can subscribe; what differs is what
// it may publish. Unknown roles are refused, never defaulted.
type Role string

const (
	// RoleHost may publish audio, video and screen, and send data messages (a teacher, a doctor).
	RoleHost Role = "host"
	// RoleParticipant may only subscribe and send data messages (chat, raise-hand).
	RoleParticipant Role = "participant"
	// RoleViewer may only subscribe.
	RoleViewer Role = "viewer"
)

var nameRe = regexp.MustCompile(`^[A-Za-z0-9._:-]+$`)

// Client talks to one LiveKit server. It is safe for concurrent use.
type Client struct {
	cfg   Config
	http  *http.Client
	now   func() time.Time
	rooms lkproto.RoomService
}

// Option customises a Client.
type Option func(*Client)

// WithClock replaces the clock (tests).
func WithClock(now func() time.Time) Option { return func(c *Client) { c.now = now } }

// WithHTTPClient replaces the HTTP client used for the server API (tests, custom timeouts).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// NewClient builds a Client. It returns ErrNotConfigured when credentials are absent and
// ErrInvalidConfig when they are present but unusable, so a half-set environment is loud.
func NewClient(cfg Config, opts ...Option) (*Client, error) {
	if !cfg.Enabled() {
		return nil, ErrNotConfigured
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	c := &Client{cfg: cfg, http: &http.Client{Timeout: 10 * time.Second}, now: time.Now}
	for _, o := range opts {
		o(c)
	}
	c.rooms = lkproto.NewRoomServiceProtobufClient(cfg.ServerURL(), c.http)
	return c, nil
}

// ClientURL is the ws(s) URL clients connect to.
func (c *Client) ClientURL() string { return c.cfg.ClientURL() }

// Host is the server host for display. It never contains credentials.
func (c *Client) Host() string { return c.cfg.Host() }

// JoinRequest asks for a token to join one room as one participant.
type JoinRequest struct {
	Room     string
	Identity string
	Name     string // display name, optional
	Role     Role
	TTL      time.Duration // 0 = default; above MaxTokenTTL is clamped
}

// Token is a signed join credential.
type Token struct {
	JWT       string
	ExpiresAt time.Time
}

func validName(s string) bool { return len(s) > 0 && len(s) <= MaxNameLen && nameRe.MatchString(s) }

func validDisplayName(s string) bool {
	if len(s) > MaxDisplayNameLen {
		return false
	}
	for _, r := range s {
		// Controls, and format characters (bidi overrides, zero-width joiners, BOM) that let a
		// display name spoof or hide text; also the Unicode line and paragraph separators.
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == '\u2028' || r == '\u2029' {
			return false
		}
	}
	return true
}

func boolp(v bool) *bool { return &v }

// grantFor returns the explicit permission set for a role. Every permission is set explicitly:
// LiveKit treats an unset permission as ALLOWED, so omitting one would silently over-grant.
func grantFor(room string, role Role) (*auth.VideoGrant, bool) {
	g := &auth.VideoGrant{RoomJoin: true, Room: room, CanUpdateOwnMetadata: boolp(false), CanSubscribe: boolp(true)}
	switch role {
	case RoleHost:
		g.CanPublish, g.CanPublishData = boolp(true), boolp(true)
	case RoleParticipant:
		g.CanPublish, g.CanPublishData = boolp(false), boolp(true)
	case RoleViewer:
		g.CanPublish, g.CanPublishData = boolp(false), boolp(false)
	default:
		return nil, false
	}
	return g, true
}

// JoinToken mints a join token scoped to one room and one participant. The caller is
// responsible for deciding WHETHER this user may join this room and in WHICH role; this
// function only refuses malformed input and never grants more than the role allows.
func (c *Client) JoinToken(req JoinRequest) (Token, error) {
	switch {
	case !validName(req.Room):
		return Token{}, fmt.Errorf("%w: room name must be 1-%d characters of letters, digits . _ : -", ErrInvalidRequest, MaxNameLen)
	case !validName(req.Identity):
		return Token{}, fmt.Errorf("%w: identity must be 1-%d characters of letters, digits . _ : -", ErrInvalidRequest, MaxNameLen)
	case !validDisplayName(req.Name):
		return Token{}, fmt.Errorf("%w: display name is too long or has control characters", ErrInvalidRequest)
	case req.TTL < 0:
		return Token{}, fmt.Errorf("%w: ttl must not be negative", ErrInvalidRequest)
	}
	grant, ok := grantFor(req.Room, req.Role)
	if !ok {
		return Token{}, fmt.Errorf("%w: unknown role %q", ErrInvalidRequest, req.Role)
	}
	ttl := req.TTL
	if ttl == 0 {
		ttl = c.cfg.TokenTTL
	}
	if ttl == 0 {
		ttl = DefaultTokenTTL
	}
	if ttl > MaxTokenTTL {
		ttl = MaxTokenTTL
	}
	at := auth.NewAccessToken(c.cfg.APIKey, c.cfg.APISecret).
		SetVideoGrant(grant).
		SetIdentity(req.Identity).
		SetValidFor(ttl)
	if req.Name != "" {
		at.SetName(req.Name)
	}
	jwt, err := at.ToJWT()
	if err != nil {
		return Token{}, fmt.Errorf("livekit: sign token: %w", err)
	}
	return Token{JWT: jwt, ExpiresAt: c.now().Add(ttl)}, nil
}

// ---- server API ----

// apiCtx attaches a short-lived server-API credential carrying only the given grant.
func (c *Client) apiCtx(ctx context.Context, grant *auth.VideoGrant) (context.Context, error) {
	jwt, err := auth.NewAccessToken(c.cfg.APIKey, c.cfg.APISecret).SetVideoGrant(grant).SetValidFor(time.Minute).ToJWT()
	if err != nil {
		return ctx, fmt.Errorf("livekit: sign api token: %w", err)
	}
	h := http.Header{}
	h.Set("Authorization", "Bearer "+jwt)
	return twirp.WithHTTPRequestHeaders(ctx, h)
}

// CreateRoom provisions a room with the configured limits. LiveKit returns the existing room
// when the name is already in use, so this is safe to call again.
func (c *Client) CreateRoom(ctx context.Context, name string) error {
	if !validName(name) {
		return fmt.Errorf("%w: room name", ErrInvalidRequest)
	}
	empty, max := c.cfg.EmptyTimeout, c.cfg.MaxParticipants
	if empty == 0 {
		empty = DefaultEmptyTimeout
	}
	if max == 0 {
		max = DefaultMaxParticipants
	}
	ctx, err := c.apiCtx(ctx, &auth.VideoGrant{RoomCreate: true})
	if err != nil {
		return err
	}
	if _, err := c.rooms.CreateRoom(ctx, &lkproto.CreateRoomRequest{Name: name, EmptyTimeout: uint32(empty / time.Second), MaxParticipants: max}); err != nil {
		return fmt.Errorf("livekit: create room: %w", err)
	}
	return nil
}

// DeleteRoom closes a room and disconnects everyone in it.
func (c *Client) DeleteRoom(ctx context.Context, name string) error {
	if !validName(name) {
		return fmt.Errorf("%w: room name", ErrInvalidRequest)
	}
	ctx, err := c.apiCtx(ctx, &auth.VideoGrant{RoomCreate: true})
	if err != nil {
		return err
	}
	if _, err := c.rooms.DeleteRoom(ctx, &lkproto.DeleteRoomRequest{Room: name}); err != nil {
		return fmt.Errorf("livekit: delete room: %w", err)
	}
	return nil
}

// RemoveParticipant disconnects one participant from a room (moderation).
func (c *Client) RemoveParticipant(ctx context.Context, room, identity string) error {
	if !validName(room) || !validName(identity) {
		return fmt.Errorf("%w: room and identity", ErrInvalidRequest)
	}
	ctx, err := c.apiCtx(ctx, &auth.VideoGrant{RoomAdmin: true, Room: room})
	if err != nil {
		return err
	}
	if _, err := c.rooms.RemoveParticipant(ctx, &lkproto.RoomParticipantIdentity{Room: room, Identity: identity}); err != nil {
		return fmt.Errorf("livekit: remove participant: %w", err)
	}
	return nil
}

// ListRooms returns the names of the rooms currently open.
func (c *Client) ListRooms(ctx context.Context) ([]string, error) {
	ctx, err := c.apiCtx(ctx, &auth.VideoGrant{RoomList: true})
	if err != nil {
		return nil, err
	}
	res, err := c.rooms.ListRooms(ctx, &lkproto.ListRoomsRequest{})
	if err != nil {
		return nil, fmt.Errorf("livekit: list rooms: %w", err)
	}
	names := make([]string, 0, len(res.GetRooms()))
	for _, r := range res.GetRooms() {
		names = append(names, r.GetName())
	}
	return names, nil
}

// Health is the result of a reachability check.
type Health struct {
	Host      string `json:"host"`
	Reachable bool   `json:"reachable"`
	Rooms     int    `json:"rooms"`
	Error     string `json:"error,omitempty"`
}

// Health checks that the server answers an authenticated request with these credentials. The
// error text is shortened and scrubbed of the credentials before it leaves the package.
func (c *Client) Health(ctx context.Context) Health {
	h := Health{Host: c.Host()}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	names, err := c.ListRooms(ctx)
	if err != nil {
		h.Error = c.scrub(err.Error())
		return h
	}
	h.Reachable, h.Rooms = true, len(names)
	return h
}

func (c *Client) scrub(s string) string {
	for _, secret := range []string{c.cfg.APISecret, c.cfg.APIKey} {
		if secret != "" {
			s = strings.ReplaceAll(s, secret, "[redacted]")
		}
	}
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}
