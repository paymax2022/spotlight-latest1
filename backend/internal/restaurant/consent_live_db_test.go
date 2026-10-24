package restaurant

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/settlement"
)

// FOOD-UAT-H-001: record -> withdraw -> re-grant; latest row wins; no row = no consent.
func TestLiveDB_Consent_RecordWithdrawQuery(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, settlement.NewService(pool, nil))

	user := uuid.New().String()
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM user_consents WHERE user_id=$1`, user) })

	if ok, err := svc.HasActiveConsent(ctx, user, ConsentMarketing); err != nil || ok {
		t.Fatalf("no row: got ok=%v err=%v, want false", ok, err)
	}
	if svc.MarketingSendAllowed(ctx, user) {
		t.Fatal("marketing must not be allowed without consent")
	}
	m := ConsentMeta{Source: "food_checkout", UserAgent: "test", IP: "203.0.113.9"}
	if err := svc.RecordConsent(ctx, user, ConsentMarketing, m); err != nil {
		t.Fatal(err)
	}
	if ok, _ := svc.HasActiveConsent(ctx, user, ConsentMarketing); !ok {
		t.Fatal("expected active consent after grant")
	}
	if ok, _ := svc.HasActiveConsent(ctx, user, ConsentPromo); ok {
		t.Fatal("promo must be independent of marketing")
	}
	if err := svc.WithdrawConsent(ctx, user, ConsentMarketing, m); err != nil {
		t.Fatal(err)
	}
	if svc.MarketingSendAllowed(ctx, user) {
		t.Fatal("marketing must be blocked after withdrawal")
	}
	if err := svc.RecordConsent(ctx, user, ConsentMarketing, m); err != nil {
		t.Fatal(err)
	}
	if !svc.MarketingSendAllowed(ctx, user) {
		t.Fatal("re-grant should re-enable")
	}
	var n int
	var ipHash string
	_ = pool.QueryRow(ctx, `SELECT count(*), max(ip_hash) FROM user_consents WHERE user_id=$1 AND kind='marketing'`, user).Scan(&n, &ipHash)
	if n != 3 {
		t.Errorf("append-only rows = %d, want 3", n)
	}
	if ipHash == "" || ipHash == "203.0.113.9" {
		t.Errorf("ip must be stored hashed, got %q", ipHash)
	}
	if err := svc.RecordConsent(ctx, user, "Bad Kind!", m); err != ErrConsentKindInvalid {
		t.Errorf("invalid kind err = %v", err)
	}
}
