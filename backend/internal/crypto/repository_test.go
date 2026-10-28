package crypto

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// LIVE-DB: GetSwapOrder must return the settlement/provider fields added by
// 20271200000041 (the query previously selected nonexistent from_symbol/to_symbol
// columns and failed on every call). SKIPPED when TEST_DATABASE_URL is unset.
func TestGetSwapOrder(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	repo := NewRepository(pool)
	_, svc, _, _, user, usdt, btc := swapRig(t)
	_ = svc

	settled := time.Now().UTC().Truncate(time.Microsecond)
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO crypto_swap_orders
		  (id, user_id, from_asset_id, to_asset_id, status, from_units, to_units,
		   from_price_kobo, to_price_kobo, cash_kobo, spread_kobo, spread_bps,
		   idempotency_key, reference, quotation_id, swap_transaction_id,
		   provider_status, ledger_settled, settled_at)
		VALUES ($1,$2,$3,$4,'filled',100,1,160000,9000000000,16000,80,50,
		        $5,'ref-1','quo-123','swp-456','completed',true,$6)`,
		id, user, usdt.ID, btc.ID, "idem-"+id, settled); err != nil {
		t.Fatalf("insert: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM crypto_swap_orders WHERE id=$1`, id) })

	o, err := repo.GetSwapOrder(ctx, id)
	if err != nil {
		t.Fatalf("GetSwapOrder: %v", err)
	}
	if o == nil {
		t.Fatal("order not found")
	}
	if o.QuotationID != "quo-123" || o.SwapTransactionID != "swp-456" || o.ProviderStatus != "completed" {
		t.Fatalf("provider fields wrong: %+v", o)
	}
	if !o.LedgerSettled || o.SettledAt == nil || !o.SettledAt.Equal(settled) {
		t.Fatalf("settlement fields wrong: settled=%v at=%v", o.LedgerSettled, o.SettledAt)
	}
	if o.FromSymbol != "USDT" || o.ToSymbol != "BTC" {
		t.Fatalf("symbols wrong: %q %q", o.FromSymbol, o.ToSymbol)
	}
}
