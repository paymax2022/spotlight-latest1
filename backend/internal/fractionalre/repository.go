package fractionalre

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository owns all DB access for the fractionalre module over a pgx pool.
// Money is always int64 kobo. Projections (raised_kobo, units_sold, ytd) are
// recomputed from source rows, never trusted as a balance.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ── Sponsors ──────────────────────────────────────────────────────────────────

func (r *Repository) CreateSponsor(ctx context.Context, s *Sponsor) error {
	const q = `
		INSERT INTO fre_sponsors (name, legal_name, trustee_name, description, created_by)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, status, created_at`
	return r.db.QueryRow(ctx, q, s.Name, s.LegalName, s.TrusteeName, s.Description, s.CreatedBy).
		Scan(&s.ID, &s.Status, &s.CreatedAt)
}

func (r *Repository) ListSponsors(ctx context.Context) ([]Sponsor, error) {
	const q = `SELECT id, name, legal_name, trustee_name, description, status, created_by, created_at
		FROM fre_sponsors ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Sponsor
	for rows.Next() {
		var s Sponsor
		if err := rows.Scan(&s.ID, &s.Name, &s.LegalName, &s.TrusteeName, &s.Description, &s.Status, &s.CreatedBy, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── Assets ────────────────────────────────────────────────────────────────────

func (r *Repository) CreateAsset(ctx context.Context, a *Asset) error {
	const q = `
		INSERT INTO fre_assets (sponsor_id, name, asset_type, description, location, geo_lat, geo_lng, nav_kobo, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, status, title_status, created_at`
	return r.db.QueryRow(ctx, q, a.SponsorID, a.Name, string(a.AssetType), a.Description, a.Location,
		a.GeoLat, a.GeoLng, a.NAVKobo, a.CreatedBy).
		Scan(&a.ID, &a.Status, &a.TitleStatus, &a.CreatedAt)
}

func (r *Repository) GetAsset(ctx context.Context, id string) (*Asset, error) {
	const q = `
		SELECT id, sponsor_id, name, asset_type, description, location, geo_lat, geo_lng,
		       status, title_status, title_verified_by, title_verified_at, nav_kobo, created_by, created_at
		FROM fre_assets WHERE id=$1`
	a := &Asset{}
	err := r.db.QueryRow(ctx, q, id).Scan(
		&a.ID, &a.SponsorID, &a.Name, &a.AssetType, &a.Description, &a.Location, &a.GeoLat, &a.GeoLng,
		&a.Status, &a.TitleStatus, &a.TitleVerifiedBy, &a.TitleVerifiedAt, &a.NAVKobo, &a.CreatedBy, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

func (r *Repository) ListAssets(ctx context.Context, status string, limit, offset int) ([]Asset, error) {
	q := `
		SELECT id, sponsor_id, name, asset_type, description, location, geo_lat, geo_lng,
		       status, title_status, title_verified_by, title_verified_at, nav_kobo, created_by, created_at
		FROM fre_assets`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT %d OFFSET %d`, limit, offset)
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.SponsorID, &a.Name, &a.AssetType, &a.Description, &a.Location, &a.GeoLat, &a.GeoLng,
			&a.Status, &a.TitleStatus, &a.TitleVerifiedBy, &a.TitleVerifiedAt, &a.NAVKobo, &a.CreatedBy, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// UpdateAssetStatus moves an asset to a new lifecycle state.
func (r *Repository) UpdateAssetStatus(ctx context.Context, id string, status AssetStatus) error {
	const q = `UPDATE fre_assets SET status=$2, updated_at=now() WHERE id=$1`
	ct, err := r.db.Exec(ctx, q, id, string(status))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetTitleVerification records the independent title verification outcome.
func (r *Repository) SetTitleVerification(ctx context.Context, id string, status TitleStatus, verifierID string) error {
	const q = `UPDATE fre_assets SET title_status=$2, title_verified_by=$3, title_verified_at=now(), updated_at=now() WHERE id=$1`
	ct, err := r.db.Exec(ctx, q, id, string(status), verifierID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) PatchAsset(ctx context.Context, id string, navKobo *int64, description, location *string) error {
	const q = `UPDATE fre_assets SET
		nav_kobo = COALESCE($2, nav_kobo),
		description = COALESCE($3, description),
		location = COALESCE($4, location),
		updated_at = now()
		WHERE id=$1`
	ct, err := r.db.Exec(ctx, q, id, navKobo, description, location)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Offerings ─────────────────────────────────────────────────────────────────

func (r *Repository) CreateOffering(ctx context.Context, o *Offering) error {
	const q = `
		INSERT INTO fre_offerings
		  (asset_id, name, unit_price_kobo, share_count, target_kobo, min_threshold_kobo,
		   ticket_min_kobo, ticket_max_kobo, status, opens_at, closes_at, escrow_reference, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING id, created_at`
	return r.db.QueryRow(ctx, q, o.AssetID, o.Name, o.UnitPriceKobo, o.ShareCount, o.TargetKobo,
		o.MinThresholdKobo, o.TicketMinKobo, o.TicketMaxKobo, string(o.Status), o.OpensAt, o.ClosesAt,
		o.EscrowReference, o.CreatedBy).
		Scan(&o.ID, &o.CreatedAt)
}

func (r *Repository) GetOffering(ctx context.Context, id string) (*Offering, error) {
	const q = `
		SELECT id, asset_id, name, unit_price_kobo, share_count, target_kobo, min_threshold_kobo,
		       ticket_min_kobo, ticket_max_kobo, status, opens_at, closes_at, extension_days,
		       raised_kobo, units_sold, investor_count, escrow_reference,
		       close_proposed_by, close_approved_by, closed_at, created_by, created_at
		FROM fre_offerings WHERE id=$1`
	o := &Offering{}
	err := r.db.QueryRow(ctx, q, id).Scan(
		&o.ID, &o.AssetID, &o.Name, &o.UnitPriceKobo, &o.ShareCount, &o.TargetKobo, &o.MinThresholdKobo,
		&o.TicketMinKobo, &o.TicketMaxKobo, &o.Status, &o.OpensAt, &o.ClosesAt, &o.ExtensionDays,
		&o.RaisedKobo, &o.UnitsSold, &o.InvestorCount, &o.EscrowReference,
		&o.CloseProposedBy, &o.CloseApprovedBy, &o.ClosedAt, &o.CreatedBy, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

func (r *Repository) ListOfferings(ctx context.Context, status string, limit, offset int) ([]Offering, error) {
	q := `
		SELECT id, asset_id, name, unit_price_kobo, share_count, target_kobo, min_threshold_kobo,
		       ticket_min_kobo, ticket_max_kobo, status, opens_at, closes_at, extension_days,
		       raised_kobo, units_sold, investor_count, escrow_reference,
		       close_proposed_by, close_approved_by, closed_at, created_by, created_at
		FROM fre_offerings`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT %d OFFSET %d`, limit, offset)
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Offering
	for rows.Next() {
		var o Offering
		if err := rows.Scan(&o.ID, &o.AssetID, &o.Name, &o.UnitPriceKobo, &o.ShareCount, &o.TargetKobo, &o.MinThresholdKobo,
			&o.TicketMinKobo, &o.TicketMaxKobo, &o.Status, &o.OpensAt, &o.ClosesAt, &o.ExtensionDays,
			&o.RaisedKobo, &o.UnitsSold, &o.InvestorCount, &o.EscrowReference,
			&o.CloseProposedBy, &o.CloseApprovedBy, &o.ClosedAt, &o.CreatedBy, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *Repository) UpdateOfferingStatus(ctx context.Context, id string, status OfferingStatus) error {
	const q = `UPDATE fre_offerings SET status=$2, updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, string(status))
	return err
}

func (r *Repository) ExtendOffering(ctx context.Context, id string, newClose time.Time, extraDays int) error {
	const q = `UPDATE fre_offerings SET closes_at=$2, extension_days=extension_days+$3, updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, newClose, extraDays)
	return err
}

func (r *Repository) SetClose(ctx context.Context, id, proposedBy, approvedBy string, status OfferingStatus) error {
	const q = `UPDATE fre_offerings SET status=$2, close_proposed_by=$3, close_approved_by=$4, closed_at=now(), updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, string(status), proposedBy, approvedBy)
	return err
}

func (r *Repository) SetCloseProposer(ctx context.Context, id, proposedBy string) error {
	const q = `UPDATE fre_offerings SET close_proposed_by=$2, status='closing', updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, proposedBy)
	return err
}

// RecomputeOfferingProjections rebuilds raised_kobo / units_sold / investor_count
// from escrowed+allocated subscriptions (projection — never a trusted balance).
func (r *Repository) RecomputeOfferingProjections(ctx context.Context, offeringID string) error {
	const q = `
		UPDATE fre_offerings o SET
		  raised_kobo = COALESCE(s.amt, 0),
		  units_sold = COALESCE(s.units, 0),
		  investor_count = COALESCE(s.cnt, 0),
		  updated_at = now()
		FROM (
		  SELECT SUM(amount_kobo) amt, SUM(units) units, COUNT(DISTINCT user_id) cnt
		  FROM fre_subscriptions
		  WHERE offering_id=$1 AND status IN ('escrowed','allocated')
		) s
		WHERE o.id=$1`
	_, err := r.db.Exec(ctx, q, offeringID)
	return err
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

// InsertSubscription writes a new subscription. The UNIQUE idempotency_key makes
// a duplicate (double-subscribe) a no-op: pgx returns a unique-violation which
// the caller maps to a fetch of the existing row.
func (r *Repository) InsertSubscription(ctx context.Context, s *Subscription) error {
	const q = `
		INSERT INTO fre_subscriptions (offering_id, user_id, units, amount_kobo, status, settlement_id, idempotency_key, risk_ack_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, created_at`
	return r.db.QueryRow(ctx, q, s.OfferingID, s.UserID, s.Units, s.AmountKobo, string(s.Status),
		s.SettlementID, s.IdempotencyKey, s.RiskAckID).
		Scan(&s.ID, &s.CreatedAt)
}

func (r *Repository) GetSubscriptionByKey(ctx context.Context, key string) (*Subscription, error) {
	const q = `SELECT id, offering_id, user_id, units, amount_kobo, status, settlement_id, idempotency_key, risk_ack_id, created_at
		FROM fre_subscriptions WHERE idempotency_key=$1`
	s := &Subscription{}
	err := r.db.QueryRow(ctx, q, key).Scan(&s.ID, &s.OfferingID, &s.UserID, &s.Units, &s.AmountKobo,
		&s.Status, &s.SettlementID, &s.IdempotencyKey, &s.RiskAckID, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

func (r *Repository) ListSubscriptionsByOffering(ctx context.Context, offeringID string, status SubscriptionStatus) ([]Subscription, error) {
	const q = `SELECT id, offering_id, user_id, units, amount_kobo, status, settlement_id, idempotency_key, risk_ack_id, created_at
		FROM fre_subscriptions WHERE offering_id=$1 AND status=$2 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, offeringID, string(status))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Subscription
	for rows.Next() {
		var s Subscription
		if err := rows.Scan(&s.ID, &s.OfferingID, &s.UserID, &s.Units, &s.AmountKobo, &s.Status,
			&s.SettlementID, &s.IdempotencyKey, &s.RiskAckID, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repository) UpdateSubscriptionStatus(ctx context.Context, id string, status SubscriptionStatus) error {
	const q = `UPDATE fre_subscriptions SET status=$2, updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, string(status))
	return err
}

// ── Cap table ─────────────────────────────────────────────────────────────────

// UpsertCapTable adds units to an investor's holding in an asset (allocation or
// secondary buy). pct_bps is recomputed by RecomputeCapTablePct afterwards.
func (r *Repository) UpsertCapTable(ctx context.Context, e *CapTableEntry) error {
	const q = `
		INSERT INTO fre_cap_table (asset_id, offering_id, user_id, units, cost_kobo, source, cert_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (asset_id, user_id) DO UPDATE
		SET units = fre_cap_table.units + EXCLUDED.units,
		    cost_kobo = fre_cap_table.cost_kobo + EXCLUDED.cost_kobo,
		    updated_at = now()`
	_, err := r.db.Exec(ctx, q, e.AssetID, e.OfferingID, e.UserID, e.Units, e.CostKobo, e.Source, e.CertRef)
	return err
}

// TransferUnits moves units from seller to buyer atomically (secondary trade).
func (r *Repository) TransferUnits(ctx context.Context, assetID, sellerID, buyerID string, units, costKobo int64) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var sellerUnits int64
	if err := tx.QueryRow(ctx, `SELECT units FROM fre_cap_table WHERE asset_id=$1 AND user_id=$2 FOR UPDATE`, assetID, sellerID).
		Scan(&sellerUnits); err != nil {
		return fmt.Errorf("fractionalre: seller holding: %w", err)
	}
	if sellerUnits < units {
		return ErrInsufficientUnits
	}
	if _, err := tx.Exec(ctx, `UPDATE fre_cap_table SET units=units-$3, cost_kobo=GREATEST(cost_kobo-$4,0), updated_at=now() WHERE asset_id=$1 AND user_id=$2`,
		assetID, sellerID, units, costKobo); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO fre_cap_table (asset_id, user_id, units, cost_kobo, source)
		VALUES ($1,$2,$3,$4,'secondary')
		ON CONFLICT (asset_id, user_id) DO UPDATE
		SET units = fre_cap_table.units + EXCLUDED.units,
		    cost_kobo = fre_cap_table.cost_kobo + EXCLUDED.cost_kobo,
		    updated_at = now()`,
		assetID, buyerID, units, costKobo); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RecomputeCapTablePct rebuilds pct_bps for every holder of an asset as a
// projection of units / total units.
func (r *Repository) RecomputeCapTablePct(ctx context.Context, assetID string) error {
	const q = `
		WITH tot AS (SELECT NULLIF(SUM(units),0) t FROM fre_cap_table WHERE asset_id=$1)
		UPDATE fre_cap_table c
		SET pct_bps = COALESCE((c.units * 10000) / (SELECT t FROM tot), 0), updated_at=now()
		WHERE c.asset_id=$1`
	_, err := r.db.Exec(ctx, q, assetID)
	return err
}

func (r *Repository) SetCertRef(ctx context.Context, assetID, userID, certRef string) error {
	const q = `UPDATE fre_cap_table SET cert_ref=$3, updated_at=now() WHERE asset_id=$1 AND user_id=$2`
	_, err := r.db.Exec(ctx, q, assetID, userID, certRef)
	return err
}

func (r *Repository) GetCapTable(ctx context.Context, assetID string) ([]CapTableEntry, error) {
	const q = `SELECT id, asset_id, offering_id, user_id, units, cost_kobo, pct_bps, source, cert_ref, acquired_at
		FROM fre_cap_table WHERE asset_id=$1 AND units > 0 ORDER BY units DESC`
	rows, err := r.db.Query(ctx, q, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CapTableEntry
	for rows.Next() {
		var e CapTableEntry
		if err := rows.Scan(&e.ID, &e.AssetID, &e.OfferingID, &e.UserID, &e.Units, &e.CostKobo, &e.PctBps, &e.Source, &e.CertRef, &e.AcquiredAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repository) GetHolding(ctx context.Context, assetID, userID string) (*CapTableEntry, error) {
	const q = `SELECT id, asset_id, offering_id, user_id, units, cost_kobo, pct_bps, source, cert_ref, acquired_at
		FROM fre_cap_table WHERE asset_id=$1 AND user_id=$2`
	e := &CapTableEntry{}
	err := r.db.QueryRow(ctx, q, assetID, userID).Scan(&e.ID, &e.AssetID, &e.OfferingID, &e.UserID,
		&e.Units, &e.CostKobo, &e.PctBps, &e.Source, &e.CertRef, &e.AcquiredAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

func (r *Repository) ListHoldings(ctx context.Context, userID string) ([]CapTableEntry, error) {
	const q = `SELECT id, asset_id, offering_id, user_id, units, cost_kobo, pct_bps, source, cert_ref, acquired_at
		FROM fre_cap_table WHERE user_id=$1 AND units > 0 ORDER BY acquired_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CapTableEntry
	for rows.Next() {
		var e CapTableEntry
		if err := rows.Scan(&e.ID, &e.AssetID, &e.OfferingID, &e.UserID, &e.Units, &e.CostKobo, &e.PctBps, &e.Source, &e.CertRef, &e.AcquiredAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ── Investor profile ──────────────────────────────────────────────────────────

func (r *Repository) GetInvestorProfile(ctx context.Context, userID string) (*InvestorProfile, error) {
	const q = `
		SELECT id, user_id, classification, declared_annual_income_kobo, ytd_invested_kobo, ytd_year,
		       suitability_score, suitability_completed_at, master_risk_ack_id, status, activated_at, created_at
		FROM fre_investor_profiles WHERE user_id=$1`
	p := &InvestorProfile{}
	err := r.db.QueryRow(ctx, q, userID).Scan(&p.ID, &p.UserID, &p.Classification, &p.DeclaredAnnualIncomeKobo,
		&p.YTDInvestedKobo, &p.YTDYear, &p.SuitabilityScore, &p.SuitabilityCompletedAt, &p.MasterRiskAckID,
		&p.Status, &p.ActivatedAt, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (r *Repository) UpsertInvestorProfile(ctx context.Context, userID string) (*InvestorProfile, error) {
	const q = `
		INSERT INTO fre_investor_profiles (user_id, status, activated_at)
		VALUES ($1, 'active', now())
		ON CONFLICT (user_id) DO UPDATE SET status='active', activated_at=COALESCE(fre_investor_profiles.activated_at, now()), updated_at=now()
		RETURNING id`
	var id string
	if err := r.db.QueryRow(ctx, q, userID).Scan(&id); err != nil {
		return nil, err
	}
	return r.GetInvestorProfile(ctx, userID)
}

func (r *Repository) SetSuitability(ctx context.Context, userID string, score int, answers []byte) error {
	const q = `
		INSERT INTO fre_investor_profiles (user_id, suitability_score, suitability_answers, suitability_completed_at)
		VALUES ($1,$2,$3,now())
		ON CONFLICT (user_id) DO UPDATE SET suitability_score=$2, suitability_answers=$3, suitability_completed_at=now(), updated_at=now()`
	_, err := r.db.Exec(ctx, q, userID, score, answers)
	return err
}

func (r *Repository) SetClassification(ctx context.Context, userID string, class Classification, incomeKobo int64, adminID string) error {
	const q = `
		INSERT INTO fre_investor_profiles (user_id, classification, declared_annual_income_kobo, classified_by)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id) DO UPDATE SET classification=$2, declared_annual_income_kobo=$3, classified_by=$4, updated_at=now()`
	_, err := r.db.Exec(ctx, q, userID, string(class), incomeKobo, adminID)
	return err
}

func (r *Repository) SetDeclaredIncome(ctx context.Context, userID string, incomeKobo int64) error {
	const q = `
		INSERT INTO fre_investor_profiles (user_id, declared_annual_income_kobo)
		VALUES ($1,$2)
		ON CONFLICT (user_id) DO UPDATE SET declared_annual_income_kobo=$2, updated_at=now()`
	_, err := r.db.Exec(ctx, q, userID, incomeKobo)
	return err
}

func (r *Repository) SetMasterRiskAck(ctx context.Context, userID, ackID string) error {
	const q = `
		INSERT INTO fre_investor_profiles (user_id, master_risk_ack_id)
		VALUES ($1,$2)
		ON CONFLICT (user_id) DO UPDATE SET master_risk_ack_id=$2, updated_at=now()`
	_, err := r.db.Exec(ctx, q, userID, ackID)
	return err
}

// SumYTDInvested computes platform-wide YTD invested kobo for a user across
// primary subscriptions + secondary buys for the given calendar year. This is
// the authoritative figure the compliance engine uses (the cached column is a
// convenience projection, recomputed here).
func (r *Repository) SumYTDInvested(ctx context.Context, userID string, year int) (int64, error) {
	const q = `
		SELECT COALESCE((
		  SELECT SUM(amount_kobo) FROM fre_subscriptions
		  WHERE user_id=$1 AND status IN ('escrowed','allocated') AND EXTRACT(YEAR FROM created_at)=$2
		),0)
		+ COALESCE((
		  SELECT SUM(amount_kobo) FROM fre_secondary_orders
		  WHERE buyer_id=$1 AND status IN ('escrowed','settled') AND EXTRACT(YEAR FROM created_at)=$2
		),0)`
	var total int64
	err := r.db.QueryRow(ctx, q, userID, year).Scan(&total)
	return total, err
}

func (r *Repository) CacheYTD(ctx context.Context, userID string, year int, ytdKobo int64) error {
	const q = `
		INSERT INTO fre_investor_profiles (user_id, ytd_invested_kobo, ytd_year)
		VALUES ($1,$2,$3)
		ON CONFLICT (user_id) DO UPDATE SET ytd_invested_kobo=$2, ytd_year=$3, updated_at=now()`
	_, err := r.db.Exec(ctx, q, userID, ytdKobo, year)
	return err
}

// SumActiveOverrides returns the total non-expired override headroom granted to
// a user by compliance (added to the base 10% cap).
func (r *Repository) SumActiveOverrides(ctx context.Context, userID string) (int64, error) {
	const q = `SELECT COALESCE(SUM(override_kobo),0) FROM fre_limit_overrides
		WHERE user_id=$1 AND (expires_at IS NULL OR expires_at > now())`
	var total int64
	err := r.db.QueryRow(ctx, q, userID).Scan(&total)
	return total, err
}

func (r *Repository) InsertOverride(ctx context.Context, userID string, overrideKobo int64, reason, reasonCode, approvedBy string, expires *time.Time) error {
	const q = `INSERT INTO fre_limit_overrides (user_id, override_kobo, reason, reason_code, approved_by, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, userID, overrideKobo, reason, reasonCode, approvedBy, expires)
	return err
}

// ── Risk acknowledgements ─────────────────────────────────────────────────────

func (r *Repository) InsertRiskAck(ctx context.Context, a *RiskAcknowledgement) error {
	const q = `INSERT INTO fre_risk_acknowledgements (user_id, offering_id, scope, disclosure_ref, scroll_completed, ip_address)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, acknowledged_at`
	return r.db.QueryRow(ctx, q, a.UserID, a.OfferingID, a.Scope, a.DisclosureRef, a.ScrollCompleted, nil).
		Scan(&a.ID, &a.AcknowledgedAt)
}

// HasOfferRiskAck reports the most recent valid per-offer acknowledgement id.
func (r *Repository) GetOfferRiskAck(ctx context.Context, userID, offeringID string) (string, bool, error) {
	const q = `SELECT id FROM fre_risk_acknowledgements
		WHERE user_id=$1 AND offering_id=$2 AND scope='offer' AND scroll_completed=true
		ORDER BY acknowledged_at DESC LIMIT 1`
	var id string
	err := r.db.QueryRow(ctx, q, userID, offeringID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

// ── Distributions ─────────────────────────────────────────────────────────────

func (r *Repository) InsertDistribution(ctx context.Context, d *Distribution) error {
	const q = `INSERT INTO fre_distributions
		(asset_id, offering_id, period_label, gross_kobo, fee_kobo, withholding_kobo, net_kobo, status, maker_id, submitted_at, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id, created_at`
	return r.db.QueryRow(ctx, q, d.AssetID, d.OfferingID, d.PeriodLabel, d.GrossKobo, d.FeeKobo, d.WithholdingKobo,
		d.NetKobo, string(d.Status), d.MakerID, d.SubmittedAt, d.IdempotencyKey).
		Scan(&d.ID, &d.CreatedAt)
}

func (r *Repository) GetDistribution(ctx context.Context, id string) (*Distribution, error) {
	const q = `SELECT id, asset_id, offering_id, period_label, gross_kobo, fee_kobo, withholding_kobo, net_kobo,
		status, maker_id, checker_id, submitted_at, approved_at, paid_at, idempotency_key, created_at
		FROM fre_distributions WHERE id=$1`
	d := &Distribution{}
	err := r.db.QueryRow(ctx, q, id).Scan(&d.ID, &d.AssetID, &d.OfferingID, &d.PeriodLabel, &d.GrossKobo, &d.FeeKobo,
		&d.WithholdingKobo, &d.NetKobo, &d.Status, &d.MakerID, &d.CheckerID, &d.SubmittedAt, &d.ApprovedAt, &d.PaidAt,
		&d.IdempotencyKey, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

func (r *Repository) ListDistributions(ctx context.Context, limit, offset int) ([]Distribution, error) {
	const q = `SELECT id, asset_id, offering_id, period_label, gross_kobo, fee_kobo, withholding_kobo, net_kobo,
		status, maker_id, checker_id, submitted_at, approved_at, paid_at, idempotency_key, created_at
		FROM fre_distributions ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Distribution
	for rows.Next() {
		var d Distribution
		if err := rows.Scan(&d.ID, &d.AssetID, &d.OfferingID, &d.PeriodLabel, &d.GrossKobo, &d.FeeKobo, &d.WithholdingKobo,
			&d.NetKobo, &d.Status, &d.MakerID, &d.CheckerID, &d.SubmittedAt, &d.ApprovedAt, &d.PaidAt, &d.IdempotencyKey, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *Repository) SetDistributionStatus(ctx context.Context, id string, status DistributionStatus) error {
	const q = `UPDATE fre_distributions SET status=$2, updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, string(status))
	return err
}

func (r *Repository) ApproveDistribution(ctx context.Context, id, checkerID string) error {
	const q = `UPDATE fre_distributions SET status='approved', checker_id=$2, approved_at=now(), updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, checkerID)
	return err
}

func (r *Repository) MarkDistributionPaid(ctx context.Context, id string, status DistributionStatus) error {
	const q = `UPDATE fre_distributions SET status=$2, paid_at=now(), updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, string(status))
	return err
}

func (r *Repository) InsertDistributionPayment(ctx context.Context, p *DistributionPayment) error {
	const q = `INSERT INTO fre_distribution_payments
		(distribution_id, user_id, units, gross_kobo, withholding_kobo, net_kobo, status, excluded_reason, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`
	return r.db.QueryRow(ctx, q, p.DistributionID, p.UserID, p.Units, p.GrossKobo, p.WithholdingKobo, p.NetKobo,
		p.Status, p.ExcludedReason, p.IdempotencyKey).Scan(&p.ID)
}

func (r *Repository) ListDistributionPayments(ctx context.Context, distributionID string) ([]DistributionPayment, error) {
	const q = `SELECT id, distribution_id, user_id, units, gross_kobo, withholding_kobo, net_kobo, status, excluded_reason, idempotency_key, paid_at
		FROM fre_distribution_payments WHERE distribution_id=$1 ORDER BY net_kobo DESC`
	rows, err := r.db.Query(ctx, q, distributionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DistributionPayment
	for rows.Next() {
		var p DistributionPayment
		if err := rows.Scan(&p.ID, &p.DistributionID, &p.UserID, &p.Units, &p.GrossKobo, &p.WithholdingKobo, &p.NetKobo,
			&p.Status, &p.ExcludedReason, &p.IdempotencyKey, &p.PaidAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) MarkPaymentStatus(ctx context.Context, id, status string) error {
	if status == "paid" {
		const q = `UPDATE fre_distribution_payments SET status='paid', paid_at=now(), updated_at=now() WHERE id=$1`
		_, err := r.db.Exec(ctx, q, id)
		return err
	}
	const q = `UPDATE fre_distribution_payments SET status=$2, updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, status)
	return err
}

func (r *Repository) ListPayoutsForUser(ctx context.Context, userID string, limit, offset int) ([]DistributionPayment, error) {
	const q = `SELECT id, distribution_id, user_id, units, gross_kobo, withholding_kobo, net_kobo, status, excluded_reason, idempotency_key, paid_at
		FROM fre_distribution_payments WHERE user_id=$1 ORDER BY paid_at DESC NULLS LAST LIMIT $2 OFFSET $3`
	rows, err := r.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DistributionPayment
	for rows.Next() {
		var p DistributionPayment
		if err := rows.Scan(&p.ID, &p.DistributionID, &p.UserID, &p.Units, &p.GrossKobo, &p.WithholdingKobo, &p.NetKobo,
			&p.Status, &p.ExcludedReason, &p.IdempotencyKey, &p.PaidAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ── Secondary market ──────────────────────────────────────────────────────────

// InsertListing writes a listing carrying the client's Idempotency-Key. The
// partial UNIQUE index on idempotency_key makes a duplicate list-for-sale a
// unique-violation which the service maps to a replay of the original listing.
func (r *Repository) InsertListing(ctx context.Context, l *SecondaryListing) error {
	const q = `INSERT INTO fre_secondary_listings (asset_id, seller_id, units, units_remaining, unit_price_kobo, nav_at_list_kobo, idempotency_key)
		VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id, status, created_at`
	return r.db.QueryRow(ctx, q, l.AssetID, l.SellerID, l.Units, l.UnitPriceKobo, l.NAVAtListKobo, l.IdempotencyKey).
		Scan(&l.ID, &l.Status, &l.CreatedAt)
}

// GetListingByKey resolves a listing by its idempotency key (replay lookup).
func (r *Repository) GetListingByKey(ctx context.Context, key string) (*SecondaryListing, error) {
	const q = `SELECT id, asset_id, seller_id, units, units_remaining, unit_price_kobo, nav_at_list_kobo, status, idempotency_key, created_at
		FROM fre_secondary_listings WHERE idempotency_key=$1`
	l := &SecondaryListing{}
	err := r.db.QueryRow(ctx, q, key).Scan(&l.ID, &l.AssetID, &l.SellerID, &l.Units, &l.UnitsRemaining,
		&l.UnitPriceKobo, &l.NAVAtListKobo, &l.Status, &l.IdempotencyKey, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return l, err
}

func (r *Repository) GetListing(ctx context.Context, id string) (*SecondaryListing, error) {
	const q = `SELECT id, asset_id, seller_id, units, units_remaining, unit_price_kobo, nav_at_list_kobo, status, idempotency_key, created_at
		FROM fre_secondary_listings WHERE id=$1`
	l := &SecondaryListing{}
	err := r.db.QueryRow(ctx, q, id).Scan(&l.ID, &l.AssetID, &l.SellerID, &l.Units, &l.UnitsRemaining,
		&l.UnitPriceKobo, &l.NAVAtListKobo, &l.Status, &l.IdempotencyKey, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return l, err
}

func (r *Repository) ListActiveListings(ctx context.Context, limit, offset int) ([]SecondaryListing, error) {
	const q = `SELECT id, asset_id, seller_id, units, units_remaining, unit_price_kobo, nav_at_list_kobo, status, idempotency_key, created_at
		FROM fre_secondary_listings WHERE status='active' AND units_remaining > 0 ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SecondaryListing
	for rows.Next() {
		var l SecondaryListing
		if err := rows.Scan(&l.ID, &l.AssetID, &l.SellerID, &l.Units, &l.UnitsRemaining, &l.UnitPriceKobo, &l.NAVAtListKobo, &l.Status, &l.IdempotencyKey, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *Repository) DecrementListing(ctx context.Context, id string, units int64) error {
	const q = `UPDATE fre_secondary_listings
		SET units_remaining = units_remaining - $2,
		    status = CASE WHEN units_remaining - $2 <= 0 THEN 'filled' ELSE status END,
		    updated_at = now()
		WHERE id=$1 AND units_remaining >= $2`
	ct, err := r.db.Exec(ctx, q, id, units)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrInsufficientUnits
	}
	return nil
}

func (r *Repository) SetListingStatus(ctx context.Context, id, status, reason string) error {
	const q = `UPDATE fre_secondary_listings SET status=$2, halted_reason=$3, updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, status, nullStr(reason))
	return err
}

func (r *Repository) InsertSecondaryOrder(ctx context.Context, o *SecondaryOrder) error {
	const q = `INSERT INTO fre_secondary_orders
		(listing_id, asset_id, buyer_id, seller_id, units, amount_kobo, fee_kobo, status, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`
	return r.db.QueryRow(ctx, q, o.ListingID, o.AssetID, o.BuyerID, o.SellerID, o.Units, o.AmountKobo, o.FeeKobo,
		o.Status, o.SettlementID, o.IdempotencyKey).Scan(&o.ID, &o.CreatedAt)
}

func (r *Repository) GetSecondaryOrderByKey(ctx context.Context, key string) (*SecondaryOrder, error) {
	const q = `SELECT id, listing_id, asset_id, buyer_id, seller_id, units, amount_kobo, fee_kobo, status, settlement_id, idempotency_key, created_at
		FROM fre_secondary_orders WHERE idempotency_key=$1`
	o := &SecondaryOrder{}
	err := r.db.QueryRow(ctx, q, key).Scan(&o.ID, &o.ListingID, &o.AssetID, &o.BuyerID, &o.SellerID, &o.Units,
		&o.AmountKobo, &o.FeeKobo, &o.Status, &o.SettlementID, &o.IdempotencyKey, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

func (r *Repository) SetOrderStatus(ctx context.Context, id, status string) error {
	const q = `UPDATE fre_secondary_orders SET status=$2, updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, status)
	return err
}

func (r *Repository) ListOrdersForUser(ctx context.Context, userID string, limit, offset int) ([]SecondaryOrder, error) {
	const q = `SELECT id, listing_id, asset_id, buyer_id, seller_id, units, amount_kobo, fee_kobo, status, settlement_id, idempotency_key, created_at
		FROM fre_secondary_orders WHERE buyer_id=$1 OR seller_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SecondaryOrder
	for rows.Next() {
		var o SecondaryOrder
		if err := rows.Scan(&o.ID, &o.ListingID, &o.AssetID, &o.BuyerID, &o.SellerID, &o.Units, &o.AmountKobo, &o.FeeKobo,
			&o.Status, &o.SettlementID, &o.IdempotencyKey, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *Repository) GetMarketControls(ctx context.Context) (*MarketControls, error) {
	const q = `SELECT trading_enabled, fee_bps, updated_by FROM fre_market_controls WHERE id=1`
	m := &MarketControls{}
	err := r.db.QueryRow(ctx, q).Scan(&m.TradingEnabled, &m.FeeBps, &m.UpdatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return &MarketControls{TradingEnabled: true, FeeBps: 100}, nil
	}
	return m, err
}

func (r *Repository) UpdateMarketControls(ctx context.Context, enabled bool, feeBps int, adminID string) error {
	const q = `UPDATE fre_market_controls SET trading_enabled=$1, fee_bps=$2, updated_by=$3, updated_at=now() WHERE id=1`
	_, err := r.db.Exec(ctx, q, enabled, feeBps, adminID)
	return err
}

// ── Watchlist / goals / auto-invest / documents ───────────────────────────────

func (r *Repository) AddWatch(ctx context.Context, userID, offeringID string) error {
	const q = `INSERT INTO fre_watchlist (user_id, offering_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`
	_, err := r.db.Exec(ctx, q, userID, offeringID)
	return err
}

func (r *Repository) RemoveWatch(ctx context.Context, userID, offeringID string) error {
	const q = `DELETE FROM fre_watchlist WHERE user_id=$1 AND offering_id=$2`
	_, err := r.db.Exec(ctx, q, userID, offeringID)
	return err
}

func (r *Repository) ListWatch(ctx context.Context, userID string) ([]Watchlist, error) {
	const q = `SELECT id, user_id, offering_id, created_at FROM fre_watchlist WHERE user_id=$1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Watchlist
	for rows.Next() {
		var w Watchlist
		if err := rows.Scan(&w.ID, &w.UserID, &w.OfferingID, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (r *Repository) CreateGoal(ctx context.Context, g *Goal) error {
	const q = `INSERT INTO fre_goals (user_id, name, target_kobo, target_date) VALUES ($1,$2,$3,$4)
		RETURNING id, saved_kobo, status, created_at`
	return r.db.QueryRow(ctx, q, g.UserID, g.Name, g.TargetKobo, g.TargetDate).
		Scan(&g.ID, &g.SavedKobo, &g.Status, &g.CreatedAt)
}

func (r *Repository) ListGoals(ctx context.Context, userID string) ([]Goal, error) {
	const q = `SELECT id, user_id, name, target_kobo, saved_kobo, target_date, status, created_at
		FROM fre_goals WHERE user_id=$1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Goal
	for rows.Next() {
		var g Goal
		if err := rows.Scan(&g.ID, &g.UserID, &g.Name, &g.TargetKobo, &g.SavedKobo, &g.TargetDate, &g.Status, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *Repository) CreateAutoInvest(ctx context.Context, a *AutoInvest) error {
	const q = `INSERT INTO fre_auto_invest (user_id, amount_kobo, cadence, asset_type, next_run_at) VALUES ($1,$2,$3,$4,$5)
		RETURNING id, status, created_at`
	return r.db.QueryRow(ctx, q, a.UserID, a.AmountKobo, a.Cadence, a.AssetType, a.NextRunAt).
		Scan(&a.ID, &a.Status, &a.CreatedAt)
}

func (r *Repository) ListAutoInvest(ctx context.Context, userID string) ([]AutoInvest, error) {
	const q = `SELECT id, user_id, amount_kobo, cadence, asset_type, status, next_run_at, last_run_at, last_error, created_at
		FROM fre_auto_invest WHERE user_id=$1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AutoInvest
	for rows.Next() {
		var a AutoInvest
		if err := rows.Scan(&a.ID, &a.UserID, &a.AmountKobo, &a.Cadence, &a.AssetType, &a.Status, &a.NextRunAt, &a.LastRunAt, &a.LastError, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) PauseAutoInvest(ctx context.Context, id, userID string) error {
	const q = `UPDATE fre_auto_invest SET status='paused', updated_at=now() WHERE id=$1 AND user_id=$2`
	_, err := r.db.Exec(ctx, q, id, userID)
	return err
}

// ListDueAutoInvest returns active plans whose next_run_at has arrived
// (the runner's work queue; ordered oldest-due first).
func (r *Repository) ListDueAutoInvest(ctx context.Context, now time.Time, limit int) ([]AutoInvest, error) {
	const q = `SELECT id, user_id, amount_kobo, cadence, asset_type, status, next_run_at, last_run_at, last_error, created_at
		FROM fre_auto_invest
		WHERE status='active' AND next_run_at IS NOT NULL AND next_run_at <= $1
		ORDER BY next_run_at LIMIT $2`
	rows, err := r.db.Query(ctx, q, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AutoInvest
	for rows.Next() {
		var a AutoInvest
		if err := rows.Scan(&a.ID, &a.UserID, &a.AmountKobo, &a.Cadence, &a.AssetType, &a.Status, &a.NextRunAt, &a.LastRunAt, &a.LastError, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CompleteAutoInvestRun advances a plan's schedule after a successful execution
// (and clears any previous failure state).
func (r *Repository) CompleteAutoInvestRun(ctx context.Context, id string, ranAt, nextRun time.Time) error {
	const q = `UPDATE fre_auto_invest SET last_run_at=$2, next_run_at=$3, last_error=NULL, updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, ranAt, nextRun)
	return err
}

// FailAutoInvest records a fail-closed execution failure: the plan flips to
// 'failed' with last_error and is skipped by the runner (never retried in a
// loop) until the investor re-creates or support intervenes.
func (r *Repository) FailAutoInvest(ctx context.Context, id, reason string) error {
	const q = `UPDATE fre_auto_invest SET status='failed', last_error=$2, last_run_at=now(), updated_at=now() WHERE id=$1`
	_, err := r.db.Exec(ctx, q, id, reason)
	return err
}

// FindOpenOfferingForAutoInvest picks the most recent open offering, optionally
// filtered by the plan's preferred asset type.
func (r *Repository) FindOpenOfferingForAutoInvest(ctx context.Context, assetType *string) (*Offering, error) {
	const q = `
		SELECT o.id FROM fre_offerings o
		JOIN fre_assets a ON a.id = o.asset_id
		WHERE o.status='open' AND ($1::text IS NULL OR a.asset_type=$1)
		ORDER BY o.created_at DESC LIMIT 1`
	var id string
	err := r.db.QueryRow(ctx, q, assetType).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return r.GetOffering(ctx, id)
}

// ── Escrow reconciliation (admin read) ────────────────────────────────────────

// ListReconciliation compares, per live offering, the raised_kobo projection
// against the recomputed sum of escrowed/allocated subscription amounts.
// Read-only; both figures are integer kobo.
func (r *Repository) ListReconciliation(ctx context.Context) ([]ReconciliationRow, error) {
	const q = `
		SELECT o.id, o.name, o.status, o.raised_kobo,
		       COALESCE(SUM(s.amount_kobo) FILTER (WHERE s.status IN ('escrowed','allocated')), 0) AS subscribed
		FROM fre_offerings o
		LEFT JOIN fre_subscriptions s ON s.offering_id = o.id
		WHERE o.status IN ('open','closing','funded')
		GROUP BY o.id, o.name, o.status, o.raised_kobo
		ORDER BY o.created_at DESC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReconciliationRow
	for rows.Next() {
		var rr ReconciliationRow
		if err := rows.Scan(&rr.OfferingID, &rr.Name, &rr.Status, &rr.RaisedKobo, &rr.SubscribedKobo); err != nil {
			return nil, err
		}
		rr.DeltaKobo, rr.Mismatch = reconcileDelta(rr.RaisedKobo, rr.SubscribedKobo)
		out = append(out, rr)
	}
	return out, rows.Err()
}

func (r *Repository) InsertDocument(ctx context.Context, d *Document) error {
	const q = `INSERT INTO fre_documents (asset_id, offering_id, user_id, doc_type, object_key, label, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`
	return r.db.QueryRow(ctx, q, d.AssetID, d.OfferingID, d.UserID, d.DocType, d.ObjectKey, d.Label, nil).
		Scan(&d.ID, &d.CreatedAt)
}

func (r *Repository) ListDocuments(ctx context.Context, userID string) ([]Document, error) {
	// Public/asset docs (user_id IS NULL) plus this user's investor-scoped docs.
	const q = `SELECT id, asset_id, offering_id, user_id, doc_type, object_key, label, created_at
		FROM fre_documents WHERE user_id IS NULL OR user_id=$1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Document
	for rows.Next() {
		var d Document
		if err := rows.Scan(&d.ID, &d.AssetID, &d.OfferingID, &d.UserID, &d.DocType, &d.ObjectKey, &d.Label, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ProjectAccountBalance projects a ledger account's balance in kobo from
// ledger_entries (CREDIT + REVERSAL_DEBIT positive; DEBIT + REVERSAL_CREDIT
// negative) — the same projection the ledger uses. Read-only; never a stored
// balance column.
func (r *Repository) ProjectAccountBalance(ctx context.Context, accountID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(
			CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
			     ELSE -amount_kobo END
		), 0)
		FROM ledger_entries
		WHERE account_id = $1`
	var bal int64
	err := r.db.QueryRow(ctx, q, accountID).Scan(&bal)
	return bal, err
}

func (r *Repository) GetCertificate(ctx context.Context, userID, investmentID string) (*Document, error) {
	// investmentID is a cap-table id; return the certificate doc for that holding.
	const q = `SELECT d.id, d.asset_id, d.offering_id, d.user_id, d.doc_type, d.object_key, d.label, d.created_at
		FROM fre_documents d
		JOIN fre_cap_table c ON c.asset_id = d.asset_id AND c.user_id = d.user_id
		WHERE c.id=$1 AND d.user_id=$2 AND d.doc_type='certificate'
		ORDER BY d.created_at DESC LIMIT 1`
	d := &Document{}
	err := r.db.QueryRow(ctx, q, investmentID, userID).Scan(&d.ID, &d.AssetID, &d.OfferingID, &d.UserID, &d.DocType, &d.ObjectKey, &d.Label, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}
