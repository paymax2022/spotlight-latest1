package stepup

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/services"
)

// Unit coverage for the step-up challenge/verify flow (ESTD-D014). Store,
// issuer and verifier are fakes; no Postgres, no Brevo.

type fakeStore struct {
	inserted  []Grant
	state     middleware.StepUpGrantState
	stateErr  error
	insertErr error
}

func (f *fakeStore) Insert(_ context.Context, g Grant) error {
	if f.insertErr != nil {
		return f.insertErr
	}
	f.inserted = append(f.inserted, g)
	return nil
}

func (f *fakeStore) GrantState(_ context.Context, _, _ string) (middleware.StepUpGrantState, error) {
	return f.state, f.stateErr
}

type fakeAudit struct{ actions []string }

func (f *fakeAudit) LogAction(_, _, action, _, _, _ string, _, _ map[string]any, _, _, _ string) {
	f.actions = append(f.actions, action)
}

func testCaller() Caller {
	return Caller{UserID: "u-1", Email: "u@x.c", Token: "tok-1", IPAddress: "1.2.3.4", UserAgent: "ua"}
}

func TestClampTTL(t *testing.T) {
	if got := ClampTTL(0); got != DefaultTTL {
		t.Fatalf("zero → default, got %s", got)
	}
	if got := ClampTTL(time.Second); got != MinTTL {
		t.Fatalf("below min clamps up, got %s", got)
	}
	if got := ClampTTL(time.Hour); got != MaxTTL {
		t.Fatalf("above max clamps down, got %s", got)
	}
	if got := ClampTTL(7 * time.Minute); got != 7*time.Minute {
		t.Fatalf("in range passes through, got %s", got)
	}
}

func TestUnavailableFailsClosed(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, 0)
	if svc.Available() {
		t.Fatal("nil deps must not be available")
	}
	if err := svc.Challenge(context.Background(), testCaller()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("challenge with no store must fail closed, got %v", err)
	}
	if _, err := svc.Verify(context.Background(), testCaller(), "123456"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("verify with no store must fail closed, got %v", err)
	}
}

func TestChallenge_NoEmail(t *testing.T) {
	svc := NewService(&fakeStore{}, func(context.Context, string, string, string, string) error { return nil },
		func(context.Context, string, string, string, string) error { return nil }, nil, 0)
	c := testCaller()
	c.Email = "  "
	if err := svc.Challenge(context.Background(), c); !errors.Is(err, ErrNoEmail) {
		t.Fatalf("empty email → ErrNoEmail, got %v", err)
	}
}

func TestChallenge_IssuesStepUpPurposeAndAudits(t *testing.T) {
	var gotPurpose, gotEmail string
	audit := &fakeAudit{}
	svc := NewService(&fakeStore{},
		func(_ context.Context, email, _, purpose, _ string) error {
			gotEmail, gotPurpose = email, purpose
			return nil
		},
		func(context.Context, string, string, string, string) error { return nil }, audit, 0)
	if err := svc.Challenge(context.Background(), testCaller()); err != nil {
		t.Fatalf("challenge: %v", err)
	}
	if gotPurpose != otp.PurposeStepUp || gotEmail != "u@x.c" {
		t.Fatalf("issuer got (%q,%q), want step_up to the account email", gotEmail, gotPurpose)
	}
	if len(audit.actions) != 1 || audit.actions[0] != "auth.step_up.challenge" {
		t.Fatalf("challenge must be audited, got %v", audit.actions)
	}
}

func TestVerify_BadCodeRefusedAndAudited(t *testing.T) {
	store := &fakeStore{}
	audit := &fakeAudit{}
	svc := NewService(store,
		func(context.Context, string, string, string, string) error { return nil },
		func(context.Context, string, string, string, string) error { return otp.ErrInvalidCode }, audit, 0)
	if _, err := svc.Verify(context.Background(), testCaller(), "000000"); !errors.Is(err, otp.ErrInvalidCode) {
		t.Fatalf("bad code must surface the otp error, got %v", err)
	}
	if len(store.inserted) != 0 {
		t.Fatal("no grant may be written on a failed verification")
	}
	if len(audit.actions) != 1 || audit.actions[0] != "auth.step_up.failed" {
		t.Fatalf("failed verify must be audited, got %v", audit.actions)
	}
}

func TestVerify_SuccessStoresGrantBoundToToken(t *testing.T) {
	store := &fakeStore{}
	audit := &fakeAudit{}
	svc := NewService(store,
		func(context.Context, string, string, string, string) error { return nil },
		func(_ context.Context, _, purpose, code, _ string) error {
			if purpose != otp.PurposeStepUp || code != "654321" {
				t.Fatalf("verifier got (%q,%q)", purpose, code)
			}
			return nil
		}, audit, 0)
	exp, err := svc.Verify(context.Background(), testCaller(), "654321")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if len(store.inserted) != 1 {
		t.Fatalf("expected one stored grant, got %d", len(store.inserted))
	}
	g := store.inserted[0]
	if g.UserID != "u-1" {
		t.Fatalf("grant user %q, want u-1", g.UserID)
	}
	if want := services.HashToken("tok-1"); g.AccessTokenHash != want {
		t.Fatalf("grant must bind sha256 of the exact bearer token")
	}
	if g.ExpiresAt.Sub(exp) != 0 {
		t.Fatal("stored and returned expiries differ")
	}
	if until := time.Until(exp); until <= 0 || until > MaxTTL {
		t.Fatalf("grant expiry %s out of bounds", until)
	}
	if len(audit.actions) != 1 || audit.actions[0] != "auth.step_up.granted" {
		t.Fatalf("grant must be audited, got %v", audit.actions)
	}
}

func TestVerify_StoreFailurePropagates(t *testing.T) {
	svc := NewService(&fakeStore{insertErr: errors.New("db")},
		func(context.Context, string, string, string, string) error { return nil },
		func(context.Context, string, string, string, string) error { return nil }, nil, 0)
	if _, err := svc.Verify(context.Background(), testCaller(), "123456"); err == nil {
		t.Fatal("a grant that could not be stored must not report success")
	}
}

func TestStatus_DelegatesToStore(t *testing.T) {
	want := middleware.StepUpGrantState{Found: true, Active: true, ExpiresAt: time.Now().Add(time.Minute)}
	svc := NewService(&fakeStore{state: want},
		func(context.Context, string, string, string, string) error { return nil },
		func(context.Context, string, string, string, string) error { return nil }, nil, 0)
	st, err := svc.Status(context.Background(), testCaller())
	if err != nil || !st.Active {
		t.Fatalf("status: %v %+v", err, st)
	}
}
