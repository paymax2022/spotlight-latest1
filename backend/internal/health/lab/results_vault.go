package healthlab

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Results vault for the patient (and an explicitly consented grantee). A "result"
// here is one released order — the unit the patient opens, shares and reviews —
// built from the per-test lab_results rows. Nothing is mocked: flags, escalation
// steps, release metadata and acknowledgement all come from persisted rows.

// ConsentGate is the HL-8 consent seam (REUSE health/consent via an app adapter).
type ConsentGate interface {
	Grant(ctx context.Context, grantorID, granteeID, scope string, expiresAt *time.Time) (consentID string, err error)
	HasActiveGrant(ctx context.Context, granteeID, subjectOwnerID, scope string) (consentID string, ok bool, err error)
}

// VaultReader resolves a vault record's report document to a short-lived signed
// URL (REUSE health/records, which access-logs the read). Nil-safe: unwired => 503.
type VaultReader interface {
	SignedDocURL(ctx context.Context, accessorID, recordID string) (url string, err error)
}

// SetResultSharing injects the consent gate and signed-URL reader (app wiring).
func (s *Service) SetResultSharing(c ConsentGate, v VaultReader) { s.consent, s.vaultRead = c, v }

var (
	ErrAckRequired        = errors.New("lab: acknowledge the consent notice before opening these results")
	ErrShareSelf          = errors.New("lab: you already have access to your own results")
	ErrRecipientNotFound  = errors.New("lab: no Spotlight account found for that email")
	ErrSharingUnavailable = errors.New("lab: result sharing is not available right now")
	ErrNoReportDocument   = errors.New("lab: no report document has been issued for this result yet")
	ErrBadShareDuration   = errors.New("lab: sharing can last 1 to 365 days")
)

const resultsScope = "LAB_RESULTS"

type ResultAnalyte struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Value          string `json:"value"`
	Unit           string `json:"unit"`
	ReferenceRange string `json:"reference_range"`
	Flag           string `json:"flag"` // normal | low | high | abnormal | critical
}

type EscalationStep struct {
	Label string     `json:"label"`
	At    *time.Time `json:"at,omitempty"`
	Done  bool       `json:"done"`
}

type Escalation struct {
	Status      string           `json:"status"` // pending | patient_notified | resolved
	RaisedAt    *time.Time       `json:"raised_at,omitempty"`
	AnalyteName string           `json:"analyte_name"`
	Steps       []EscalationStep `json:"steps"`
}

// ResultView is what the app renders. Analytes are present only on the detail
// read, and never while an HL-7 escalation is still with the care team.
type ResultView struct {
	ID               string          `json:"id"` // the order id
	OrderID          string          `json:"order_id"`
	RecordID         *string         `json:"record_id,omitempty"`
	TestName         string          `json:"test_name"`
	LabName          string          `json:"lab_name"`
	Status           string          `json:"status"` // RELEASED | ESCALATED
	ReleasedByName   string          `json:"released_by_name,omitempty"`
	ReleasedAt       *time.Time      `json:"released_at,omitempty"`
	CollectedAt      *time.Time      `json:"collected_at,omitempty"`
	HasAbnormal      bool            `json:"has_abnormal"`
	HasCritical      bool            `json:"has_critical"`
	Analytes         []ResultAnalyte `json:"analytes"`
	AnalytesWithheld bool            `json:"analytes_withheld"`
	Escalation       *Escalation     `json:"escalation,omitempty"`
	Acknowledged     bool            `json:"acknowledged"`
	HasDocument      bool            `json:"has_document"`
	SharedBy         string          `json:"shared_by,omitempty"`
}

type resultOrderRow struct {
	orderID, state, patientID, labName string
	recordID                           *string
	collectedAt                        *time.Time
}

const resultOrderSelect = `
	SELECT o.id, o.state, o.patient_id, p.display_name, o.result_record_id, s.collected_at
	FROM lab_orders o
	JOIN health_providers p ON p.id = o.lab_provider_id
	LEFT JOIN lab_samples s ON s.order_id = o.id`

func visibleState(state string) bool {
	return state == "ESCALATED" || state == "RELEASED" || state == "CLOSED"
}

func releasedState(state string) bool { return state == "RELEASED" || state == "CLOSED" }

var (
	reLess    = regexp.MustCompile(`^\s*(?:<=|<|≤)\s*([0-9]+(?:\.[0-9]+)?)`)
	reGreater = regexp.MustCompile(`^\s*(?:>=|>|≥)\s*([0-9]+(?:\.[0-9]+)?)`)
	reSpan    = regexp.MustCompile(`^\s*([0-9]+(?:\.[0-9]+)?)\s*[-–]\s*([0-9]+(?:\.[0-9]+)?)`)
)

// inferFlag maps the stored NORMAL/ABNORMAL/CRITICAL status to a display flag. The
// store keeps severity only, so direction is inferred from the numeric value and
// the reference range; when it cannot be derived the flag is a plain "abnormal" —
// never a guessed high/low.
func inferFlag(status ResultStatus, value, refRange string) string {
	switch status {
	case ResultNormal:
		return "normal"
	case ResultCritical:
		return "critical"
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return "abnormal"
	}
	if m := reSpan.FindStringSubmatch(refRange); m != nil {
		lo, _ := strconv.ParseFloat(m[1], 64)
		hi, _ := strconv.ParseFloat(m[2], 64)
		switch {
		case v < lo:
			return "low"
		case v > hi:
			return "high"
		}
	}
	if m := reLess.FindStringSubmatch(refRange); m != nil {
		if x, _ := strconv.ParseFloat(m[1], 64); v >= x {
			return "high"
		}
	}
	if m := reGreater.FindStringSubmatch(refRange); m != nil {
		if x, _ := strconv.ParseFloat(m[1], 64); v <= x {
			return "low"
		}
	}
	return "abnormal"
}

func scanResultOrder(row pgx.Row) (*resultOrderRow, error) {
	var r resultOrderRow
	if err := row.Scan(&r.orderID, &r.state, &r.patientID, &r.labName, &r.recordID, &r.collectedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOrderNotFound
		}
		return nil, err
	}
	return &r, nil
}

func (s *Service) queryResultOrders(ctx context.Context, where string, args ...any) ([]resultOrderRow, error) {
	rows, err := s.db.Query(ctx, resultOrderSelect+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var orders []resultOrderRow
	for rows.Next() {
		var r resultOrderRow
		if err := rows.Scan(&r.orderID, &r.state, &r.patientID, &r.labName, &r.recordID, &r.collectedAt); err != nil {
			return nil, err
		}
		orders = append(orders, r)
	}
	return orders, rows.Err()
}

// buildView assembles one ResultView from persisted rows.
func (s *Service) buildView(ctx context.Context, o *resultOrderRow, withAnalytes bool, viewerID string) (*ResultView, error) {
	results, err := s.loadResults(ctx, o.orderID)
	if err != nil {
		return nil, err
	}
	v := &ResultView{
		ID: o.orderID, OrderID: o.orderID, RecordID: o.recordID, LabName: o.labName,
		Status: "RELEASED", CollectedAt: o.collectedAt, Analytes: []ResultAnalyte{},
	}
	if o.state == "ESCALATED" {
		v.Status = "ESCALATED"
	}
	names := make([]string, 0, len(results))
	seen := map[string]bool{}
	var criticalName string
	var escalatedAt, releasedAt *time.Time
	var releasedBy *string
	for _, r := range results {
		if !seen[r.TestName] {
			seen[r.TestName] = true
			names = append(names, r.TestName)
		}
		if r.Status != ResultNormal {
			v.HasAbnormal = true
		}
		if r.Status == ResultCritical {
			v.HasCritical = true
			if criticalName == "" {
				criticalName = r.TestName
			}
		}
		if r.EscalatedAt != nil && (escalatedAt == nil || r.EscalatedAt.Before(*escalatedAt)) {
			escalatedAt = r.EscalatedAt
		}
		if r.ReleasedAt != nil && (releasedAt == nil || r.ReleasedAt.After(*releasedAt)) {
			releasedAt = r.ReleasedAt
		}
		if r.ReleasedBy != nil {
			releasedBy = r.ReleasedBy
		}
	}
	v.TestName = strings.Join(names, ", ")
	if releasedState(o.state) {
		v.ReleasedAt = releasedAt
	}
	if releasedBy != nil {
		var name string
		_ = s.db.QueryRow(ctx, `SELECT COALESCE(NULLIF(btrim(full_name),''), NULLIF(btrim(display_name),''), '') FROM user_profiles WHERE id = $1`, *releasedBy).Scan(&name)
		v.ReleasedByName = name
	}

	if v.HasCritical {
		var notifiedAt *time.Time
		_ = s.db.QueryRow(ctx, `SELECT min(created_at) FROM lab_critical_notifications WHERE order_id = $1`, o.orderID).Scan(&notifiedAt)
		esc := &Escalation{AnalyteName: criticalName, RaisedAt: escalatedAt, Status: "pending"}
		esc.Steps = []EscalationStep{
			{Label: "Critical value detected and flagged", At: escalatedAt, Done: escalatedAt != nil},
			{Label: "Care team notified", At: notifiedAt, Done: notifiedAt != nil},
			{Label: "Result released to you", At: v.ReleasedAt, Done: releasedState(o.state)},
		}
		switch {
		case releasedState(o.state):
			esc.Status = "resolved"
		case notifiedAt != nil:
			esc.Status = "patient_notified"
		}
		v.Escalation = esc
	}

	var n int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM lab_result_acknowledgements WHERE order_id = $1 AND user_id = $2`, o.orderID, viewerID).Scan(&n)
	v.Acknowledged = n > 0
	if o.recordID != nil {
		_ = s.db.QueryRow(ctx, `SELECT count(*) FROM health_record_docs WHERE record_id = $1`, *o.recordID).Scan(&n)
		v.HasDocument = n > 0
	}

	// Values are shown only once released; a critical result still with the care
	// team (HL-7) shows its escalation, never the numbers.
	if withAnalytes && releasedState(o.state) {
		for _, r := range results {
			v.Analytes = append(v.Analytes, ResultAnalyte{
				ID: r.ID, Name: r.TestName, Value: r.Value, Unit: r.Unit,
				ReferenceRange: r.RefRange, Flag: inferFlag(r.Status, r.Value, r.RefRange),
			})
		}
	} else if withAnalytes {
		v.AnalytesWithheld = true
	}
	return v, nil
}

func (s *Service) buildViews(ctx context.Context, orders []resultOrderRow, viewerID string) ([]ResultView, error) {
	out := make([]ResultView, 0, len(orders))
	for i := range orders {
		v, err := s.buildView(ctx, &orders[i], false, viewerID)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, nil
}

// ListMyResults returns the caller's results (summaries — no analyte values).
func (s *Service) ListMyResults(ctx context.Context, userID string) ([]ResultView, error) {
	orders, err := s.queryResultOrders(ctx, `
		WHERE o.patient_id = $1 AND o.state IN ('ESCALATED','RELEASED','CLOSED')
		  AND EXISTS (SELECT 1 FROM lab_results r WHERE r.order_id = o.id AND r.superseded_by IS NULL)
		ORDER BY o.updated_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	return s.buildViews(ctx, orders, userID)
}

// GetResultView returns one result. The patient must have acknowledged the consent
// notice; a grantee needs an ACTIVE LAB_RESULTS (or ALL) grant and sees released
// results only. Anything else is indistinguishable from "not found".
func (s *Service) GetResultView(ctx context.Context, requesterID, orderID string) (*ResultView, error) {
	o, err := scanResultOrder(s.db.QueryRow(ctx, resultOrderSelect+` WHERE o.id = $1`, orderID))
	if err != nil {
		return nil, err
	}
	if !visibleState(o.state) {
		return nil, ErrOrderNotFound
	}
	if requesterID == o.patientID {
		var n int
		_ = s.db.QueryRow(ctx, `SELECT count(*) FROM lab_result_acknowledgements WHERE order_id = $1 AND user_id = $2`, orderID, requesterID).Scan(&n)
		if n == 0 {
			return nil, ErrAckRequired
		}
		s.logVaultRead(ctx, o, requesterID, "OWNER", nil)
		return s.buildView(ctx, o, true, requesterID)
	}
	if s.consent == nil || !releasedState(o.state) {
		return nil, ErrOrderNotFound
	}
	cid, ok, err := s.consent.HasActiveGrant(ctx, requesterID, o.patientID, resultsScope)
	if err != nil || !ok {
		return nil, ErrOrderNotFound
	}
	s.logVaultRead(ctx, o, requesterID, "CONSENT", &cid)
	return s.buildView(ctx, o, true, requesterID)
}

// logVaultRead appends to the immutable HL-8 read trail when the result has a
// vault record. Best-effort: it must never turn a permitted read into a failure.
func (s *Service) logVaultRead(ctx context.Context, o *resultOrderRow, accessor, basis string, consentID *string) {
	if o.recordID == nil {
		return
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO health_record_access_log (record_id, accessor_id, access_basis, consent_id)
		VALUES ($1,$2,$3,$4)`, *o.recordID, accessor, basis, consentID)
}

// AcknowledgeResult records the patient's consent acknowledgement (idempotent).
func (s *Service) AcknowledgeResult(ctx context.Context, userID, orderID string) (time.Time, error) {
	var state string
	err := s.db.QueryRow(ctx, `SELECT state FROM lab_orders WHERE id = $1 AND patient_id = $2`, orderID, userID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !visibleState(state)) {
		return time.Time{}, ErrOrderNotFound
	}
	if err != nil {
		return time.Time{}, err
	}
	var at time.Time
	err = s.db.QueryRow(ctx, `
		INSERT INTO lab_result_acknowledgements (order_id, user_id) VALUES ($1,$2)
		ON CONFLICT (order_id, user_id) DO UPDATE SET order_id = EXCLUDED.order_id
		RETURNING acknowledged_at`, orderID, userID).Scan(&at)
	if err != nil {
		return time.Time{}, err
	}
	s.audited(userID, "", "health.lab.result.acknowledge", orderID, nil, nil)
	return at, nil
}

// ShareResult grants a Spotlight user read access to the caller's lab results
// (scope LAB_RESULTS) for 1-365 days, via the shared, revocable consent module.
// Re-sharing with someone who already holds an active grant is a no-op success.
func (s *Service) ShareResult(ctx context.Context, userID, orderID, granteeEmail string, days int) (string, time.Time, error) {
	if s.consent == nil {
		return "", time.Time{}, ErrSharingUnavailable
	}
	if days == 0 {
		days = 30
	}
	if days < 1 || days > 365 {
		return "", time.Time{}, ErrBadShareDuration
	}
	var state string
	qerr := s.db.QueryRow(ctx, `SELECT state FROM lab_orders WHERE id = $1 AND patient_id = $2`, orderID, userID).Scan(&state)
	if errors.Is(qerr, pgx.ErrNoRows) || (qerr == nil && !releasedState(state)) {
		return "", time.Time{}, ErrOrderNotFound
	}
	if qerr != nil {
		return "", time.Time{}, qerr
	}
	var granteeID string
	gerr := s.db.QueryRow(ctx, `SELECT id::text FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`, strings.TrimSpace(granteeEmail)).Scan(&granteeID)
	if errors.Is(gerr, pgx.ErrNoRows) {
		return "", time.Time{}, ErrRecipientNotFound
	}
	if gerr != nil {
		return "", time.Time{}, gerr
	}
	if granteeID == userID {
		return "", time.Time{}, ErrShareSelf
	}
	if cid, ok, _ := s.consent.HasActiveGrant(ctx, granteeID, userID, resultsScope); ok {
		return cid, time.Time{}, nil
	}
	expiresAt := time.Now().Add(time.Duration(days) * 24 * time.Hour)
	cid, cerr := s.consent.Grant(ctx, userID, granteeID, resultsScope, &expiresAt)
	if cerr != nil {
		return "", time.Time{}, cerr
	}
	s.audited(userID, granteeID, "health.lab.result.share", orderID, nil,
		map[string]any{"scope": resultsScope, "days": days})
	return cid, expiresAt, nil
}

// ListSharedWithMe lists released results other patients have shared with the caller.
func (s *Service) ListSharedWithMe(ctx context.Context, granteeID string) ([]ResultView, error) {
	orders, err := s.queryResultOrders(ctx, `
		WHERE o.state IN ('RELEASED','CLOSED') AND o.patient_id <> $1
		  AND EXISTS (SELECT 1 FROM health_consents c
		              WHERE c.grantee_id = $1 AND c.subject_owner_id = o.patient_id
		                AND c.grantor_id = c.subject_owner_id AND c.state = 'ACTIVE'
		                AND c.scope IN ('LAB_RESULTS','ALL')
		                AND (c.expires_at IS NULL OR c.expires_at > now()))
		  AND EXISTS (SELECT 1 FROM lab_results r WHERE r.order_id = o.id AND r.superseded_by IS NULL)
		ORDER BY o.updated_at DESC LIMIT 100`, granteeID)
	if err != nil {
		return nil, err
	}
	views, err := s.buildViews(ctx, orders, granteeID)
	if err != nil {
		return nil, err
	}
	for i := range views {
		var by string
		_ = s.db.QueryRow(ctx, `SELECT COALESCE(NULLIF(btrim(full_name),''), '') FROM user_profiles WHERE id = $1`, orders[i].patientID).Scan(&by)
		views[i].SharedBy = shortAuthor(by)
	}
	return views, nil
}

// ResultSignedURL returns a short-lived signed URL for the result's report
// document. Owner only; the read is access-logged by the vault.
func (s *Service) ResultSignedURL(ctx context.Context, userID, orderID string) (string, error) {
	o, err := scanResultOrder(s.db.QueryRow(ctx, resultOrderSelect+` WHERE o.id = $1 AND o.patient_id = $2`, orderID, userID))
	if err != nil {
		return "", err
	}
	if !releasedState(o.state) {
		return "", ErrOrderNotFound
	}
	if o.recordID == nil {
		return "", ErrNoReportDocument
	}
	var n int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM health_record_docs WHERE record_id = $1`, *o.recordID).Scan(&n)
	if n == 0 {
		return "", ErrNoReportDocument
	}
	if s.vaultRead == nil {
		return "", ErrSharingUnavailable
	}
	return s.vaultRead.SignedDocURL(ctx, userID, *o.recordID)
}
