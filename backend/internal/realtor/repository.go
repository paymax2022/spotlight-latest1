package realtor

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is all pgx data access for the realtor admin control plane.
// All monetary amounts are BIGINT minor units (kobo) — never floats.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

var ErrNotFound = errors.New("realtor: not found")

// ── Overview ──────────────────────────────────────────────────────────────────

// Overview returns the headline counts/aggregates for the admin dashboard.
// Field names mirror the admin client's RealtorOverview type (camelCase).
func (r *Repository) Overview(ctx context.Context) (map[string]any, error) {
	scalarInt := func(q string) int64 {
		var n int64
		_ = r.db.QueryRow(ctx, q).Scan(&n)
		return n
	}
	scalarMoney := func(q string) int64 {
		var n int64
		_ = r.db.QueryRow(ctx, q).Scan(&n)
		return n
	}
	out := map[string]any{
		"listingsLive":        scalarInt(`SELECT COUNT(*) FROM realtor_listings WHERE status='published'`),
		"pendingModeration":   scalarInt(`SELECT COUNT(*) FROM realtor_listings WHERE status='pending_verification'`),
		"pendingVerification": scalarInt(`SELECT COUNT(*) FROM realtor_listings WHERE verification='unverified' AND status IN ('pending_verification','draft')`),
		"activeLeases":        scalarInt(`SELECT COUNT(*) FROM realtor_leases WHERE status='active'`),
		"escrowHeldKobo":      scalarMoney(`SELECT COALESCE(SUM(amount_kobo),0) FROM realtor_escrow_deposits WHERE status IN ('held','release_requested','disputed')`),
		"payoutsDueKobo":      scalarMoney(`SELECT COALESCE(SUM(amount_kobo),0) FROM realtor_escrow_deposits WHERE status='release_requested'`),
		"gmvKobo":             scalarMoney(`SELECT COALESCE(SUM(amount_kobo),0) FROM realtor_payments WHERE status='paid' AND created_at >= now() - interval '30 days'`),
		"openDisputes":        scalarInt(`SELECT COUNT(*) FROM realtor_escrow_deposits WHERE status='disputed'`),
		"fraudFlags":          scalarInt(`SELECT COUNT(*) FROM realtor_listings WHERE status='suspended'`),
	}
	return out, nil
}

// ── Listings moderation ───────────────────────────────────────────────────────

// AdminListing mirrors the admin client's AdminListing type.
type AdminListing struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Area          string   `json:"area"`
	City          string   `json:"city"`
	Mode          string   `json:"mode"`
	PriceKobo     int64    `json:"priceKobo"`
	Verification  string   `json:"verification"`
	OwnerName     string   `json:"ownerName"`
	OwnerVerified bool     `json:"ownerVerified"`
	RiskFlags     []string `json:"riskFlags"`
	SubmittedAt   string   `json:"submittedAt"`
}

// PendingListings returns listings awaiting moderation (status pending_verification).
func (r *Repository) PendingListings(ctx context.Context, limit, offset int) ([]AdminListing, error) {
	const q = `
		SELECT l.id, l.title, COALESCE(p.area,''), COALESCE(p.city,''), l.mode, l.price_kobo,
		       l.verification, COALESCE(pf.name,''),
		       (l.verification IN ('document_backed','inspected','verified')) AS owner_verified,
		       l.created_at
		FROM realtor_listings l
		LEFT JOIN realtor_units u      ON u.id = l.unit_id
		LEFT JOIN realtor_properties p ON p.id = u.property_id
		LEFT JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
		WHERE l.status = 'pending_verification'
		ORDER BY l.created_at ASC
		LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminListing{}
	for rows.Next() {
		var a AdminListing
		var submitted time.Time
		if err := rows.Scan(&a.ID, &a.Title, &a.Area, &a.City, &a.Mode, &a.PriceKobo,
			&a.Verification, &a.OwnerName, &a.OwnerVerified, &submitted); err != nil {
			return nil, err
		}
		a.SubmittedAt = submitted.UTC().Format(time.RFC3339)
		a.RiskFlags = []string{}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetListingStatus returns the current status of a listing (existence check).
func (r *Repository) GetListingStatus(ctx context.Context, id string) (string, string, error) {
	var status, verification string
	err := r.db.QueryRow(ctx,
		`SELECT status, verification FROM realtor_listings WHERE id=$1`, id).
		Scan(&status, &verification)
	if err == pgx.ErrNoRows {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	return status, verification, nil
}

// DecideListing applies an admin moderation decision to a listing.
// approve  → status=published.
// reject   → status=suspended.
// changes_requested → status=draft (sent back to owner).
// The status transition is additive (UPDATE of a moderation column only — never a
// ledger/money column) and is audited by the caller.
func (r *Repository) DecideListing(ctx context.Context, id, decision string) (string, error) {
	var newStatus, newVerification string
	switch decision {
	case "approved":
		newStatus, newVerification = "published", "document_backed"
	case "rejected":
		newStatus, newVerification = "suspended", "unverified"
	case "changes_requested":
		newStatus, newVerification = "draft", "unverified"
	default:
		return "", errors.New("realtor: invalid decision")
	}
	// Additive moderation transition: updates only the listing status/verification
	// columns (never a money/ledger column). The decision is audited by the caller.
	ct, err := r.db.Exec(ctx,
		`UPDATE realtor_listings SET status=$2, verification=$3, updated_at=now() WHERE id=$1`,
		id, newStatus, newVerification)
	if err != nil {
		return "", err
	}
	if ct.RowsAffected() == 0 {
		return "", ErrNotFound
	}
	return newStatus, nil
}

// ── Verifications ─────────────────────────────────────────────────────────────

// VerificationRequest mirrors the admin client's VerificationRequest type.
type VerificationRequest struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	SubjectName string     `json:"subjectName"`
	Documents   []VerifDoc `json:"documents"`
	Status      string     `json:"status"`
	SubmittedAt string     `json:"submittedAt"`
	RiskNote    string     `json:"riskNote,omitempty"`
}

type VerifDoc struct {
	Label    string `json:"label"`
	Uploaded bool   `json:"uploaded"`
}

// PendingVerifications derives the property-verification queue from listings that
// are pending verification (there is no separate verifications table; the listing
// `verification` column is the source of truth). Documents are surfaced from the
// listing media/fees metadata where present.
func (r *Repository) PendingVerifications(ctx context.Context, limit, offset int) ([]VerificationRequest, error) {
	const q = `
		SELECT l.id, l.title, l.verification, l.created_at,
		       COALESCE(jsonb_array_length(l.media),0) AS media_count
		FROM realtor_listings l
		WHERE l.verification = 'unverified'
		  AND l.status IN ('pending_verification','draft','published')
		ORDER BY l.created_at ASC
		LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VerificationRequest{}
	for rows.Next() {
		var id, title, verification string
		var submitted time.Time
		var mediaCount int
		if err := rows.Scan(&id, &title, &verification, &submitted, &mediaCount); err != nil {
			return nil, err
		}
		out = append(out, VerificationRequest{
			ID:          id,
			Kind:        "property",
			SubjectName: title,
			Status:      "pending",
			SubmittedAt: submitted.UTC().Format(time.RFC3339),
			Documents: []VerifDoc{
				{Label: "Ownership document", Uploaded: mediaCount > 0},
				{Label: "Listing media", Uploaded: mediaCount > 0},
			},
		})
	}
	return out, rows.Err()
}

// DecideVerification applies a verification decision against the underlying listing.
// approved → verification=verified. rejected → verification=unverified (and the
// listing is suspended). more_info → left pending (no state change recorded here).
func (r *Repository) DecideVerification(ctx context.Context, id, status string) error {
	switch status {
	case "approved":
		ct, err := r.db.Exec(ctx,
			`UPDATE realtor_listings SET verification='verified', updated_at=now() WHERE id=$1`, id)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	case "rejected":
		ct, err := r.db.Exec(ctx,
			`UPDATE realtor_listings SET verification='unverified', status='suspended', updated_at=now() WHERE id=$1`, id)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	case "more_info":
		// No mutation — the request stays in the queue. Existence check only.
		if _, _, err := r.GetListingStatus(ctx, id); err != nil {
			return err
		}
		return nil
	default:
		return errors.New("realtor: invalid verification status")
	}
}

// ── Payments ──────────────────────────────────────────────────────────────────

// AdminPayment mirrors the admin client's AdminPayment type.
type AdminPayment struct {
	ID             string `json:"id"`
	Reference      string `json:"reference"`
	Kind           string `json:"kind"`
	AmountKobo     int64  `json:"amountKobo"`
	EscrowHeldKobo int64  `json:"escrowHeldKobo"`
	Status         string `json:"status"`
	Payer          string `json:"payer"`
	CreatedAt      string `json:"createdAt"`
}

// Payments lists realtor payments for the admin payments view (read-only).
func (r *Repository) Payments(ctx context.Context, limit, offset int) ([]AdminPayment, error) {
	const q = `
		SELECT pay.id, pay.reference, pay.amount_kobo, pay.escrow_held_kobo, pay.status,
		       pay.created_at
		FROM realtor_payments pay
		ORDER BY pay.created_at DESC
		LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminPayment{}
	for rows.Next() {
		var p AdminPayment
		var created time.Time
		var dbStatus string
		if err := rows.Scan(&p.ID, &p.Reference, &p.AmountKobo, &p.EscrowHeldKobo, &dbStatus, &created); err != nil {
			return nil, err
		}
		p.Status = mapPaymentStatus(dbStatus)
		p.Kind = "rent"
		p.Payer = ""
		p.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, p)
	}
	return out, rows.Err()
}

// mapPaymentStatus maps the DB payment status to the admin client's PaymentStatus.
func mapPaymentStatus(s string) string {
	switch s {
	case "paid":
		return "paid"
	case "processing":
		return "processing"
	case "failed":
		return "failed"
	default:
		return s
	}
}

// ── Escrow ────────────────────────────────────────────────────────────────────

// EscrowAccount mirrors the admin client's EscrowAccount type.
type EscrowAccount struct {
	ID             string `json:"id"`
	LeaseOrBooking string `json:"leaseOrBooking"`
	AmountKobo     int64  `json:"amountKobo"`
	Status         string `json:"status"`
	HeldSince      string `json:"heldSince"`
}

// Escrow lists escrow deposits for the admin escrow view (read-only).
func (r *Repository) Escrow(ctx context.Context, limit, offset int) ([]EscrowAccount, error) {
	const q = `
		SELECT e.id, e.amount_kobo, e.status, e.held_since,
		       COALESCE(p.name,'') AS property_name, COALESCE(u.label,'') AS unit_label
		FROM realtor_escrow_deposits e
		LEFT JOIN realtor_leases l     ON l.id = e.lease_id
		LEFT JOIN realtor_listings li  ON li.id = l.listing_id
		LEFT JOIN realtor_units u      ON u.id = li.unit_id
		LEFT JOIN realtor_properties p ON p.id = u.property_id
		ORDER BY e.held_since DESC
		LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EscrowAccount{}
	for rows.Next() {
		var e EscrowAccount
		var held time.Time
		var propertyName, unitLabel string
		if err := rows.Scan(&e.ID, &e.AmountKobo, &e.Status, &held, &propertyName, &unitLabel); err != nil {
			return nil, err
		}
		label := "Lease"
		if propertyName != "" || unitLabel != "" {
			label = "Lease · " + propertyName
			if unitLabel != "" {
				label += " " + unitLabel
			}
		}
		e.LeaseOrBooking = label
		e.HeldSince = held.UTC().Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ── Audit log ─────────────────────────────────────────────────────────────────

// InsertAudit appends an immutable admin-audit row (mirrors invest_admin_audit_log).
func (r *Repository) InsertAudit(ctx context.Context, adminID, action, entityType, entityID, reason string, oldVal, newVal any) error {
	ob, _ := json.Marshal(oldVal)
	nb, _ := json.Marshal(newVal)
	const q = `INSERT INTO realtor_admin_audit_log (admin_id, action, entity_type, entity_id, old_value, new_value, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := r.db.Exec(ctx, q, adminID, action, entityType, nullStr(entityID), ob, nb, nullStr(reason))
	return err
}

// ── helpers ───────────────────────────────────────────────────────────────────

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
