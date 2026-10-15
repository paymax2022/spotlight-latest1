package connectconsole

import (
	"context"
	"fmt"
)

// FinanceSummary mirrors frontend-admin ConnectFinanceSummary. Four tiles are NULL because no agreed
// definition or source exists yet (platform take rate, float, and the ledger debit/credit totals for
// Connect); they are null, not zero, so an admin is never shown a false "0".
type FinanceSummary struct {
	GiftVolumeTodayKobo   int64  `json:"gift_volume_today_kobo"`
	GiftVolume30dKobo     int64  `json:"gift_volume_30d_kobo"`
	PaidVoteVolume30dKobo int64  `json:"paid_vote_volume_30d_kobo"`
	PayoutVolume30dKobo   int64  `json:"payout_volume_30d_kobo"`
	TakeRate30dKobo       *int64 `json:"take_rate_30d_kobo"`
	FloatBalanceKobo      *int64 `json:"float_balance_kobo"`
	LedgerDebitsKobo      *int64 `json:"ledger_debits_kobo"`
	LedgerCreditsKobo     *int64 `json:"ledger_credits_kobo"`
	PendingPayoutsKobo    int64  `json:"pending_payouts_kobo"`
}

// GetFinance sums Connect money movement from the Connect tables. Gifts count only status 'sent'
// (reversed gifts are excluded); payout volume counts only 'settled' in the last 30 days; pending
// payouts are 'requested' + 'processing'.
func (s *Service) GetFinance(ctx context.Context) (*FinanceSummary, error) {
	var f FinanceSummary
	err := s.db.QueryRow(ctx, `SELECT
		COALESCE((SELECT SUM(amount_kobo) FROM connect_gifts WHERE status = 'sent' AND created_at >= date_trunc('day', now())), 0)::bigint,
		COALESCE((SELECT SUM(amount_kobo) FROM connect_gifts WHERE status = 'sent' AND created_at >= now() - interval '30 days'), 0)::bigint,
		COALESCE((SELECT SUM(amount_kobo) FROM connect_votes WHERE paid AND created_at >= now() - interval '30 days'), 0)::bigint,
		COALESCE((SELECT SUM(amount_kobo) FROM connect_payouts WHERE status = 'settled' AND updated_at >= now() - interval '30 days'), 0)::bigint,
		COALESCE((SELECT SUM(amount_kobo) FROM connect_payouts WHERE status IN ('requested','processing')), 0)::bigint`).
		Scan(&f.GiftVolumeTodayKobo, &f.GiftVolume30dKobo, &f.PaidVoteVolume30dKobo, &f.PayoutVolume30dKobo, &f.PendingPayoutsKobo)
	if err != nil {
		return nil, fmt.Errorf("connect: finance summary: %w", err)
	}
	return &f, nil
}
