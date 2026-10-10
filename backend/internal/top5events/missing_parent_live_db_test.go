package top5events_test

// Live-DB regression for missing-parent semantics (the wave-12 sweep beyond
// #611, which covered the Vendors existence check + bind failures):
//
//   - transition() (Submit/Approve/GoLive/Close) returned a FRESH
//     errors.New("events: not found") — same text as the sentinel but a
//     different instance, so errors.Is failed and the handler answered 400
//     instead of 404.
//   - Purchase (tier), TapCharge (vendor/wallet), CloseWallet, SettleVendor
//     and walletFor had the same fresh-error pattern; OpenWallet on a missing
//     event died on the event_wallets FK (23503 → sanitized 400).
//   - Suspend conflated "missing" with "terminal" behind one 400; it now
//     pre-checks existence (missing → 404, terminal → 400).
//   - TapCharge's non-operator refusal is a uniform ErrForbidden (403) for
//     BOTH an inactive vendor and a wrong-operator caller — splitting them
//     would hand a caller a probe into the vendor's active flag.
//
// Skips unless TEST_DATABASE_URL is set; reuses the ticketTokenPool /
// ticketTokenService / seedTicketTokenUser helpers from
// ticket_token_live_db_test.go (same package).

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/top5events"
)

// seedEvent inserts a bare event row in the given state (mirrors the
// organizer_id + organiser_id dual-column quirk documented in
// seedIssuedTicket) and registers cleanup.
func seedEvent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, organiserID, state string) string {
	t.Helper()
	eventID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, description, state, starts_at, ends_at)
		 VALUES ($1,$2,$2,'Missing Parent Test','',$3,$4,$5)`,
		eventID, organiserID, state,
		time.Now().Add(24*time.Hour), time.Now().Add(30*time.Hour)); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM events WHERE id=$1`, eventID) })
	return eventID
}

func TestLiveDB_MissingParent_EventTransitionsNotFound(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	org := seedTicketTokenUser(t, ctx, pool)
	ghost := uuid.New().String()

	calls := map[string]func() error{
		"Submit":  func() error { return svc.Submit(ctx, org, ghost) },
		"Approve": func() error { return svc.Approve(ctx, "admin-1", ghost) },
		"GoLive":  func() error { return svc.GoLive(ctx, org, ghost) },
		"Close":   func() error { return svc.Close(ctx, org, ghost) },
		"Suspend": func() error { return svc.Suspend(ctx, "admin-1", ghost) },
	}
	for name, fn := range calls {
		if err := fn(); !errors.Is(err, top5events.ErrNotFound) {
			t.Fatalf("%s on a missing event: got %v, want ErrNotFound (handler → 404)", name, err)
		}
	}
}

func TestLiveDB_MissingParent_ChildWritesNotFound(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	ghost := uuid.New().String()

	// Purchase on a missing event — already correct via GetEvent, pinned here.
	if _, err := svc.Purchase(ctx, uuid.New().String(), ghost, uuid.New().String(), "", "idem-"+uuid.New().String()); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("Purchase on missing event: got %v, want ErrNotFound", err)
	}
	// OpenWallet on a missing event used to hit the event_wallets FK (23503).
	if _, err := svc.OpenWallet(ctx, uuid.New().String(), ghost); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("OpenWallet on missing event: got %v, want ErrNotFound", err)
	}
	// TapCharge on a missing vendor (checked before the wallet).
	if _, err := svc.TapCharge(ctx, uuid.New().String(), ghost, uuid.New().String(), 1000, "idem-"+uuid.New().String()); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("TapCharge on missing vendor: got %v, want ErrNotFound", err)
	}
	// SettleVendor on a missing vendor — the handler now maps ErrNotFound →
	// 404 (GetEvent inside the service could already return the sentinel, but
	// the handler's bespoke switch fell through to 400).
	if _, err := svc.SettleVendor(ctx, ghost, uuid.New().String(), "idem-"+uuid.New().String()); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("SettleVendor on missing vendor: got %v, want ErrNotFound", err)
	}
	// CloseWallet / GetWallet on a missing wallet.
	if err := svc.CloseWallet(ctx, ghost); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("CloseWallet on missing wallet: got %v, want ErrNotFound", err)
	}
	if _, err := svc.GetWallet(ctx, uuid.New().String(), ghost); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("GetWallet on missing wallet: got %v, want ErrNotFound", err)
	}
}

func TestLiveDB_MissingParent_PurchaseMissingTierNotFound(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	eventID := seedEvent(t, ctx, pool, buyer, "LIVE")

	// A real LIVE event + a tier id that doesn't exist → ErrNotFound.
	if _, err := svc.Purchase(ctx, buyer, eventID, uuid.New().String(), "", "idem-"+uuid.New().String()); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("Purchase on missing tier: got %v, want ErrNotFound", err)
	}
}

func TestLiveDB_Suspend_TerminalIsRefusedNotNotFound(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	eventID := seedEvent(t, ctx, pool, seedTicketTokenUser(t, ctx, pool), "CLOSED")

	// A terminal event keeps the domain refusal — the existence pre-check must
	// not turn "wrong state" into 404.
	err := svc.Suspend(ctx, "admin-1", eventID)
	if err == nil {
		t.Fatal("Suspend on a CLOSED event must be refused")
	}
	if errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("Suspend on a terminal event: got %v, want a non-404 refusal", err)
	}
}

func TestLiveDB_TapCharge_NonOperatorAndInactiveUniformForbidden(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	vendorOwner := seedTicketTokenUser(t, ctx, pool)
	attacker := seedTicketTokenUser(t, ctx, pool)
	eventID := seedEvent(t, ctx, pool, vendorOwner, "LIVE")

	seedVendor := func(active bool) string {
		t.Helper()
		vendorID := uuid.New().String()
		if _, err := pool.Exec(ctx,
			`INSERT INTO event_vendors (id, event_id, user_id, name, active) VALUES ($1,$2,$3,'Test Stall',$4)`,
			vendorID, eventID, vendorOwner, active); err != nil {
			t.Fatalf("seed vendor: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM event_vendors WHERE id=$1`, vendorID)
		})
		return vendorID
	}

	// Wrong operator on an ACTIVE vendor → ErrForbidden (was an ad-hoc 400).
	activeVendor := seedVendor(true)
	if _, err := svc.TapCharge(ctx, attacker, activeVendor, uuid.New().String(), 1000, "idem-"+uuid.New().String()); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("TapCharge by a non-operator: got %v, want ErrForbidden", err)
	}
	// INACTIVE vendor gets the SAME refusal — the two cases must be
	// indistinguishable so the active flag can't be probed through the error.
	inactiveVendor := seedVendor(false)
	_, err := svc.TapCharge(ctx, vendorOwner, inactiveVendor, uuid.New().String(), 1000, "idem-"+uuid.New().String())
	if !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("TapCharge on an inactive vendor: got %v, want the same ErrForbidden", err)
	}
}
