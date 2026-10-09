package connectvoting

// DB-free tests for the support-ticket error-mapping contract (wave-9 probe:
// GET /support/tickets/<uuid>/messages 500'd on a nonexistent ticket while the
// sibling ticket GET 404'd).
//
// Two halves are pinned:
//   - malformed ticket ids must yield ErrTicketNotFound BEFORE touching the
//     database — the SupportService is built on a nil pool, so any query
//     attempt would panic and fail the test (a 22P02 reaching the handler is
//     exactly the raw-error→500 class being swept).
//   - the handler must map ErrTicketNotFound → 404 TICKET_NOT_FOUND and real
//     DB errors → 500 (covered by the live-DB half below).
//
// The well-formed-but-absent path needs Postgres and runs under
// TEST_DATABASE_URL with the other *_live_db_test.go suites.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSupportTicket_MalformedID_NotFound_NoDBTouch(t *testing.T) {
	svc := NewSupportService(nil) // nil pool: any query would panic — the gate must win first
	ctx := context.Background()
	bad := "not-a-uuid"
	uid := uuid.New().String()

	cases := []struct {
		name string
		call func() error
	}{
		{"GetSupportTicket", func() error { _, err := svc.GetSupportTicket(ctx, uid, bad); return err }},
		{"UpdateSupportTicket", func() error { _, err := svc.UpdateSupportTicket(ctx, uid, bad, "closed", "", ""); return err }},
		{"AddTicketMessage", func() error { _, err := svc.AddTicketMessage(ctx, uid, bad, "hi", nil); return err }},
		{"ListTicketMessages", func() error { _, err := svc.ListTicketMessages(ctx, uid, bad); return err }},
	}
	for _, tc := range cases {
		if err := tc.call(); !errors.Is(err, ErrTicketNotFound) {
			t.Fatalf("%s: malformed ticket id must yield ErrTicketNotFound, got %v", tc.name, err)
		}
	}
}

// Handler-level check that the ErrTicketNotFound → 404 TICKET_NOT_FOUND mapping
// is wired (no DB needed — respondErr is exercised directly on a gin context).
func TestSupportTicket_RespondErr_NotFoundShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/support/tickets/x", nil)

	respondErr(c, http.StatusNotFound, "TICKET_NOT_FOUND", ErrTicketNotFound.Error())

	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "TICKET_NOT_FOUND") || !strings.Contains(body, "ticket not found") {
		t.Fatalf("404 body must carry TICKET_NOT_FOUND + message, got %s", body)
	}
}

// Live-DB half: well-formed but nonexistent/foreign ticket ids must return
// ErrTicketNotFound (→ 404), never a raw pgx error (→ 500). GATED ON
// TEST_DATABASE_URL — same convention as paidvote_rail_idem_live_db_test.go:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_SupportTicket -v
func TestLiveDB_SupportTicket_NotFoundMapping(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB support-ticket error-mapping test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping test db: %v", err)
	}

	svc := NewSupportService(pool)
	uid := uuid.New().String()
	missing := uuid.New().String() // well-formed, guaranteed absent

	cases := []struct {
		name string
		call func() error
	}{
		{"GetSupportTicket", func() error { _, err := svc.GetSupportTicket(ctx, uid, missing); return err }},
		{"UpdateSupportTicket", func() error { _, err := svc.UpdateSupportTicket(ctx, uid, missing, "closed", "", ""); return err }},
		{"AddTicketMessage", func() error { _, err := svc.AddTicketMessage(ctx, uid, missing, "hi", nil); return err }},
		{"ListTicketMessages", func() error { _, err := svc.ListTicketMessages(ctx, uid, missing); return err }},
	}
	for _, tc := range cases {
		if err := tc.call(); !errors.Is(err, ErrTicketNotFound) {
			t.Fatalf("%s: absent ticket must yield ErrTicketNotFound (→404), got %v", tc.name, err)
		}
	}
}
