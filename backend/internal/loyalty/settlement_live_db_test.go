package loyalty

// Live-DB tests for BlackService.RecordPartnerSettlement idempotency (the admin
// money-mutation path). SKIPPED whenever TEST_DATABASE_URL is unset — same
// convention as redeem_live_db_test.go.
//
// Requires migration 20271018000000_loyalty_partner_settlement_idem_key.sql
// applied (partner_settlements.actor_user_id + idempotency_key partial unique
// index).

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/points"
)

// seedPartner inserts a partner + one offer and returns (partnerID, offerID).
// Deleting the partner cascades to offers + settlements.
func seedPartner(t *testing.T, pool *pgxpool.Pool) (string, string) {
	t.Helper()
	ctx := context.Background()
	var partnerID, offerID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO loyalty_partners (name) VALUES ($1) RETURNING id`,
		"test-partner-"+uuid.NewString()[:13]).Scan(&partnerID); err != nil {
		t.Fatalf("seed partner: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO partner_offers (partner_id, title) VALUES ($1,'test offer') RETURNING id`,
		partnerID).Scan(&offerID); err != nil {
		t.Fatalf("seed offer: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM loyalty_partners WHERE id=$1`, partnerID)
	})
	return partnerID, offerID
}

func newBlackSvc(pool *pgxpool.Pool) *BlackService {
	return NewBlackService(NewService(pool, points.NewService(pool, nil), nil), nil)
}

// Keyless settlement booking is rejected fail-closed (iron rule): partner
// billing is a money path and an unkeyed retry must never double-book it.
func TestLiveDB_PartnerSettlement_NoKey_Rejected(t *testing.T) {
	pool := liveLoyaltyPool(t)
	svc := newBlackSvc(pool)
	ctx := context.Background()
	partnerID, offerID := seedPartner(t, pool)

	if _, err := svc.RecordPartnerSettlement(ctx, "admin-1", partnerID, offerID, 5000, ""); !errors.Is(err, points.ErrIdempotencyRequired) {
		t.Fatalf("keyless settlement: err = %v, want points.ErrIdempotencyRequired", err)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM partner_settlements WHERE partner_id=$1`, partnerID).Scan(&rows); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if rows != 0 {
		t.Fatalf("rejected settlement must write nothing, got %d rows", rows)
	}
}

// A client key makes a retried booking return the SAME settlement row — one
// partner-billing record, never two.
func TestLiveDB_PartnerSettlement_ReplaysIdempotently(t *testing.T) {
	pool := liveLoyaltyPool(t)
	svc := newBlackSvc(pool)
	ctx := context.Background()
	admin := seedLoyaltyUser(t, pool)
	partnerID, offerID := seedPartner(t, pool)

	key := "settle-" + uuid.NewString()
	first, err := svc.RecordPartnerSettlement(ctx, admin, partnerID, offerID, 5000, key)
	if err != nil {
		t.Fatalf("first settlement: %v", err)
	}
	second, err := svc.RecordPartnerSettlement(ctx, admin, partnerID, offerID, 5000, key)
	if err != nil {
		t.Fatalf("replay settlement: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("replay must return the same settlement: %s vs %s", first.ID, second.ID)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM partner_settlements WHERE actor_user_id=$1 AND idempotency_key=$2`, admin, key).Scan(&rows); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected exactly 1 settlement row, got %d", rows)
	}
}

// Same admin + same key + DIFFERENT params is a 409 conflict — never silently
// return the original settlement. Dedupe is scoped per admin: the same key
// under a different admin is a different mutation and must succeed.
func TestLiveDB_PartnerSettlement_SameKeyDifferentParams_Conflict(t *testing.T) {
	pool := liveLoyaltyPool(t)
	svc := newBlackSvc(pool)
	ctx := context.Background()
	admin := seedLoyaltyUser(t, pool)
	otherAdmin := seedLoyaltyUser(t, pool)
	partnerID, offerID := seedPartner(t, pool)

	key := "settle-" + uuid.NewString()
	if _, err := svc.RecordPartnerSettlement(ctx, admin, partnerID, offerID, 5000, key); err != nil {
		t.Fatalf("first settlement: %v", err)
	}
	// Different amount under the same key → conflict.
	if _, err := svc.RecordPartnerSettlement(ctx, admin, partnerID, offerID, 9000, key); !errors.Is(err, points.ErrIdempotencyConflict) {
		t.Fatalf("different-amount replay: err = %v, want points.ErrIdempotencyConflict", err)
	}
	// Same key under a DIFFERENT admin is a different mutation — no collision.
	other, err := svc.RecordPartnerSettlement(ctx, otherAdmin, partnerID, offerID, 7000, key)
	if err != nil {
		t.Fatalf("other-admin settlement with same key must not collide: %v", err)
	}
	if other.AmountKobo != 7000 {
		t.Fatalf("other-admin settlement: got %+v", other)
	}
}
