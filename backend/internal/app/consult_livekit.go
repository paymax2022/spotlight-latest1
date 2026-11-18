package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/integrations/livekit"
)

// consultRoomPrefix names every room the shared consult engine owns. The rail
// refuses to provision or mint for anything outside it, so consult code cannot
// reach academy rooms or arbitrary SFU rooms.
const consultRoomPrefix = "consult-"

type consultLiveKitRail struct {
	lk         liveKitAPI
	defaultTTL time.Duration
}

var _ consultengine.RoomMedia = consultLiveKitRail{}

// consultRoomOK reports whether room is a complete consult room name of the
// form consult-<vertical>-<session id>. The bare prefix, a name with no session
// id (for example "consult-vet"), and anything outside the namespace are
// refused, so a partial name cannot provision or mint against a shared room.
func consultRoomOK(room string) bool {
	rest, ok := strings.CutPrefix(room, consultRoomPrefix)
	if !ok {
		return false
	}
	vertical, session, found := strings.Cut(rest, "-")
	return found && vertical != "" && session != ""
}

func (c consultLiveKitRail) EnsureRoom(ctx context.Context, room string) error {
	if !consultRoomOK(room) {
		return errors.New("consult live: not a consult room")
	}
	if err := c.lk.CreateRoom(ctx, room); err != nil {
		return fmt.Errorf("consult live: provision room: %w", err)
	}
	return nil
}

func (c consultLiveKitRail) CloseRoom(ctx context.Context, room string) error {
	if !consultRoomOK(room) {
		return errors.New("consult live: not a consult room")
	}
	return c.lk.DeleteRoom(ctx, room)
}

func (c consultLiveKitRail) JoinToken(ctx context.Context, room, identity string, role consultengine.MediaRole, ttl time.Duration) (string, error) {
	if !consultRoomOK(room) {
		return "", errors.New("consult live: not a consult room")
	}
	var r livekit.Role
	switch role {
	case consultengine.MediaPeer:
		r = livekit.RolePeer
	case consultengine.MediaPeerAdmin:
		r = livekit.RolePeerAdmin
	default:
		return "", fmt.Errorf("consult live: unknown role %q", role)
	}
	tok, err := c.lk.JoinToken(livekit.JoinRequest{Room: room, Identity: identity, Role: r, TTL: ttl})
	if err != nil {
		return "", fmt.Errorf("consult live: join token: %w", err)
	}
	return tok.JWT, nil
}

func (c consultLiveKitRail) URL() string { return c.lk.ClientURL() }

func (c consultLiveKitRail) TokenTTL() time.Duration {
	if c.defaultTTL <= 0 {
		return consultengine.DefaultJoinTTL
	}
	return c.defaultTTL
}

// unavailableConsultMedia refuses every media call. It is installed when
// FEATURE_LIVEKIT_ENABLED is on but the client could not be built, so a consult
// fails loudly instead of pretending a room exists.
type unavailableConsultMedia struct{}

var _ consultengine.RoomMedia = unavailableConsultMedia{}

func (unavailableConsultMedia) EnsureRoom(context.Context, string) error {
	return consultengine.ErrMediaUnavailable
}
func (unavailableConsultMedia) CloseRoom(context.Context, string) error {
	return consultengine.ErrMediaUnavailable
}
func (unavailableConsultMedia) JoinToken(context.Context, string, string, consultengine.MediaRole, time.Duration) (string, error) {
	return "", consultengine.ErrMediaUnavailable
}
func (unavailableConsultMedia) URL() string             { return "" }
func (unavailableConsultMedia) TokenTTL() time.Duration { return consultengine.DefaultJoinTTL }

// consultMediaFor picks the media implementation: nil when the feature is off
// (sessions then fail closed with ErrMediaUnavailable), a refusing rail when the
// flag is on but the client is unusable, or the real rail.
func consultMediaFor(cfg config.Config, lk *livekit.Client) consultengine.RoomMedia {
	if !cfg.FeatureLiveKitEnabled {
		return nil
	}
	if lk == nil {
		return unavailableConsultMedia{}
	}
	return consultLiveKitRail{lk: lk, defaultTTL: time.Duration(cfg.LiveKitTokenTTLSeconds) * time.Second}
}
