package transport

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/notifications"
)

type fakeUserNotifier struct {
	calls []struct {
		userID, event, title, body string
		data                       map[string]any
	}
	err error
}

func (f *fakeUserNotifier) NotifyUser(_ context.Context, userID, event, title, body string, data map[string]any) error {
	f.calls = append(f.calls, struct {
		userID, event, title, body string
		data                       map[string]any
	}{userID, event, title, body, data})
	return f.err
}

func TestNotifyUser_NilNotifierIsSafe(t *testing.T) {
	s := &Service{}
	s.notifyUser(context.Background(), "u1", "scheduled.reminder", "b1", "hi") // must not panic
}

func TestNotifyUser_RoutesThroughNotifier(t *testing.T) {
	f := &fakeUserNotifier{}
	s := (&Service{}).WithUserNotifier(f)
	s.notifyUser(context.Background(), "u1", "scheduled.reminder", "b1", "due soon")
	if len(f.calls) != 1 {
		t.Fatalf("want 1 call, got %d", len(f.calls))
	}
	c := f.calls[0]
	if c.userID != "u1" || c.event != "scheduled.reminder" || c.body != "due soon" || c.title != "Upcoming trip reminder" {
		t.Fatalf("unexpected call %+v", c)
	}
	if c.data["ref"] != "b1" || c.data["event"] != "scheduled.reminder" {
		t.Fatalf("unexpected data %+v", c.data)
	}
}

func TestNotifyUser_DeliveryErrorSwallowed(t *testing.T) {
	f := &fakeUserNotifier{err: errors.New("queue down")}
	s := (&Service{}).WithUserNotifier(f)
	s.notifyUser(context.Background(), "u1", "parcel.insurance_refunded", "", "refunded")
	if len(f.calls) != 1 {
		t.Fatalf("want 1 call, got %d", len(f.calls))
	}
	if _, ok := f.calls[0].data["ref"]; ok {
		t.Fatal("empty ref must not be sent")
	}
}

func TestNotifyUser_SkipsEmptyUser(t *testing.T) {
	f := &fakeUserNotifier{}
	(&Service{}).WithUserNotifier(f).notifyUser(context.Background(), "", "scheduled.reminder", "b1", "x")
	if len(f.calls) != 0 {
		t.Fatal("empty user must not be notified")
	}
}

func TestNotifyUser_CancelledContextStillDelivers(t *testing.T) {
	f := &fakeUserNotifier{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	(&Service{}).WithUserNotifier(f).notifyUser(ctx, "u1", "scheduled.failed_no_driver", "b1", "x")
	if len(f.calls) != 1 || f.calls[0].title != "Scheduled trip not dispatched" {
		t.Fatalf("unexpected calls %+v", f.calls)
	}
}

type fakePushSender struct {
	sent []notifications.Notification
	fail map[string]bool
}

func (f *fakePushSender) Send(_ context.Context, n notifications.Notification) error {
	f.sent = append(f.sent, n)
	if f.fail[n.PushToken] {
		return errors.New("enqueue failed")
	}
	return nil
}

func TestSendToTokens_OnePushPerTokenAndJoinsErrors(t *testing.T) {
	f := &fakePushSender{fail: map[string]bool{"t2": true}}
	err := sendToTokens(context.Background(), f, []string{"t1", "t2", "t3"}, notifications.Notification{UserID: "u1", Event: notifications.EventTransportUpdate})
	if len(f.sent) != 3 {
		t.Fatalf("want 3 sends, got %d", len(f.sent))
	}
	for i, tok := range []string{"t1", "t2", "t3"} {
		if f.sent[i].PushToken != tok {
			t.Fatalf("send %d token=%q want %q", i, f.sent[i].PushToken, tok)
		}
	}
	if err == nil {
		t.Fatal("expected joined error for failed token")
	}
	if err := sendToTokens(context.Background(), f, nil, notifications.Notification{}); err != nil {
		t.Fatalf("no tokens must be nil, got %v", err)
	}
}

func TestPushUserNotifier_NilSafe(t *testing.T) {
	var p *PushUserNotifier
	if err := p.NotifyUser(context.Background(), "u", "e", "t", "b", nil); err != nil {
		t.Fatal(err)
	}
}

func TestShareURL_ConfigurableBase(t *testing.T) {
	s := &Service{}
	if got := s.shareURL("tok"); got != defaultShareBaseURL+"/tok" {
		t.Fatalf("default: %s", got)
	}
	s.WithShareBaseURL(" https://www.spotlightng.com/track/ ")
	if got := s.shareURL("tok"); got != "https://www.spotlightng.com/track/tok" {
		t.Fatalf("configured: %s", got)
	}
	s.WithShareBaseURL("")
	if got := s.shareURL("tok"); got != defaultShareBaseURL+"/tok" {
		t.Fatalf("blank falls back: %s", got)
	}
}
