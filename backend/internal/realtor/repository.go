package realtor

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Repository is all pgx data access for the realtor admin control plane.
// All monetary amounts are BIGINT minor units (kobo) — never floats.
type Repository struct {
	db  *pgxpool.Pool
	led *ledger.Service // nil-safe: only required by money-moving methods (ResolveEscrow)
}

func NewRepository(db *pgxpool.Pool, led *ledger.Service) *Repository {
	return &Repository{db: db, led: led}
}

var ErrNotFound = errors.New("realtor: not found")

// PROPMGMT-002 sentinel errors for the inspection-gated escrow resolve flow.
var (
	ErrInvalidEscrowDecision = errors.New("realtor: decision must be one of released_to_tenant, forfeited_to_landlord, disputed")
	ErrEscrowAlreadyResolved = errors.New("realtor: escrow deposit already released")
	ErrMoveOutRequired       = errors.New("realtor: move-out inspection has not been submitted for this lease")
	ErrLedgerNotConfigured   = errors.New("realtor: ledger service not configured")
)

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

// ── Escrow resolution (PROPMGMT-002: inspection-gated release) ─────────────────

// EscrowResolution mirrors the admin client's response shape for a resolved
// (or disputed) escrow deposit.
type EscrowResolution struct {
	ID             string `json:"id"`
	LeaseID        string `json:"leaseId"`
	AmountKobo     int64  `json:"amountKobo"`
	Status         string `json:"status"`
	ResolvedTo     string `json:"resolvedTo,omitempty"`
	ResolutionNote string `json:"resolutionNote,omitempty"`
}

func isValidEscrowDecision(d string) bool {
	switch d {
	case "released_to_tenant", "forfeited_to_landlord", "disputed":
		return true
	}
	return false
}

// ResolveEscrow applies an admin decision to a refundable lease deposit held in
// the shared 'settlement' standing account (ADR-040 pattern — deposits are NOT
// held in a dedicated per-deposit account; realtor_escrow_deposits is the
// bookkeeping record of what is earmarked). Money mutation Iron Rules:
//   - idempotency: PostReversal/PostJournal are called with a deterministic key
//     derived from the deposit id, so a retried admin call is a safe no-op
//     (ledger.ErrDuplicate).
//   - balanced double-entry: PostReversal / PostJournal always post a balanced
//     pair; no balance column is ever written directly.
//   - fail-closed inspection gate: released_to_tenant / forfeited_to_landlord
//     REQUIRE a realtor_move_outs row with submitted_at set — this is the whole
//     point of "inspection-gated release" (PROPMGMT-002). 'disputed' does not
//     require a move-out submission (an admin may flag a dispute proactively)
//     and leaves the deposit resolvable again later (only status='released' is
//     a terminal state — see the guard below).
//   - audit: every branch writes an immutable realtor_admin_audit_log row.
func (r *Repository) ResolveEscrow(ctx context.Context, id, decision, note, adminID string) (*EscrowResolution, error) {
	if !isValidEscrowDecision(decision) {
		return nil, ErrInvalidEscrowDecision
	}
	if r.led == nil {
		return nil, ErrLedgerNotConfigured
	}

	// Load current state + trace lease -> listing -> unit -> property -> portfolio
	// to resolve the landlord/owner id, mirroring the exact join chain used by
	// the realtor_owner_dashboard RPC (20260620020000_realtor_backend_rpcs.sql).
	var leaseID, tenantID, ownerID, status string
	var amountKobo int64
	err := r.db.QueryRow(ctx, `
		SELECT e.lease_id, e.amount_kobo, e.status, l.tenant_id, pf.owner_id
		FROM realtor_escrow_deposits e
		JOIN realtor_leases l      ON l.id = e.lease_id
		JOIN realtor_listings li   ON li.id = l.listing_id
		JOIN realtor_units u       ON u.id = li.unit_id
		JOIN realtor_properties p  ON p.id = u.property_id
		JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
		WHERE e.id = $1`, id).
		Scan(&leaseID, &amountKobo, &status, &tenantID, &ownerID)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	// A released deposit is terminal — never resolve it a second time (the
	// double-payout guard). A disputed deposit is NOT terminal: it can still be
	// resolved to a final released_to_tenant/forfeited_to_landlord decision.
	if status == "released" {
		return nil, ErrEscrowAlreadyResolved
	}

	beforeState := map[string]any{"status": status}

	if decision == "released_to_tenant" || decision == "forfeited_to_landlord" {
		var submittedAt *time.Time
		moveErr := r.db.QueryRow(ctx, `SELECT submitted_at FROM realtor_move_outs WHERE lease_id = $1`, leaseID).Scan(&submittedAt)
		if moveErr != nil && moveErr != pgx.ErrNoRows {
			return nil, moveErr
		}
		if moveErr == pgx.ErrNoRows || submittedAt == nil {
			return nil, ErrMoveOutRequired
		}
	}

	var resolvedTo string
	switch decision {
	case "released_to_tenant":
		tenantAcc, err := r.led.GetOrCreateUserWallet(ctx, tenantID)
		if err != nil {
			return nil, err
		}
		settlementAcc, err := r.led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
		if err != nil {
			return nil, err
		}
		err = r.led.PostReversal(ctx, tenantAcc.ID, settlementAcc.ID, amountKobo,
			"realtor:escrow:release:"+id, "realtor-escrow-release-"+id)
		if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return nil, err
		}
		resolvedTo = "tenant"

	case "forfeited_to_landlord":
		landlordAcc, err := r.led.GetOrCreateUserWallet(ctx, ownerID)
		if err != nil {
			return nil, err
		}
		settlementAcc, err := r.led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
		if err != nil {
			return nil, err
		}
		err = r.led.PostJournal(ctx, ledger.JournalEntry{
			Reference:       "realtor:escrow:forfeit:" + id,
			IdempotencyKey:  "realtor-escrow-forfeit-" + id,
			AmountKobo:      amountKobo,
			DebitAccountID:  settlementAcc.ID,
			CreditAccountID: landlordAcc.ID,
			Description:     "Realtor escrow deposit forfeited to landlord",
		})
		if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return nil, err
		}
		resolvedTo = "landlord"

	case "disputed":
		// No ledger call — recording a dispute does not move money.
	}

	newStatus := "disputed"
	var ct pgconn.CommandTag
	if decision == "disputed" {
		res, err := r.db.Exec(ctx,
			`UPDATE realtor_escrow_deposits SET status='disputed', resolution_note=$2, resolved_by=$3 WHERE id=$1`,
			id, nullStr(note), adminID)
		if err != nil {
			return nil, err
		}
		ct = res
	} else {
		newStatus = "released"
		res, err := r.db.Exec(ctx,
			`UPDATE realtor_escrow_deposits SET status='released', released_at=NOW(), resolved_to=$2, resolution_note=$3, resolved_by=$4 WHERE id=$1`,
			id, resolvedTo, nullStr(note), adminID)
		if err != nil {
			return nil, err
		}
		ct = res
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}

	out := &EscrowResolution{ID: id, LeaseID: leaseID, AmountKobo: amountKobo, Status: newStatus, ResolvedTo: resolvedTo, ResolutionNote: note}
	_ = r.InsertAudit(ctx, adminID, "escrow.resolve", "escrow_deposit", id, note,
		beforeState,
		map[string]any{"decision": decision, "status": newStatus, "resolvedTo": resolvedTo})
	return out, nil
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
