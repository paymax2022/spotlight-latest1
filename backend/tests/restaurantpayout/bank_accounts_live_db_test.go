package restaurantpayout_test

// ---------------------------------------------------------------------------
// LIVE-DB tests for merchant settlement bank-account CAPTURE (safe half of the
// withdrawal work — no money movement). Covers validation, first-account-default,
// masking, owner-scoping, idempotent re-add, set-default, and delete.
//
// Skips unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"spotlight/backend/internal/restaurant"
)

func acct(bank, code, number, name string) restaurant.AddBankAccountRequest {
	return restaurant.AddBankAccountRequest{BankName: bank, BankCode: code, AccountNumber: number, AccountName: name}
}

func TestLiveDB_MerchantBankAccounts(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveRestaurantService(pool, newLiveLedgerService(pool))

	owner := seedUser(t, ctx, pool)
	stranger := seedUser(t, ctx, pool)

	// Validation: account number must be 10 digits.
	if _, err := svc.AddBankAccount(ctx, owner, acct("GTBank", "058", "12345", "Blue Yam")); err == nil {
		t.Fatal("short account number: want error, got nil")
	}

	// First account → default, masked to last 4.
	a1, err := svc.AddBankAccount(ctx, owner, acct("GTBank", "058", "0123456789", "Blue Yam Kitchen"))
	if err != nil {
		t.Fatalf("add a1: %v", err)
	}
	if !a1.IsDefault {
		t.Fatal("first account should be the default")
	}
	if a1.AccountNumberMasked != "****6789" {
		t.Fatalf("masked = %q, want ****6789", a1.AccountNumberMasked)
	}

	// Second account → not default.
	a2, err := svc.AddBankAccount(ctx, owner, acct("Access", "044", "0987654321", "Blue Yam Kitchen"))
	if err != nil {
		t.Fatalf("add a2: %v", err)
	}
	if a2.IsDefault {
		t.Fatal("second account should not be default")
	}

	// Idempotent re-add of a1 (same bank_code + account_number) — no duplicate.
	if _, err := svc.AddBankAccount(ctx, owner, acct("GTBank", "058", "0123456789", "Blue Yam Kitchen")); err != nil {
		t.Fatalf("re-add a1: %v", err)
	}
	list, err := svc.ListBankAccounts(ctx, owner)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("owner accounts = %d, want 2 (idempotent re-add)", len(list))
	}
	if !list[0].IsDefault {
		t.Fatal("the default account should sort first")
	}

	// Owner-scoping: a stranger sees nothing.
	if sl, _ := svc.ListBankAccounts(ctx, stranger); len(sl) != 0 {
		t.Fatalf("stranger saw %d accounts, want 0", len(sl))
	}

	// Set default to a2; a1 must lose default (at most one default per owner).
	if err := svc.SetDefaultBankAccount(ctx, owner, a2.ID); err != nil {
		t.Fatalf("set default a2: %v", err)
	}
	list, _ = svc.ListBankAccounts(ctx, owner)
	for _, b := range list {
		if b.ID == a2.ID && !b.IsDefault {
			t.Fatal("a2 should be the default")
		}
		if b.ID == a1.ID && b.IsDefault {
			t.Fatal("a1 should no longer be default")
		}
	}

	// A stranger cannot set a default on the owner's account.
	if err := svc.SetDefaultBankAccount(ctx, stranger, a1.ID); err == nil {
		t.Fatal("stranger set-default: want not-found, got nil")
	}

	// Delete a1; deleting again → not found.
	if err := svc.DeleteBankAccount(ctx, owner, a1.ID); err != nil {
		t.Fatalf("delete a1: %v", err)
	}
	if err := svc.DeleteBankAccount(ctx, owner, a1.ID); err == nil {
		t.Fatal("delete missing account: want not-found, got nil")
	}
}
