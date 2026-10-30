package top5events

// Admin fraud queue — GET /api/events/admin/fraud and
// POST /api/events/admin/fraud/:id/action.
//
// Signals are DERIVED on read from the module's own append-only records, so
// there is no detector job to fall behind and nothing to backfill:
//   - dup_scan            a ticket credential rejected at the gate 2+ times
//   - abnormal_topup      5+ event-wallet top-ups inside one hour
//   - vendor_self_charge  a vendor tap-charging a wallet its own operator owns
//   - rapid_refund        3+ refund requests by one buyer on one event (commerce)
// A signal id is deterministic (kind:subject[:bucket]), so a reviewer's
// decision in event_fraud_reviews (append-only) stays attached across reads.
// The newest review row is the signal's status; no row = open.

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	fraudWindow          = "30 days"
	fraudMaxRows         = 200
	dupScanMinRejects    = 2
	topupBurstMin        = 5
	rapidRefundMinCount  = 3
	fraudNoteMaxLen      = 1000
	fraudKindDupScan     = "dup_scan"
	fraudKindTopup       = "abnormal_topup"
	fraudKindSelfCharge  = "vendor_self_charge"
	fraudKindRapidRefund = "rapid_refund"
	fraudActionBlock     = "block"
	fraudActionReview    = "investigate"
	sevMedium            = "medium"
)

// ErrFraudSignalNotFound is returned when an action names a signal the
// detectors no longer (or never) produced.
var ErrFraudSignalNotFound = fmt.Errorf("%w: fraud signal", ErrNotFound)

type AdminFraudSignal struct {
	ID            string `json:"id"`
	EventID       string `json:"event_id"`
	EventTitle    string `json:"event_title"`
	Kind          string `json:"kind"`
	SubjectMasked string `json:"subject_masked"`
	Detail        string `json:"detail"`
	Severity      string `json:"severity"`
	AmountKobo    int64  `json:"amount_kobo"`
	Status        string `json:"status"`
	CreatedAt     string `json:"created_at"`

	subjectID string // vendor id for vendor_self_charge (block target)
	at        time.Time
}

type AdminFraudActionResult struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	AuditID string `json:"audit_id"`
	Message string `json:"message"`
}

var fraudActionStatus = map[string]string{
	fraudActionReview: "investigating",
	"clear":           "cleared",
	fraudActionBlock:  "blocked",
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// AdminListFraudSignals returns derived signals, newest first, filtered by
// status/kind/q (q matches event title, subject or id).
func (s *Service) AdminListFraudSignals(ctx context.Context, status, kind, q string) ([]AdminFraudSignal, error) {
	all, err := s.fraudSignals(ctx)
	if err != nil {
		return nil, err
	}
	q = strings.ToLower(strings.TrimSpace(q))
	out := []AdminFraudSignal{}
	for _, sig := range all {
		if status != "" && sig.Status != status {
			continue
		}
		if kind != "" && sig.Kind != kind {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(sig.EventTitle+" "+sig.SubjectMasked+" "+sig.ID), q) {
			continue
		}
		out = append(out, sig)
	}
	return out, nil
}

// adminFraudOpenCount is the dashboard badge: signals nobody has closed out
// (open or investigating).
func (s *Service) adminFraudOpenCount(ctx context.Context) (int, error) {
	all, err := s.fraudSignals(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, sig := range all {
		if sig.Status == "open" || sig.Status == "investigating" {
			n++
		}
	}
	return n, nil
}

func (s *Service) fraudSignals(ctx context.Context) ([]AdminFraudSignal, error) {
	var out []AdminFraudSignal
	for _, detect := range []func(context.Context) ([]AdminFraudSignal, error){
		s.detectDupScans, s.detectTopupBursts, s.detectVendorSelfCharge, s.detectRapidRefunds,
	} {
		rows, err := detect(ctx)
		if err != nil {
			return nil, err
		}
		out = append(out, rows...)
	}
	statuses, err := s.fraudReviewStatuses(ctx)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Status = "open"
		if st, ok := statuses[out[i].ID]; ok {
			out[i].Status = st
		}
		out[i].CreatedAt = out[i].at.Format(rfc3339)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].at.After(out[j].at) })
	return out, nil
}

func (s *Service) detectDupScans(ctx context.Context) ([]AdminFraudSignal, error) {
	rows, err := s.db.Query(ctx, `
		SELECT t.id, t.event_id, e.title, t.price_paid_kobo,
		       COUNT(*), COUNT(DISTINCT NULLIF(cv.gate_id,'')), MAX(cv.scanned_at)
		FROM credential_validations cv
		JOIN event_tickets t ON t.credential_id = cv.credential_id
		JOIN events e ON e.id = t.event_id
		WHERE cv.outcome = 'REJECTED' AND cv.scanned_at >= now() - interval '`+fraudWindow+`'
		GROUP BY t.id, t.event_id, e.title, t.price_paid_kobo
		HAVING COUNT(*) >= $1
		ORDER BY MAX(cv.scanned_at) DESC LIMIT `+strconv.Itoa(fraudMaxRows), dupScanMinRejects)
	if err != nil {
		return nil, fmt.Errorf("events: fraud dup-scan: %w", err)
	}
	defer rows.Close()
	var out []AdminFraudSignal
	for rows.Next() {
		var ticketID string
		var sig AdminFraudSignal
		var rejects, gates int
		if err := rows.Scan(&ticketID, &sig.EventID, &sig.EventTitle, &sig.AmountKobo, &rejects, &gates, &sig.at); err != nil {
			return nil, fmt.Errorf("events: fraud dup-scan scan: %w", err)
		}
		sig.ID = fraudKindDupScan + ":" + ticketID
		sig.Kind = fraudKindDupScan
		sig.SubjectMasked = "tkt #" + shortID(ticketID) + "•••"
		sig.Detail = fmt.Sprintf("%d rejected gate scans across %d gate(s) in %s", rejects, gates, fraudWindow)
		sig.Severity = dupScanSeverity(rejects, gates)
		out = append(out, sig)
	}
	return out, rows.Err()
}

func dupScanSeverity(rejects, gates int) string {
	switch {
	case gates >= 3 || rejects >= 6:
		return "high"
	case gates >= 2 || rejects >= 3:
		return sevMedium
	}
	return "low"
}

func (s *Service) detectTopupBursts(ctx context.Context) ([]AdminFraudSignal, error) {
	rows, err := s.db.Query(ctx, `
		SELECT w.id, w.event_id, e.title, date_trunc('hour', le.created_at) AS bucket,
		       COUNT(*), SUM(le.amount_kobo), MAX(le.created_at)
		FROM event_wallet_ledger le
		JOIN event_wallets w ON w.id = le.wallet_id
		JOIN events e ON e.id = w.event_id
		WHERE le.type = 'TOPUP' AND le.created_at >= now() - interval '`+fraudWindow+`'
		GROUP BY w.id, w.event_id, e.title, bucket
		HAVING COUNT(*) >= $1
		ORDER BY MAX(le.created_at) DESC LIMIT `+strconv.Itoa(fraudMaxRows), topupBurstMin)
	if err != nil {
		return nil, fmt.Errorf("events: fraud top-up burst: %w", err)
	}
	defer rows.Close()
	var out []AdminFraudSignal
	for rows.Next() {
		var walletID string
		var bucket time.Time
		var n int
		var sig AdminFraudSignal
		if err := rows.Scan(&walletID, &sig.EventID, &sig.EventTitle, &bucket, &n, &sig.AmountKobo, &sig.at); err != nil {
			return nil, fmt.Errorf("events: fraud top-up scan: %w", err)
		}
		sig.ID = fraudKindTopup + ":" + walletID + ":" + strconv.FormatInt(bucket.Unix(), 10)
		sig.Kind = fraudKindTopup
		sig.SubjectMasked = "wlt " + shortID(walletID) + "•••"
		sig.Detail = fmt.Sprintf("%d top-ups within one hour from one event wallet", n)
		sig.Severity = sevMedium
		if n >= 2*topupBurstMin {
			sig.Severity = "high"
		}
		out = append(out, sig)
	}
	return out, rows.Err()
}

func (s *Service) detectVendorSelfCharge(ctx context.Context) ([]AdminFraudSignal, error) {
	rows, err := s.db.Query(ctx, `
		SELECT v.id, v.name, v.event_id, e.title, COUNT(*), SUM(vc.amount_kobo), MAX(vc.created_at)
		FROM vendor_charges vc
		JOIN event_vendors v ON v.id = vc.vendor_id
		JOIN event_wallets w ON w.id = vc.wallet_id
		JOIN events e ON e.id = v.event_id
		WHERE w.owner_id = v.user_id AND vc.created_at >= now() - interval '`+fraudWindow+`'
		GROUP BY v.id, v.name, v.event_id, e.title
		ORDER BY MAX(vc.created_at) DESC LIMIT `+strconv.Itoa(fraudMaxRows))
	if err != nil {
		return nil, fmt.Errorf("events: fraud vendor self-charge: %w", err)
	}
	defer rows.Close()
	var out []AdminFraudSignal
	for rows.Next() {
		var name string
		var n int
		var sig AdminFraudSignal
		if err := rows.Scan(&sig.subjectID, &name, &sig.EventID, &sig.EventTitle, &n, &sig.AmountKobo, &sig.at); err != nil {
			return nil, fmt.Errorf("events: fraud self-charge scan: %w", err)
		}
		sig.ID = fraudKindSelfCharge + ":" + sig.subjectID
		sig.Kind = fraudKindSelfCharge
		sig.SubjectMasked = "ven " + maskName(name)
		sig.Detail = fmt.Sprintf("Vendor charged its own operator's event wallet %d time(s)", n)
		sig.Severity = "critical"
		out = append(out, sig)
	}
	return out, rows.Err()
}

// detectRapidRefunds needs the commerce refund table; without it (commerce
// migration not applied) the detector reports nothing rather than failing.
func (s *Service) detectRapidRefunds(ctx context.Context) ([]AdminFraudSignal, error) {
	if ok, err := s.tableExists(ctx, "public.event_refunds"); err != nil || !ok {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT r.event_id, e.title, r.buyer_id, COUNT(*), SUM(r.amount_kobo), MAX(r.created_at)
		FROM event_refunds r JOIN events e ON e.id = r.event_id
		WHERE r.created_at >= now() - interval '`+fraudWindow+`'
		GROUP BY r.event_id, e.title, r.buyer_id
		HAVING COUNT(*) >= $1
		ORDER BY MAX(r.created_at) DESC LIMIT `+strconv.Itoa(fraudMaxRows), rapidRefundMinCount)
	if err != nil {
		return nil, fmt.Errorf("events: fraud rapid refund: %w", err)
	}
	defer rows.Close()
	var out []AdminFraudSignal
	for rows.Next() {
		var buyer string
		var n int
		var sig AdminFraudSignal
		if err := rows.Scan(&sig.EventID, &sig.EventTitle, &buyer, &n, &sig.AmountKobo, &sig.at); err != nil {
			return nil, fmt.Errorf("events: fraud rapid refund scan: %w", err)
		}
		sig.ID = fraudKindRapidRefund + ":" + sig.EventID + ":" + buyer
		sig.Kind = fraudKindRapidRefund
		sig.SubjectMasked = "buyer " + shortID(buyer) + "•••"
		sig.Detail = fmt.Sprintf("%d refund requests on one event by one buyer", n)
		sig.Severity = "low"
		if n >= 2*rapidRefundMinCount {
			sig.Severity = sevMedium
		}
		out = append(out, sig)
	}
	return out, rows.Err()
}

func (s *Service) tableExists(ctx context.Context, name string) (bool, error) {
	var ok bool
	if err := s.db.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, name).Scan(&ok); err != nil {
		return false, fmt.Errorf("events: table check %s: %w", name, err)
	}
	return ok, nil
}

// fraudReviewStatuses maps signal id → newest review status. Before the
// review migration is applied every signal reads as open.
func (s *Service) fraudReviewStatuses(ctx context.Context) (map[string]string, error) {
	out := map[string]string{}
	ok, err := s.tableExists(ctx, "public.event_fraud_reviews")
	if err != nil || !ok {
		return out, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT ON (signal_id) signal_id, status
		FROM event_fraud_reviews ORDER BY signal_id, created_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("events: fraud reviews: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, st string
		if err := rows.Scan(&id, &st); err != nil {
			return nil, fmt.Errorf("events: fraud reviews scan: %w", err)
		}
		out[id] = st
	}
	return out, rows.Err()
}

// AdminActionFraudSignal records a reviewer decision. "block" on a vendor
// self-charge also deactivates the vendor (no further tap-charges); for the
// other kinds it is a recorded verdict only — revoking an attendee's ticket or
// wallet is a separate, deliberate action. No money moves here.
func (s *Service) AdminActionFraudSignal(ctx context.Context, actorID, signalID, action, note string) (*AdminFraudActionResult, error) {
	status, ok := fraudActionStatus[action]
	if !ok {
		return nil, fmt.Errorf("%w: action must be investigate, clear or block", ErrValidation)
	}
	note = clampTrim(note, fraudNoteMaxLen)
	if action != fraudActionReview && note == "" {
		return nil, fmt.Errorf("%w: clearing or blocking a signal needs a note", ErrValidation)
	}
	all, err := s.fraudSignals(ctx)
	if err != nil {
		return nil, err
	}
	var sig *AdminFraudSignal
	for i := range all {
		if all[i].ID == signalID {
			sig = &all[i]
			break
		}
	}
	if sig == nil {
		return nil, ErrFraudSignalNotFound
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin fraud review: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if action == fraudActionBlock && sig.Kind == fraudKindSelfCharge {
		if _, err := tx.Exec(ctx, `UPDATE event_vendors SET active=false WHERE id=$1`, sig.subjectID); err != nil {
			return nil, fmt.Errorf("events: deactivate vendor: %w", err)
		}
	}
	reviewID := uuid.New().String()
	if _, err := tx.Exec(ctx, `
		INSERT INTO event_fraud_reviews (id, signal_id, kind, event_id, action, status, note, actor_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		reviewID, sig.ID, sig.Kind, sig.EventID, action, status, note, actorID); err != nil {
		return nil, fmt.Errorf("events: insert fraud review: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: commit fraud review: %w", err)
	}
	s.log(actorID, "events.fraud."+action, sig.ID, map[string]any{"kind": sig.Kind, keyEvent: sig.EventID, "status": status, "review": reviewID})

	msg := "Signal marked " + status
	if action == fraudActionBlock && sig.Kind == fraudKindSelfCharge {
		msg += "; vendor deactivated"
	}
	return &AdminFraudActionResult{ID: sig.ID, Status: status, AuditID: reviewID, Message: msg}, nil
}

// --- HTTP ---

type fraudActionRequest struct {
	Action string `json:"action"`
	Note   string `json:"note"`
}

func (h *Handler) AdminListFraud(c *gin.Context) {
	out, err := h.svc.AdminListFraudSignals(c.Request.Context(), c.Query("status"), c.Query("kind"), c.Query("q"))
	commerceRespond(c, out, err)
}

func (h *Handler) AdminFraudAction(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req fraudActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.AdminActionFraudSignal(c.Request.Context(), u, c.Param("id"), req.Action, req.Note)
	commerceRespond(c, out, err)
}
