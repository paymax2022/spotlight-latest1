package top5events_test

// Live-DB regression for TicketToken (Service.TicketToken / GET
// /tickets/:ticketId/token) — the endpoint that lets a ticket holder fetch their
// own live, server-issued rotating gate token (replacing the mobile client's
// former homegrown, unverified QR-rotation scheme).
//
// Ticket rows are seeded directly (not via Purchase) to keep this a pure read/
// authz test independent of the money-path purchase flow — see
// service_integration_test.go's own header for why Purchase needs a real
// standing-account setup this suite deliberately avoids depending on.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/top5events"
)

func ticketTokenPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping TicketToken live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func ticketTokenService(pool *pgxpool.Pool) *top5events.Service {
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	wal := wallet.NewService(led, tiersSvc)
	sett := settlement.NewService(pool, led)
	cred := credential.NewService(pool, nil)
	tags := cashtag.NewService(pool)
	return top5events.NewService(pool, led, wal, sett, tiersSvc, cred, tags, nil)
}

func seedTicketTokenUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, id, id+"@ticket-token.itest"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// seedIssuedTicket creates the minimal chain a real Purchase() would have left
// behind — event, legacy ticket-type row (still NOT NULL/FK'd on event_tickets
// even though production's own INSERT no longer populates it — a pre-existing
// schema-drift artifact, not something this test works around beyond satisfying
// the constraint), tier, a REAL issued credential (so CurrentToken has something
// genuine to mint against), and the ticket row itself — then registers cleanup in
// FK-safe order.
func seedIssuedTicket(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cred *credential.Service, ownerID string) (ticketID string) {
	t.Helper()

	eventID := uuid.New().String()
	// Both organizer_id (legacy, NOT NULL) and organiser_id (new spelling — what
	// ScanTicket's steward/organiser authz actually reads) must be set: they're
	// two independently-nullable columns left over from the schema-drift
	// reconciliation, not synonyms the DB keeps in sync for you.
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, starts_at, ends_at) VALUES ($1,$2,$2,'Ticket Token Test Event',$3,$4)`,
		eventID, ownerID, time.Now().Add(24*time.Hour), time.Now().Add(30*time.Hour)); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM events WHERE id=$1`, eventID) })

	typeID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_ticket_types (id, event_id, name) VALUES ($1,$2,'General')`, typeID, eventID); err != nil {
		t.Fatalf("seed ticket type: %v", err)
	}

	tierID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_ticket_tiers (id, event_id, name, price_kobo, capacity) VALUES ($1,$2,'General',500000,100)`,
		tierID, eventID); err != nil {
		t.Fatalf("seed tier: %v", err)
	}

	// Real Purchase() always creates an order before a ticket (event_tickets.order_id
	// is nullable in the schema, but getTicket's SELECT scans it into a non-nullable
	// *string — a NULL order_id crashes it. Production never produces that shape, so
	// this test matches production's real invariant rather than exercising a case
	// getTicket doesn't handle, which is a separate, pre-existing latent bug.
	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_orders (id, event_id, buyer_id, tier_id, total_kobo, idempotency_key) VALUES ($1,$2,$3,$4,500000,$5)`,
		orderID, eventID, ownerID, tierID, "itest-order-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}

	c, err := cred.Issue(ctx, ownerID, credential.KindEventTicket, credential.Policy{
		SingleUse: true, RotateTTL: 30 * time.Second, ValidFrom: time.Now(), ValidTo: time.Now().Add(48 * time.Hour),
	})
	if err != nil {
		t.Fatalf("issue credential: %v", err)
	}

	ticketID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_tickets (id, event_id, ticket_type_id, tier_id, order_id, owner_id, credential_id, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		ticketID, eventID, typeID, tierID, orderID, ownerID, c.ID, "itest-"+ticketID); err != nil {
		t.Fatalf("seed ticket: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM event_tickets WHERE id=$1`, ticketID) })

	return ticketID
}

func TestLiveDB_TicketToken_OwnerGetsRealRotatingToken(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	owner := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, owner)

	tok, err := svc.TicketToken(ctx, owner, ticketID)
	if err != nil {
		t.Fatalf("TicketToken: %v", err)
	}
	if tok == nil || tok.Sig == "" {
		t.Fatalf("got %+v, want a real signed token", tok)
	}
}

func TestLiveDB_TicketToken_NonOwnerForbidden(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, owner)

	_, err := svc.TicketToken(ctx, stranger, ticketID)
	if err != top5events.ErrForbidden {
		t.Fatalf("got err=%v, want ErrForbidden for a non-owner caller", err)
	}
}

func TestLiveDB_TicketToken_UnknownTicketNotFound(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	owner := seedTicketTokenUser(t, ctx, pool)

	_, err := svc.TicketToken(ctx, owner, uuid.New().String())
	if err != top5events.ErrNotFound {
		t.Fatalf("got err=%v, want ErrNotFound for an unknown ticket id", err)
	}
}
