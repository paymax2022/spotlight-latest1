package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/integrations/livekit"
)

func TestConsultRailRefusesRoomsOutsideItsNamespace(t *testing.T) {
	f := &fakeLK{}
	rail := consultLiveKitRail{lk: f, defaultTTL: 10 * time.Minute}
	for _, room := range []string{"academy-live-s1", "consult-s1", "consult-vet", ""} {
		if err := rail.EnsureRoom(context.Background(), room); err == nil {
			t.Fatalf("EnsureRoom(%q) must refuse", room)
		}
		if _, err := rail.JoinToken(context.Background(), room, "u1", consultengine.MediaPeer, time.Minute); err == nil {
			t.Fatalf("JoinToken(%q) must refuse", room)
		}
	}
	if len(f.created) != 0 || len(f.tokens) != 0 {
		t.Fatalf("a refused room reached LiveKit: created=%v tokens=%v", f.created, f.tokens)
	}
}

func TestConsultRailMapsPeerRolesAndPassesTheTTL(t *testing.T) {
	f := &fakeLK{}
	rail := consultLiveKitRail{lk: f, defaultTTL: 10 * time.Minute}
	room := "consult-vet-abc"
	if err := rail.EnsureRoom(context.Background(), room); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if len(f.created) != 1 || f.created[0] != room {
		t.Fatalf("created = %v, want [%s]", f.created, room)
	}
	if _, err := rail.JoinToken(context.Background(), room, "p1", consultengine.MediaPeer, 90*time.Second); err != nil {
		t.Fatalf("patient token: %v", err)
	}
	if _, err := rail.JoinToken(context.Background(), room, "d1", consultengine.MediaPeerAdmin, 90*time.Second); err != nil {
		t.Fatalf("provider token: %v", err)
	}
	if len(f.tokens) != 2 {
		t.Fatalf("tokens = %v", f.tokens)
	}
	if f.tokens[0].Role != livekit.RolePeer || f.tokens[1].Role != livekit.RolePeerAdmin {
		t.Fatalf("roles = %q, %q; want peer, peer_admin", f.tokens[0].Role, f.tokens[1].Role)
	}
	if f.tokens[0].TTL != 90*time.Second {
		t.Fatalf("ttl = %v, want 90s", f.tokens[0].TTL)
	}
	if rail.URL() != "wss://rtc.example.com" {
		t.Fatalf("url = %q", rail.URL())
	}
	if rail.TokenTTL() != 10*time.Minute {
		t.Fatalf("token ttl = %v", rail.TokenTTL())
	}
}

func TestConsultMediaFailsClosed(t *testing.T) {
	off := config.Config{}
	if m := consultMediaFor(off, nil); m != nil {
		t.Fatal("media must be nil when the LiveKit flag is off")
	}
	on := config.Config{FeatureLiveKitEnabled: true, LiveKitTokenTTLSeconds: 600}
	m := consultMediaFor(on, nil)
	if m == nil {
		t.Fatal("flag on with a broken client must still return a refusing implementation")
	}
	if err := m.EnsureRoom(context.Background(), "consult-vet-x"); !errors.Is(err, consultengine.ErrMediaUnavailable) {
		t.Fatalf("EnsureRoom: err = %v, want ErrMediaUnavailable", err)
	}
	if _, err := m.JoinToken(context.Background(), "consult-vet-x", "u", consultengine.MediaPeer, time.Minute); !errors.Is(err, consultengine.ErrMediaUnavailable) {
		t.Fatalf("JoinToken: err = %v, want ErrMediaUnavailable", err)
	}
	if m.URL() != "" {
		t.Fatalf("a refusing rail must not advertise a URL, got %q", m.URL())
	}
}
