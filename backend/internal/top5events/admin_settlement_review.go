package top5events

// Settlement-break detection + reviewer decisions, and the vendor payout
// decision the admin console models as approve/reject.
//
// A break is DERIVED per vendor from three invariants that hold whenever
// TapCharge and SettleVendor ran to completion:
//   1. SUM(vendor_charges) == SUM(vendor_float)            (same tx in TapCharge)
//   2. SUM(vendor_float settled) == SUM(event_settlements.gross_kobo)
//   3. gross_kobo == fee_kobo + net_kobo on every settlement row
// The per-event break is the sum of absolute deltas. Reviewer actions are
// recorded append-only in event_settlement_reviews; they annotate a break and
// never move money — a correction is a reversing ledger entry, posted
// separately. A review applies only while the break amount is unchanged: if
// the delta moves, the line reopens.

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/httperr"
)

const (
	settlementNoteMaxLen    = 1000
	reviewSubjectBreak      = "settlement_break"
	reviewSubjectPayout     = "vendor_payout"
	settlementLinePrefix    = "set_"
	settlementReviewsTable  = "public.event_settlement_reviews"
	payoutDecisionApprove   = "approve"
	payoutDecisionReject    = "reject"
	payoutStatusRejected    = "rejected"
	settlementStatusSettled = "settled"
	keyReview               = "review"
)

var settlementActionStatus = map[string]string{
	"investigate": "investigating",
	"resolve":     "resolved",
	"reconcile":   "reconciled",
}

type settlementReview struct {
	status    string
	breakKobo int64
}

type AdminSettlementResolveResult struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	AuditID string `json:"audit_id"`
	Message string `json:"message"`
}

type AdminVendorPayoutResult struct {
	ID           string `json:"id"`
	PayoutStatus string `json:"payout_status"`
	AuditID      string `json:"audit_id"`
	Message      string `json:"message"`
	NetKobo      int64  `json:"net_kobo,omitempty"`
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// settlementBreaksByEvent returns event id → total break kobo, only for
// events with a non-zero break.
func (s *Service) settlementBreaksByEvent(ctx context.Context) (map[string]int64, error) {
	rows, err := s.db.Query(ctx, `
		SELECT v.event_id,
		       COALESCE((SELECT SUM(amount_kobo) FROM vendor_charges WHERE vendor_id=v.id),0)
		     - COALESCE((SELECT SUM(amount_kobo) FROM vendor_float WHERE vendor_id=v.id),0),
		       COALESCE((SELECT SUM(amount_kobo) FROM vendor_float WHERE vendor_id=v.id AND settled),0)
		     - COALESCE((SELECT SUM(gross_kobo) FROM event_settlements WHERE vendor_id=v.id),0),
		       COALESCE((SELECT SUM(ABS(gross_kobo - fee_kobo - net_kobo)) FROM event_settlements WHERE vendor_id=v.id),0)
		FROM event_vendors v`)
	if err != nil {
		return nil, fmt.Errorf("events: settlement breaks: %w", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var eventID string
		var chargeDelta, settleDelta, splitDelta int64
		if err := rows.Scan(&eventID, &chargeDelta, &settleDelta, &splitDelta); err != nil {
			return nil, fmt.Errorf("events: settlement breaks scan: %w", err)
		}
		if b := abs64(chargeDelta) + abs64(settleDelta) + splitDelta; b > 0 {
			out[eventID] += b
		}
	}
	return out, rows.Err()
}

// latestReviews maps subject id → newest review for one subject kind. Before
// the review migration is applied there are none.
func (s *Service) latestReviews(ctx context.Context, kind string) (map[string]settlementReview, error) {
	out := map[string]settlementReview{}
	var ok bool
	if err := s.db.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, settlementReviewsTable).Scan(&ok); err != nil || !ok {
		return out, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT ON (subject_id) subject_id, status, break_kobo
		FROM event_settlement_reviews WHERE subject_kind=$1
		ORDER BY subject_id, created_at DESC, id DESC`, kind)
	if err != nil {
		return nil, fmt.Errorf("events: settlement reviews: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var r settlementReview
		if err := rows.Scan(&id, &r.status, &r.breakKobo); err != nil {
			return nil, fmt.Errorf("events: settlement reviews scan: %w", err)
		}
		out[id] = r
	}
	return out, rows.Err()
}

// breakStatus is the line status for a non-zero break: the reviewer's verdict
// while the delta is the one they reviewed, else open.
func breakStatus(lineID string, breakKobo int64, reviews map[string]settlementReview) string {
	if r, ok := reviews[lineID]; ok && r.breakKobo == breakKobo {
		return r.status
	}
	return "open"
}

func breakIsOpen(status string) bool { return status == "open" || status == "investigating" }

// applySettlementBreaks folds detected breaks into the settlement view,
// adding a line for an event that has a break but no settlement yet.
func (s *Service) applySettlementBreaks(ctx context.Context, out *AdminSettlement) error {
	breaks, err := s.settlementBreaksByEvent(ctx)
	if err != nil {
		return err
	}
	if len(breaks) == 0 {
		return nil
	}
	reviews, err := s.latestReviews(ctx, reviewSubjectBreak)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for i := range out.Lines {
		l := &out.Lines[i]
		seen[l.EventID] = true
		if b := breaks[l.EventID]; b > 0 {
			l.BreakKobo = b
			l.Status = breakStatus(l.ID, b, reviews)
		}
	}
	for eventID, b := range breaks {
		if seen[eventID] {
			continue
		}
		var title string
		if err := s.db.QueryRow(ctx, `SELECT title FROM events WHERE id=$1`, eventID).Scan(&title); err != nil {
			return fmt.Errorf("events: settlement break title: %w", err)
		}
		id := settlementLinePrefix + eventID
		out.Lines = append(out.Lines, AdminSettlementLine{
			ID: id, EventID: eventID, EventTitle: title, BreakKobo: b, Status: breakStatus(id, b, reviews),
		})
	}
	for _, l := range out.Lines {
		out.TotalBreakKobo += l.BreakKobo
		if l.BreakKobo > 0 && breakIsOpen(l.Status) {
			out.BreaksOpen++
		}
	}
	return nil
}

// adminDashboardBreaks fills the two settlement-break dashboard tiles.
func (s *Service) adminDashboardBreaks(ctx context.Context, d *AdminDashboard) error {
	view := &AdminSettlement{}
	if err := s.applySettlementBreaks(ctx, view); err != nil {
		return err
	}
	for _, l := range view.Lines {
		if breakIsOpen(l.Status) {
			d.SettlementBreaks++
			d.SettlementBreakKobo += l.BreakKobo
		}
	}
	return nil
}

func (s *Service) insertSettlementReview(ctx context.Context, kind, subjectID, eventID, action, status, note, actorID, idemKey string, breakKobo int64) (string, error) {
	id := uuid.New().String()
	var key any
	if idemKey != "" {
		key = idemKey
	}
	var got string
	err := s.db.QueryRow(ctx, `
		INSERT INTO event_settlement_reviews
		  (id, subject_kind, subject_id, event_id, action, status, break_kobo, note, actor_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING id`,
		id, kind, subjectID, eventID, action, status, breakKobo, note, actorID, key).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		// Same Idempotency-Key replayed: return the original review row.
		err = s.db.QueryRow(ctx, `SELECT id FROM event_settlement_reviews WHERE idempotency_key=$1`, idemKey).Scan(&got)
	}
	if err != nil {
		return "", fmt.Errorf("events: insert settlement review: %w", err)
	}
	return got, nil
}

// AdminResolveSettlementBreak records a reviewer decision on a break line.
func (s *Service) AdminResolveSettlementBreak(ctx context.Context, actorID, lineID, action, note string) (*AdminSettlementResolveResult, error) {
	status, ok := settlementActionStatus[action]
	if !ok {
		return nil, fmt.Errorf("%w: action must be investigate, resolve or reconcile", ErrValidation)
	}
	note = clampTrim(note, settlementNoteMaxLen)
	if action != "investigate" && note == "" {
		return nil, fmt.Errorf("%w: resolving a break needs a note", ErrValidation)
	}
	view := &AdminSettlement{}
	if err := s.applySettlementBreaks(ctx, view); err != nil {
		return nil, err
	}
	var line *AdminSettlementLine
	for i := range view.Lines {
		if view.Lines[i].ID == lineID {
			line = &view.Lines[i]
		}
	}
	if line == nil {
		return nil, fmt.Errorf("%w: no open settlement break %s", ErrNotFound, lineID)
	}
	reviewID, err := s.insertSettlementReview(ctx, reviewSubjectBreak, lineID, line.EventID, action, status, note, actorID, "", line.BreakKobo)
	if err != nil {
		return nil, err
	}
	s.log(actorID, "events.settlement.break."+action, lineID, map[string]any{keyEvent: line.EventID, "break_kobo": line.BreakKobo, keyReview: reviewID})
	return &AdminSettlementResolveResult{ID: lineID, Status: status, AuditID: reviewID, Message: "Settlement break marked " + status}, nil
}

// AdminDecideVendorPayout approves (settles now, via SettleVendor) or rejects
// (records a hold) a vendor's unsettled float. Approval is a money mutation and
// needs the caller's Idempotency-Key, which is passed straight to SettleVendor
// so a retry dedups on the same ledger legs.
func (s *Service) AdminDecideVendorPayout(ctx context.Context, actorID, vendorID, decision, note, idemKey string) (*AdminVendorPayoutResult, error) {
	note = clampTrim(note, settlementNoteMaxLen)
	var eventID string
	if err := s.db.QueryRow(ctx, `SELECT event_id FROM event_vendors WHERE id=$1`, vendorID).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("events: payout vendor: %w", err)
	}
	switch decision {
	case payoutDecisionApprove:
		if idemKey == "" {
			return nil, fmt.Errorf("%w: Idempotency-Key header required", ErrValidation)
		}
		// A replay of a completed approval (or a retry after a crash between
		// the settlement commit and the review insert) finds the settlement
		// row by its key and does not settle again.
		var net int64
		err := s.db.QueryRow(ctx, `SELECT net_kobo FROM event_settlements WHERE idempotency_key=$1 AND vendor_id=$2`, idemKey, vendorID).Scan(&net)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if net, err = s.SettleVendor(ctx, eventID, vendorID, idemKey); err != nil {
				return nil, err
			}
		case err != nil:
			return nil, fmt.Errorf("events: payout replay check: %w", err)
		}
		reviewID, err := s.insertSettlementReview(ctx, reviewSubjectPayout, vendorID, eventID, decision, string(PayoutPaid), note, actorID, idemKey, 0)
		if err != nil {
			return nil, err
		}
		s.log(actorID, "events.vendor.payout.approve", vendorID, map[string]any{keyEvent: eventID, "net": net, keyReview: reviewID})
		return &AdminVendorPayoutResult{ID: vendorID, PayoutStatus: string(PayoutPaid), AuditID: reviewID, Message: "Vendor settled net of fees", NetKobo: net}, nil
	case payoutDecisionReject:
		if note == "" {
			return nil, fmt.Errorf("%w: rejecting a payout needs a note", ErrValidation)
		}
		reviewID, err := s.insertSettlementReview(ctx, reviewSubjectPayout, vendorID, eventID, decision, payoutStatusRejected, note, actorID, idemKey, 0)
		if err != nil {
			return nil, err
		}
		s.log(actorID, "events.vendor.payout.reject", vendorID, map[string]any{keyEvent: eventID, keyReview: reviewID})
		return &AdminVendorPayoutResult{ID: vendorID, PayoutStatus: payoutStatusRejected, AuditID: reviewID, Message: "Payout held; float stays unsettled"}, nil
	}
	return nil, fmt.Errorf("%w: decision must be approve or reject", ErrValidation)
}

// rejectedVendorPayouts lists vendors whose newest payout decision is a
// rejection made after their newest unsettled float row — new takings after a
// rejection put the vendor back in the pending queue.
func (s *Service) rejectedVendorPayouts(ctx context.Context) (map[string]bool, error) {
	out := map[string]bool{}
	var ok bool
	if err := s.db.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, settlementReviewsTable).Scan(&ok); err != nil || !ok {
		return out, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT r.subject_id FROM (
			SELECT DISTINCT ON (subject_id) subject_id, status, created_at
			FROM event_settlement_reviews WHERE subject_kind=$1
			ORDER BY subject_id, created_at DESC, id DESC
		) r
		WHERE r.status=$2 AND r.created_at >= COALESCE(
			(SELECT MAX(created_at) FROM vendor_float WHERE vendor_id::text = r.subject_id AND NOT settled), r.created_at)`,
		reviewSubjectPayout, payoutStatusRejected)
	if err != nil {
		return nil, fmt.Errorf("events: rejected payouts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("events: rejected payouts scan: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// --- HTTP ---

type settlementResolveRequest struct {
	Action string `json:"action"`
	Note   string `json:"note"`
}

type vendorPayoutRequest struct {
	Decision string `json:"decision"`
	Note     string `json:"note"`
}

func (h *Handler) AdminResolveSettlementBreak(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req settlementResolveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.AdminResolveSettlementBreak(c.Request.Context(), u, c.Param("id"), req.Action, req.Note)
	commerceRespond(c, out, err)
}

func (h *Handler) AdminVendorPayout(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req vendorPayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.AdminDecideVendorPayout(c.Request.Context(), u, c.Param("id"), req.Decision, req.Note, idemKey(c))
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, ErrNotFound):
			status = http.StatusNotFound
		case errors.Is(err, ErrKYCRequired), errors.Is(err, ErrForbidden):
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}
