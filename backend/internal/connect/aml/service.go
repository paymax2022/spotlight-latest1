package connectaml

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/ptr"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	keyError = "error"
	keyData  = "data"
)

// Auditor writes an immutable audit entry (connect_audit_log). AML decisions are
// audited (action + reason code + ids — never raw PII).
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// Thresholds are backend-owned kobo limits + window sizes for the rules engine.
// Defaults align with PRD §7 (single-event reporting threshold, velocity burst,
// structuring aggregation). They are NOT client input.
type Thresholds struct {
	// SingleEventKobo: a single event at/above this is reported (THRESHOLD_EXCEEDED).
	SingleEventKobo int64
	// VelocityWindow + VelocityMaxCount: more than MaxCount events in Window → VELOCITY_BURST.
	VelocityWindow   time.Duration
	VelocityMaxCount int
	// StructuringWindow + StructuringAggKobo: many sub-threshold events whose sum
	// reaches AggKobo within Window → STRUCTURING.
	StructuringWindow  time.Duration
	StructuringAggKobo int64
}

// DefaultThresholds returns CBN/NFIU-aligned defaults (₦1,000,000 single-event
// reporting line; ₦5,000,000 aggregate structuring line). All kobo.
func DefaultThresholds() Thresholds {
	return Thresholds{
		SingleEventKobo:    100_000_000, // ₦1,000,000
		VelocityWindow:     time.Hour,
		VelocityMaxCount:   20,
		StructuringWindow:  24 * time.Hour,
		StructuringAggKobo: 500_000_000, // ₦5,000,000
	}
}

// Sentinel errors.
var (
	ErrCaseNotFound = errors.New("aml: case not found or not open")
	ErrInvalidType  = errors.New("aml: report type must be str or sar")
)

// Service runs the monitoring rules engine and owns the NFIU case scaffold.
// Hooks (FlagGift / FlagPaidVote / FlagPayout) are called from the money path;
// they record the event, score it, screen the subject, and raise append-only
// alerts. Scoring NEVER blocks settlement — AML is detect-and-report, not a
// pre-authorization gate (the tier/limit gate is the money-path guard).
type Service struct {
	repo     *Repository
	audit    Auditor
	screener SanctionsScreener
	limits   Thresholds
}

// NewService builds the AML service. If screener is nil, a NoopScreener is used.
func NewService(repo *Repository, audit Auditor, screener SanctionsScreener, limits Thresholds) *Service {
	if screener == nil {
		screener = NoopScreener{}
	}
	if limits.SingleEventKobo == 0 {
		limits = DefaultThresholds()
	}
	return &Service{repo: repo, audit: audit, screener: screener, limits: limits}
}

// FlagGift is the gifting hook (satisfies gifting.SolicitationFlagger).
func (s *Service) FlagGift(ctx context.Context, senderID, recipientID string, amountKobo int64, ref string) error {
	return s.score(ctx, senderID, EventGift, amountKobo, ref)
}

// FlagPaidVote is the voting hook (satisfies voting.SolicitationFlagger).
func (s *Service) FlagPaidVote(ctx context.Context, voterID string, amountKobo int64, ref string) error {
	return s.score(ctx, voterID, EventPaidVote, amountKobo, ref)
}

// FlagPayout is the payouts hook (satisfies payouts.SolicitationFlagger).
func (s *Service) FlagPayout(ctx context.Context, creatorID string, amountKobo int64, ref string) error {
	return s.score(ctx, creatorID, EventPayout, amountKobo, ref)
}

// score records the event projection, evaluates the rules, screens the subject,
// and raises append-only alerts for every triggered reason. Best-effort: a
// scoring/storage error is returned for logging but never unwinds the money move.
func (s *Service) score(ctx context.Context, subjectID string, kind EventKind, amountKobo int64, ref string) error {
	if err := s.repo.RecordEvent(ctx, subjectID, kind, amountKobo, ref); err != nil {
		return err
	}

	// Threshold rule — single event at/above the reporting line.
	if amountKobo >= s.limits.SingleEventKobo {
		s.raise(ctx, subjectID, kind, ReasonThresholdExceeded, amountKobo, 1, ref)
	}

	// Velocity rule — too many events in the short window.
	if s.limits.VelocityMaxCount > 0 {
		n, _, err := s.repo.SumRecent(ctx, subjectID, kind, time.Now().UTC().Add(-s.limits.VelocityWindow))
		if err == nil && n > s.limits.VelocityMaxCount {
			s.raise(ctx, subjectID, kind, ReasonVelocity, amountKobo, n, ref)
		}
	}

	// Structuring rule — many sub-threshold events aggregating past the line.
	if s.limits.StructuringAggKobo > 0 {
		n, total, err := s.repo.SumRecent(ctx, subjectID, kind, time.Now().UTC().Add(-s.limits.StructuringWindow))
		if err == nil && total >= s.limits.StructuringAggKobo && n > 1 {
			s.raise(ctx, subjectID, kind, ReasonStructuring, total, n, ref)
		}
	}

	// Sanctions / PEP screening — stub interface; a hit raises an alert.
	if res, err := s.screener.Screen(ctx, subjectID); err == nil && res.Hit {
		s.raise(ctx, subjectID, kind, ReasonSanctionsHit, amountKobo, 1, ref)
	}
	return nil
}

// raise appends an alert and audits it (best-effort; reason code only, no PII).
func (s *Service) raise(ctx context.Context, subjectID string, kind EventKind, reason ReasonCode, amountKobo int64, windowCount int, ref string) {
	r := ref
	a, err := s.repo.InsertAlert(ctx, &Alert{
		SubjectID:   subjectID,
		EventKind:   kind,
		ReasonCode:  reason,
		AmountKobo:  amountKobo,
		WindowCount: windowCount,
		LedgerRef:   &r,
	})
	if err != nil || s.audit == nil {
		return
	}
	_ = s.audit.WriteAudit(ctx, "connect.aml.alert", "system", "connect_aml_alert", a.ID, map[string]any{
		"reason_code": string(reason), "event_kind": string(kind),
		"amount_kobo": amountKobo, "window_count": windowCount,
	})
}

// ListAlerts returns recent monitoring alerts (admin).
func (s *Service) ListAlerts(ctx context.Context, limit int) ([]Alert, error) {
	return s.repo.ListAlerts(ctx, limit)
}

// ListCases returns recent NFIU STR/SAR cases (admin).
func (s *Service) ListCases(ctx context.Context, limit int) ([]Case, error) {
	return s.repo.ListCases(ctx, limit)
}

// OpenCase opens an append-only STR/SAR case for a subject (admin/compliance).
func (s *Service) OpenCase(ctx context.Context, subjectID, reportType string, reasonCodes []string, adminID string) (*Case, error) {
	if reportType != "str" && reportType != "sar" {
		return nil, ErrInvalidType
	}
	c, err := s.repo.OpenCase(ctx, subjectID, reportType, reasonCodes, &adminID)
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "connect.aml.case.open", adminID, "connect_aml_case", c.ID, map[string]any{
			"report_type": reportType, "reason_codes": reasonCodes,
		})
	}
	return c, nil
}

// FileSTR files an open case with the NFIU (forward-only transition to 'filed').
func (s *Service) FileSTR(ctx context.Context, caseID, adminID string, req FileSTRRequest) (*Case, error) {
	c, err := s.repo.FileSTR(ctx, caseID, adminID, req)
	if err != nil {
		return nil, ErrCaseNotFound
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "connect.aml.case.file_str", adminID, "connect_aml_case", c.ID, map[string]any{
			"filed_ref": req.FiledRef, "report_type": c.ReportType,
		})
	}
	return c, nil
}

// SanctionsScreener screens a subject against sanctions / PEP lists. This is a
// stub INTERFACE: the real implementation plugs in a provider (e.g. a watchlist
// API) without changing the AML service. The default NoopScreener returns no hit
// so the money path is never blocked by an unconfigured provider — production
// MUST wire a real screener (fail-closed policy is provider-side).
// Implementations MUST NOT return or log raw PII; a hit is described by a stable
// list name + match code only.
type SanctionsScreener interface {
	Screen(ctx context.Context, subjectID string) (ScreenResult, error)
}

// NoopScreener is the default stub — always "no hit". Replace in production.
type NoopScreener struct{}

// Screen always returns no hit.
func (NoopScreener) Screen(ctx context.Context, subjectID string) (ScreenResult, error) {
	return ScreenResult{Hit: false}, nil
}

// ReasonCode is a stable machine code describing why an event was flagged.
// Codes (never free-text PII) are the only human-meaningful payload stored.
type ReasonCode string

const (
	ReasonThresholdExceeded ReasonCode = "THRESHOLD_EXCEEDED" // single event >= reporting threshold
	ReasonVelocity          ReasonCode = "VELOCITY_BURST"     // too many events in a short window
	ReasonStructuring       ReasonCode = "STRUCTURING"        // many sub-threshold events aggregating high
	ReasonSanctionsHit      ReasonCode = "SANCTIONS_HIT"      // screening matched a sanctions/PEP list
)

// EventKind is the money-event source that triggered monitoring.
type EventKind string

const (
	EventGift     EventKind = "gift"
	EventPaidVote EventKind = "paid_vote"
	EventPayout   EventKind = "payout"
)

// Alert mirrors a row of public.connect_aml_alerts (append-only).
type Alert struct {
	ID          string     `json:"id"`
	SubjectID   string     `json:"subject_id"`
	EventKind   EventKind  `json:"event_kind"`
	ReasonCode  ReasonCode `json:"reason_code"`
	AmountKobo  int64      `json:"amount_kobo"`
	WindowCount int        `json:"window_count"`
	LedgerRef   *string    `json:"ledger_ref,omitempty"`
	CaseID      *string    `json:"case_id,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// Case mirrors a row of public.connect_aml_cases (append-only NFIU STR/SAR
// scaffold). report_type is 'str' (suspicious transaction) or 'sar' (suspicious
// activity). filed_at is set once the report is filed (forward-only).
type Case struct {
	ID          string     `json:"id"`
	SubjectID   string     `json:"subject_id"`
	ReportType  string     `json:"report_type"`
	Status      string     `json:"status"`
	ReasonCodes []string   `json:"reason_codes"`
	Narrative   *string    `json:"narrative,omitempty"` // compliance summary (NO raw counterpart PII)
	OpenedBy    *string    `json:"opened_by,omitempty"`
	FiledBy     *string    `json:"filed_by,omitempty"`
	FiledRef    *string    `json:"filed_ref,omitempty"` // NFIU acknowledgement reference
	FiledAt     *time.Time `json:"filed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// FileSTRRequest is the admin body for POST /aml/cases/:id/file-str.
type FileSTRRequest struct {
	FiledRef  string `json:"filedRef"`  // NFIU acknowledgement reference
	Narrative string `json:"narrative"` // compliance narrative (reason codes only, no raw PII)
}

// ScreenResult is the outcome of a sanctions/PEP screen.
type ScreenResult struct {
	Hit       bool   `json:"hit"`
	ListName  string `json:"list_name,omitempty"`
	MatchCode string `json:"match_code,omitempty"` // stable code, never a raw name
}

// Handler exposes the AML admin surface over HTTP. All routes are mounted under
// the connect admin group with RBAC connect.aml.* permissions (wired in Register
// via the route file — handlers assume the caller is already authorised).
type Handler struct{ svc *Service }

// NewHandler builds an AML handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// ListAlerts — GET /api/connect/admin/aml/alerts (connect.aml.view).
func (h *Handler) ListAlerts(c *gin.Context) {
	out, err := h.svc.ListAlerts(c.Request.Context(), ptr.DerefZero(ginutil.IntParam(c, "limit")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// ListCases — GET /api/connect/admin/aml/cases (connect.aml.view).
func (h *Handler) ListCases(c *gin.Context) {
	out, err := h.svc.ListCases(c.Request.Context(), ptr.DerefZero(ginutil.IntParam(c, "limit")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// openCaseRequest is the admin body for POST /aml/cases.
type openCaseRequest struct {
	SubjectID   string   `json:"subjectId" binding:"required"`
	ReportType  string   `json:"reportType" binding:"required"` // str | sar
	ReasonCodes []string `json:"reasonCodes"`
}

// OpenCase — POST /api/connect/admin/aml/cases (connect.aml.manage).
func (h *Handler) OpenCase(c *gin.Context) {
	var req openCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
		return
	}
	out, err := h.svc.OpenCase(c.Request.Context(), req.SubjectID, req.ReportType, req.ReasonCodes, ginutil.UserID(c))
	if err != nil {
		if errors.Is(err, ErrInvalidType) {
			c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{keyData: out})
}

// FileSTR — POST /api/connect/admin/aml/cases/:id/file-str (connect.aml.file).
func (h *Handler) FileSTR(c *gin.Context) {
	var req FileSTRRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
		return
	}
	out, err := h.svc.FileSTR(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req)
	if err != nil {
		if errors.Is(err, ErrCaseNotFound) {
			c.JSON(http.StatusNotFound, gin.H{keyError: err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// PermissionGuard mirrors middleware.RequirePermission without importing the
// middleware/services packages into this leaf package: the route file supplies a
// factory that builds the per-permission gin.HandlerFunc.
type PermissionGuard func(permission string) gin.HandlerFunc

// Register wires the AML admin routes under the connect admin group. The caller
// passes a guard factory (built from middleware.RequirePermission + the RBAC
// service) so each route enforces its connect.aml.* permission.
func Register(admin gin.IRouter, svc *Service, guard PermissionGuard) {
	h := NewHandler(svc)
	g := admin.Group("/aml")
	g.GET("/alerts", guard("connect.aml.view"), h.ListAlerts)
	g.GET("/cases", guard("connect.aml.view"), h.ListCases)
	g.POST("/cases", guard("connect.aml.manage"), h.OpenCase)
	g.POST("/cases/:id/file-str", guard("connect.aml.file"), h.FileSTR)
}

// Repository handles connect_aml_alerts + connect_aml_cases over a pgx pool.
// Alerts are insert-only; cases are insert + forward-only status update (file).
// All queries are parameterized; no raw PII is ever written.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds an AML repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// InsertAlert appends an immutable alert row.
func (r *Repository) InsertAlert(ctx context.Context, a *Alert) (*Alert, error) {
	const ins = `INSERT INTO connect_aml_alerts
		(subject_id, event_kind, reason_code, amount_kobo, window_count, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, subject_id, event_kind, reason_code, amount_kobo, window_count, ledger_ref, case_id, created_at`
	out := &Alert{}
	if err := r.db.QueryRow(ctx, ins,
		a.SubjectID, string(a.EventKind), string(a.ReasonCode), a.AmountKobo, a.WindowCount, a.LedgerRef,
	).Scan(
		&out.ID, &out.SubjectID, &out.EventKind, &out.ReasonCode, &out.AmountKobo,
		&out.WindowCount, &out.LedgerRef, &out.CaseID, &out.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("aml: insert alert: %w", err)
	}
	return out, nil
}

// SumRecent returns (count, total kobo) of money events for a subject of a given
// kind since `since` — the input to velocity + structuring scoring. It reads the
// AML alert/event projection table, which records every flagged candidate.
func (r *Repository) SumRecent(ctx context.Context, subjectID string, kind EventKind, since time.Time) (int, int64, error) {
	const q = `SELECT COUNT(*), COALESCE(SUM(amount_kobo),0)
		FROM connect_aml_events
		WHERE subject_id = $1 AND event_kind = $2 AND created_at >= $3`
	var n int
	var total int64
	if err := r.db.QueryRow(ctx, q, subjectID, string(kind), since).Scan(&n, &total); err != nil {
		return 0, 0, fmt.Errorf("aml: sum recent: %w", err)
	}
	return n, total, nil
}

// RecordEvent appends the raw money-event projection used for scoring (subject +
// kind + amount + ledger ref only — never counterpart PII).
func (r *Repository) RecordEvent(ctx context.Context, subjectID string, kind EventKind, amountKobo int64, ledgerRef string) error {
	const ins = `INSERT INTO connect_aml_events (subject_id, event_kind, amount_kobo, ledger_ref)
		VALUES ($1,$2,$3,$4)`
	if _, err := r.db.Exec(ctx, ins, subjectID, string(kind), amountKobo, ledgerRef); err != nil {
		return fmt.Errorf("aml: record event: %w", err)
	}
	return nil
}

const caseColumns = `id, subject_id, report_type, status, reason_codes, narrative,
	opened_by, filed_by, filed_ref, filed_at, created_at, updated_at`

// OpenCase appends an immutable STR/SAR case in 'open' status.
func (r *Repository) OpenCase(ctx context.Context, subjectID, reportType string, reasonCodes []string, openedBy *string) (*Case, error) {
	const ins = `INSERT INTO connect_aml_cases
		(subject_id, report_type, status, reason_codes, opened_by)
		VALUES ($1,$2,'open',$3,$4)
		RETURNING ` + caseColumns
	return scanCase(r.db.QueryRow(ctx, ins, subjectID, reportType, reasonCodes, openedBy))
}

// FileSTR transitions a case to 'filed' (forward-only) and stamps the NFIU
// acknowledgement reference + compliance narrative. Refuses to re-file.
func (r *Repository) FileSTR(ctx context.Context, id, filedBy string, req FileSTRRequest) (*Case, error) {
	const upd = `UPDATE connect_aml_cases SET
			status     = 'filed',
			filed_by   = $2,
			filed_ref  = NULLIF($3,''),
			narrative  = COALESCE(NULLIF($4,''), narrative),
			filed_at   = now(),
			updated_at = now()
		WHERE id = $1 AND status = 'open'
		RETURNING ` + caseColumns
	return scanCase(r.db.QueryRow(ctx, upd, id, filedBy, req.FiledRef, req.Narrative))
}

// ListAlerts returns recent alerts, newest first.
func (r *Repository) ListAlerts(ctx context.Context, limit int) ([]Alert, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, subject_id, event_kind, reason_code, amount_kobo, window_count, ledger_ref, case_id, created_at
		FROM connect_aml_alerts ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("aml: list alerts: %w", err)
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		var a Alert
		if err := rows.Scan(&a.ID, &a.SubjectID, &a.EventKind, &a.ReasonCode,
			&a.AmountKobo, &a.WindowCount, &a.LedgerRef, &a.CaseID, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListCases returns recent cases, newest first.
func (r *Repository) ListCases(ctx context.Context, limit int) ([]Case, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT ` + caseColumns + ` FROM connect_aml_cases ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("aml: list cases: %w", err)
	}
	defer rows.Close()
	var out []Case
	for rows.Next() {
		c, err := scanCase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// rowScanner abstracts pgx.Row / pgx.Rows for the shared case scan.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanCase(s rowScanner) (*Case, error) {
	c := &Case{}
	if err := s.Scan(
		&c.ID, &c.SubjectID, &c.ReportType, &c.Status, &c.ReasonCodes, &c.Narrative,
		&c.OpenedBy, &c.FiledBy, &c.FiledRef, &c.FiledAt, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return c, nil
}
