package crowdfunding

import (
	"context"
	"fmt"
	"time"
)

// categoryLabels mirrors the seeded crowdfunding_categories (avoids a join per row).
var categoryLabels = map[string]string{
	"medical": "Medical", "education": "Education", "creative": "Creative", "sme": "SME",
	"ngo": "NGO", "religious": "Religious", "community": "Community", "emergency": "Emergency",
	"reward": "Reward", "investment": "Investment",
}

func categoryLabel(slug string) string {
	if l, ok := categoryLabels[slug]; ok {
		return l
	}
	return "Community"
}

// reviewTransition encodes the allowed review-status state machine.
// Returns the new status and whether the transition is permitted.
func reviewTransition(current, decision string) (string, bool) {
	switch decision {
	case "APPROVE":
		if current == "PENDING_REVIEW" || current == "CHANGES_REQUESTED" {
			return "ACTIVE", true
		}
	case "REJECT":
		if current == "PENDING_REVIEW" || current == "CHANGES_REQUESTED" {
			return "REJECTED", true
		}
	case "REQUEST_CHANGES":
		if current == "PENDING_REVIEW" {
			return "CHANGES_REQUESTED", true
		}
	case "FREEZE":
		if current == "ACTIVE" || current == "PENDING_REVIEW" {
			return "FROZEN", true
		}
	case "UNFREEZE":
		if current == "FROZEN" {
			return "ACTIVE", true
		}
	}
	return "", false
}

// AdminListPending returns campaigns awaiting (or in) review.
// AdminCampaignSummary is the review-queue shape: everything the public list
// carries, plus the two fields the moderation console needs and the public one
// must never expose.
//
// submittedAt and riskLevel were already SELECTed by the discovery query and
// then dropped by toSummary, so the admin console rendered blanks for both —
// including the queue's sort key. They are added here rather than on
// CampaignSummary because that type is also the PUBLIC discovery payload, and
// riskLevel is an internal fraud signal: putting it there would publish the
// platform's own risk assessment of every campaign to anyone browsing.
type AdminCampaignSummary struct {
	CampaignSummary
	SubmittedAt string `json:"submittedAt"`
	RiskLevel   string `json:"riskLevel"`
}

func (s *Service) AdminListPending(ctx context.Context, status string) ([]AdminCampaignSummary, error) {
	q := CampaignQuery{Status: status}
	if status == "" {
		q.Status = "PENDING_REVIEW"
	}

	where, args := buildDiscoveryWhere(q, 1)
	sql := fmt.Sprintf(`SELECT %s FROM campaigns c %s %s LIMIT 60`, selectCols, where, sortClause(q.Sort))
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AdminCampaignSummary{}
	for rows.Next() {
		r, err := scanRow(rows.Scan)
		if err != nil {
			return nil, err
		}
		name, typ, verif := s.creatorMeta(ctx, r.creatorID)
		out = append(out, AdminCampaignSummary{
			CampaignSummary: r.toSummary(name, typ, verif),
			SubmittedAt:     r.submittedAt.UTC().Format(time.RFC3339),
			RiskLevel:       r.riskLevel,
		})
	}
	return out, rows.Err()
}

// AdminDecide applies a guarded review transition atomically and writes an audit row.
func (s *Service) AdminDecide(ctx context.Context, campaignID, adminID, decision, note string) error {
	if decision == "REJECT" || decision == "REQUEST_CHANGES" || decision == "FREEZE" {
		if note == "" {
			return fmt.Errorf("crowdfunding: a note is required for %s", decision)
		}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current string
	if err := tx.QueryRow(ctx, `SELECT review_status FROM campaigns WHERE id=$1 FOR UPDATE`, campaignID).Scan(&current); err != nil {
		return fmt.Errorf("crowdfunding: campaign not found")
	}
	next, ok := reviewTransition(current, decision)
	if !ok {
		return fmt.Errorf("crowdfunding: cannot %s a campaign in %s state", decision, current)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE campaigns SET review_status=$1, admin_note=COALESCE(NULLIF($2,''), admin_note),
		        status=CASE WHEN $1='ACTIVE' THEN 'active' ELSE status END, updated_at=NOW()
		 WHERE id=$3`, next, note, campaignID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO campaign_reviews (campaign_id, admin_id, decision, note, prev_status, new_status)
		 VALUES ($1,$2,$3,$4,$5,$6)`, campaignID, adminID, decision, note, current, next); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AdminStats returns platform-wide counters derived live from the ledger/tables.
func (s *Service) AdminStats(ctx context.Context) (*AdminStats, error) {
	st := &AdminStats{CategoryBreakdown: []CategoryStat{}}
	const q = `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE review_status='ACTIVE'),
			COUNT(*) FILTER (WHERE review_status='PENDING_REVIEW'),
			COUNT(*) FILTER (WHERE review_status='REJECTED')
		FROM campaigns`
	if err := s.db.QueryRow(ctx, q).Scan(&st.TotalCampaigns, &st.ActiveCampaigns, &st.PendingReview, &st.RejectedCampaigns); err != nil {
		return nil, err
	}
	// GMV + escrow derived from contributions (append-only).
	_ = s.db.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ('escrowed','released')),0),
			COALESCE(SUM(amount_kobo) FILTER (WHERE status='escrowed'),0)
		FROM contributions`).Scan(&st.TotalRaisedKobo, &st.EscrowKobo)
	st.PlatformRevenueKobo = st.TotalRaisedKobo / 40 // 2.5% indicative

	_ = s.db.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(amount_kobo),0) FROM cf_withdrawals WHERE status='PENDING'`,
	).Scan(&st.WithdrawalsPending, &st.WithdrawalsPendingKobo)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM cf_refunds WHERE status='REQUESTED'`).Scan(&st.RefundRequests)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM cf_fraud_alerts WHERE status IN ('OPEN','INVESTIGATING')`).Scan(&st.FraudAlerts)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM cf_support_tickets WHERE status IN ('OPEN','PENDING')`).Scan(&st.OpenTickets)

	rows, err := s.db.Query(ctx, `
		SELECT c.category, COUNT(*),
		       COALESCE(SUM((SELECT COALESCE(SUM(co.amount_kobo),0) FROM contributions co
		                     WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released'))), 0)
		FROM campaigns c
		GROUP BY c.category
		ORDER BY 3 DESC`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var cs CategoryStat
			if err := rows.Scan(&cs.Category, &cs.Count, &cs.RaisedKobo); err == nil {
				st.CategoryBreakdown = append(st.CategoryBreakdown, cs)
			}
		}
	}

	return st, nil
}
