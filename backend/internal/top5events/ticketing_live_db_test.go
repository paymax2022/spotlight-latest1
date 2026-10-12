package top5events_test

// Live-DB tests for UpdateTier (Phase 2 ticketing depth).

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/top5events"
)

func seedTier(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventID string, price int64, capacity, sold int) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_ticket_tiers (id, event_id, name, price_kobo, capacity, sold, active)
		 VALUES ($1,$2,'General',$3,$4,$5,true)`, id, eventID, price, capacity, sold); err != nil {
		t.Fatalf("seed tier: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM event_ticket_tiers WHERE id=$1`, id) })
	return id
}

func TestLiveDB_UpdateTier_SoftFields(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	start := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	end := start.Add(48 * time.Hour)
	inv := true
	got, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{
		Name: strp("VIP"), Description: strp("front row"), SalesStartAt: &start, SalesEndAt: &end, InviteOnly: &inv,
	})
	if err != nil {
		t.Fatalf("UpdateTier: %v", err)
	}
	if got.Name != "VIP" || got.Description != "front row" || !got.InviteOnly || got.SalesStartAt == nil || !got.SalesStartAt.Equal(start) {
		t.Fatalf("returned tier wrong: %+v", got)
	}
	var name, desc string
	var e *time.Time
	if err := pool.QueryRow(ctx, `SELECT name, description, sales_end_at FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&name, &desc, &e); err != nil {
		t.Fatal(err)
	}
	if name != "VIP" || desc != "front row" || e == nil || !e.Equal(end) {
		t.Fatalf("not persisted: %q %q %v", name, desc, e)
	}
}

func TestLiveDB_UpdateTier_PriceLockedAfterSale(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 2)
	price := int64(5000)
	_, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{PriceKobo: &price, Name: strp("sneaky")})
	if !errors.Is(err, top5events.ErrTierLocked) {
		t.Fatalf("want ErrTierLocked, got %v", err)
	}
	var p int64
	var name string
	_ = pool.QueryRow(ctx, `SELECT price_kobo, name FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&p, &name)
	if p != 1000 || name != "General" {
		t.Fatalf("mutated despite lock: %d %q", p, name)
	}
}

func TestLiveDB_UpdateTier_CapacityBelowSoldRejected(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 5)
	low := 3
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{Capacity: &low}); !errors.Is(err, top5events.ErrTierLocked) {
		t.Fatalf("want ErrTierLocked, got %v", err)
	}
	ok := 5
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{Capacity: &ok}); err != nil {
		t.Fatalf("capacity == sold should pass: %v", err)
	}
}

func TestLiveDB_UpdateTier_InvalidWindow(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	s := time.Now().Add(2 * time.Hour)
	e := time.Now().Add(time.Hour)
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{SalesStartAt: &s, SalesEndAt: &e}); !errors.Is(err, top5events.ErrInvalidWindow) {
		t.Fatalf("want ErrInvalidWindow, got %v", err)
	}
	// Setting only one side is allowed; a later conflicting one-sided patch is not.
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{SalesEndAt: &e}); err != nil {
		t.Fatalf("one side only should pass: %v", err)
	}
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{SalesStartAt: &s}); !errors.Is(err, top5events.ErrInvalidWindow) {
		t.Fatalf("want ErrInvalidWindow vs stored end, got %v", err)
	}
}

func TestLiveDB_UpdateTier_ManagerAllowed(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	mgr := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_team_members (event_id, user_id, role, granted_by) VALUES ($1,$2,'MANAGER',$3)`, ev, mgr, owner); err != nil {
		t.Fatalf("seed team: %v", err)
	}
	got, err := svc.UpdateTier(ctx, mgr, ev, tier, top5events.TierPatch{Name: strp("Mgr Edit")})
	if err != nil || got.Name != "Mgr Edit" {
		t.Fatalf("manager UpdateTier: %v %+v", err, got)
	}
}

func TestLiveDB_UpdateTier_StrangerForbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := svc.UpdateTier(ctx, stranger, ev, tier, top5events.TierPatch{Name: strp("x")}); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

// ---------- Promo create + edit (Phase 2 Task 3) ----------

func i64p(v int64) *int64 { return &v }
func intp(v int) *int     { return &v }

func cleanupPromos(t *testing.T, pool *pgxpool.Pool, eventID string) {
	t.Helper()
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM event_promo_codes WHERE event_id=$1`, eventID) })
}

func seedUsedPromo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventID string, used, maxUses int) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_promo_codes (id, event_id, code, version, percent_off, max_uses, used, active)
		 VALUES ($1,$2,$3,1,10,$4,$5,true)`, id, eventID, "P"+id[:8], maxUses, used); err != nil {
		t.Fatalf("seed promo: %v", err)
	}
	cleanupPromos(t, pool, eventID)
	return id
}

func TestLiveDB_Promo_CreatePercentOnly(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	cleanupPromos(t, pool, ev)
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	s := time.Now().UTC().Truncate(time.Second)
	e := s.Add(time.Hour)
	got, err := svc.AddPromo(ctx, owner, ev, top5events.PromoCode{Code: "PCT", PercentOff: 20, TierID: &tier, StartsAt: &s, EndsAt: &e, PerUserLimit: 2})
	if err != nil {
		t.Fatalf("AddPromo: %v", err)
	}
	var pct, pul int
	var amt *int64
	var tid *string
	if err := pool.QueryRow(ctx, `SELECT percent_off, amount_off_kobo, tier_id::text, per_user_limit FROM event_promo_codes WHERE id=$1`, got.ID).Scan(&pct, &amt, &tid, &pul); err != nil {
		t.Fatal(err)
	}
	if pct != 20 || amt != nil || tid == nil || *tid != tier || pul != 2 {
		t.Fatalf("not persisted: %d %v %v %d", pct, amt, tid, pul)
	}
}

func TestLiveDB_Promo_CreateAmountOnly(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	cleanupPromos(t, pool, ev)
	got, err := svc.AddPromo(ctx, owner, ev, top5events.PromoCode{Code: "AMT", AmountOffKobo: i64p(500)})
	if err != nil {
		t.Fatalf("AddPromo: %v", err)
	}
	var amt *int64
	if err := pool.QueryRow(ctx, `SELECT amount_off_kobo FROM event_promo_codes WHERE id=$1`, got.ID).Scan(&amt); err != nil || amt == nil || *amt != 500 {
		t.Fatalf("amount not persisted: %v %v", amt, err)
	}
}

func TestLiveDB_Promo_CreateBothRejected(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	cleanupPromos(t, pool, ev)
	if _, err := svc.AddPromo(ctx, owner, ev, top5events.PromoCode{Code: "BOTH", PercentOff: 10, AmountOffKobo: i64p(500)}); err == nil {
		t.Fatal("want error for both percent and amount")
	}
}

func TestLiveDB_Promo_CreateNeitherRejected(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	cleanupPromos(t, pool, ev)
	if _, err := svc.AddPromo(ctx, owner, ev, top5events.PromoCode{Code: "NONE"}); err == nil {
		t.Fatal("want error for neither percent nor amount")
	}
}

func TestLiveDB_Promo_CreateTierScopeForeignEventRejected(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	other := seedManageEvent(t, ctx, pool, owner, "LIVE")
	cleanupPromos(t, pool, ev)
	foreign := seedTier(t, ctx, pool, other, 1000, 10, 0)
	if _, err := svc.AddPromo(ctx, owner, ev, top5events.PromoCode{Code: "FOR", PercentOff: 10, TierID: &foreign}); err == nil {
		t.Fatal("want error for tier on a different event")
	}
}

func TestLiveDB_Promo_UpdateValueAfterUseLocked(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	promo := seedUsedPromo(t, ctx, pool, ev, 1, 5)
	if _, err := svc.UpdatePromo(ctx, owner, ev, promo, top5events.PromoPatch{PercentOff: intp(50)}); !errors.Is(err, top5events.ErrPromoLocked) {
		t.Fatalf("percent: want ErrPromoLocked, got %v", err)
	}
	if _, err := svc.UpdatePromo(ctx, owner, ev, promo, top5events.PromoPatch{AmountOffKobo: i64p(100)}); !errors.Is(err, top5events.ErrPromoLocked) {
		t.Fatalf("amount: want ErrPromoLocked, got %v", err)
	}
	var pct int
	_ = pool.QueryRow(ctx, `SELECT percent_off FROM event_promo_codes WHERE id=$1`, promo).Scan(&pct)
	if pct != 10 {
		t.Fatalf("locked write leaked: %d", pct)
	}
}

func TestLiveDB_Promo_UpdateCodeRejected(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	promo := seedUsedPromo(t, ctx, pool, ev, 0, 5)
	var before string
	_ = pool.QueryRow(ctx, `SELECT code FROM event_promo_codes WHERE id=$1`, promo).Scan(&before)
	if _, err := svc.UpdatePromo(ctx, owner, ev, promo, top5events.PromoPatch{Code: strp("NEWCODE"), MaxUses: intp(9)}); !errors.Is(err, top5events.ErrPromoLocked) {
		t.Fatalf("want ErrPromoLocked, got %v", err)
	}
	var after string
	var mu int
	_ = pool.QueryRow(ctx, `SELECT code, max_uses FROM event_promo_codes WHERE id=$1`, promo).Scan(&after, &mu)
	if after != before || mu != 5 {
		t.Fatalf("write leaked: code %q->%q max_uses %d", before, after, mu)
	}
}

func TestLiveDB_Promo_UpdateDeactivateAfterUseOk(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	promo := seedUsedPromo(t, ctx, pool, ev, 1, 5)
	off := false
	got, err := svc.UpdatePromo(ctx, owner, ev, promo, top5events.PromoPatch{Active: &off})
	if err != nil || got.Active {
		t.Fatalf("deactivate: %v %+v", err, got)
	}
}

func TestLiveDB_Promo_UpdateRaiseMaxUsesAfterUseOk(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	promo := seedUsedPromo(t, ctx, pool, ev, 1, 5)
	got, err := svc.UpdatePromo(ctx, owner, ev, promo, top5events.PromoPatch{MaxUses: intp(50)})
	if err != nil || got.MaxUses != 50 {
		t.Fatalf("raise: %v %+v", err, got)
	}
	if _, err := svc.UpdatePromo(ctx, owner, ev, promo, top5events.PromoPatch{MaxUses: intp(2)}); !errors.Is(err, top5events.ErrPromoLocked) {
		t.Fatalf("lower: want ErrPromoLocked, got %v", err)
	}
}

func TestLiveDB_Promo_UpdateManagerAllowed(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	mgr := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	promo := seedUsedPromo(t, ctx, pool, ev, 0, 5)
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_team_members (event_id, user_id, role, granted_by) VALUES ($1,$2,'MANAGER',$3)`, ev, mgr, owner); err != nil {
		t.Fatalf("seed team: %v", err)
	}
	got, err := svc.UpdatePromo(ctx, mgr, ev, promo, top5events.PromoPatch{AmountOffKobo: i64p(300)})
	if err != nil || got.AmountOffKobo == nil || *got.AmountOffKobo != 300 || got.PercentOff != 0 {
		t.Fatalf("manager UpdatePromo: %v %+v", err, got)
	}
}

func TestLiveDB_Promo_UpdateStrangerForbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	promo := seedUsedPromo(t, ctx, pool, ev, 0, 5)
	if _, err := svc.UpdatePromo(ctx, stranger, ev, promo, top5events.PromoPatch{MaxUses: intp(9)}); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}
