package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations/livekit"
)

// fakeLK records what the adapter asks LiveKit for.
type fakeLK struct {
	created, deleted []string
	tokens           []livekit.JoinRequest
	createErr        error
	deleteErr        error
}

func (f *fakeLK) CreateRoom(_ context.Context, n string) error {
	f.created = append(f.created, n)
	return f.createErr
}
func (f *fakeLK) DeleteRoom(_ context.Context, n string) error {
	f.deleted = append(f.deleted, n)
	return f.deleteErr
}
func (f *fakeLK) JoinToken(r livekit.JoinRequest) (livekit.Token, error) {
	f.tokens = append(f.tokens, r)
	return livekit.Token{JWT: "jwt-for-" + r.Identity}, nil
}
func (f *fakeLK) ClientURL() string { return "wss://rtc.example.com" }

func TestAcademyLiveKitRoomIsNamedAfterTheSessionAndProvisionedOnTheServer(t *testing.T) {
	f := &fakeLK{}
	room, err := academyLiveKitRail{lk: f}.CreateRoom(context.Background(), "9f1c")
	if err != nil || room != "academy-live-9f1c" {
		t.Fatalf("room = %q, %v", room, err)
	}
	if len(f.created) != 1 || f.created[0] != "academy-live-9f1c" {
		t.Fatalf("the room was not created on the LiveKit server: %v", f.created)
	}
}

func TestAcademyLiveKitDoesNotFabricateARoomWhenTheServerFails(t *testing.T) {
	f := &fakeLK{createErr: errors.New("livekit down")}
	room, err := academyLiveKitRail{lk: f}.CreateRoom(context.Background(), "s1")
	if err == nil || room != "" {
		t.Fatalf("a failed provision must be an error with no room ref, got %q, %v", room, err)
	}
}

func TestAcademyLiveKitRolesMapToTheMinimumPermissions(t *testing.T) {
	f := &fakeLK{}
	a := academyLiveKitRail{lk: f}
	for role, want := range map[string]livekit.Role{"host": livekit.RoleHost, "attendee": livekit.RoleParticipant} {
		tok, err := a.Token(context.Background(), "academy-live-1", "user-7", role)
		if err != nil || tok != "jwt-for-user-7" {
			t.Fatalf("%s: %q, %v", role, tok, err)
		}
		got := f.tokens[len(f.tokens)-1]
		if got.Role != want || got.Room != "academy-live-1" || got.Identity != "user-7" {
			t.Errorf("%s -> %+v, want role %s", role, got, want)
		}
	}
}

func TestAcademyLiveKitRefusesWhatItDoesNotOwnOrUnderstand(t *testing.T) {
	f := &fakeLK{}
	a := academyLiveKitRail{lk: f}
	ctx := context.Background()
	for name, call := range map[string]func() error{
		"unknown role":         func() error { _, e := a.Token(ctx, "academy-live-1", "u", "admin"); return e },
		"empty role":           func() error { _, e := a.Token(ctx, "academy-live-1", "u", ""); return e },
		"no room":              func() error { _, e := a.Token(ctx, "", "u", "host"); return e },
		"someone else's room":  func() error { _, e := a.Token(ctx, "doctor-consult-1", "u", "host"); return e },
		"close someone else's": func() error { return a.CloseRoom(ctx, "doctor-consult-1") },
		"close nothing":        func() error { return a.CloseRoom(ctx, "") },
	} {
		if call() == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if len(f.tokens) != 0 || len(f.deleted) != 0 {
		t.Fatalf("LiveKit was asked to act on something the academy does not own: %v %v", f.tokens, f.deleted)
	}
}

func TestAcademyLiveKitClosesItsRoomAndReportsWhereToConnect(t *testing.T) {
	f := &fakeLK{}
	a := academyLiveKitRail{lk: f}
	if err := a.CloseRoom(context.Background(), "academy-live-1"); err != nil || len(f.deleted) != 1 {
		t.Fatalf("close: %v %v", err, f.deleted)
	}
	if c := a.Connection(); c.Provider != "livekit" || c.URL != "wss://rtc.example.com" {
		t.Fatalf("connection = %+v", c)
	}
}

var fakeLKClient = livekit.Client{}

// ---- wiring

const lkTestSecret = "s3cr3t-s3cr3t-s3cr3t-s3cr3t-s3cr3t-0123"

func lkConfig() config.Config {
	return config.Config{FeatureLiveKitEnabled: true, LiveKitURL: "wss://rtc.example.com", LiveKitAPIKey: "APIkey", LiveKitAPISecret: lkTestSecret, LiveKitTokenTTLSeconds: 600}
}

func passAuth(c *gin.Context) { c.Next() }

func TestRegisterLiveKitIsAbsentWhenTheFlagIsOff(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	cfg := lkConfig()
	cfg.FeatureLiveKitEnabled = false
	if c := registerLiveKit(r, cfg, nil, passAuth); c != nil {
		t.Fatal("the flag is off: no client")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/livekit", strings.NewReader("{}")))
	if w.Code != http.StatusNotFound {
		t.Fatalf("the webhook must not be mounted while the flag is off, got %d", w.Code)
	}
}

func TestRegisterLiveKitFailsClosedOnBadConfig(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	cfg := lkConfig()
	cfg.LiveKitAPISecret = "short"
	if c := registerLiveKit(r, cfg, nil, passAuth); c != nil {
		t.Fatal("an invalid configuration must not produce a client")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/livekit", strings.NewReader("{}")))
	if w.Code != http.StatusNotFound {
		t.Fatalf("nothing is mounted for a bad configuration, got %d", w.Code)
	}
}

func TestRegisterLiveKitMountsAnAuthenticatedWebhook(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	c := registerLiveKit(r, lkConfig(), nil, passAuth)
	if c == nil {
		t.Fatal("a valid configuration must produce a client")
	}
	// Unsigned -> 401 (it is reachable without user auth, so the signature is the only gate).
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/livekit", strings.NewReader(`{"event":"room_finished"}`)))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned webhook -> %d, want 401", w.Code)
	}
}

// With room.auto_create off on the server (so a token holder cannot conjure rooms), a room closed
// by the empty-room timeout cannot be rejoined unless it is re-provisioned. Token does that first.
func TestAcademyLiveKitTokenEnsuresTheRoomExistsFirst(t *testing.T) {
	f := &fakeLK{}
	a := academyLiveKitRail{lk: f}
	if _, err := a.Token(context.Background(), "academy-live-1", "user-7", "attendee"); err != nil {
		t.Fatal(err)
	}
	if len(f.created) != 1 || f.created[0] != "academy-live-1" {
		t.Fatalf("the room was not ensured before the token was minted: %v", f.created)
	}
}

func TestAcademyLiveKitMintsNoTokenWhenTheRoomCannotBeEnsured(t *testing.T) {
	f := &fakeLK{createErr: errors.New("livekit down")}
	tok, err := academyLiveKitRail{lk: f}.Token(context.Background(), "academy-live-1", "user-7", "host")
	if err == nil || tok != "" {
		t.Fatalf("a token for a room that may not exist must not be handed out: %q, %v", tok, err)
	}
	if len(f.tokens) != 0 {
		t.Fatal("a token was minted anyway")
	}
}

// A flagged-on but unusable LiveKit must not quietly hand out the dev stub's fake tokens.
func TestFlaggedOnButUnavailableLiveKitFailsClosed(t *testing.T) {
	on, off := lkConfig(), lkConfig()
	off.FeatureLiveKitEnabled = false

	if p := academyLiveRoomsFor(off, nil); p != nil {
		t.Fatalf("flag off must leave the previous provider alone, got %T", p)
	}
	if p := academyLiveRoomsFor(on, &fakeLKClient); p == nil {
		t.Fatal("a working client must be used")
	}
	p := academyLiveRoomsFor(on, nil)
	if p == nil {
		t.Fatal("flag on with no usable client must install a refusing provider, not fall back to the stub")
	}
	if room, err := p.CreateRoom(context.Background(), "s1"); err == nil || room != "" {
		t.Fatalf("CreateRoom must refuse, got %q, %v", room, err)
	}
	if tok, err := p.Token(context.Background(), "academy-live-s1", "u", "host"); err == nil || tok != "" {
		t.Fatalf("Token must refuse, got %q, %v", tok, err)
	}
}
