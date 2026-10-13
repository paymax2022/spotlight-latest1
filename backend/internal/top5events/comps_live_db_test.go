package top5events_test

// Live-DB tests for IssueComp (Phase 3): zero-value guest tickets. A comp is an
// order+credential+ticket at ZERO value and must move NO money.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/top5events"
)

func seedHandleUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (userID, handle string) {
	t.Helper()
	userID = seedTicketTokenUser(t, ctx, pool)
	handle = "comp" + uuid.New().String()[:8]
	if _, err := pool.Exec(ctx, `INSERT INTO cashtag_handles (user_id, handle) VALUES ($1,$2)`, userID, handle); err != nil {
		t.Fatalf("seed handle: %v", err)
	}
	return
}

func ledgerRowCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLiveDB_IssueComp_ZeroValue(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	owner := seedTicketTokenUser(t, ctx, pool)
	rcpt, handle := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 5000, 10, 0) // a PRICED tier: comp must still cost 0
	setFee1000(t, ctx, pool, ev)

	balBefore := buyerBalance(t, ctx, led, rcpt)
	escBefore := standingBalance(t, ctx, led, ledger.AccountEscrow)
	rowsBefore := ledgerRowCount(t, ctx, pool)

	tickets, err := svc.IssueComp(ctx, owner, ev, tier, []string{"@" + handle}, "VIP guest", newIdem())
	if err != nil {
		t.Fatalf("IssueComp: %v", err)
	}
	if len(tickets) != 1 || tickets[0].OwnerID != rcpt || tickets[0].PricePaidKobo != 0 || tickets[0].CredentialID == "" || tickets[0].State != top5events.TicketIssued {
		t.Fatalf("bad ticket: %+v", tickets)
	}
	var kind, note string
	var issuedBy *string
	var credOK bool
	if err := pool.QueryRow(ctx, `SELECT t.kind, COALESCE(t.comp_note,''), t.issued_by::text, EXISTS(SELECT 1 FROM credentials c WHERE c.id=t.credential_id)
		FROM event_tickets t WHERE t.id=$1`, tickets[0].ID).Scan(&kind, &note, &issuedBy, &credOK); err != nil {
		t.Fatal(err)
	}
	if kind != "COMP" || note != "VIP guest" || issuedBy == nil || *issuedBy != owner || !credOK {
		t.Fatalf("ticket row: kind=%s note=%q issuedBy=%v cred=%v", kind, note, issuedBy, credOK)
	}
	var okind, ostatus string
	var total int64
	if err := pool.QueryRow(ctx, `SELECT kind, status, total_kobo FROM event_orders WHERE id=$1`, tickets[0].OrderID).Scan(&okind, &ostatus, &total); err != nil {
		t.Fatal(err)
	}
	if okind != "COMP" || ostatus != "PAID" || total != 0 {
		t.Fatalf("order row: %s %s %d", okind, ostatus, total)
	}
	var sold int
	_ = pool.QueryRow(ctx, `SELECT sold FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&sold)
	if sold != 1 {
		t.Fatalf("sold=%d want 1", sold)
	}
	// ZERO money moved.
	if d := buyerBalance(t, ctx, led, rcpt) - balBefore; d != 0 {
		t.Fatalf("recipient wallet delta=%d want 0", d)
	}
	if d := standingBalance(t, ctx, led, ledger.AccountEscrow) - escBefore; d != 0 {
		t.Fatalf("escrow delta=%d want 0", d)
	}
	if n := ledgerRowCount(t, ctx, pool); n != rowsBefore {
		t.Fatalf("ledger_entries grew %d -> %d; a comp must post nothing", rowsBefore, n)
	}
}

func TestLiveDB_IssueComp_InviteOnlyTier(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	_, handle := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 5, 0)
	if _, err := pool.Exec(ctx, `UPDATE event_ticket_tiers SET invite_only=true WHERE id=$1`, tier); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.IssueComp(ctx, owner, ev, tier, []string{handle}, "", newIdem()); err != nil {
		t.Fatalf("comp into invite_only tier: %v", err)
	}
	var sold int
	_ = pool.QueryRow(ctx, `SELECT sold FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&sold)
	if sold != 1 {
		t.Fatalf("sold=%d", sold)
	}
}

func TestLiveDB_IssueComp_SoldOut(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	_, h1 := seedHandleUser(t, ctx, pool)
	_, h2 := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 2, 1) // one seat left
	_, err := svc.IssueComp(ctx, owner, ev, tier, []string{h1, h2}, "", newIdem())
	if !errors.Is(err, top5events.ErrSoldOut) {
		t.Fatalf("want ErrSoldOut, got %v", err)
	}
	var sold, tk, ord int
	_ = pool.QueryRow(ctx, `SELECT sold FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&sold)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_tickets WHERE tier_id=$1`, tier).Scan(&tk)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_orders WHERE event_id=$1`, ev).Scan(&ord)
	if sold != 1 || tk != 0 || ord != 0 {
		t.Fatalf("partial issuance: sold=%d tickets=%d orders=%d", sold, tk, ord)
	}
}

func TestLiveDB_IssueComp_Idempotent(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	_, h1 := seedHandleUser(t, ctx, pool)
	_, h2 := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	idem := newIdem()
	first, err := svc.IssueComp(ctx, owner, ev, tier, []string{h1, h2}, "n", idem)
	if err != nil || len(first) != 2 {
		t.Fatalf("first: %v %d", err, len(first))
	}
	second, err := svc.IssueComp(ctx, owner, ev, tier, []string{h1, h2}, "n", idem)
	if err != nil || len(second) != 2 {
		t.Fatalf("replay: %v %d", err, len(second))
	}
	ids := map[string]bool{}
	for _, tk := range first {
		ids[tk.ID] = true
	}
	for _, tk := range second {
		if !ids[tk.ID] {
			t.Fatalf("replay minted a different ticket %s", tk.ID)
		}
	}
	var sold, tk, cr int
	_ = pool.QueryRow(ctx, `SELECT sold FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&sold)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_tickets WHERE tier_id=$1`, tier).Scan(&tk)
	_ = pool.QueryRow(ctx, `SELECT count(DISTINCT credential_id) FROM event_tickets WHERE tier_id=$1`, tier).Scan(&cr)
	if sold != 2 || tk != 2 || cr != 2 {
		t.Fatalf("sold=%d tickets=%d creds=%d want 2/2/2", sold, tk, cr)
	}
}

func TestLiveDB_IssueComp_ManagerAllowed(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	mgr := seedTicketTokenUser(t, ctx, pool)
	_, handle := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_team_members (event_id, user_id, role, granted_by) VALUES ($1,$2,'MANAGER',$3)`, ev, mgr, owner); err != nil {
		t.Fatalf("seed team: %v", err)
	}
	got, err := svc.IssueComp(ctx, mgr, ev, tier, []string{handle}, "", newIdem())
	if err != nil || len(got) != 1 {
		t.Fatalf("manager IssueComp: %v %d", err, len(got))
	}
}

func TestLiveDB_IssueComp_TerminalStateRejected(t *testing.T) {
	for _, state := range []string{"CANCELLED", "CLOSED"} {
		t.Run(state, func(t *testing.T) {
			ctx := context.Background()
			pool := ticketTokenPool(t)
			svc := ticketTokenService(pool)
			owner := seedTicketTokenUser(t, ctx, pool)
			_, handle := seedHandleUser(t, ctx, pool)
			ev := seedManageEvent(t, ctx, pool, owner, state)
			tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
			_, err := svc.IssueComp(ctx, owner, ev, tier, []string{handle}, "", newIdem())
			if !errors.Is(err, top5events.ErrNotPurchasable) {
				t.Fatalf("want ErrNotPurchasable, got %v", err)
			}
			var sold, tk, ord int
			_ = pool.QueryRow(ctx, `SELECT sold FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&sold)
			_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_tickets WHERE event_id=$1`, ev).Scan(&tk)
			_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_orders WHERE event_id=$1`, ev).Scan(&ord)
			if sold != 0 || tk != 0 || ord != 0 {
				t.Fatalf("created despite terminal state: sold=%d tickets=%d orders=%d", sold, tk, ord)
			}
		})
	}
}

func TestLiveDB_IssueComp_StrangerForbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	_, handle := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := svc.IssueComp(ctx, stranger, ev, tier, []string{handle}, "", newIdem()); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	var sold int
	_ = pool.QueryRow(ctx, `SELECT sold FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&sold)
	if sold != 0 {
		t.Fatalf("sold=%d", sold)
	}
}
