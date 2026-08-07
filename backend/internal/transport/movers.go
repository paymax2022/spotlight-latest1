package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ─── Movers (bidding + escrow) ───────────────────────────────────────────────
//
// State machine:
//   quote_requested → bids_received → bid_accepted(escrow funded)
//                  → crew_assigned → in_progress → completion_confirmed(escrow released)
//   (disputed / cancelled)
//
// Flow: customer posts a quote (no escrow). Approved providers submit bids.
// Customer accepts a bid → escrow funds that bid amount → bid_accepted, escrow funded.
// Provider starts → in_progress. Customer confirms completion → settle provider.

var moverTransitions = map[string]map[string]bool{
	"quote_requested": {"bids_received": true, "bid_accepted": true, "cancelled": true},
	"bids_received":   {"bid_accepted": true, "cancelled": true},
	"bid_accepted":    {"crew_assigned": true, "in_progress": true, "cancelled": true, "disputed": true},
	"crew_assigned":   {"in_progress": true, "cancelled": true, "disputed": true},
	"in_progress":     {"completion_confirmed": true, "disputed": true},
}

func canTransitionMover(from, to string) bool {
	if from == to {
		return false
	}
	m, ok := moverTransitions[from]
	if !ok {
		return false
	}
	return m[to]
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// MoverQuoteRequest is POST /mobility/movers/quote.
type MoverQuoteRequest struct {
	Pickup       Place           `json:"pickup" binding:"required"`
	Dropoff      Place           `json:"dropoff" binding:"required"`
	PropertyType string          `json:"property_type"`
	TruckSize    string          `json:"truck_size"`
	Helpers      int             `json:"helpers"`
	Fragile      bool            `json:"fragile"`
	Inventory    json.RawMessage `json:"inventory"`
	MoveAt       string          `json:"move_at"` // RFC3339
}

// MoverBidRequest is POST /driver/movers/:id/bid.
type MoverBidRequest struct {
	AmountKobo int64  `json:"amount_kobo" binding:"required,min=1"`
	Note       string `json:"note"`
}

// MoverAcceptBidRequest is POST /mobility/movers/:id/accept-bid.
type MoverAcceptBidRequest struct {
	BidID          string `json:"bid_id" binding:"required"`
	IdempotencyKey string `json:"idempotency_key"`
}

// moverRow is the internal projection of a mover job.
type moverRow struct {
	ID            string
	UserID        string
	ProviderID    *string
	Status        string
	EscrowStatus  string
	AcceptedBidID *string
	QuoteAmount   *int64
	SettlementID  *string
}

func (s *Service) loadMover(ctx context.Context, id string, m *moverRow) error {
	const q = `SELECT id, user_id, provider_id, status, escrow_status, accepted_bid_id, quote_amount_kobo, settlement_id
	           FROM mover_jobs WHERE id=$1`
	return s.db.QueryRow(ctx, q, id).Scan(
		&m.ID, &m.UserID, &m.ProviderID, &m.Status, &m.EscrowStatus,
		&m.AcceptedBidID, &m.QuoteAmount, &m.SettlementID,
	)
}

// ─── Customer flows ──────────────────────────────────────────────────────────

// RequestMoverQuote creates a mover job in quote_requested (no escrow yet).
func (s *Service) RequestMoverQuote(ctx context.Context, userID string, req MoverQuoteRequest) (map[string]any, error) {
	truckSize := req.TruckSize
	if truckSize == "" {
		truckSize = "medium"
	}
	var moveAt *time.Time
	if req.MoveAt != "" {
		if t, err := time.Parse(time.RFC3339, req.MoveAt); err == nil {
			moveAt = &t
		}
	}
	var inventory []byte
	if len(req.Inventory) > 0 {
		inventory = []byte(req.Inventory)
	}
	jobID := uuid.New().String()
	const q = `
		INSERT INTO mover_jobs
			(id, user_id, pickup_address, dropoff_address, property_type, inventory, truck_size, helpers, fragile, move_at, status, escrow_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'quote_requested','none')`
	if _, err := s.db.Exec(ctx, q,
		jobID, userID, req.Pickup.Address, req.Dropoff.Address, nullStr(req.PropertyType),
		inventory, truckSize, req.Helpers, req.Fragile, moveAt,
	); err != nil {
		return nil, fmt.Errorf("transport: insert mover job: %w", err)
	}
	s.recordModeEvent(ctx, userID, "mover.quote_requested", "mover_job", jobID, "", "quote_requested",
		map[string]any{"truck_size": truckSize, "helpers": req.Helpers})
	return s.MoverDetail(ctx, jobID, userID)
}

// MoverDetail returns a job + its bids (object-level authz: owner or bidding provider).
func (s *Service) MoverDetail(ctx context.Context, id, callerID string) (map[string]any, error) {
	const q = `
		SELECT id, user_id, provider_id, pickup_address, dropoff_address, property_type, truck_size,
		       helpers, fragile, move_at, accepted_bid_id, quote_amount_kobo, status, escrow_status, created_at
		FROM mover_jobs WHERE id=$1`
	var (
		jid, uid, pickup, dropoff, truckSize, status, escrowStatus string
		providerID, propType, acceptedBid                          *string
		helpers                                                    int
		fragile                                                    bool
		moveAt                                                     *time.Time
		quoteAmount                                                *int64
		createdAt                                                  time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&jid, &uid, &providerID, &pickup, &dropoff, &propType, &truckSize,
		&helpers, &fragile, &moveAt, &acceptedBid, &quoteAmount, &status, &escrowStatus, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	// Object-level authz: owner, OR a provider who has bid on the job.
	isOwner := callerID == uid
	if !isOwner {
		var cnt int
		s.db.QueryRow(ctx, `
			SELECT COUNT(*) FROM mover_bids b JOIN drivers d ON d.id = b.provider_id
			WHERE b.job_id=$1 AND d.user_id=$2`, id, callerID).Scan(&cnt)
		if cnt == 0 {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	bids, err := s.listMoverBids(ctx, id)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": jid, "userId": uid, "providerId": providerID,
		"pickupAddress": pickup, "dropoffAddress": dropoff, "propertyType": propType,
		"truckSize": truckSize, "helpers": helpers, "fragile": fragile, "moveAt": moveAt,
		"acceptedBidId": acceptedBid, "quoteAmountKobo": quoteAmount,
		"status": status, "escrowStatus": escrowStatus, "createdAt": createdAt, "bids": bids,
	}, nil
}

func (s *Service) listMoverBids(ctx context.Context, jobID string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, `
		SELECT b.id, b.provider_id, b.amount_kobo, b.note, b.status, b.created_at, d.name, d.rating
		FROM mover_bids b JOIN drivers d ON d.id = b.provider_id
		WHERE b.job_id=$1 ORDER BY b.amount_kobo ASC`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, providerID, status, name string
		var note *string
		var amount int64
		var rating float64
		var createdAt time.Time
		if err := rows.Scan(&id, &providerID, &amount, &note, &status, &createdAt, &name, &rating); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "providerId": providerID, "amountKobo": amount, "note": note,
			"status": status, "createdAt": createdAt, "providerName": name, "providerRating": rating,
		})
	}
	return out, nil
}

// AcceptMoverBid funds escrow for the chosen bid → bid_accepted, escrow funded.
func (s *Service) AcceptMoverBid(ctx context.Context, jobID, userID, bidID, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	var m moverRow
	if err := s.loadMover(ctx, jobID, &m); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	if m.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your job")
	}
	if m.Status != "quote_requested" && m.Status != "bids_received" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "job not open for bid acceptance")
	}
	if m.EscrowStatus != "none" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "job already funded")
	}
	// Load the chosen bid and its provider.
	var providerID string
	var amount int64
	var bidStatus string
	if err := s.db.QueryRow(ctx,
		`SELECT provider_id, amount_kobo, status FROM mover_bids WHERE id=$1 AND job_id=$2`, bidID, jobID).
		Scan(&providerID, &amount, &bidStatus); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "bid not found")
	}
	if bidStatus != "submitted" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "bid not available")
	}

	// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same contract
	// as RequestRide): a Tier0/over-limit customer cannot fund the bid.
	if err := s.enforceTierLimit(ctx, userID, amount); err != nil {
		return nil, err
	}

	ref := "mover:" + jobID
	sett, err := s.settlement.Escrow(ctx, userID, ref, idempotencyKey, "transport", amount)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow mover bid: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
		UPDATE mover_jobs SET provider_id=$1, accepted_bid_id=$2, quote_amount_kobo=$3,
			status='bid_accepted', escrow_status='funded', settlement_id=$4, updated_at=NOW()
		WHERE id=$5 AND escrow_status='none' AND status IN ('quote_requested','bids_received')`,
		providerID, bidID, amount, sett.ID, jobID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "job changed concurrently")
	}
	if _, err := tx.Exec(ctx, `UPDATE mover_bids SET status='accepted' WHERE id=$1`, bidID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE mover_bids SET status='rejected' WHERE job_id=$1 AND id<>$2 AND status='submitted'`, jobID, bidID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, providerID)
	s.recordModeEvent(ctx, userID, "mover.bid_accepted", "mover_job", jobID, m.Status, "bid_accepted",
		map[string]any{"bid_id": bidID, "amount_kobo": amount, "provider_id": providerID, "settlement_id": sett.ID})
	return s.MoverDetail(ctx, jobID, userID)
}

// ConfirmMoverCompletion releases escrow → settle provider (in_progress → confirmed).
func (s *Service) ConfirmMoverCompletion(ctx context.Context, jobID, userID string) error {
	var m moverRow
	if err := s.loadMover(ctx, jobID, &m); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	if m.UserID != userID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your job")
	}
	if m.Status != "in_progress" {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not in progress")
	}
	if m.EscrowStatus != "funded" {
		return codedErr(http.StatusConflict, CodeInvalidState, "escrow not funded")
	}
	if err := s.moverSetStatus(ctx, jobID, "in_progress", "completion_confirmed"); err != nil {
		return err
	}
	if m.SettlementID != nil && m.ProviderID != nil {
		if err := s.settleModeProvider(ctx, *m.SettlementID, *m.ProviderID); err != nil {
			return fmt.Errorf("transport: settle mover: %w", err)
		}
	}
	s.db.Exec(ctx, `UPDATE mover_jobs SET escrow_status='released', updated_at=NOW() WHERE id=$1`, jobID)
	if m.ProviderID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *m.ProviderID)
	}
	s.recordModeEvent(ctx, userID, "mover.completion_confirmed", "mover_job", jobID, "in_progress", "completion_confirmed", nil)
	return nil
}

// CancelMover refunds funded escrow + cancels (owner only).
func (s *Service) CancelMover(ctx context.Context, jobID, userID, reason string) error {
	var m moverRow
	if err := s.loadMover(ctx, jobID, &m); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	if m.UserID != userID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your job")
	}
	if !canTransitionMover(m.Status, "cancelled") {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot cancel from status %s", m.Status))
	}
	if err := s.moverSetStatus(ctx, jobID, m.Status, "cancelled"); err != nil {
		return err
	}
	if m.EscrowStatus == "funded" && m.SettlementID != nil {
		s.settlement.Refund(ctx, *m.SettlementID, "mover_cancelled:"+reason)
		s.db.Exec(ctx, `UPDATE mover_jobs SET escrow_status='refunded', updated_at=NOW() WHERE id=$1`, jobID)
	}
	if m.ProviderID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *m.ProviderID)
	}
	s.recordModeEvent(ctx, userID, "mover.cancelled", "mover_job", jobID, m.Status, "cancelled", map[string]any{"reason": reason})
	return nil
}

// moverSetStatus performs a guarded status update.
func (s *Service) moverSetStatus(ctx context.Context, id, from, to string) error {
	if !canTransitionMover(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("illegal mover transition %s → %s", from, to))
	}
	tag, err := s.db.Exec(ctx, `UPDATE mover_jobs SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "mover status changed concurrently")
	}
	return nil
}

// ListMoverJobs returns the caller's own mover jobs (customer history/active
// list), newest first. Object-level authZ: scoped to user_id (the caller can
// never see another customer's jobs via this endpoint — distinct from
// OpenMoverJobs below, which is the provider-facing open-bidding feed).
func (s *Service) ListMoverJobs(ctx context.Context, userID string) ([]map[string]any, error) {
	const q = `
		SELECT id, provider_id, pickup_address, dropoff_address, property_type, truck_size,
		       helpers, fragile, move_at, accepted_bid_id, quote_amount_kobo, status, escrow_status, created_at
		FROM mover_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, pickup, dropoff, truckSize, status, escrowStatus string
		var providerID, propType, acceptedBid *string
		var helpers int
		var fragile bool
		var moveAt *time.Time
		var quoteAmount *int64
		var createdAt time.Time
		if err := rows.Scan(&id, &providerID, &pickup, &dropoff, &propType, &truckSize,
			&helpers, &fragile, &moveAt, &acceptedBid, &quoteAmount, &status, &escrowStatus, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "providerId": providerID, "pickupAddress": pickup, "dropoffAddress": dropoff,
			"propertyType": propType, "truckSize": truckSize, "helpers": helpers, "fragile": fragile,
			"moveAt": moveAt, "acceptedBidId": acceptedBid, "quoteAmountKobo": quoteAmount,
			"status": status, "escrowStatus": escrowStatus, "createdAt": createdAt,
		})
	}
	return out, rows.Err()
}

// ─── Provider (driver) flows ─────────────────────────────────────────────────

// OpenMoverJobs returns jobs open for bidding (quote_requested / bids_received).
func (s *Service) OpenMoverJobs(ctx context.Context, driverUserID string) ([]map[string]any, error) {
	if _, err := s.driverGate(ctx, driverUserID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, pickup_address, dropoff_address, property_type, truck_size, helpers, fragile, move_at, status, created_at
		FROM mover_jobs WHERE status IN ('quote_requested','bids_received') ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, pickup, dropoff, truckSize, status string
		var propType *string
		var helpers int
		var fragile bool
		var moveAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(&id, &pickup, &dropoff, &propType, &truckSize, &helpers, &fragile, &moveAt, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "pickupAddress": pickup, "dropoffAddress": dropoff, "propertyType": propType,
			"truckSize": truckSize, "helpers": helpers, "fragile": fragile, "moveAt": moveAt,
			"status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// SubmitMoverBid records an approved provider's bid (one per provider per job).
func (s *Service) SubmitMoverBid(ctx context.Context, jobID, driverUserID string, amount int64, note string) (map[string]any, error) {
	providerID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var m moverRow
	if err := s.loadMover(ctx, jobID, &m); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	if m.Status != "quote_requested" && m.Status != "bids_received" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "job not open for bids")
	}
	bidID := uuid.New().String()
	if _, err := s.db.Exec(ctx,
		`INSERT INTO mover_bids (id, job_id, provider_id, amount_kobo, note, status) VALUES ($1,$2,$3,$4,$5,'submitted')`,
		bidID, jobID, providerID, amount, nullStr(note)); err != nil {
		return nil, codedErr(http.StatusConflict, "BID_EXISTS", "you have already bid on this job")
	}
	// First bid moves the job to bids_received.
	if m.Status == "quote_requested" {
		s.db.Exec(ctx, `UPDATE mover_jobs SET status='bids_received', updated_at=NOW() WHERE id=$1 AND status='quote_requested'`, jobID)
	}
	s.recordModeEvent(ctx, driverUserID, "mover.bid_submitted", "mover_job", jobID, m.Status, "bids_received",
		map[string]any{"bid_id": bidID, "amount_kobo": amount})
	return map[string]any{"id": bidID, "jobId": jobID, "amountKobo": amount, "status": "submitted"}, nil
}

// StartMoverJob: bid_accepted/crew_assigned → in_progress (assigned provider only).
func (s *Service) StartMoverJob(ctx context.Context, jobID, driverUserID string) error {
	m, err := s.providerOwnedMover(ctx, jobID, driverUserID)
	if err != nil {
		return err
	}
	if m.Status != "bid_accepted" && m.Status != "crew_assigned" {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not ready to start")
	}
	if err := s.moverSetStatus(ctx, jobID, m.Status, "in_progress"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, "mover.in_progress", "mover_job", jobID, m.Status, "in_progress", nil)
	return nil
}

// CompleteMoverJob: provider signals work done (in_progress, awaits customer confirm).
// The escrow is released by the customer's confirm-completion, not here.
func (s *Service) CompleteMoverJob(ctx context.Context, jobID, driverUserID string) error {
	m, err := s.providerOwnedMover(ctx, jobID, driverUserID)
	if err != nil {
		return err
	}
	if m.Status != "in_progress" {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not in progress")
	}
	// Provider-side completion is recorded; payout waits for customer confirmation.
	s.recordModeEvent(ctx, driverUserID, "mover.provider_completed", "mover_job", jobID, "in_progress", "in_progress",
		map[string]any{"awaiting": "customer_confirmation"})
	return nil
}

// providerOwnedMover loads a job and asserts the caller is the assigned provider.
func (s *Service) providerOwnedMover(ctx context.Context, jobID, driverUserID string) (*moverRow, error) {
	providerID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var m moverRow
	if err := s.loadMover(ctx, jobID, &m); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	if m.ProviderID == nil || *m.ProviderID != providerID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the assigned provider")
	}
	return &m, nil
}
