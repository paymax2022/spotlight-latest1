package live

import (
	"context"
	"log"
	"time"
)

// LiveRoomProvider is the INJECTED streaming-room provider (LiveKit-style). Domain
// code calls this interface; the concrete vendor adapter (e.g. connect/live's
// LiveKit/VideoSDK issuer) is wired in at the composition root. NO vendor type ever
// leaks into this package (paymax-rails.md streaming — "adapter, not SDK leak").
//   - CreateRoom provisions/returns a room reference for a session.
//   - Token mints a join credential for (room, user, role).
//
// A nil provider degrades to a deterministic STUB (stubRoomProvider): it returns a
// synthetic room ref and a stub token so the package runs end-to-end in dev. The
// stub NEVER fabricates a real stream — callers must treat its output as non-live.
type LiveRoomProvider interface {
	CreateRoom(ctx context.Context, sessionID string) (roomRef string, err error)
	Token(ctx context.Context, roomRef, userID, role string) (token string, err error)
}

// stubRoomProvider is the deterministic dev fallback used when no provider is wired.
// roomRef = "room-"+sessionID; token is a stable synthetic string per (room,user,role).
type stubRoomProvider struct{}

func (stubRoomProvider) CreateRoom(_ context.Context, sessionID string) (string, error) {
	return "room-" + sessionID, nil
}

func (stubRoomProvider) Token(_ context.Context, roomRef, userID, role string) (string, error) {
	return "stub-token-" + roomRef + "-" + userID + "-" + role, nil
}

// providerOrStub returns p, or a deterministic stub when p is nil.
func providerOrStub(p LiveRoomProvider) LiveRoomProvider {
	if p == nil {
		return stubRoomProvider{}
	}
	return p
}

// RoomConnection tells a client where to connect with the token it was given. Only
// providers that run a server the client dials (LiveKit) report one; the dev stub and
// VideoSDK do not, so their join response is unchanged.
type RoomConnection struct {
	Provider string `json:"provider"`
	URL      string `json:"url"`
}

// ConnectionInfoProvider is the OPTIONAL capability of reporting a RoomConnection.
type ConnectionInfoProvider interface{ Connection() RoomConnection }

// RoomCloser is the OPTIONAL capability of closing a room, disconnecting everyone in it, when
// a session ends or is cancelled. Without it a participant stays connected until the provider's
// own empty-room timeout.
type RoomCloser interface {
	CloseRoom(ctx context.Context, roomRef string) error
}

func connectionOf(p LiveRoomProvider) *RoomConnection {
	if c, ok := p.(ConnectionInfoProvider); ok {
		info := c.Connection()
		return &info
	}
	return nil
}

// closeRoomBestEffort closes the session's room if the provider can. The session state change
// has already been committed, so a provider failure is logged, never returned.
func closeRoomBestEffort(ctx context.Context, p LiveRoomProvider, roomRef *string) {
	closer, ok := p.(RoomCloser)
	if !ok || roomRef == nil || *roomRef == "" {
		return
	}
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err := closer.CloseRoom(cctx, *roomRef); err != nil {
		log.Printf("[academy-live] could not close room %q: %v", *roomRef, err)
	}
}
