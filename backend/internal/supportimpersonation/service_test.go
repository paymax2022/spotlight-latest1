package supportimpersonation

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/services"
)

// Unit coverage for the ESTD-D028 start/stop policy. Store, roles, audit and
// notifier are fakes; no Postgres.

const (
	agentID  = "11111111-1111-1111-1111-111111111111"
	targetID = "22222222-2222-2222-2222-222222222222"
)

type fakeSessionStore struct {
	started  []StartParams
	startOut Session
	startErr error

	targetExists bool
	targetStatus string
	targetErr    error

	stopOut Session
	stopOK  bool
	stopErr error

	list []Session
}

func (f *fakeSessionStore) TargetStatus(context.Context, string) (bool, string, error) {
	return f.targetExists, f.targetStatus, f.targetErr
}

func (f *fakeSessionStore) Start(_ context.Context, p StartParams) (Session, error) {
	f.started = append(f.started, p)
	if f.startErr != nil {
		return Session{}, f.startErr
	}
	if f.startOut.ID == "" {
		f.startOut = Session{ID: "sess-1", ActorUserID: p.ActorUserID, TargetUserID: p.TargetUserID,
			Reason: p.Reason, TicketRef: p.TicketRef, Mode: "read_only",
			StartedAt: time.Now(), ExpiresAt: time.Now().Add(p.Duration)}
	}
	return f.startOut, nil
}

func (f *fakeSessionStore) Stop(context.Context, string, string, string, string) (Session, bool, error) {
	return f.stopOut, f.stopOK, f.stopErr
}

func (f *fakeSessionStore) Active(context.Context, string) (*Session, error) { return nil, nil }

func (f *fakeSessionStore) ListForTarget(context.Context, string, int) ([]Session, error) {
	return f.list, nil
}

type fakeRoles struct {
	roles []string
	err   error
}

func (f fakeRoles) GetUserRoles(context.Context, string) ([]string, error) { return f.roles, f.err }

type fakeAudit struct{ actions []string }

func (f *fakeAudit) LogAction(_, _, action, _, _, _ string, _, _ map[string]any, _, _, _ string) {
	f.actions = append(f.actions, action)
}

type fakeNotifier struct{ events []string }

func (f *fakeNotifier) NotifySuspiciousLogin(_, _, eventType string, _ map[string]any) {
	f.events = append(f.events, eventType)
}

func validReq() StartRequest {
	return StartRequest{TargetUserID: targetID, Reason: "helping with a stuck dues invoice", TicketRef: "INC-123"}
}

func testActor() Actor { return Actor{UserID: agentID, Token: "agent-tok", IPAddress: "1.2.3.4"} }

func liveStore() *fakeSessionStore {
	return &fakeSessionStore{targetExists: true, targetStatus: "active"}
}

func TestStart_Validation(t *testing.T) {
	svc := NewService(liveStore(), fakeRoles{}, nil, nil, 0)
	ctx := context.Background()
	a := testActor()

	cases := []struct {
		name string
		mut  func(*StartRequest)
		want error
	}{
		{"bad uuid", func(r *StartRequest) { r.TargetUserID = "not-a-uuid" }, ErrInvalidTarget},
		{"self", func(r *StartRequest) { r.TargetUserID = agentID }, ErrSelf},
		{"short reason", func(r *StartRequest) { r.Reason = "too short" }, ErrReasonRequired},
		{"no ticket", func(r *StartRequest) { r.TicketRef = "" }, ErrTicketRequired},
		{"negative duration", func(r *StartRequest) { r.DurationMinutes = -5 }, ErrDuration},
	}
	for _, tc := range cases {
		req := validReq()
		tc.mut(&req)
		if _, err := svc.Start(ctx, a, req); !errors.Is(err, tc.want) {
			t.Fatalf("%s: want %v, got %v", tc.name, tc.want, err)
		}
	}
}

func TestStart_TargetMustExistAndBeUnprotected(t *testing.T) {
	ctx := context.Background()
	a := testActor()

	svc := NewService(&fakeSessionStore{targetExists: false}, fakeRoles{}, nil, nil, 0)
	if _, err := svc.Start(ctx, a, validReq()); !errors.Is(err, ErrTargetNotFound) {
		t.Fatalf("missing target: want ErrTargetNotFound, got %v", err)
	}

	svc = NewService(&fakeSessionStore{targetExists: true, targetStatus: "deleted"}, fakeRoles{}, nil, nil, 0)
	if _, err := svc.Start(ctx, a, validReq()); !errors.Is(err, ErrTargetNotFound) {
		t.Fatalf("deleted target: want ErrTargetNotFound, got %v", err)
	}

	for _, role := range []string{"super-admin", "System-Admin", "support-impersonation-agent"} {
		svc = NewService(liveStore(), fakeRoles{roles: []string{role}}, nil, nil, 0)
		if _, err := svc.Start(ctx, a, validReq()); !errors.Is(err, ErrTargetProtected) {
			t.Fatalf("target with role %q: want ErrTargetProtected, got %v", role, err)
		}
	}

	svc = NewService(liveStore(), fakeRoles{err: errors.New("rbac down")}, nil, nil, 0)
	if _, err := svc.Start(ctx, a, validReq()); !errors.Is(err, ErrTargetRolesCheck) {
		t.Fatalf("roles lookup failure must fail closed, got %v", err)
	}
}

func TestStart_WritesSessionAuditsAndNotifies(t *testing.T) {
	store := liveStore()
	audit := &fakeAudit{}
	notifier := &fakeNotifier{}
	svc := NewService(store, fakeRoles{}, audit, notifier, 0)
	sess, err := svc.Start(context.Background(), testActor(), validReq())
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if len(store.started) != 1 {
		t.Fatal("no session written")
	}
	p := store.started[0]
	if p.ActorTokenHash != services.HashToken("agent-tok") {
		t.Fatal("session must bind the agent's token hash")
	}
	if p.Duration != DefaultDuration {
		t.Fatalf("default duration %s, want %s", p.Duration, DefaultDuration)
	}
	if sess.Mode != "read_only" {
		t.Fatalf("mode %q, want read_only", sess.Mode)
	}
	if len(audit.actions) != 1 || audit.actions[0] != "support.impersonation.start" {
		t.Fatalf("start must be audited, got %v", audit.actions)
	}
	if len(notifier.events) != 1 || notifier.events[0] != services.EventSupportAccess {
		t.Fatalf("impersonated user must be notified, got %v", notifier.events)
	}
}

func TestStart_DurationClampedToMax(t *testing.T) {
	store := liveStore()
	svc := NewService(store, fakeRoles{}, nil, nil, 30*time.Minute)
	req := validReq()
	req.DurationMinutes = 120
	if _, err := svc.Start(context.Background(), testActor(), req); err != nil {
		t.Fatalf("start: %v", err)
	}
	if got := store.started[0].Duration; got != 30*time.Minute {
		t.Fatalf("duration %s must clamp to configured max 30m", got)
	}
}

func TestClampMax(t *testing.T) {
	if got := ClampMax(0); got != 30*time.Minute {
		t.Fatalf("zero → 30m default, got %s", got)
	}
	if got := ClampMax(2 * time.Hour); got != MaxDuration {
		t.Fatalf("over ceiling clamps to %s, got %s", MaxDuration, got)
	}
}

func TestStop_OnlyOwnSessions(t *testing.T) {
	svc := NewService(&fakeSessionStore{stopOK: false}, fakeRoles{}, nil, nil, 0)
	if _, err := svc.Stop(context.Background(), testActor(), "sess-x"); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("foreign/missing session: want ErrSessionNotFound, got %v", err)
	}

	audit := &fakeAudit{}
	svc = NewService(&fakeSessionStore{stopOK: true, stopOut: Session{ID: "s", TargetUserID: targetID, EndReason: "stopped"}}, fakeRoles{}, audit, nil, 0)
	if _, err := svc.Stop(context.Background(), testActor(), "s"); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if len(audit.actions) != 1 || audit.actions[0] != "support.impersonation.stop" {
		t.Fatalf("stop must be audited, got %v", audit.actions)
	}
}

func TestUnwiredServiceFailsClosed(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, 0)
	if _, err := svc.Start(context.Background(), testActor(), validReq()); !errors.Is(err, ErrServiceUnwired) {
		t.Fatalf("unwired: want ErrServiceUnwired, got %v", err)
	}
}
