package top5events_test

// Live-DB tests for IssueComp (Phase 3): zero-value guest tickets. A comp is an
// order+credential+ticket at ZERO value and must move NO money.

import (
	"context"
	"encoding/csv"
	"errors"
	"strings"
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

// Reusing the same client idemKey against a different event (same recipient)
// must issue a distinct, fresh ticket — not return the first event's ticket and
// not silently skip. The stored key is scoped to event+tier.
func TestLiveDB_IssueComp_IdemKeyScopedToEvent(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	_, handle := seedHandleUser(t, ctx, pool)
	evA := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tierA := seedTier(t, ctx, pool, evA, 1000, 10, 0)
	evB := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tierB := seedTier(t, ctx, pool, evB, 1000, 10, 0)
	idem := newIdem()
	a, err := svc.IssueComp(ctx, owner, evA, tierA, []string{handle}, "", idem)
	if err != nil || len(a) != 1 {
		t.Fatalf("event A: %v %d", err, len(a))
	}
	b, err := svc.IssueComp(ctx, owner, evB, tierB, []string{handle}, "", idem)
	if err != nil || len(b) != 1 {
		t.Fatalf("event B (reused idemKey): %v %d", err, len(b))
	}
	if a[0].ID == b[0].ID {
		t.Fatalf("reused idemKey leaked event A's ticket into event B: %s", a[0].ID)
	}
	var soldB, tkB int
	_ = pool.QueryRow(ctx, `SELECT sold FROM event_ticket_tiers WHERE id=$1`, tierB).Scan(&soldB)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_tickets WHERE event_id=$1`, evB).Scan(&tkB)
	if soldB != 1 || tkB != 1 {
		t.Fatalf("event B not issued cleanly: sold=%d tickets=%d want 1/1", soldB, tkB)
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

func TestLiveDB_AttendeesCSV(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	r1, h1 := seedHandleUser(t, ctx, pool)
	r2, h2 := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)

	// A name containing a comma and a quote proves the csv writer quotes/escapes.
	trickyName := `Doe, John "JD"`
	tag, err := pool.Exec(ctx, `UPDATE user_profiles SET full_name=$2 WHERE id=$1`, r1, trickyName)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("seed profile name: err=%v rows=%d", err, tag.RowsAffected())
	}

	t1, err := svc.IssueComp(ctx, owner, ev, tier, []string{h1}, "", newIdem())
	if err != nil || len(t1) != 1 {
		t.Fatalf("comp1: %v", err)
	}
	if _, err := svc.IssueComp(ctx, owner, ev, tier, []string{h2}, "", newIdem()); err != nil {
		t.Fatalf("comp2: %v", err)
	}
	_ = r2
	if _, err := pool.Exec(ctx, `UPDATE event_tickets SET checked_in_at=now() WHERE id=$1`, t1[0].ID); err != nil {
		t.Fatalf("check in: %v", err)
	}

	raw, err := svc.AttendeesCSV(ctx, owner, ev)
	if err != nil {
		t.Fatalf("AttendeesCSV: %v", err)
	}
	recs, err := csv.NewReader(strings.NewReader(string(raw))).ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	wantHdr := []string{"name", "cashtag", "tier_name", "ticket_id", "state", "checked_in", "checked_in_at"}
	if len(recs) != 3 {
		t.Fatalf("rows=%d want 3 (header+2): %q", len(recs), raw)
	}
	for i, h := range wantHdr {
		if recs[0][i] != h {
			t.Fatalf("header=%v want %v", recs[0], wantHdr)
		}
	}
	var sawChecked, sawUnchecked bool
	for _, r := range recs[1:] {
		switch r[3] {
		case t1[0].ID:
			sawChecked = true
			if r[0] != trickyName || r[1] != h1 || r[5] != "true" || r[6] == "" {
				t.Fatalf("checked-in row bad: %q", r)
			}
		default:
			sawUnchecked = true
			if r[1] != h2 || r[5] != "false" || r[6] != "" {
				t.Fatalf("unchecked row bad: %q", r)
			}
		}
	}
	if !sawChecked || !sawUnchecked {
		t.Fatalf("missing rows: %q", raw)
	}
}

func TestLiveDB_AttendeesCSV_NonManagerForbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	steward := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	if _, err := pool.Exec(ctx, `INSERT INTO event_stewards (event_id, user_id, added_by) VALUES ($1,$2,$3)`, ev, steward, owner); err != nil {
		t.Fatalf("seed steward: %v", err)
	}
	// Sanity: the steward may view the roster, but must not export it.
	if _, err := svc.AttendeesForEvent(ctx, steward, ev); err != nil {
		t.Fatalf("steward roster: %v", err)
	}
	for name, caller := range map[string]string{"steward": steward, "stranger": stranger} {
		if _, err := svc.AttendeesCSV(ctx, caller, ev); !errors.Is(err, top5events.ErrForbidden) {
			t.Fatalf("%s: want ErrForbidden, got %v", name, err)
		}
	}
}

// ---- Announce (Phase 3) ----

type fakeSend struct{ user, title, body string }

type fakeNotifier struct {
	calls  []fakeSend
	failOn map[string]bool
}

func (f *fakeNotifier) Send(_ context.Context, userID, title, body string) error {
	f.calls = append(f.calls, fakeSend{userID, title, body})
	if f.failOn[userID] {
		return errors.New("boom")
	}
	return nil
}

func announceRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ev string) (n, recipients int) {
	t.Helper()
	if err := pool.QueryRow(ctx, `SELECT count(*), COALESCE(max(recipient_count),0) FROM event_announcements WHERE event_id=$1`, ev).Scan(&n, &recipients); err != nil {
		t.Fatal(err)
	}
	return
}

func TestLiveDB_Announce_ScopedDistinctHolders(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	fn := &fakeNotifier{}
	svc.SetNotifier(fn)
	owner := seedTicketTokenUser(t, ctx, pool)
	u1, h1 := seedHandleUser(t, ctx, pool)
	u2, h2 := seedHandleUser(t, ctx, pool)
	u3, h3 := seedHandleUser(t, ctx, pool)
	evA := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tierA := seedTier(t, ctx, pool, evA, 1000, 10, 0)
	evB := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tierB := seedTier(t, ctx, pool, evB, 1000, 10, 0)
	// u1 holds TWO tickets on A (duplicate holder); u2 one; u3 only on B.
	for _, h := range []string{h1, h1, h2} {
		if _, err := svc.IssueComp(ctx, owner, evA, tierA, []string{h}, "", newIdem()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.IssueComp(ctx, owner, evB, tierB, []string{h3}, "", newIdem()); err != nil {
		t.Fatal(err)
	}
	n, err := svc.Announce(ctx, owner, evA, "Doors", "Doors open at 7", newIdem())
	if err != nil || n != 2 {
		t.Fatalf("Announce: n=%d err=%v", n, err)
	}
	got := map[string]int{}
	for _, c := range fn.calls {
		got[c.user]++
		if c.title != "Doors" || c.body != "Doors open at 7" {
			t.Fatalf("bad payload %+v", c)
		}
	}
	if len(got) != 2 || got[u1] != 1 || got[u2] != 1 || got[u3] != 0 {
		t.Fatalf("recipients wrong (want u1,u2 once, never u3): %v", got)
	}
	if rows, rc := announceRows(t, ctx, pool, evA); rows != 1 || rc != 2 {
		t.Fatalf("rows=%d recipient_count=%d", rows, rc)
	}
	if rows, _ := announceRows(t, ctx, pool, evB); rows != 0 {
		t.Fatalf("event B got an announcement row")
	}
}

func TestLiveDB_Announce_Forbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	fn := &fakeNotifier{}
	svc.SetNotifier(fn)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	_, h := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := svc.IssueComp(ctx, owner, ev, tier, []string{h}, "", newIdem()); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Announce(ctx, stranger, ev, "x", "y", newIdem()); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if len(fn.calls) != 0 {
		t.Fatalf("sent despite forbidden")
	}
	if rows, _ := announceRows(t, ctx, pool, ev); rows != 0 {
		t.Fatalf("recorded despite forbidden")
	}
}

func TestLiveDB_Announce_EmptyBodyAndNoKey(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	if _, err := svc.Announce(ctx, owner, ev, "s", "  ", newIdem()); !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("empty body: want ErrValidation, got %v", err)
	}
	if _, err := svc.Announce(ctx, owner, ev, "s", "b", ""); err == nil {
		t.Fatalf("missing idempotency key must error")
	}
}

func TestLiveDB_Announce_NilNotifierStillRecords(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool) // no notifier wired
	owner := seedTicketTokenUser(t, ctx, pool)
	_, h1 := seedHandleUser(t, ctx, pool)
	_, h2 := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := svc.IssueComp(ctx, owner, ev, tier, []string{h1, h2}, "", newIdem()); err != nil {
		t.Fatal(err)
	}
	n, err := svc.Announce(ctx, owner, ev, "", "hello", newIdem())
	if err != nil || n != 2 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if rows, rc := announceRows(t, ctx, pool, ev); rows != 1 || rc != 2 {
		t.Fatalf("rows=%d rc=%d", rows, rc)
	}
}

func TestLiveDB_Announce_IdempotentReplay(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	fn := &fakeNotifier{}
	svc.SetNotifier(fn)
	owner := seedTicketTokenUser(t, ctx, pool)
	_, h1 := seedHandleUser(t, ctx, pool)
	_, h2 := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := svc.IssueComp(ctx, owner, ev, tier, []string{h1, h2}, "", newIdem()); err != nil {
		t.Fatal(err)
	}
	idem := newIdem()
	first, err := svc.Announce(ctx, owner, ev, "s", "b", idem)
	if err != nil || first != 2 {
		t.Fatalf("first: %d %v", first, err)
	}
	second, err := svc.Announce(ctx, owner, ev, "s", "b", idem)
	if err != nil || second != 2 {
		t.Fatalf("replay: %d %v", second, err)
	}
	if len(fn.calls) != 2 {
		t.Fatalf("replay re-sent: %d calls", len(fn.calls))
	}
	if rows, _ := announceRows(t, ctx, pool, ev); rows != 1 {
		t.Fatalf("replay wrote a 2nd row: %d", rows)
	}
}

func TestLiveDB_Announce_SendFailureDoesNotAbortBatch(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	u1, h1 := seedHandleUser(t, ctx, pool)
	_, h2 := seedHandleUser(t, ctx, pool)
	_, h3 := seedHandleUser(t, ctx, pool)
	fn := &fakeNotifier{failOn: map[string]bool{u1: true}}
	svc.SetNotifier(fn)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := svc.IssueComp(ctx, owner, ev, tier, []string{h1, h2, h3}, "", newIdem()); err != nil {
		t.Fatal(err)
	}
	n, err := svc.Announce(ctx, owner, ev, "s", "b", newIdem())
	if err != nil || n != 3 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if len(fn.calls) != 3 {
		t.Fatalf("a failing send aborted the batch: %d calls", len(fn.calls))
	}
	if rows, rc := announceRows(t, ctx, pool, ev); rows != 1 || rc != 3 {
		t.Fatalf("rows=%d rc=%d", rows, rc)
	}
}
