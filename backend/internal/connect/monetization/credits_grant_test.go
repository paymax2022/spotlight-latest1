package connectmonetization

import (
	"context"
	"encoding/json"
	"testing"
)

type fakeGranter struct {
	grants map[string]int64
}

func (f *fakeGranter) Grant(_ context.Context, _ , creditType, _ string, amount int64, _ string) error {
	if f.grants == nil {
		f.grants = map[string]int64{}
	}
	f.grants[creditType] += amount
	return nil
}

// TestGrantPurchaseCreditsMapping proves PAY-008 grant-on-purchase: a one-off PASS
// grants its positive numeric entitlements as consumable credits; a subscription
// (recurring allowance, not a one-off balance) grants nothing here.
func TestGrantPurchaseCreditsMapping(t *testing.T) {
	pass := &Plan{Code: "pass_super5", Kind: KindPass, Entitlements: json.RawMessage(`{"super_likes":5,"note":"x","zero":0}`)}
	fg := &fakeGranter{}
	s := &Service{credits: fg}
	if err := s.grantPurchaseCredits(context.Background(), "u1", "order-key", pass); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if fg.grants["super_likes"] != 5 {
		t.Errorf("super_likes granted = %d, want 5", fg.grants["super_likes"])
	}
	if _, ok := fg.grants["note"]; ok {
		t.Errorf("non-numeric entitlement should not be granted")
	}
	if _, ok := fg.grants["zero"]; ok {
		t.Errorf("zero-quota entitlement should not be granted")
	}

	// Subscription quotas are recurring, not one-off balances → no grant here.
	sub := &Plan{Code: "connect_plus", Kind: KindSubscription, Entitlements: json.RawMessage(`{"super_likes_per_day":5}`)}
	fg2 := &fakeGranter{}
	s2 := &Service{credits: fg2}
	if err := s2.grantPurchaseCredits(context.Background(), "u1", "k", sub); err != nil {
		t.Fatalf("grant sub: %v", err)
	}
	if len(fg2.grants) != 0 {
		t.Errorf("subscription should grant no one-off credits, got %v", fg2.grants)
	}

	// Nil granter is a safe no-op.
	s3 := &Service{}
	if err := s3.grantPurchaseCredits(context.Background(), "u1", "k", pass); err != nil {
		t.Errorf("nil granter should be a no-op, got %v", err)
	}
}
