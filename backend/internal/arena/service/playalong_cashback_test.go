package service

import (
	"context"
	"testing"
)

// fakeEngagementRepo lets a test drive the pass total and the "already granted
// today" cashback count that the per-day rate limit reads.
type fakeEngagementRepo struct {
	total         int
	cashbackToday int
}

func (f *fakeEngagementRepo) Record(_ context.Context, _, _, _, _, _ string, _ int) (int, bool, error) {
	return f.total, false, nil
}
func (f *fakeEngagementRepo) CashbackCountToday(_ context.Context, _, _ string) (int, error) {
	return f.cashbackToday, nil
}

// TestPlayAlong_CashbackDailyCapIsExact proves the daily cashback cap is strict:
// with PlayAlongCashbackPerDay=3, a spectator who has already received 2 today
// still gets one (count 2 < 3), but one who has received 3 gets none (count 3 is
// NOT < 3). A `<=` bound would wrongly grant a 4th (PerDay+1) — the bug this pins.
func TestPlayAlong_CashbackDailyCapIsExact(t *testing.T) {
	cfg := fakeCfg{Config{
		PlayAlongThreshold:      50,
		PlayAlongCashbackKobo:   5000,
		PlayAlongCashbackPerDay: 3,
	}}
	creds := NewCredentialService(newFakeCredRepo(), &fakeAudit{})
	payload := AttemptPayload{Points: 100, Passed: true} // total 100 ≥ threshold 50 → certified

	cases := []struct {
		name         string
		grantedToday int
		wantCashback bool
	}{
		{"below cap grants", 2, true},  // 2 < 3
		{"at cap blocks", 3, false},    // 3 is NOT < 3 (would be granted by a `<=` bug)
		{"above cap blocks", 4, false}, // 4 < 3 false
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeEngagementRepo{total: 100, cashbackToday: tc.grantedToday}
			led := newFakeLedger()
			svc := NewPlayAlongService(repo, creds, led, cfg, &fakeAudit{})

			res, err := svc.Attempt(context.Background(), "spectator-1", "idem-"+tc.name, "comp-1", payload)
			if err != nil {
				t.Fatalf("attempt: %v", err)
			}
			gotCashback := res.CashbackKobo > 0
			if gotCashback != tc.wantCashback {
				t.Fatalf("grantedToday=%d: cashback granted=%v, want %v (kobo=%d)",
					tc.grantedToday, gotCashback, tc.wantCashback, res.CashbackKobo)
			}
			if tc.wantCashback && led.credits != 1 {
				t.Fatalf("expected exactly one ledger credit for the cashback, got %d", led.credits)
			}
			if !tc.wantCashback && led.credits != 0 {
				t.Fatalf("expected no ledger credit when over cap, got %d", led.credits)
			}
		})
	}
}
