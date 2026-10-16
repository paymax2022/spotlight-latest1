package livekit

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/livekit/protocol/auth"
	lkproto "github.com/livekit/protocol/livekit"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	testKey    = "lk-test-key"
	testSecret = "s3cr3t-s3cr3t-s3cr3t-s3cr3t-s3cr3t-0123" // >= 32 chars
)

var t0 = time.Date(2026, 10, 15, 9, 0, 0, 0, time.UTC)

func goodConfig(url string) Config {
	return Config{URL: url, APIKey: testKey, APISecret: testSecret}
}

func newTestClient(t *testing.T, url string) *Client {
	t.Helper()
	c, err := NewClient(goodConfig(url), WithClock(func() time.Time { return t0 }))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return c
}

// verify parses a token the way the LiveKit server does.
func verify(t *testing.T, raw string) *auth.ClaimGrants {
	t.Helper()
	v, err := auth.ParseAPIToken(raw)
	if err != nil {
		t.Fatalf("token does not parse: %v", err)
	}
	if v.APIKey() != testKey {
		t.Fatalf("issuer = %q, want the API key", v.APIKey())
	}
	_, grants, err := v.Verify(testSecret)
	if err != nil {
		t.Fatalf("token does not verify with the secret: %v", err)
	}
	return grants
}

func isTrue(b *bool) bool  { return b != nil && *b }
func isFalse(b *bool) bool { return b != nil && !*b }

// ---------------------------------------------------------------- config

func TestConfigValidate(t *testing.T) {
	ok := func() Config { return goodConfig("wss://rtc.example.com") }
	if err := ok().Validate(); err != nil {
		t.Fatalf("a good config must pass: %v", err)
	}
	for name, mutate := range map[string]func(*Config){
		"no url":                 func(c *Config) { c.URL = "" },
		"no scheme":              func(c *Config) { c.URL = "rtc.example.com" },
		"wrong scheme":           func(c *Config) { c.URL = "ftp://rtc.example.com" },
		"no host":                func(c *Config) { c.URL = "wss://" },
		"credentials in url":     func(c *Config) { c.URL = "wss://user:pass@rtc.example.com" },
		"no key":                 func(c *Config) { c.APIKey = "" },
		"no secret":              func(c *Config) { c.APISecret = "" },
		"short secret":           func(c *Config) { c.APISecret = "too-short" },
		"placeholder secret":     func(c *Config) { c.APISecret = strings.Repeat("CHANGE_ME", 6) },
		"placeholder key":        func(c *Config) { c.APIKey = "CHANGE_ME" },
		"ttl above the cap":      func(c *Config) { c.TokenTTL = MaxTokenTTL + time.Second },
		"negative ttl":           func(c *Config) { c.TokenTTL = -time.Minute },
		"negative empty timeout": func(c *Config) { c.EmptyTimeout = -time.Second },
	} {
		c := ok()
		mutate(&c)
		if err := c.Validate(); err == nil {
			t.Errorf("%s: accepted", name)
		} else if !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("%s: %v is not ErrInvalidConfig", name, err)
		}
	}
}

func TestConfigNeverLeaksTheSecretInErrors(t *testing.T) {
	c := goodConfig("ftp://x")
	err := c.Validate()
	if err == nil || strings.Contains(err.Error(), testSecret) {
		t.Fatalf("error must exist and must not contain the secret: %v", err)
	}
}

func TestConfigURLForms(t *testing.T) {
	for in, want := range map[string][2]string{
		"wss://rtc.example.com":   {"https://rtc.example.com", "wss://rtc.example.com"},
		"wss://rtc.example.com/":  {"https://rtc.example.com", "wss://rtc.example.com"},
		"ws://10.0.0.5:7880":      {"http://10.0.0.5:7880", "ws://10.0.0.5:7880"},
		"https://rtc.example.com": {"https://rtc.example.com", "wss://rtc.example.com"},
		"http://localhost:7880":   {"http://localhost:7880", "ws://localhost:7880"},
	} {
		c := goodConfig(in)
		if got := c.ServerURL(); got != want[0] {
			t.Errorf("ServerURL(%s) = %q, want %q", in, got, want[0])
		}
		if got := c.ClientURL(); got != want[1] {
			t.Errorf("ClientURL(%s) = %q, want %q", in, got, want[1])
		}
	}
}

func TestNotConfiguredFailsClosed(t *testing.T) {
	for _, c := range []Config{{}, {URL: "wss://x"}, {APIKey: "k", APISecret: testSecret}, {URL: "wss://x", APIKey: "k"}} {
		if c.Enabled() {
			t.Errorf("%+v must not be enabled", c)
		}
		cl, err := NewClient(c)
		if !errors.Is(err, ErrNotConfigured) || cl != nil {
			t.Errorf("NewClient(%+v) = %v, %v; want nil, ErrNotConfigured", c, cl, err)
		}
	}
	// Half-configured but present is an error, not a silent "disabled".
	if _, err := NewClient(Config{URL: "wss://x", APIKey: "k", APISecret: "short"}); !errors.Is(err, ErrInvalidConfig) {
		t.Errorf("a configured-but-invalid config must be ErrInvalidConfig, got %v", err)
	}
}

// ---------------------------------------------------------------- tokens

func TestRoleGrants(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	tests := []struct {
		role                     Role
		publish, subscribe, data bool
		sources                  []string
	}{
		{RoleHost, true, true, true, nil},
		{RoleParticipant, false, true, true, nil},
		{RoleViewer, false, true, false, nil},
	}
	for _, tc := range tests {
		tok, err := c.JoinToken(JoinRequest{Room: "academy-live-1", Identity: "user-1", Name: "Ada", Role: tc.role})
		if err != nil {
			t.Fatalf("%s: %v", tc.role, err)
		}
		g := verify(t, tok.JWT)
		v := g.Video
		if v == nil || !v.RoomJoin || v.Room != "academy-live-1" || g.Identity != "user-1" || g.Name != "Ada" {
			t.Fatalf("%s: join grant wrong: %+v / %+v", tc.role, g, v)
		}
		// Each permission must be set EXPLICITLY: an unset one means "all permissions" to LiveKit.
		for name, got := range map[string]*bool{"canPublish": v.CanPublish, "canSubscribe": v.CanSubscribe, "canPublishData": v.CanPublishData} {
			if got == nil {
				t.Errorf("%s: %s is unset, which LiveKit treats as allowed", tc.role, name)
			}
		}
		if isTrue(v.CanPublish) != tc.publish || isTrue(v.CanSubscribe) != tc.subscribe || isTrue(v.CanPublishData) != tc.data {
			t.Errorf("%s: publish=%v subscribe=%v data=%v, want %v/%v/%v", tc.role, isTrue(v.CanPublish), isTrue(v.CanSubscribe), isTrue(v.CanPublishData), tc.publish, tc.subscribe, tc.data)
		}
		// Never an admin token, never able to create rooms, record, hide, or edit own metadata.
		if v.RoomAdmin || v.RoomCreate || v.RoomList || v.RoomRecord || v.Hidden || v.Recorder || v.Agent || v.IngressAdmin || isTrue(v.CanUpdateOwnMetadata) {
			t.Errorf("%s: token carries more than a join grant: %+v", tc.role, v)
		}
	}
	// A viewer or participant who cannot publish must hold an explicit false, not nil.
	tok, _ := c.JoinToken(JoinRequest{Room: "r", Identity: "u", Role: RoleViewer})
	if v := verify(t, tok.JWT).Video; !isFalse(v.CanPublish) {
		t.Errorf("viewer CanPublish must be an explicit false, got %v", v.CanPublish)
	}
}

func TestJoinTokenExpiry(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	def, err := c.JoinToken(JoinRequest{Room: "r", Identity: "u", Role: RoleViewer})
	if err != nil {
		t.Fatal(err)
	}
	if !def.ExpiresAt.Equal(t0.Add(DefaultTokenTTL)) {
		t.Errorf("default expiry = %v, want %v", def.ExpiresAt, t0.Add(DefaultTokenTTL))
	}
	if DefaultTokenTTL != 10*time.Minute {
		t.Errorf("default TTL = %v, want 10m", DefaultTokenTTL)
	}
	short, _ := c.JoinToken(JoinRequest{Room: "r", Identity: "u", Role: RoleViewer, TTL: time.Minute})
	if !short.ExpiresAt.Equal(t0.Add(time.Minute)) {
		t.Errorf("explicit ttl ignored: %v", short.ExpiresAt)
	}
	long, _ := c.JoinToken(JoinRequest{Room: "r", Identity: "u", Role: RoleViewer, TTL: 48 * time.Hour})
	if !long.ExpiresAt.Equal(t0.Add(MaxTokenTTL)) {
		t.Errorf("an oversized ttl must be clamped to %v, got %v", MaxTokenTTL, long.ExpiresAt)
	}
	if _, err := c.JoinToken(JoinRequest{Room: "r", Identity: "u", Role: RoleViewer, TTL: -time.Second}); !errors.Is(err, ErrInvalidRequest) {
		t.Errorf("negative ttl: %v", err)
	}
}

func TestJoinTokenRejectsBadRequests(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	long := strings.Repeat("a", MaxNameLen+1)
	for name, req := range map[string]JoinRequest{
		"no room":                {Identity: "u", Role: RoleHost},
		"no identity":            {Room: "r", Role: RoleHost},
		"no role":                {Room: "r", Identity: "u"},
		"unknown role":           {Room: "r", Identity: "u", Role: "admin"},
		"room has space":         {Room: "my room", Identity: "u", Role: RoleHost},
		"room has slash":         {Room: "a/b", Identity: "u", Role: RoleHost},
		"room too long":          {Room: long, Identity: "u", Role: RoleHost},
		"identity bad":           {Room: "r", Identity: "u v", Role: RoleHost},
		"identity long":          {Room: "r", Identity: long, Role: RoleHost},
		"name too long":          {Room: "r", Identity: "u", Role: RoleHost, Name: strings.Repeat("n", MaxDisplayNameLen+1)},
		"name has bidi override": {Room: "r", Identity: "u", Role: RoleHost, Name: "Ada \u202eevil"},
		"name has zero-width":    {Room: "r", Identity: "u", Role: RoleHost, Name: "Ada\u200bX"},
		"name has newline":       {Room: "r", Identity: "u", Role: RoleHost, Name: "Ada\nX"},
	} {
		tok, err := c.JoinToken(req)
		if !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%s: err = %v, want ErrInvalidRequest", name, err)
		}
		if tok.JWT != "" {
			t.Errorf("%s: a token was minted for an invalid request", name)
		}
	}
}

func TestTokenDoesNotContainTheSecret(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	tok, _ := c.JoinToken(JoinRequest{Room: "r", Identity: "u", Role: RoleHost})
	if strings.Contains(tok.JWT, testSecret) {
		t.Fatal("the JWT must be signed with the secret, never contain it")
	}
}

// ---------------------------------------------------------------- room API (fake Twirp server)

type fakeLK struct {
	mu    sync.Mutex
	calls []string
	rooms map[string]*lkproto.Room
	fail  int // HTTP status to return when non-zero
	srv   *httptest.Server
}

func newFakeLK(t *testing.T) *fakeLK {
	t.Helper()
	f := &fakeLK{rooms: map[string]*lkproto.Room{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve(t)))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeLK) serve(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		method := strings.TrimPrefix(r.URL.Path, "/twirp/livekit.RoomService/")
		f.calls = append(f.calls, method)
		if f.fail != 0 {
			http.Error(w, `{"code":"internal","msg":"boom"}`, f.fail)
			return
		}
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		g := verify(t, raw)
		body, _ := io.ReadAll(r.Body)
		var out proto.Message
		switch method {
		case "CreateRoom":
			if !g.Video.RoomCreate {
				http.Error(w, `{"code":"permission_denied"}`, http.StatusForbidden)
				return
			}
			var req lkproto.CreateRoomRequest
			_ = proto.Unmarshal(body, &req)
			room := &lkproto.Room{Name: req.Name, EmptyTimeout: req.EmptyTimeout, MaxParticipants: req.MaxParticipants}
			f.rooms[req.Name] = room
			out = room
		case "ListRooms":
			if !g.Video.RoomList {
				http.Error(w, `{"code":"permission_denied"}`, http.StatusForbidden)
				return
			}
			res := &lkproto.ListRoomsResponse{}
			for _, rm := range f.rooms {
				res.Rooms = append(res.Rooms, rm)
			}
			out = res
		case "DeleteRoom":
			if !g.Video.RoomCreate {
				http.Error(w, `{"code":"permission_denied"}`, http.StatusForbidden)
				return
			}
			var req lkproto.DeleteRoomRequest
			_ = proto.Unmarshal(body, &req)
			delete(f.rooms, req.Room)
			out = &lkproto.DeleteRoomResponse{}
		case "RemoveParticipant":
			var req lkproto.RoomParticipantIdentity
			_ = proto.Unmarshal(body, &req)
			if !g.Video.RoomAdmin || g.Video.Room != req.Room {
				http.Error(w, `{"code":"permission_denied"}`, http.StatusForbidden)
				return
			}
			out = &lkproto.RemoveParticipantResponse{}
		default:
			http.NotFound(w, r)
			return
		}
		b, _ := proto.Marshal(out)
		w.Header().Set("Content-Type", "application/protobuf")
		_, _ = w.Write(b)
	}
}

func TestCreateRoomSendsTheConfiguredLimitsWithARoomCreateToken(t *testing.T) {
	f := newFakeLK(t)
	cfg := goodConfig(strings.Replace(f.srv.URL, "http://", "ws://", 1))
	cfg.EmptyTimeout = 90 * time.Second
	cfg.MaxParticipants = 250
	c, err := NewClient(cfg, WithClock(func() time.Time { return time.Now() }))
	if err != nil {
		t.Fatal(err)
	}
	if err := c.CreateRoom(context.Background(), "academy-live-1"); err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	room := f.rooms["academy-live-1"]
	if room == nil || room.EmptyTimeout != 90 || room.MaxParticipants != 250 {
		t.Fatalf("room limits not sent: %+v", room)
	}
}

func TestCreateRoomUsesSafeDefaultLimits(t *testing.T) {
	f := newFakeLK(t)
	c, _ := NewClient(goodConfig(strings.Replace(f.srv.URL, "http://", "ws://", 1)))
	if err := c.CreateRoom(context.Background(), "r1"); err != nil {
		t.Fatal(err)
	}
	room := f.rooms["r1"]
	if room.EmptyTimeout != uint32(DefaultEmptyTimeout/time.Second) || room.MaxParticipants != DefaultMaxParticipants {
		t.Fatalf("defaults not applied: %+v", room)
	}
}

func TestRoomAPIOperations(t *testing.T) {
	f := newFakeLK(t)
	c, _ := NewClient(goodConfig(strings.Replace(f.srv.URL, "http://", "ws://", 1)))
	ctx := context.Background()
	_ = c.CreateRoom(ctx, "a")
	_ = c.CreateRoom(ctx, "b")
	names, err := c.ListRooms(ctx)
	if err != nil || len(names) != 2 {
		t.Fatalf("ListRooms = %v, %v", names, err)
	}
	if err := c.RemoveParticipant(ctx, "a", "user-9"); err != nil {
		t.Fatalf("RemoveParticipant: %v", err)
	}
	if err := c.DeleteRoom(ctx, "a"); err != nil {
		t.Fatalf("DeleteRoom: %v", err)
	}
	if names, _ := c.ListRooms(ctx); len(names) != 1 || names[0] != "b" {
		t.Fatalf("room not deleted: %v", names)
	}
}

func TestRoomAPIValidatesInputBeforeCallingTheServer(t *testing.T) {
	f := newFakeLK(t)
	c, _ := NewClient(goodConfig(strings.Replace(f.srv.URL, "http://", "ws://", 1)))
	ctx := context.Background()
	for name, err := range map[string]error{
		"create empty":       c.CreateRoom(ctx, ""),
		"create bad chars":   c.CreateRoom(ctx, "a b"),
		"delete empty":       c.DeleteRoom(ctx, ""),
		"remove no room":     c.RemoveParticipant(ctx, "", "u"),
		"remove no identity": c.RemoveParticipant(ctx, "r", ""),
	} {
		if !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if len(f.calls) != 0 {
		t.Fatalf("the server was called for invalid input: %v", f.calls)
	}
}

func TestServerErrorsSurfaceWithoutFabricatingSuccess(t *testing.T) {
	f := newFakeLK(t)
	f.fail = http.StatusInternalServerError
	c, _ := NewClient(goodConfig(strings.Replace(f.srv.URL, "http://", "ws://", 1)))
	if err := c.CreateRoom(context.Background(), "r"); err == nil {
		t.Fatal("a failing LiveKit server must be an error, not a silent success")
	}
	if _, err := c.ListRooms(context.Background()); err == nil {
		t.Fatal("ListRooms must fail when the server does")
	}
}

func TestUnreachableServerIsAnErrorWithinTheTimeout(t *testing.T) {
	c, _ := NewClient(goodConfig("ws://127.0.0.1:1"), WithHTTPClient(&http.Client{Timeout: 500 * time.Millisecond}))
	start := time.Now()
	if err := c.CreateRoom(context.Background(), "r"); err == nil {
		t.Fatal("expected a connection error")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("an unreachable server must not hang the caller")
	}
}

func TestHealthReportsReachabilityAndRoomCount(t *testing.T) {
	f := newFakeLK(t)
	c, _ := NewClient(goodConfig(strings.Replace(f.srv.URL, "http://", "ws://", 1)))
	_ = c.CreateRoom(context.Background(), "a")
	h := c.Health(context.Background())
	if !h.Reachable || h.Rooms != 1 || h.Error != "" {
		t.Fatalf("health = %+v", h)
	}
	f.fail = http.StatusBadGateway
	h = c.Health(context.Background())
	if h.Reachable || h.Error == "" {
		t.Fatalf("an unreachable server must report so: %+v", h)
	}
	if strings.Contains(h.Error, testSecret) {
		t.Fatal("health output must never contain the secret")
	}
}

// ---------------------------------------------------------------- webhooks

func signedWebhook(t *testing.T, ev *lkproto.WebhookEvent, key, secret string) *http.Request {
	t.Helper()
	body, err := protojson.Marshal(ev)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	jwt, err := auth.NewAccessToken(key, secret).SetSha256(base64.StdEncoding.EncodeToString(sum[:])).SetValidFor(5 * time.Minute).ToJWT()
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/webhooks/livekit", strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/webhook+json")
	r.Header.Set("Authorization", jwt)
	return r
}

func TestParseWebhookAcceptsASignedEvent(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	ev := &lkproto.WebhookEvent{Event: "participant_joined", Id: "EV_1", CreatedAt: t0.Unix(),
		Room: &lkproto.Room{Name: "academy-live-1"}, Participant: &lkproto.ParticipantInfo{Identity: "user-1"}}
	got, err := c.ParseWebhook(signedWebhook(t, ev, testKey, testSecret))
	if err != nil {
		t.Fatalf("a correctly signed webhook must verify: %v", err)
	}
	if got.Type != "participant_joined" || got.Room != "academy-live-1" || got.Identity != "user-1" || got.ID != "EV_1" || !got.At.Equal(t0) {
		t.Fatalf("event mapped wrong: %+v", got)
	}
}

func TestParseWebhookRejectsForgeries(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	ev := &lkproto.WebhookEvent{Event: "room_finished", Room: &lkproto.Room{Name: "r"}}

	wrongSecret := signedWebhook(t, ev, testKey, strings.Repeat("x", 40))
	wrongKey := signedWebhook(t, ev, "SomeOtherKey", testSecret)

	tampered := signedWebhook(t, ev, testKey, testSecret)
	tampered.Body = io.NopCloser(strings.NewReader(`{"event":"room_finished","room":{"name":"other-room"}}`))

	unsigned := httptest.NewRequest(http.MethodPost, "/w", strings.NewReader(`{"event":"room_finished"}`))

	for name, r := range map[string]*http.Request{"wrong secret": wrongSecret, "wrong key": wrongKey, "body tampered after signing": tampered, "no signature": unsigned} {
		if _, err := c.ParseWebhook(r); !errors.Is(err, ErrBadWebhook) {
			t.Errorf("%s: err = %v, want ErrBadWebhook", name, err)
		}
	}
}

func serveWebhook(t *testing.T, c *Client, on func(context.Context, Event) error, r *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.POST("/webhooks/livekit", c.WebhookHandler(on))
	w := httptest.NewRecorder()
	e.ServeHTTP(w, r)
	return w
}

func TestWebhookHandlerStatuses(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	ev := &lkproto.WebhookEvent{Event: "room_finished", Id: "EV_2", Room: &lkproto.Room{Name: "academy-live-9"}}

	var got []Event
	ok := func(_ context.Context, e Event) error { got = append(got, e); return nil }

	if w := serveWebhook(t, c, ok, signedWebhook(t, ev, testKey, testSecret)); w.Code != http.StatusOK {
		t.Fatalf("valid event -> %d (%s)", w.Code, w.Body.String())
	}
	if len(got) != 1 || got[0].Type != "room_finished" || got[0].Room != "academy-live-9" {
		t.Fatalf("callback not invoked with the event: %+v", got)
	}

	got = nil
	if w := serveWebhook(t, c, ok, signedWebhook(t, ev, testKey, strings.Repeat("z", 40))); w.Code != http.StatusUnauthorized {
		t.Fatalf("forged event -> %d, want 401", w.Code)
	}
	if len(got) != 0 {
		t.Fatal("a forged event reached the callback")
	}

	// A failing consumer must answer 5xx so LiveKit retries the delivery.
	boom := func(context.Context, Event) error { return fmt.Errorf("db down") }
	if w := serveWebhook(t, c, boom, signedWebhook(t, ev, testKey, testSecret)); w.Code != http.StatusInternalServerError {
		t.Fatalf("callback failure -> %d, want 500", w.Code)
	}

	// With no consumer wired, a valid event is still acknowledged (nothing to retry).
	if w := serveWebhook(t, c, nil, signedWebhook(t, ev, testKey, testSecret)); w.Code != http.StatusOK {
		t.Fatalf("nil consumer -> %d, want 200", w.Code)
	}
}

func TestWebhookBodyIsBounded(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	big := signedWebhook(t, &lkproto.WebhookEvent{Event: "x", Room: &lkproto.Room{Name: strings.Repeat("a", 2<<20)}}, testKey, testSecret)
	if w := serveWebhook(t, c, nil, big); w.Code == http.StatusOK {
		t.Fatalf("an oversized webhook body must be refused, got %d", w.Code)
	}
}
