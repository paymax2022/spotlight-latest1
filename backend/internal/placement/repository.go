package placement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data layer for placement. It NEVER mutates ledger tables —
// money moves via the finance ledger service; this repo only records placement-domain
// rows (campaigns, reservations, analytics events, audit log).
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the placement repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// sqlStater matches the pgx-wrapped *pgconn.PgError without importing pgconn.
type sqlStater interface{ SQLState() string }

// isExclusionViolation reports whether err is a Postgres 23P01 exclusion_violation
// (the EXCLUDE USING gist no-overlap constraint on placement_reservation).
func isExclusionViolation(err error) bool {
	var pgErr sqlStater
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23P01"
	}
	return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Zones
// ─────────────────────────────────────────────────────────────────────────────

const zoneCols = `id, code, label, layout_type, capacity, base_daily_rate_kobo,
	tier_multiplier, position, is_active, creative_spec, rate_version`

func scanZone(row interface{ Scan(dest ...any) error }) (*Zone, error) {
	var z Zone
	var layout string
	var specRaw []byte
	if err := row.Scan(
		&z.ID, &z.Code, &z.Label, &layout, &z.Capacity, &z.BaseDailyRateKobo,
		&z.TierMultiplier, &z.Position, &z.IsActive, &specRaw, &z.RateVersion,
	); err != nil {
		return nil, err
	}
	z.LayoutType = LayoutType(layout)
	if len(specRaw) > 0 {
		_ = json.Unmarshal(specRaw, &z.CreativeSpec)
	}
	if z.CreativeSpec == nil {
		z.CreativeSpec = map[string]any{}
	}
	return &z, nil
}

// GetZone returns an active zone by code.
func (r *Repository) GetZone(ctx context.Context, code string) (*Zone, error) {
	row := r.db.QueryRow(ctx, `SELECT `+zoneCols+` FROM public.placement_zone WHERE code = $1`, code)
	z, err := scanZone(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrZoneNotFound
		}
		return nil, err
	}
	return z, nil
}

// ListZones returns active zones ordered by position.
func (r *Repository) ListZones(ctx context.Context) ([]Zone, error) {
	rows, err := r.db.Query(ctx, `SELECT `+zoneCols+` FROM public.placement_zone WHERE is_active = TRUE ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Zone
	for rows.Next() {
		z, err := scanZone(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *z)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────────────────
// Campaigns
// ─────────────────────────────────────────────────────────────────────────────

const campaignCols = `id, merchant_id, subject_type, subject_id, zone_code,
	window_start, window_end, duration_days, creative, quoted_price_kobo, rate_version,
	state, review_reviewer_id, review_decision, review_reason, reviewed_at, payment_ref,
	paused_intervals, activated_at, completed_at, version, created_at, updated_at`

func scanCampaign(row interface{ Scan(dest ...any) error }) (*Campaign, error) {
	var c Campaign
	var state string
	var creativeRaw, pausedRaw []byte
	if err := row.Scan(
		&c.ID, &c.MerchantID, &c.SubjectType, &c.SubjectID, &c.ZoneCode,
		&c.WindowStart, &c.WindowEnd, &c.DurationDays, &creativeRaw, &c.QuotedPriceKobo, &c.RateVersion,
		&state, &c.ReviewReviewer, &c.ReviewDecision, &c.ReviewReason, &c.ReviewedAt, &c.PaymentRef,
		&pausedRaw, &c.ActivatedAt, &c.CompletedAt, &c.Version, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	c.State = State(state)
	if len(creativeRaw) > 0 {
		_ = json.Unmarshal(creativeRaw, &c.Creative)
	}
	if c.Creative == nil {
		c.Creative = map[string]any{}
	}
	if len(pausedRaw) > 0 {
		_ = json.Unmarshal(pausedRaw, &c.PausedIntervals)
	}
	return &c, nil
}

// CreateCampaign inserts a campaign in DRAFT (or its given state). jsonb columns are
// passed as native Go values (map/slice); pgx encodes them to jsonb via encoding/json,
// matching the established repo pattern (e.g. stays reservation occupancy).
func (r *Repository) CreateCampaign(ctx context.Context, c *Campaign) (*Campaign, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.featured_campaign
			(merchant_id, subject_type, subject_id, zone_code, window_start, window_end,
			 duration_days, creative, quoted_price_kobo, rate_version, state)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING `+campaignCols,
		c.MerchantID, c.SubjectType, c.SubjectID, c.ZoneCode, c.WindowStart, c.WindowEnd,
		c.DurationDays, orMap(c.Creative), c.QuotedPriceKobo, c.RateVersion, string(c.State),
	)
	return scanCampaign(row)
}

// GetCampaign returns a campaign by id.
func (r *Repository) GetCampaign(ctx context.Context, id string) (*Campaign, error) {
	row := r.db.QueryRow(ctx, `SELECT `+campaignCols+` FROM public.featured_campaign WHERE id = $1`, id)
	c, err := scanCampaign(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return c, nil
}

// ListByMerchant returns the merchant's campaigns newest-first.
func (r *Repository) ListByMerchant(ctx context.Context, merchantID string, limit, offset int) ([]Campaign, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+campaignCols+` FROM public.featured_campaign
		WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, merchantID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Campaign
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// ReviewQueue returns campaigns in a given state (admin). Empty state = the default
// review pipeline (SUBMITTED + UNDER_REVIEW + NEEDS_MORE_INFO).
func (r *Repository) ReviewQueue(ctx context.Context, state string, limit, offset int) ([]Campaign, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+campaignCols+` FROM public.featured_campaign
		WHERE ($1 = '' AND state IN ('SUBMITTED','UNDER_REVIEW','NEEDS_MORE_INFO'))
		   OR ($1 <> '' AND state = $1)
		ORDER BY created_at ASC LIMIT $2 OFFSET $3`, state, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Campaign
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// CountActiveByMerchant counts a merchant's non-terminal campaigns (for the
// concurrent-campaign cap). Optionally excludes one campaign id.
func (r *Repository) CountActiveByMerchant(ctx context.Context, merchantID, excludeID string) (int, error) {
	const q = `
		SELECT COUNT(*) FROM public.featured_campaign
		WHERE merchant_id = $1 AND id <> $2
		  AND state NOT IN ('REJECTED','CANCELLED','CANCELLED_EARLY','SUSPENDED','COMPLETED')`
	var n int
	err := r.db.QueryRow(ctx, q, merchantID, excludeID).Scan(&n)
	return n, err
}

// LastWindowEndInZone returns the most recent window_end for a merchant's
// non-terminal/non-rejected campaigns in a zone (for the per-zone cooldown). Returns
// (zero time, nil) when none exists.
func (r *Repository) LastWindowEndInZone(ctx context.Context, merchantID, zoneCode, excludeID string) (time.Time, error) {
	const q = `
		SELECT COALESCE(MAX(window_end), 'epoch'::timestamptz) FROM public.featured_campaign
		WHERE merchant_id = $1 AND zone_code = $2 AND id <> $3
		  AND state NOT IN ('REJECTED','CANCELLED')`
	var t time.Time
	err := r.db.QueryRow(ctx, q, merchantID, zoneCode, excludeID).Scan(&t)
	return t, err
}

// SetState applies a guarded optimistic-locked state change. The WHERE on version is
// the optimistic lock; a 0-row update means a concurrent writer raced (or the
// expected version is stale).
func (r *Repository) SetState(ctx context.Context, id string, to State, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.featured_campaign
		SET state = $2, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $3`, id, string(to), expectedVersion)
	if err != nil {
		return fmt.Errorf("placement: set state: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("%w on %s → %s", ErrConflict, id, to)
	}
	return nil
}

// SetQuote persists a fresh quote (price + rate_version lock) on a DRAFT/NEEDS_MORE_INFO
// campaign, optimistic-locked.
func (r *Repository) SetQuote(ctx context.Context, id string, priceKobo int64, rateVersion, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.featured_campaign
		SET quoted_price_kobo = $2, rate_version = $3, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $4`, id, priceKobo, rateVersion, expectedVersion)
	if err != nil {
		return fmt.Errorf("placement: set quote: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("%w setting quote on %s", ErrConflict, id)
	}
	return nil
}

// SetReview records the reviewer decision/reason alongside a state change (optimistic).
func (r *Repository) SetReview(ctx context.Context, id string, to State, reviewerID, decision, reason string, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.featured_campaign
		SET state = $2, review_reviewer_id = $3, review_decision = $4, review_reason = $5,
		    reviewed_at = now(), version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $6`, id, string(to), reviewerID, decision, reason, expectedVersion)
	if err != nil {
		return fmt.Errorf("placement: set review: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("%w setting review on %s", ErrConflict, id)
	}
	return nil
}

// SetPaymentRef records the payment/ledger ref alongside a state change (optimistic).
func (r *Repository) SetPaymentRef(ctx context.Context, id string, to State, paymentRef string, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.featured_campaign
		SET state = $2, payment_ref = $3, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $4`, id, string(to), paymentRef, expectedVersion)
	if err != nil {
		return fmt.Errorf("placement: set payment ref: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("%w setting payment ref on %s", ErrConflict, id)
	}
	return nil
}

// SetActivated flips a campaign to ACTIVE + stamps activated_at (scheduler; optimistic).
func (r *Repository) SetActivated(ctx context.Context, id string, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.featured_campaign
		SET state = 'ACTIVE', activated_at = now(), version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $2 AND state = 'SCHEDULED'`, id, expectedVersion)
	if err != nil {
		return fmt.Errorf("placement: set activated: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("%w activating %s", ErrConflict, id)
	}
	return nil
}

// SetCompleted flips a campaign to COMPLETED + stamps completed_at (scheduler; optimistic).
func (r *Repository) SetCompleted(ctx context.Context, id string, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.featured_campaign
		SET state = 'COMPLETED', completed_at = now(), version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $2 AND state IN ('ACTIVE','PAUSED')`, id, expectedVersion)
	if err != nil {
		return fmt.Errorf("placement: set completed: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("%w completing %s", ErrConflict, id)
	}
	return nil
}

// SetPausedIntervals + window_end persists the paused-interval ledger and the
// possibly-extended window_end alongside a state change (optimistic).
func (r *Repository) SetPausedIntervalsAndWindow(ctx context.Context, id string, to State, intervals []Interval, windowEnd time.Time, expectedVersion int) error {
	if intervals == nil {
		intervals = []Interval{}
	}
	ct, err := r.db.Exec(ctx, `
		UPDATE public.featured_campaign
		SET state = $2, paused_intervals = $3, window_end = $4,
		    version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $5`, id, string(to), intervals, windowEnd, expectedVersion)
	if err != nil {
		return fmt.Errorf("placement: set paused intervals: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("%w setting paused intervals on %s", ErrConflict, id)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Reservations (EXCLUSIVE-zone slot holds)
// ─────────────────────────────────────────────────────────────────────────────

// InsertReservation inserts a SCHEDULED reservation. If the no-overlap exclusion
// constraint fires (SQLSTATE 23P01) it maps to ErrSlotTaken so the caller can refuse
// the approval without partially mutating state.
func (r *Repository) InsertReservation(ctx context.Context, campaignID, zoneCode string, windowStart, windowEnd time.Time) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.placement_reservation
			(campaign_id, zone_code, window_start, window_end, state)
		VALUES ($1,$2,$3,$4,'SCHEDULED')`,
		campaignID, zoneCode, windowStart, windowEnd)
	if err != nil {
		if isExclusionViolation(err) {
			return ErrSlotTaken
		}
		return fmt.Errorf("placement: insert reservation: %w", err)
	}
	return nil
}

// SetReservationState moves a reservation to a terminal/holding state so the slot is
// freed/held appropriately. No-op when the campaign has no reservation (POOLED zone).
func (r *Repository) SetReservationState(ctx context.Context, campaignID string, state State) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.placement_reservation SET state = $2, updated_at = now()
		WHERE campaign_id = $1`, campaignID, string(state))
	if err != nil {
		return fmt.Errorf("placement: set reservation state: %w", err)
	}
	return nil
}

// CountActiveInZone counts campaigns currently occupying a POOLED zone (state ACTIVE
// within their window). Used for the capacity check at activation.
func (r *Repository) CountActiveInZone(ctx context.Context, zoneCode string, now time.Time) (int, error) {
	const q = `
		SELECT COUNT(*) FROM public.featured_campaign
		WHERE zone_code = $1 AND state = 'ACTIVE'
		  AND window_start <= $2 AND window_end > $2`
	var n int
	err := r.db.QueryRow(ctx, q, zoneCode, now).Scan(&n)
	return n, err
}

// ─────────────────────────────────────────────────────────────────────────────
// Serving query (resolver)
// ─────────────────────────────────────────────────────────────────────────────

// ServingCandidates returns ACTIVE campaigns whose window contains now, for a zone,
// excluding SUSPENDED. Ordered by tier_multiplier-weighted priority is applied in the
// resolver; here we just return the live rows.
func (r *Repository) ServingCandidates(ctx context.Context, zoneCode string, now time.Time) ([]Campaign, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+campaignCols+` FROM public.featured_campaign
		WHERE zone_code = $1 AND state = 'ACTIVE'
		  AND window_start <= $2 AND window_end > $2
		ORDER BY created_at ASC`, zoneCode, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Campaign
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics events (append-only)
// ─────────────────────────────────────────────────────────────────────────────

// InsertImpression appends one impression event.
func (r *Repository) InsertImpression(ctx context.Context, campaignID, zoneCode, token, sessionID string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.placement_impression_event (campaign_id, zone_code, placement_token, session_id)
		VALUES ($1,$2,$3,$4)`, campaignID, zoneCode, token, nullable(sessionID))
	return err
}

// InsertTap appends one tap event.
func (r *Repository) InsertTap(ctx context.Context, campaignID, zoneCode, token, sessionID string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.placement_tap_event (campaign_id, zone_code, placement_token, session_id)
		VALUES ($1,$2,$3,$4)`, campaignID, zoneCode, token, nullable(sessionID))
	return err
}

// Analytics is a campaign's served-impression/tap roll-up.
type Analytics struct {
	CampaignID  string `json:"campaign_id"`
	Impressions int64  `json:"impressions"`
	Taps        int64  `json:"taps"`
}

// CampaignAnalytics returns impression + tap counts for a campaign.
func (r *Repository) CampaignAnalytics(ctx context.Context, campaignID string) (*Analytics, error) {
	a := &Analytics{CampaignID: campaignID}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM public.placement_impression_event WHERE campaign_id=$1`, campaignID).Scan(&a.Impressions); err != nil {
		return nil, err
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM public.placement_tap_event WHERE campaign_id=$1`, campaignID).Scan(&a.Taps); err != nil {
		return nil, err
	}
	return a, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit log (INSERT-only, immutable)
// ─────────────────────────────────────────────────────────────────────────────

// InsertAudit writes one immutable audit row. actorID empty = system (scheduler) →
// stored as NULL. before/after/metadata are arbitrary JSON.
func (r *Repository) InsertAudit(ctx context.Context, campaignID, actorID, action string, before, after, metadata map[string]any) error {
	// before/after may be nil (→ SQL NULL jsonb); metadata defaults to {}.
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.placement_audit_log (campaign_id, actor_id, action, before, after, metadata)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		campaignID, nullable(actorID), action, jsonbOrNil(before), jsonbOrNil(after), orMap(metadata))
	return err
}

// jsonbOrNil returns nil (SQL NULL) for a nil map so an absent before/after stays
// NULL rather than encoding an empty object.
func jsonbOrNil(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler sweep helpers
// ─────────────────────────────────────────────────────────────────────────────

// DueForActivation returns SCHEDULED campaigns whose window_start has arrived.
func (r *Repository) DueForActivation(ctx context.Context, now time.Time, limit int) ([]Campaign, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+campaignCols+` FROM public.featured_campaign
		WHERE state = 'SCHEDULED' AND window_start <= $1
		ORDER BY window_start ASC LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectCampaigns(rows)
}

// DueForExpiration returns ACTIVE/PAUSED campaigns whose window_end has passed.
func (r *Repository) DueForExpiration(ctx context.Context, now time.Time, limit int) ([]Campaign, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+campaignCols+` FROM public.featured_campaign
		WHERE state IN ('ACTIVE','PAUSED') AND window_end <= $1
		ORDER BY window_end ASC LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectCampaigns(rows)
}

// StartingSoon returns SCHEDULED campaigns starting within the lookahead (reminders).
func (r *Repository) StartingSoon(ctx context.Context, from, to time.Time, limit int) ([]Campaign, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+campaignCols+` FROM public.featured_campaign
		WHERE state = 'SCHEDULED' AND window_start > $1 AND window_start <= $2
		ORDER BY window_start ASC LIMIT $3`, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectCampaigns(rows)
}

// OrphanedHolds returns SCHEDULED campaigns whose window_end has passed but never
// activated (orphaned escrow holds past TTL) — reconciliation sweep targets.
func (r *Repository) OrphanedHolds(ctx context.Context, now time.Time, limit int) ([]Campaign, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+campaignCols+` FROM public.featured_campaign
		WHERE state = 'SCHEDULED' AND window_end <= $1
		ORDER BY window_end ASC LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectCampaigns(rows)
}

func collectCampaigns(rows pgx.Rows) ([]Campaign, error) {
	var out []Campaign
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────────────────
// small helpers
// ─────────────────────────────────────────────────────────────────────────────

func orMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

// nullable turns "" into a SQL NULL for nullable text/uuid columns.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
