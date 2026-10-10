package aicare

// LIVE-DB pin for the w12 aicare denial-semantics contract decision: every
// session-scoped service call fuses ownership into its WHERE clause
// (AND user_id=$2), so "exists but not yours" and "does not exist" resolve
// to the same ErrSessionNotFound — which the handler maps to a single
// uniform 404. Before this, SendMessage/Escalate/Resolve answered 400 while
// GetHistory answered 404, and Escalate/Resolve relayed raw driver errors.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_SessionScopedCalls_UniformNotFound(t *testing.T) {
	pool := aicarePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	attacker := uuid.New().String()
	for _, u := range []string{owner, attacker} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}

	sess, err := svc.CreateSession(ctx, owner, CreateSessionRequest{Topic: "wallet issue"})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	missing := uuid.New().String()

	// Foreign and missing sessions must produce the identical sentinel on
	// every session-scoped path — that is what makes the handler's 404
	// uniform rather than an existence oracle.
	checks := []struct {
		name string
		call func(sessionID string) error
	}{
		{"Resolve", func(id string) error { return svc.Resolve(ctx, id, attacker) }},
		{"Escalate", func(id string) error { return svc.Escalate(ctx, id, attacker, EscalateRequest{}) }},
		{"GetHistory", func(id string) error { _, e := svc.GetHistory(ctx, id, attacker); return e }},
		{"SendMessage", func(id string) error {
			_, _, e := svc.SendMessage(ctx, id, attacker, SendMessageRequest{Content: "hi"})
			return e
		}},
	}
	for _, c := range checks {
		if err := c.call(sess.ID); !errors.Is(err, ErrSessionNotFound) {
			t.Fatalf("%s on a foreign session: err = %v, want ErrSessionNotFound", c.name, err)
		}
		if err := c.call(missing); !errors.Is(err, ErrSessionNotFound) {
			t.Fatalf("%s on a missing session: err = %v, want ErrSessionNotFound", c.name, err)
		}
	}
}
