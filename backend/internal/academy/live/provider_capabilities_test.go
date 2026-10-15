package live

import (
	"context"
	"errors"
	"testing"
)

type plainProvider struct{}

func (plainProvider) CreateRoom(context.Context, string) (string, error)            { return "r", nil }
func (plainProvider) Token(context.Context, string, string, string) (string, error) { return "t", nil }

// richProvider also tells clients where to connect and can close a room.
type richProvider struct {
	plainProvider
	closed []string
	err    error
}

func (*richProvider) Connection() RoomConnection {
	return RoomConnection{Provider: "livekit", URL: "wss://rtc.example.com"}
}
func (p *richProvider) CloseRoom(_ context.Context, roomRef string) error {
	p.closed = append(p.closed, roomRef)
	return p.err
}

func TestConnectionOfOnlyReportsProvidersThatKnowTheirURL(t *testing.T) {
	if c := connectionOf(plainProvider{}); c != nil {
		t.Fatalf("a provider with no connection info must report none, got %+v", c)
	}
	if c := connectionOf(stubRoomProvider{}); c != nil {
		t.Fatalf("the dev stub must not advertise a connection: %+v", c)
	}
	c := connectionOf(&richProvider{})
	if c == nil || c.Provider != "livekit" || c.URL != "wss://rtc.example.com" {
		t.Fatalf("connection = %+v", c)
	}
}

func TestCloseRoomBestEffort(t *testing.T) {
	ref := "academy-live-1"
	empty := ""

	p := &richProvider{}
	closeRoomBestEffort(context.Background(), p, &ref)
	if len(p.closed) != 1 || p.closed[0] != ref {
		t.Fatalf("the room was not closed: %v", p.closed)
	}

	// Nothing to close, or nothing able to close it: no call, no panic.
	p2 := &richProvider{}
	closeRoomBestEffort(context.Background(), p2, nil)
	closeRoomBestEffort(context.Background(), p2, &empty)
	closeRoomBestEffort(context.Background(), plainProvider{}, &ref)
	if len(p2.closed) != 0 {
		t.Fatalf("closed with no room ref: %v", p2.closed)
	}

	// A provider failure must never surface: the session state change already happened.
	failing := &richProvider{err: errors.New("livekit down")}
	closeRoomBestEffort(context.Background(), failing, &ref)
	if len(failing.closed) != 1 {
		t.Fatal("the close should still have been attempted")
	}
}

func TestJoinResponseAddsTheConnectionOnlyWhenKnown(t *testing.T) {
	sess := &LiveSession{ID: "s1"}
	plain := joinResponse(sess, "tok", nil)
	if _, has := plain["rtc"]; has {
		t.Fatal("no rtc block without connection info (keeps the VideoSDK/stub response unchanged)")
	}
	if plain["token"] != "tok" || plain["session"] != sess {
		t.Fatalf("existing fields changed: %+v", plain)
	}
	rich := joinResponse(sess, "tok", &RoomConnection{Provider: "livekit", URL: "wss://rtc.example.com"})
	rtc, ok := rich["rtc"].(*RoomConnection)
	if !ok || rtc.URL != "wss://rtc.example.com" {
		t.Fatalf("rtc block missing: %+v", rich)
	}
}
