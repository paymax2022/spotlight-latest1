package crowdfunding

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

// Service manages crowdfunding campaigns, contributions, and payouts/refunds.
type Service struct {
	db         *pgxpool.Pool
	ledger     *ledger.Service
	settlement *settlement.Service
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service, settlement *settlement.Service) *Service {
	return &Service{db: db, ledger: ledger, settlement: settlement}
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// crowdfunding never imports the commission package at compile time (mirrors the
// transport/restaurant/stays seams) — the adapter, which lives in app-wiring,
// discards the returned earning row and surfaces only the error.
//
// This records realized profit ONLY; it never moves money. Crowdfunding's own money
// movement (the 90/10 escrow split at Release) is unchanged, and the injected
// recorder is deliberately constructed WITHOUT a ledger so RecordFor never re-posts
// to the ledger (no double count of the commission revenue account) — it appends the
// immutable earning row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a settled crowdfunding
// contribution. It is best-effort and MUST NEVER affect the caller's outcome: a nil
// recorder is a no-op, and any error is logged and swallowed so a profit-registry
// failure can never fail or reverse the campaign release. The recorded breakdown is
// resolved server-side from the central rate card; the contribution id doubles as
// the source ref + idempotency key so retries and reconciliation sweeps never
// double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"crowdfunding", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[crowdfunding] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// Create creates a new campaign in draft state.
func (s *Service) Create(ctx context.Context, creatorID string, req CreateCampaignRequest) (*Campaign, error) {
	if req.Deadline.Before(time.Now()) {
		return nil, fmt.Errorf("crowdfunding: deadline must be in the future")
	}
	c := &Campaign{
		ID:          uuid.New().String(),
		CreatorID:   creatorID,
		Title:       req.Title,
		Description: req.Description,
		GoalKobo:    req.GoalKobo,
		Status:      "draft",
		Deadline:    req.Deadline,
		CoverURL:    req.CoverURL,
		CreatedAt:   time.Now(),
	}
	const q = `
		INSERT INTO campaigns (id, creator_id, title, description, goal_kobo, status, deadline, cover_url)
		VALUES ($1,$2,$3,$4,$5,'draft',$6,$7)`
	_, err := s.db.Exec(ctx, q, c.ID, c.CreatorID, c.Title, c.Description, c.GoalKobo, c.Deadline, c.CoverURL)
	return c, err
}

// Publish activates a campaign so it can receive contributions.
func (s *Service) Publish(ctx context.Context, campaignID, creatorID string) error {
	const q = `UPDATE campaigns SET status='active' WHERE id=$1 AND creator_id=$2 AND status='draft'`
	tag, err := s.db.Exec(ctx, q, campaignID, creatorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("crowdfunding: campaign not found or already active")
	}
	return nil
}

// Get returns a single campaign with the current raised total.
func (s *Service) Get(ctx context.Context, id string) (*Campaign, error) {
	const q = `
		SELECT c.id, c.creator_id, c.title, c.description, c.goal_kobo,
		       COALESCE(SUM(co.amount_kobo) FILTER (WHERE co.status IN ('escrowed','released')), 0) AS raised_kobo,
		       c.status, c.deadline, c.cover_url, c.created_at
		FROM campaigns c
		LEFT JOIN contributions co ON co.campaign_id = c.id
		WHERE c.id=$1 GROUP BY c.id`
	camp := &Campaign{}
	return camp, s.db.QueryRow(ctx, q, id).Scan(
		&camp.ID, &camp.CreatorID, &camp.Title, &camp.Description, &camp.GoalKobo,
		&camp.RaisedKobo, &camp.Status, &camp.Deadline, &camp.CoverURL, &camp.CreatedAt,
	)
}

// Contribute escrows a contributor's funds toward a campaign, then immediately
// settles the 90/10 split (creator/platform) so the contribution is available
// in the creator's wallet on arrival — no goal-gated escrow hold. This is a
// deliberate product choice (donation/GoFundMe-style "keep what you raise",
// not Kickstarter-style all-or-nothing): a campaign that later fails to reach
// its goal has no refund path for money already settled here. The one
// remaining checkpoint is admin campaign review — reviewStatus must already be
// ACTIVE, which is why that's checked here in addition to the funding-cycle
// status (Publish() can flip status to 'active' without going through review;
// requiring reviewStatus too closes that gap rather than relying on Publish()
// alone). If the campaign goal is now met, it also transitions to "funded".
func (s *Service) Contribute(ctx context.Context, campaignID, contributorID string, req ContributeRequest) (*Contribution, error) {
	var status, reviewStatus, creatorID string
	var deadline time.Time
	var pausedAt, deletedAt *time.Time
	if err := s.db.QueryRow(ctx, `SELECT status, review_status, creator_id, deadline, paused_at, deleted_at FROM campaigns WHERE id=$1`, campaignID).
		Scan(&status, &reviewStatus, &creatorID, &deadline, &pausedAt, &deletedAt); err != nil {
		return nil, fmt.Errorf("crowdfunding: campaign not found")
	}
	// A campaign the owner soft-deleted no longer exists as far as the product
	// is concerned; presenting it as "not found" matches every read surface.
	if deletedAt != nil {
		return nil, fmt.Errorf("crowdfunding: campaign not found")
	}
	// Owner-paused campaigns stop TAKING money, not merely hiding from the
	// rails — otherwise anyone holding a direct link could keep funding a
	// campaign its creator has explicitly stopped.
	if pausedAt != nil {
		return nil, fmt.Errorf("crowdfunding: campaign is paused by its creator and is not accepting contributions")
	}
	if status != "active" {
		return nil, fmt.Errorf("crowdfunding: campaign is not accepting contributions")
	}
	if reviewStatus != "ACTIVE" {
		return nil, fmt.Errorf("crowdfunding: campaign has not passed admin review")
	}
	if time.Now().After(deadline) {
		return nil, fmt.Errorf("crowdfunding: campaign deadline has passed")
	}

	ref := "campaign:" + campaignID + ":contributor:" + contributorID
	sett, err := s.settlement.Escrow(ctx, contributorID, ref, req.IdempotencyKey, "crowdfunding", req.AmountKobo)
	if err != nil {
		return nil, fmt.Errorf("crowdfunding: escrow contribution: %w", err)
	}

	contrib := &Contribution{
		ID:             uuid.New().String(),
		CampaignID:     campaignID,
		ContributorID:  contributorID,
		AmountKobo:     req.AmountKobo,
		Status:         "escrowed",
		IdempotencyKey: req.IdempotencyKey,
		SettlementID:   sett.ID,
		CreatedAt:      time.Now(),
	}
	const insertC = `
		INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key, settlement_id)
		VALUES ($1,$2,$3,$4,'escrowed',$5,$6)`
	if _, err := s.db.Exec(ctx, insertC, contrib.ID, contrib.CampaignID, contrib.ContributorID, contrib.AmountKobo, contrib.IdempotencyKey, contrib.SettlementID); err != nil {
		return nil, fmt.Errorf("crowdfunding: insert contribution: %w", err)
	}

	// Settle immediately (90% creator / 10% platform) rather than waiting for
	// Release() at goal-completion. The contribution itself is already recorded
	// (money is accounted for either way); a settle failure here is logged and
	// left 'escrowed' rather than failing the whole call — there is no unwind
	// for money the contributor has already paid.
	split := settlement.Split{ProviderID: creatorID, ProviderPct: 0.90, PlatformPct: 0.10}
	if err := s.settlement.Settle(ctx, contrib.SettlementID, split); err != nil {
		log.Printf("[crowdfunding] instant settle failed for contribution %s (left escrowed, needs manual sweep): %v", contrib.ID, err)
	} else if _, err := s.db.Exec(ctx, `UPDATE contributions SET status='released' WHERE id=$1`, contrib.ID); err != nil {
		log.Printf("[crowdfunding] settled contribution %s but failed to flip status to released: %v", contrib.ID, err)
	} else {
		contrib.Status = "released"
		creatorRef := creatorID
		s.recordCommissionSafe(ctx, "Community", "Crowdfunding", "", contrib.AmountKobo, contrib.ID, &creatorRef)
	}

	s.checkAndMarkFunded(ctx, campaignID)
	return contrib, nil
}

// Release pays out all escrowed contributions to the campaign creator.
// 90% to creator, 10% platform fee.
func (s *Service) Release(ctx context.Context, campaignID, creatorID string) error {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM campaigns WHERE id=$1 AND creator_id=$2`, campaignID, creatorID).Scan(&status); err != nil {
		return fmt.Errorf("crowdfunding: campaign not found")
	}
	if status != "funded" {
		return fmt.Errorf("crowdfunding: campaign must be in 'funded' state to release funds")
	}

	rows, err := s.db.Query(ctx, `SELECT id, settlement_id, contributor_id, amount_kobo FROM contributions WHERE campaign_id=$1 AND status='escrowed'`, campaignID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type c struct {
		id, settlementID, contributorID string
		amountKobo                      int64
	}
	var contribs []c
	for rows.Next() {
		var entry c
		if err := rows.Scan(&entry.id, &entry.settlementID, &entry.contributorID, &entry.amountKobo); err != nil {
			return err
		}
		contribs = append(contribs, entry)
	}
	rows.Close()

	split := settlement.Split{
		ProviderID:  creatorID,
		ProviderPct: 0.90,
		PlatformPct: 0.10,
	}
	for _, entry := range contribs {
		if err := s.settlement.Settle(ctx, entry.settlementID, split); err != nil {
			return fmt.Errorf("crowdfunding: settle contribution %s: %w", entry.id, err)
		}
		s.db.Exec(ctx, `UPDATE contributions SET status='released' WHERE id=$1`, entry.id)
		// Record realized Spotlight profit into the central Commission & Profit
		// registry. Release is crowdfunding's disbursement/settlement point — the
		// 90/10 split above already posted the 10% platform cut to the ledger, so this
		// is EARNING-ROW ONLY (the injected recorder has a nil ledger ⇒ no double post).
		// Best-effort + idempotent: the contribution id doubles as source ref +
		// idempotency key, so replays / reconciliation never double-count. gross = the
		// contribution amount the 10% platform fee applies to. A recorder failure is
		// logged and swallowed — it must NEVER fail or reverse the release above.
		contributorID := entry.contributorID
		s.recordCommissionSafe(ctx, "Community", "Crowdfunding", "", entry.amountKobo, entry.id, &contributorID)
	}
	return nil
}

// RefundAll refunds all escrowed contributions when a campaign fails or is cancelled.
func (s *Service) RefundAll(ctx context.Context, campaignID, creatorID string) error {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM campaigns WHERE id=$1 AND creator_id=$2`, campaignID, creatorID).Scan(&status); err != nil {
		return fmt.Errorf("crowdfunding: campaign not found")
	}
	if status == "funded" {
		return fmt.Errorf("crowdfunding: cannot refund a funded campaign")
	}

	rows, err := s.db.Query(ctx, `SELECT id, settlement_id FROM contributions WHERE campaign_id=$1 AND status='escrowed'`, campaignID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type c struct{ id, settlementID string }
	var contribs []c
	for rows.Next() {
		var entry c
		if err := rows.Scan(&entry.id, &entry.settlementID); err != nil {
			return err
		}
		contribs = append(contribs, entry)
	}
	rows.Close()

	for _, entry := range contribs {
		if err := s.settlement.Refund(ctx, entry.settlementID, "campaign_cancelled"); err != nil {
			return fmt.Errorf("crowdfunding: refund contribution %s: %w", entry.id, err)
		}
		s.db.Exec(ctx, `UPDATE contributions SET status='refunded' WHERE id=$1`, entry.id)
	}
	_, err = s.db.Exec(ctx, `UPDATE campaigns SET status='failed' WHERE id=$1`, campaignID)
	return err
}

func (s *Service) checkAndMarkFunded(ctx context.Context, campaignID string) {
	var goalKobo, raisedKobo int64
	s.db.QueryRow(ctx, `
		SELECT c.goal_kobo,
		       COALESCE(SUM(co.amount_kobo) FILTER (WHERE co.status IN ('escrowed','released')), 0)
		FROM campaigns c LEFT JOIN contributions co ON co.campaign_id=c.id
		WHERE c.id=$1 GROUP BY c.id`, campaignID).Scan(&goalKobo, &raisedKobo)
	if raisedKobo >= goalKobo {
		s.db.Exec(ctx, `UPDATE campaigns SET status='funded' WHERE id=$1 AND status='active'`, campaignID)
	}
}
