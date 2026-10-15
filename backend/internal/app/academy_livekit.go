package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	academylive "spotlight/backend/internal/academy/live"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations/livekit"
)

// academyRoomPrefix names every LiveKit room the academy owns. The adapter refuses to mint
// tokens for, or close, any room outside it, so a bad room reference cannot reach another
// module's rooms.
const academyRoomPrefix = "academy-live-"

// liveKitAPI is the slice of *livekit.Client the academy adapter needs.
type liveKitAPI interface {
	JoinToken(livekit.JoinRequest) (livekit.Token, error)
	CreateRoom(ctx context.Context, name string) error
	DeleteRoom(ctx context.Context, name string) error
	ClientURL() string
}

var _ liveKitAPI = (*livekit.Client)(nil)

// academyLiveKitRail runs academy live classes on a self-hosted LiveKit server. The room is
// the session (deterministic name); a host may publish, an attendee may only subscribe and
// send data messages. It satisfies academy/live.LiveRoomProvider and the optional
// ConnectionInfoProvider and RoomCloser capabilities.
type academyLiveKitRail struct{ lk liveKitAPI }

var (
	_ academylive.LiveRoomProvider       = academyLiveKitRail{}
	_ academylive.ConnectionInfoProvider = academyLiveKitRail{}
	_ academylive.RoomCloser             = academyLiveKitRail{}
)

// CreateRoom provisions the session's room on the server. A failure is an error with no room
// reference: a class is never started on a room that does not exist.
func (a academyLiveKitRail) CreateRoom(ctx context.Context, sessionID string) (string, error) {
	name := academyRoomPrefix + sessionID
	if err := a.lk.CreateRoom(ctx, name); err != nil {
		return "", fmt.Errorf("academy live: provision room: %w", err)
	}
	return name, nil
}

// Token mints a join credential for one user in one academy room.
func (a academyLiveKitRail) Token(ctx context.Context, roomRef, userID, role string) (string, error) {
	if !strings.HasPrefix(roomRef, academyRoomPrefix) {
		return "", errors.New("academy live: not an academy room")
	}
	var r livekit.Role
	switch role {
	case "host":
		r = livekit.RoleHost
	case "attendee":
		r = livekit.RoleParticipant
	default:
		return "", fmt.Errorf("academy live: unknown role %q", role)
	}
	// The server is run with room.auto_create off, so a room the empty-room timeout has closed
	// must be re-provisioned before anyone can rejoin it. CreateRoom is idempotent.
	if err := a.lk.CreateRoom(ctx, roomRef); err != nil {
		return "", fmt.Errorf("academy live: ensure room: %w", err)
	}
	tok, err := a.lk.JoinToken(livekit.JoinRequest{Room: roomRef, Identity: userID, Role: r})
	if err != nil {
		return "", fmt.Errorf("academy live: join token: %w", err)
	}
	return tok.JWT, nil
}

// Connection tells the client which server to dial with the token.
func (a academyLiveKitRail) Connection() academylive.RoomConnection {
	return academylive.RoomConnection{Provider: "livekit", URL: a.lk.ClientURL()}
}

// CloseRoom ends the room, disconnecting everyone still in it.
func (a academyLiveKitRail) CloseRoom(ctx context.Context, roomRef string) error {
	if !strings.HasPrefix(roomRef, academyRoomPrefix) {
		return errors.New("academy live: not an academy room")
	}
	return a.lk.DeleteRoom(ctx, roomRef)
}

// errLiveKitUnavailable is what a live class gets when LiveKit was switched on but cannot be used.
var errLiveKitUnavailable = errors.New("academy live: LiveKit is enabled but unavailable (see the [livekit] alert in the backend log)")

// unavailableLiveRooms refuses every request. It is installed when FEATURE_LIVEKIT_ENABLED is on
// but the configuration is unusable, so a live class fails loudly instead of quietly running on
// the dev stub, whose "tokens" no media server would accept.
type unavailableLiveRooms struct{}

func (unavailableLiveRooms) CreateRoom(context.Context, string) (string, error) {
	return "", errLiveKitUnavailable
}

func (unavailableLiveRooms) Token(context.Context, string, string, string) (string, error) {
	return "", errLiveKitUnavailable
}

// academyLiveRoomsFor chooses the room provider for academy live classes. nil means "not LiveKit":
// the previous provider (VideoSDK, else the dev stub) stays in place. With the flag on, the answer
// is never nil: a usable client, or a provider that refuses.
func academyLiveRoomsFor(cfg config.Config, lk *livekit.Client) academylive.LiveRoomProvider {
	if !cfg.FeatureLiveKitEnabled {
		return nil
	}
	if lk == nil {
		return unavailableLiveRooms{}
	}
	return academyLiveKitRail{lk: lk}
}
