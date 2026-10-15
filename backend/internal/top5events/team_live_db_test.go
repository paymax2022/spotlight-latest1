package top5events_test

// Live-DB tests for per-event team-member grants (AddTeamMember /
// RemoveTeamMember / ListTeam). Owner-only; MANAGER role only. Skips unless
// TEST_DATABASE_URL is set (via ticketTokenPool).

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/top5events"
)

// seedTeamHandleUser seeds a user with a cashtag handle and returns (userID, handle).
func seedTeamHandleUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (string, string) {
	t.Helper()
	uid := seedTicketTokenUser(t, ctx, pool)
	handle := "tm" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]
	if _, err := pool.Exec(ctx, `INSERT INTO cashtag_handles (user_id, handle) VALUES ($1,$2)`, uid, handle); err != nil {
		t.Fatalf("seed handle: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM cashtag_handles WHERE user_id=$1`, uid) })
	return uid, handle
}

func teamRowCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM event_team_members WHERE event_id=$1`, eventID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestLiveDB_Team_OwnerGrantsManager(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	mgr, handle := seedTeamHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")

	// Before the grant the user cannot manage.
	if err := svc.Pause(ctx, mgr, ev); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("pre-grant pause = %v, want ErrForbidden", err)
	}
	row, err := svc.AddTeamMember(ctx, owner, ev, "@"+handle, "MANAGER")
	if err != nil {
		t.Fatalf("AddTeamMember: %v", err)
	}
	if row.UserID != mgr || row.Role != "MANAGER" || row.Handle != handle || row.GrantedBy != owner {
		t.Fatalf("row = %+v", row)
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
	// Granted user can now manage (Pause is a manage-gated action).
	if err := svc.Pause(ctx, mgr, ev); err != nil {
		t.Fatalf("post-grant pause = %v, want nil", err)
	}
}

func TestLiveDB_Team_NonOwnerForbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	mgr, mgrHandle := seedTeamHandleUser(t, ctx, pool)
	_, target := seedTeamHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")

	if _, err := svc.AddTeamMember(ctx, stranger, ev, target, "MANAGER"); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("stranger add = %v, want ErrForbidden", err)
	}
	if _, err := svc.AddTeamMember(ctx, owner, ev, mgrHandle, "MANAGER"); err != nil {
		t.Fatalf("owner add: %v", err)
	}
	// A granted MANAGER cannot grant others.
	if _, err := svc.AddTeamMember(ctx, mgr, ev, target, "MANAGER"); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("manager add = %v, want ErrForbidden", err)
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
}

func TestLiveDB_Team_UnknownEventNotFound(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	_, h := seedTeamHandleUser(t, ctx, pool)
	if _, err := svc.AddTeamMember(ctx, owner, uuid.New().String(), h, "MANAGER"); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestLiveDB_Team_UnknownHandleValidation(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	if _, err := svc.AddTeamMember(ctx, owner, ev, "nosuchhandle_zzz", "MANAGER"); !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("err = %v, want ErrValidation", err)
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 0 {
		t.Fatalf("rows = %d, want 0", n)
	}
}

func TestLiveDB_Team_RoleValidation(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	_, h := seedTeamHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	for _, role := range []string{"FINANCE", "ADMIN", ""} {
		if _, err := svc.AddTeamMember(ctx, owner, ev, h, role); !errors.Is(err, top5events.ErrValidation) {
			t.Fatalf("role %q err = %v, want ErrValidation", role, err)
		}
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 0 {
		t.Fatalf("rows = %d, want 0", n)
	}
}

func TestLiveDB_Team_CannotGrantOrganiser(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner, ownerHandle := seedTeamHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	if _, err := svc.AddTeamMember(ctx, owner, ev, ownerHandle, "MANAGER"); !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("err = %v, want ErrValidation", err)
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 0 {
		t.Fatalf("rows = %d, want 0", n)
	}
}

func TestLiveDB_Team_DuplicateGrantIdempotent(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	mgr, h := seedTeamHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	first, err := svc.AddTeamMember(ctx, owner, ev, h, "MANAGER")
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := svc.AddTeamMember(ctx, owner, ev, h, "MANAGER")
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if second.UserID != mgr || !second.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("replay changed row: %+v vs %+v", first, second)
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
}

func TestLiveDB_Team_List(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	mgr, h := seedTeamHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")

	empty, err := svc.ListTeam(ctx, owner, ev)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty list = %v, %v; want non-nil len 0", empty, err)
	}
	if _, err := svc.AddTeamMember(ctx, owner, ev, h, "MANAGER"); err != nil {
		t.Fatalf("add: %v", err)
	}
	got, err := svc.ListTeam(ctx, owner, ev)
	if err != nil || len(got) != 1 || got[0].UserID != mgr || got[0].Handle != h {
		t.Fatalf("list = %+v, %v", got, err)
	}
	if _, err := svc.ListTeam(ctx, stranger, ev); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("stranger list = %v, want ErrForbidden", err)
	}
	if _, err := svc.ListTeam(ctx, mgr, ev); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("manager list = %v, want ErrForbidden", err)
	}
}

func TestLiveDB_Team_Remove(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	mgr, h := seedTeamHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	if _, err := svc.AddTeamMember(ctx, owner, ev, h, "MANAGER"); err != nil {
		t.Fatalf("add: %v", err)
	}
	if err := svc.RemoveTeamMember(ctx, stranger, ev, mgr); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("stranger remove = %v, want ErrForbidden", err)
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 1 {
		t.Fatalf("rows = %d, want 1 after forbidden remove", n)
	}
	if err := svc.RemoveTeamMember(ctx, owner, ev, mgr); err != nil {
		t.Fatalf("owner remove: %v", err)
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 0 {
		t.Fatalf("rows = %d, want 0", n)
	}
	if err := svc.Pause(ctx, mgr, ev); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("post-remove pause = %v, want ErrForbidden", err)
	}
	// Removing a non-member is an idempotent no-op.
	if err := svc.RemoveTeamMember(ctx, owner, ev, mgr); err != nil {
		t.Fatalf("idempotent remove: %v", err)
	}
}
