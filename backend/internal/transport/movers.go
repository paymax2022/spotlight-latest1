package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/fsm"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/settlement"
)

// State machine:
//   quote_requested → bids_received → bid_accepted(escrow funded)
//                  → crew_assigned → in_progress → completion_confirmed(escrow released)
// Flow: customer posts a quote (no escrow). Approved providers submit bids.
// Customer accepts a bid → escrow funds that bid amount → bid_accepted, escrow funded.
// Provider starts → in_progress. Customer confirms completion → settle provider.

var moverTransitions = fsm.Table[string]{
	"quote_requested": {"bids_received": true, "bid_accepted": true, "cancelled": true},
	"bids_received":   {"bid_accepted": true, "cancelled": true},
	"bid_accepted":    {"crew_assigned": true, "in_progress": true, "cancelled": true, "disputed": true},
	"crew_assigned":   {"in_progress": true, "cancelled": true, "disputed": true},
	"in_progress":     {"completion_confirmed": true, "disputed": true},
}

func canTransitionMover(from, to string) bool {
	return moverTransitions.Can(from, to)
}

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
		jobID, userID, req.Pickup.Address, req.Dropoff.Address, dbutil.NullStr(req.PropertyType),
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
		_ = s.db.QueryRow(ctx, `
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

// MoverAcceptRequest identifies the (job, bid) a card-direct acceptance is for.
// It carries NO amount: the charge is the accepted bid read server-side.
type MoverAcceptRequest struct {
	JobID string `json:"job_id"`
	BidID string `json:"bid_id"`
}

// moverFrozenAcceptance is the priced input set frozen at card-direct initiate
// (transport_paystack_intents.pricing_json) and handed back to the booking.
// There is no pricing config to snapshot — the "price" IS the bid — so the
// frozen identity of the bid is what Book must re-find unchanged: same bid,
// same provider, same amount.
type moverFrozenAcceptance struct {
	JobID      string `json:"jobId"`
	BidID      string `json:"bidId"`
	ProviderID string `json:"providerId"`
	AmountKobo int64  `json:"amountKobo"`
}

// moverAcceptance is the server-read state of one (job, bid) pair that the
// customer is allowed to accept right now.
type moverAcceptance struct {
	job        moverRow
	providerID string
	amount     int64
}

// loadMoverAcceptance reads the job and bid and enforces, in the order the
// wallet path always has, that the job belongs to userID, is still open for
// acceptance and unfunded, and that the bid belongs to the job and is still
// 'submitted'. The amount is ALWAYS the bid's, never anything a client sent.
func (s *Service) loadMoverAcceptance(ctx context.Context, jobID, userID, bidID string) (*moverAcceptance, error) {
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
	return &moverAcceptance{job: m, providerID: providerID, amount: amount}, nil
}

// AcceptMoverBid funds escrow for the chosen bid FROM THE CUSTOMER'S WALLET
// (KYC-tier gated) → bid_accepted, escrow funded. The card-direct sibling is
// AcceptMoverBidPaystackFunded.
func (s *Service) AcceptMoverBid(ctx context.Context, jobID, userID, bidID, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	if IsReservedIdempotencyKey(idempotencyKey) {
		return nil, codedErr(http.StatusBadRequest, "INVALID_IDEMPOTENCY_KEY", "this idempotency key format is reserved")
	}
	if _, err := s.acceptMoverBid(ctx, jobID, userID, bidID, idempotencyKey, nil); err != nil {
		return nil, err
	}
	return s.MoverDetail(ctx, jobID, userID)
}

// QuoteMoverAcceptance returns the EXACT amount (kobo) a card-direct acceptance
// of bidID will be charged — the bid read server-side — plus the frozen bid
// identity. Pure read; used by transport/paystackcheckout to decide what to ask
// Paystack for. Refuses (before any charge) a job/bid that cannot be accepted.
func (s *Service) QuoteMoverAcceptance(ctx context.Context, userID string, req MoverAcceptRequest) (int64, json.RawMessage, error) {
	if req.JobID == "" || req.BidID == "" {
		return 0, nil, codedErr(http.StatusBadRequest, "invalid_input", "job_id and bid_id are required")
	}
	acc, err := s.loadMoverAcceptance(ctx, req.JobID, userID, req.BidID)
	if err != nil {
		return 0, nil, err
	}
	// M3: one OPEN checkout per job. A second pending/processing intent (even for
	// another bid) could be paid as well: two charges, one move, one refunded.
	// Ownership of the job is already proven above, so revealing the reference
	// to resume is safe.
	if ref, open, oerr := s.openMoverCheckout(ctx, userID, req.JobID); oerr != nil {
		return 0, nil, oerr
	} else if open {
		ce := codedErr(http.StatusConflict, "checkout_in_progress",
			"A card checkout for this move is already open. Resume or finish it before starting another.")
		ce.Details = map[string]any{"reference": ref}
		return 0, nil, ce
	}
	frozen, err := json.Marshal(moverFrozenAcceptance{JobID: req.JobID, BidID: req.BidID, ProviderID: acc.providerID, AmountKobo: acc.amount})
	if err != nil {
		return 0, nil, fmt.Errorf("transport: freeze mover acceptance: %w", err)
	}
	return acc.amount, frozen, nil
}

// openMoverCheckout returns the reference of the payer's pending/processing
// card checkout for jobID, if any (transport_paystack_intents, domain 'movers').
// Backed by the partial unique index uq_transport_paystack_intents_mover_open_job
// that makes a second one impossible even under a race.
func (s *Service) openMoverCheckout(ctx context.Context, userID, jobID string) (string, bool, error) {
	var ref string
	err := s.db.QueryRow(ctx, `
		SELECT reference FROM public.transport_paystack_intents
		WHERE domain='movers' AND request_json->>'job_id' = $1 AND payer_id = $2
		  AND status IN ('pending','processing')
		ORDER BY created_at LIMIT 1`, jobID, userID).Scan(&ref)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return ref, true, nil
}

// FindMoverAcceptanceByIdempotencyKey returns the job whose bid was accepted
// under the card-direct key (the NAMESPACED Paystack reference), for userID.
// The key lives on the escrow settlement (mover_jobs.idempotency_key is the
// job-CREATION key), so the join is job.settlement_id → settlements, restricted
// to external funding so a wallet settlement can never answer for a card charge.
// Replay and the engine's "is a refund safe?" decision both rely on this: found
// ⇒ the acceptance exists ⇒ NEVER refund the charge that backs it.
func (s *Service) FindMoverAcceptanceByIdempotencyKey(ctx context.Context, userID, idempotencyKey string) (string, bool, error) {
	var id string
	err := s.db.QueryRow(ctx, `
		SELECT m.id FROM mover_jobs m JOIN settlements st ON st.id = m.settlement_id
		WHERE st.idempotency_key=$1 AND st.funding_source='external' AND m.user_id=$2`,
		idempotencyKey, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

// AcceptMoverBidPaystackFunded accepts a bid funded by an ALREADY-VERIFIED
// external Paystack charge of exactly verifiedAmountKobo — never a wallet debit,
// so the KYC-tier gate does not (and must not) run. The caller
// (transport/paystackcheckout) has verified the charge with the gateway; this
// function trusts that unconditionally but independently RE-READS the job and
// bid and refuses (before any write) unless: the job still belongs to userID and
// is open and unfunded, the bid is still 'submitted', and the bid's amount and
// provider are exactly what was frozen at quote time AND equal verifiedAmountKobo.
// Idempotent on idempotencyKey (the namespaced reference). On a failure after the
// escrow was posted the escrow is reversed ledger-side (RefundExternal) iff no
// job owns it, so the caller's gateway refund leaves the books balanced. Must
// only ever be called from a server-initiated confirm flow.
func (s *Service) AcceptMoverBidPaystackFunded(ctx context.Context, userID string, req MoverAcceptRequest, idempotencyKey string, verifiedAmountKobo int64, frozenPricing json.RawMessage) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	if req.JobID == "" || req.BidID == "" {
		return "", codedErr(http.StatusBadRequest, "invalid_input", "job_id and bid_id are required")
	}
	if verifiedAmountKobo <= 0 {
		return "", codedErr(http.StatusConflict, CodeAmountMismatch, "verified payment amount is not a positive charge")
	}
	ext := &moverExternalFunding{verifiedKobo: verifiedAmountKobo}
	if len(frozenPricing) > 0 {
		var f moverFrozenAcceptance
		if err := json.Unmarshal(frozenPricing, &f); err != nil {
			return "", fmt.Errorf("transport: frozen mover acceptance unreadable: %w", err)
		}
		ext.frozen = &f
	}
	return s.acceptMoverBid(ctx, req.JobID, userID, req.BidID, idempotencyKey, ext)
}

// moverExternalFunding marks acceptMoverBid as card-direct. It is never
// client-settable: only AcceptMoverBidPaystackFunded builds it.
type moverExternalFunding struct {
	verifiedKobo int64
	frozen       *moverFrozenAcceptance // nil ⇒ legacy / no snapshot: amount cross-check only
}

// acceptMoverBid is the shared body of AcceptMoverBid (wallet; ext == nil) and
// AcceptMoverBidPaystackFunded (card-direct). Returns the job id.
func (s *Service) acceptMoverBid(ctx context.Context, jobID, userID, bidID, idempotencyKey string, ext *moverExternalFunding) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	external := ext != nil
	if external {
		// Replay: a repeat of an already-accepted card-funded bid returns the job
		// untouched — no second escrow, no second update.
		id, found, err := s.FindMoverAcceptanceByIdempotencyKey(ctx, userID, idempotencyKey)
		if err != nil {
			return "", err
		}
		if found {
			if id != jobID {
				return "", codedErr(http.StatusConflict, CodeInvalidState, "idempotency key belongs to a different job")
			}
			return id, nil
		}
	}
	acc, err := s.loadMoverAcceptance(ctx, jobID, userID, bidID)
	if err != nil {
		return "", err
	}
	m, providerID, amount := acc.job, acc.providerID, acc.amount

	if external {
		// Cross-check BEFORE anything writes: the bid is the price, and it can be
		// changed/replaced between the quote that set the charge and now. Never
		// trust the quote, only what was actually collected.
		if amount != ext.verifiedKobo {
			return "", codedErr(http.StatusConflict, CodeAmountMismatch, "verified payment amount no longer matches the accepted bid")
		}
		if f := ext.frozen; f != nil && (f.BidID != bidID || f.JobID != jobID || f.ProviderID != providerID || f.AmountKobo != amount) {
			return "", codedErr(http.StatusConflict, CodeAmountMismatch, "the bid changed after checkout was opened")
		}
	} else if err := s.enforceTierLimit(ctx, userID, amount); err != nil {
		// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same
		// contract as RequestRide): a Tier0/over-limit customer cannot fund the
		// bid from the wallet. Skipped ONLY for card-direct: no wallet debit exists.
		return "", err
	}

	ref := "mover:" + jobID
	var sett *settlement.Settlement
	if external {
		sett, err = s.settlement.EscrowExternal(ctx, userID, ref, idempotencyKey, "transport", amount)
	} else {
		sett, err = s.settlement.Escrow(ctx, userID, ref, idempotencyKey, "transport", amount)
	}
	if err != nil {
		return "", fmt.Errorf("transport: escrow mover bid: %w", err)
	}
	if external {
		// EscrowExternal returns the EXISTING row on a replay. Only a live
		// (escrowed) external escrow held for THIS customer and exactly this
		// amount may back the acceptance; a refunded / settled / foreign /
		// wallet-funded row would fund a move with money that went back (or never
		// was this charge).
		if sett.Status != settlement.StatusEscrowed || sett.PayerID != userID || sett.FundingSource != "external" {
			return "", fmt.Errorf("transport: external escrow replay for %s is not a live escrow of this customer's charge (status=%s payer_match=%t funding=%s) — refusing to accept the bid",
				idempotencyKey, sett.Status, sett.PayerID == userID, sett.FundingSource)
		}
		if sett.TotalKobo != amount {
			return "", fmt.Errorf("transport: external escrow replay amount %d != bid %d", sett.TotalKobo, amount)
		}
	}

	if err := s.commitMoverAcceptance(ctx, jobID, userID, bidID, providerID, amount, sett.ID, external); err != nil {
		if external {
			// The booking ctx may be the very thing that failed (deadline / cancel),
			// so the compensation runs on a detached, bounded one. Reverse ONLY when
			// Find proves no job owns the escrow; a Find error leaves it in place.
			cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
			defer cancel()
			id, _, cerr := resolveExternalInsertFailure(
				func() (string, bool, error) {
					return s.FindMoverAcceptanceByIdempotencyKey(cctx, userID, idempotencyKey)
				},
				func() error { return s.settlement.RefundExternal(cctx, sett.ID, "mover_accept_failed") },
			)
			if cerr != nil {
				log.Printf("[transport] external escrow settlement=%s after mover accept failure (%v) — %v — needs manual reconciliation", sett.ID, err, cerr)
				return "", fmt.Errorf("transport: accept mover bid: %w (compensation: %v)", err, cerr)
			}
			if id != "" { // a concurrent confirm of the same charge owns the escrow
				return id, nil
			}
		}
		return "", err
	}

	_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, providerID)
	meta := map[string]any{"bid_id": bidID, "amount_kobo": amount, "provider_id": providerID, "settlement_id": sett.ID}
	if external {
		meta["funding"] = "external"
		meta["verified_amount_kobo"] = ext.verifiedKobo
	}
	s.recordModeEvent(ctx, userID, "mover.bid_accepted", "mover_job", jobID, m.Status, "bid_accepted", meta)
	return jobID, nil
}

// commitMoverAcceptance flips job + bids in one transaction. For card-direct the
// bid flip is GUARDED (still 'submitted', same provider, same amount) so a bid
// withdrawn/changed between the pre-check and here rolls the whole thing back
// instead of funding a move for a bid that no longer exists as charged.
func (s *Service) commitMoverAcceptance(ctx context.Context, jobID, userID, bidID, providerID string, amount int64, settlementID string, external bool) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `
		UPDATE mover_jobs SET provider_id=$1, accepted_bid_id=$2, quote_amount_kobo=$3,
			status='bid_accepted', escrow_status='funded', settlement_id=$4, updated_at=NOW()
		WHERE id=$5 AND user_id=$6 AND escrow_status='none' AND status IN ('quote_requested','bids_received')`,
		providerID, bidID, amount, settlementID, jobID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "job changed concurrently")
	}
	if external {
		tag, err = tx.Exec(ctx, `UPDATE mover_bids SET status='accepted' WHERE id=$1 AND job_id=$2 AND status='submitted' AND provider_id=$3 AND amount_kobo=$4`,
			bidID, jobID, providerID, amount)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return codedErr(http.StatusConflict, CodeInvalidState, "bid changed concurrently")
		}
	} else if _, err := tx.Exec(ctx, `UPDATE mover_bids SET status='accepted' WHERE id=$1`, bidID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE mover_bids SET status='rejected' WHERE job_id=$1 AND id<>$2 AND status='submitted'`, jobID, bidID); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
		if err := s.settleModeProvider(ctx, *m.SettlementID, *m.ProviderID, 0); err != nil {
			return fmt.Errorf("transport: settle mover: %w", err)
		}
	}
	_, _ = s.db.Exec(ctx, `UPDATE mover_jobs SET escrow_status='released', updated_at=NOW() WHERE id=$1`, jobID)
	if m.ProviderID != nil {
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *m.ProviderID)
	}
	s.recordModeEvent(ctx, userID, "mover.completion_confirmed", "mover_job", jobID, "in_progress", "completion_confirmed", nil)
	return nil
}

// moverDomain is the name the card-direct refund registry files mover refunds
// under (transport/paystackcheckout.MoversDomainName).
const moverDomain = RefundDomainMovers

// CancelMover refunds funded escrow + cancels (owner only). The refund rail is
// chosen from the settlement itself (refundSettlement): card-funded money goes
// back through the gateway, wallet-funded money to the wallet — never crossed.
// See CancelMoverWithRefund for the refund_status the HTTP endpoint reports.
func (s *Service) CancelMover(ctx context.Context, jobID, userID, reason string) error {
	_, err := s.CancelMoverWithRefund(ctx, jobID, userID, reason)
	return err
}

// CancelMoverWithRefund cancels a move and reports whether the customer's money
// is actually back. A card-funded move whose domain has no refunder wired is
// refused BEFORE the status flips (503 refund_unavailable).
func (s *Service) CancelMoverWithRefund(ctx context.Context, jobID, userID, reason string) (*CancelResult, error) {
	reason = capCancelReason(reason)
	var m moverRow
	if err := s.loadMover(ctx, jobID, &m); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	if m.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your job")
	}
	if m.Status == "cancelled" {
		// Idempotent re-cancel. Only meaningful for a card-funded move whose
		// first refund attempt failed after the status flip: finish it
		// (escrowed OR disputed settlement). A completed refund is a no-op;
		// anything else is a plain 409.
		if m.SettlementID != nil && (m.EscrowStatus == "funded" || m.EscrowStatus == "refunded") {
			if res, handled, err := s.finishCancelledRefund(ctx, moverDomain, jobID, m.SettlementID, "mover_cancelled_retry:"+reason); handled {
				if err != nil {
					return nil, err
				}
				if res.RefundStatus == RefundStatusRefunded && m.EscrowStatus == "funded" {
					_, _ = s.db.Exec(ctx, `UPDATE mover_jobs SET escrow_status='refunded', updated_at=NOW() WHERE id=$1 AND escrow_status='funded'`, jobID)
				}
				return res, nil
			}
		}
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from status "+m.Status)
	}
	if !canTransitionMover(m.Status, "cancelled") {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from status "+m.Status)
	}
	external := false
	if m.EscrowStatus == "funded" && m.SettlementID != nil {
		var err error
		if external, err = s.requireRefundRail(ctx, moverDomain, m.SettlementID); err != nil {
			return nil, err
		}
	}
	if err := s.moverSetStatus(ctx, jobID, m.Status, "cancelled"); err != nil {
		return nil, err
	}
	res := &CancelResult{RefundStatus: RefundStatusNone}
	if m.EscrowStatus == "funded" && m.SettlementID != nil {
		rerr := s.refundSettlement(ctx, moverDomain, jobID, *m.SettlementID, "mover_cancelled:"+reason)
		if rerr != nil {
			log.Printf("[transport] mover %s cancelled but refund of settlement=%s failed: %v", jobID, *m.SettlementID, rerr)
		}
		res.RefundStatus = refundStatusFor(rerr, external)
		// escrow_status may only read 'refunded' once the money really went back.
		// Wallet-funded keeps its historical best-effort mark; card-funded (or an
		// unresolvable rail) stays 'funded' so a re-POST of cancel finishes it.
		if rerr == nil || !external {
			_, _ = s.db.Exec(ctx, `UPDATE mover_jobs SET escrow_status='refunded', updated_at=NOW() WHERE id=$1`, jobID)
		}
	}
	if m.ProviderID != nil {
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *m.ProviderID)
	}
	s.recordModeEvent(ctx, userID, "mover.cancelled", "mover_job", jobID, m.Status, "cancelled", map[string]any{"reason": reason, "refund_status": res.RefundStatus})
	return res, nil
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
		bidID, jobID, providerID, amount, dbutil.NullStr(note)); err != nil {
		return nil, codedErr(http.StatusConflict, "BID_EXISTS", "you have already bid on this job")
	}
	// First bid moves the job to bids_received.
	if m.Status == "quote_requested" {
		_, _ = s.db.Exec(ctx, `UPDATE mover_jobs SET status='bids_received', updated_at=NOW() WHERE id=$1 AND status='quote_requested'`, jobID)
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

// MoverQuote creates a mover job in quote_requested.
func (h *Handler) MoverQuote(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req MoverQuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	j, err := h.svc.RequestMoverQuote(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, j)
}

// MoverList returns the caller's mover jobs (GET /mobility/movers). Sibling to
// MoverGet (:id) — needs registering in finance_routes.go's `mob` group:
func (h *Handler) MoverList(c *gin.Context) {
	userID := ginutil.UserID(c)
	jobs, err := h.svc.ListMoverJobs(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": jobs})
}

// MoverGet returns a job + bids.
func (h *Handler) MoverGet(c *gin.Context) {
	userID := ginutil.UserID(c)
	j, err := h.svc.MoverDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

// MoverAcceptBid funds escrow for a chosen bid.
func (h *Handler) MoverAcceptBid(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req MoverAcceptBidRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	key := ginutil.IdempotencyKey(c)
	if key == "" {
		key = req.IdempotencyKey
	}
	j, err := h.svc.AcceptMoverBid(c.Request.Context(), c.Param("id"), userID, req.BidID, key)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

// MoverConfirmCompletion releases escrow → settle provider.
func (h *Handler) MoverConfirmCompletion(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.ConfirmMoverCompletion(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "completion_confirmed"})
}

// MoverCancel refunds + cancels a job.
func (h *Handler) MoverCancel(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	res, err := h.svc.CancelMoverWithRefund(c.Request.Context(), c.Param("id"), userID, req.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled", "refund_status": res.RefundStatus})
}

// MoverOpen returns jobs open for bidding.
func (h *Handler) MoverOpen(c *gin.Context) {
	userID := ginutil.UserID(c)
	jobs, err := h.svc.OpenMoverJobs(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": jobs})
}

// MoverBid submits a bid.
func (h *Handler) MoverBid(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req MoverBidRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	bid, err := h.svc.SubmitMoverBid(c.Request.Context(), c.Param("id"), userID, req.AmountKobo, req.Note)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, bid)
}

// MoverStart starts the job.
func (h *Handler) MoverStart(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.StartMoverJob(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "in_progress"})
}

// MoverComplete signals provider-side completion (awaits customer confirm).
func (h *Handler) MoverComplete(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.CompleteMoverJob(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "awaiting": "customer_confirmation"})
}
