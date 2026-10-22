package cryptosvc

// Live-DB tests for the deposit store. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func TestLive_DepositUpsertNeverRegressesAndAddressFirstWins(t *testing.T) {
	pool := livePool(t)
	s := NewPGStore(pool)
	ctx := context.Background()
	user, depID := uuid.NewString(), "dp_"+uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.crypto_deposits WHERE provider_deposit_id=$1`, depID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.crypto_deposit_addresses WHERE user_id=$1::uuid`, user)
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.crypto_accounts WHERE user_id=$1::uuid`, user)
	})

	if err := s.SaveProviderAccount(ctx, user, "livetest", "acct-"+user); err != nil {
		t.Fatal(err)
	}
	if got, ok, err := s.UserByProviderAccount(ctx, "livetest", "acct-"+user); err != nil || !ok || got != user {
		t.Fatalf("account lookup = %s %v %v", got, ok, err)
	}

	for _, a := range []string{"first", "second"} {
		if err := s.SaveDepositAddress(ctx, user, "livetest", cryptoprov.DepositAddress{Currency: "USDT", Network: "trc20", Address: a}); err != nil {
			t.Fatal(err)
		}
	}
	if a, ok, err := s.SavedDepositAddress(ctx, user, "livetest", "USDT", "trc20"); err != nil || !ok || a.Address != "first" {
		t.Fatalf("address = %+v %v %v, want the first one kept", a, ok, err)
	}

	rec := func(st cryptoprov.DepositStatus, conf int) DepositRecord {
		return DepositRecord{Provider: "livetest", ProviderDepositID: depID, UserID: user, Currency: "USDT", Network: "trc20",
			Amount: decimal.RequireFromString("25.000000000000000001"), Status: st, Confirmations: conf, RequiredConfirmations: 12}
	}
	steps := []struct {
		st      cryptoprov.DepositStatus
		conf    int
		changed bool
	}{
		{cryptoprov.DepositPending, 1, true},
		{cryptoprov.DepositPending, 1, false}, // duplicate
		{cryptoprov.DepositPending, 5, true},  // more confirmations
		{cryptoprov.DepositAccepted, 12, true},
		{cryptoprov.DepositPending, 3, false},  // late, out of order
		{cryptoprov.DepositRejected, 12, false}, // terminal never flips
	}
	for i, st := range steps {
		changed, err := s.UpsertDeposit(ctx, rec(st.st, st.conf))
		if err != nil || changed != st.changed {
			t.Fatalf("step %d: changed=%v err=%v, want %v", i, changed, err, st.changed)
		}
	}
	got, err := s.ListDeposits(ctx, user, 10)
	if err != nil || len(got) != 1 {
		t.Fatalf("list = %+v %v", got, err)
	}
	if got[0].Status != cryptoprov.DepositAccepted || got[0].Confirmations != 12 || !got[0].Amount.Equal(decimal.RequireFromString("25.000000000000000001")) {
		t.Fatalf("final = %+v", got[0])
	}
}
