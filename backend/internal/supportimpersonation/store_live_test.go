package supportimpersonation

// LIVE-DB coverage for PostgresStore against a fully migrated Postgres
// (TEST_DATABASE_URL-gated, same convention as internal/estate/*_live_db_test.go).
// Proves the session lifecycle and that the audit trail is append-only and
// fail-closed-complete: a session can never exist without its events.

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
)

func impersonationLiveStore(t *testing.T) (*PostgresStore, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB impersonation store tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return NewPostgresStore(pool), pool
}

func liveStartParams() StartParams {
	return StartParams{
		ActorUserID:    uuid.New().String(),
		ActorTokenHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		TargetUserID:   uuid.New().String(),
		Reason:         "investigating a stuck dues receipt",
		TicketRef:      "INC-999",
		Duration:       15 * time.Minute,
		IPAddress:      "10.0.0.1",
		UserAgent:      "uat",
	}
}

func countEvents(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sessionID string) map[string]int {
	t.Helper()
	rows, err := pool.Query(ctx, `SELECT event, count(*) FROM support_impersonation_events WHERE session_id = $1 GROUP BY event`, sessionID)
	if err != nil {
		t.Fatalf("count events: %v", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var ev string
		var n int
		if err := rows.Scan(&ev, &n); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out[ev] = n
	}
	return out
}

func TestLiveDB_ImpersonationLifecycle(t *testing.T) {
	store, pool := impersonationLiveStore(t)
	ctx := context.Background()
	p := liveStartParams()

	sess, err := store.Start(ctx, p)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if sess.Mode != "read_only" || sess.ActorUserID != p.ActorUserID || sess.TargetUserID != p.TargetUserID {
		t.Fatalf("session row: %+v", sess)
	}
	if time.Until(sess.ExpiresAt) <= 0 || time.Until(sess.ExpiresAt) > 15*time.Minute {
		t.Fatalf("expires_at %s outside the requested window", sess.ExpiresAt)
	}

	// The session can never exist without its start event — one transaction.
	ev := countEvents(t, ctx, pool, sess.ID)
	if ev["start"] != 1 {
		t.Fatalf("expected exactly one start event, got %v", ev)
	}

	// Resolve binds actor AND token hash.
	got, err := store.Resolve(ctx, sess.ID, p.ActorUserID, p.ActorTokenHash)
	if err != nil || got.TargetUserID != p.TargetUserID {
		t.Fatalf("resolve: %+v err=%v", got, err)
	}
	if _, err := store.Resolve(ctx, sess.ID, p.ActorUserID, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"); !errors.Is(err, middleware.ErrImpersonationNotFound) {
		t.Fatalf("wrong token must not resolve (got %v) — a session is not portable across logins", err)
	}
	if _, err := store.Resolve(ctx, sess.ID, uuid.New().String(), p.ActorTokenHash); !errors.Is(err, middleware.ErrImpersonationNotFound) {
		t.Fatalf("another agent must not resolve (got %v)", err)
	}

	// Every served request is an event with a stamped status.
	eid, err := store.RecordRequest(ctx, middleware.SupportImpersonation{
		SessionID: sess.ID, ActorUserID: p.ActorUserID, TargetUserID: p.TargetUserID},
		middleware.ImpersonationRequestEvent{Method: "GET", Path: "/api/finance/estate/e1/dashboard", Route: "/api/finance/estate/:id/dashboard"})
	if err != nil {
		t.Fatalf("record request: %v", err)
	}
	if err := store.FinishRequest(ctx, eid, 200); err != nil {
		t.Fatalf("finish request: %v", err)
	}
	var status int
	if err := pool.QueryRow(ctx, `SELECT status_code FROM support_impersonation_events WHERE id = $1`, eid).Scan(&status); err != nil || status != 200 {
		t.Fatalf("request event must carry the response status, got %d err=%v", status, err)
	}

	// A refused attempt is audited too.
	if err := store.RecordRefusal(ctx, sess.ID, "refused", middleware.ImpersonationRequestEvent{
		Method: "POST", Path: "/api/finance/estate/e1/dues/invoices", Detail: "mutation_refused"}); err != nil {
		t.Fatalf("record refusal: %v", err)
	}

	// Stop closes the session with its own event, and Resolve then refuses.
	stopped, ok, err := store.Stop(ctx, sess.ID, p.ActorUserID, "10.0.0.1", "uat")
	if err != nil || !ok || stopped.EndReason != "stopped" {
		t.Fatalf("stop: %+v ok=%v err=%v", stopped, ok, err)
	}
	if _, err := store.Resolve(ctx, sess.ID, p.ActorUserID, p.ActorTokenHash); !errors.Is(err, middleware.ErrImpersonationExpired) {
		t.Fatalf("ended session must resolve as expired/ended, got %v", err)
	}

	ev = countEvents(t, ctx, pool, sess.ID)
	for _, want := range []string{"start", "request", "refused", "stop"} {
		if ev[want] != 1 {
			t.Fatalf("expected one %q event, got %v", want, ev)
		}
	}
}

func TestLiveDB_ImpersonationExpiredSessionLazyClose(t *testing.T) {
	store, _ := impersonationLiveStore(t)
	ctx := context.Background()
	p := liveStartParams()
	p.Duration = time.Second

	sess, err := store.Start(ctx, p)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	time.Sleep(1500 * time.Millisecond)
	if _, err := store.Resolve(ctx, sess.ID, p.ActorUserID, p.ActorTokenHash); !errors.Is(err, middleware.ErrImpersonationExpired) {
		t.Fatalf("expired session must refuse, got %v", err)
	}
	active, err := store.Active(ctx, p.ActorUserID)
	if err != nil || active != nil {
		t.Fatalf("expired session must not read as active, %+v err=%v", active, err)
	}
}

func TestLiveDB_ImpersonationSupersedeClosesPrior(t *testing.T) {
	store, pool := impersonationLiveStore(t)
	ctx := context.Background()
	p := liveStartParams()

	first, err := store.Start(ctx, p)
	if err != nil {
		t.Fatalf("first start: %v", err)
	}
	second, err := store.Start(ctx, p)
	if err != nil {
		t.Fatalf("second start: %v", err)
	}
	// The first session is closed 'superseded' with its own stop event.
	var reason string
	if err := pool.QueryRow(ctx, `SELECT end_reason FROM support_impersonation_sessions WHERE id = $1`, first.ID).Scan(&reason); err != nil || reason != "superseded" {
		t.Fatalf("first session must close superseded, got %q err=%v", reason, err)
	}
	if ev := countEvents(t, ctx, pool, first.ID); ev["stop"] != 1 {
		t.Fatalf("superseded session must carry a stop event, got %v", ev)
	}
	if _, err := store.Resolve(ctx, first.ID, p.ActorUserID, p.ActorTokenHash); !errors.Is(err, middleware.ErrImpersonationExpired) {
		t.Fatalf("superseded session must refuse, got %v", err)
	}
	if _, err := store.Resolve(ctx, second.ID, p.ActorUserID, p.ActorTokenHash); err != nil {
		t.Fatalf("new session must resolve, got %v", err)
	}
}

func TestLiveDB_ImpersonationNoticesForTarget(t *testing.T) {
	store, _ := impersonationLiveStore(t)
	ctx := context.Background()
	p := liveStartParams()
	if _, err := store.Start(ctx, p); err != nil {
		t.Fatalf("start: %v", err)
	}
	list, err := store.ListForTarget(ctx, p.TargetUserID, 10)
	if err != nil || len(list) != 1 {
		t.Fatalf("target notice list: %+v err=%v", list, err)
	}
	if list[0].Reason != p.Reason || list[0].TicketRef != p.TicketRef {
		t.Fatalf("notice must carry reason + ticket, got %+v", list[0])
	}
}
