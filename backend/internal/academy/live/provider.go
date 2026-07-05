package live

import "context"

// LiveRoomProvider is the INJECTED streaming-room provider (LiveKit-style). Domain
// code calls this interface; the concrete vendor adapter (e.g. connect/live's
// LiveKit/Agora issuer) is wired in at the composition root. NO vendor type ever
// leaks into this package (paymax-rails.md streaming — "adapter, not SDK leak").
//
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
