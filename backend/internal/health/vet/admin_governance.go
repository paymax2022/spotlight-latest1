package healthvet

// Admin governance writes behind the console: service reactivation, vet
// capability suspend/reinstate (delegated to the providers state machine), and
// the moderation queue (vet_moderation_items). Every write is audited (HL-12).

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
)

// CapabilityStatusSetter suspends/reinstates a provider capability (HL-2).
// Satisfied in the app layer by an adapter over healthproviders.Service.
type CapabilityStatusSetter interface {
	SetCapabilityStatus(ctx context.Context, adminID, providerID, action, note string) error
}

var (
	ErrProviderNotFound    = errors.New("vet: provider not found")
	ErrGovernanceUnwired   = errors.New("vet: provider status changes are not configured")
	ErrModerationNotFound  = errors.New("vet: moderation item not found")
	ErrModerationClosed    = errors.New("vet: moderation item is already closed")
	ErrModerationBadAction = errors.New("vet: action must be investigate, resolve, ignore or suspend_provider")
	ErrReportInvalid       = errors.New("vet: kind must be a known report kind and summary 1-1000 characters")
)

const (
	modOpen          = "open"
	modInvestigating = "investigating"
	modResolved      = "resolved"
	modIgnored       = "ignored"
	actionSuspend    = "suspend"

	keyStatus     = "status"
	keyProviderID = "provider_id"
	keyData       = "data"
	keySuccess    = "success"
	keyActive     = "active"
	sevMedium     = "medium"
	sevLow        = "low"
)

// okJSON writes the console's {"success": true, "data": …} envelope at code.
func okJSON(c *gin.Context, code int, data any) {
	if code == http.StatusOK {
		consoleOK(c, data, nil)
		return
	}
	c.JSON(code, gin.H{keySuccess: true, keyData: data})
}

var reportKinds = map[string]string{ // kind → default severity
	"profile_claim": sevMedium, "review_abuse": sevLow, "credential_mismatch": "high",
	"unlicensed_advice": sevMedium, "image_violation": sevMedium, "other": sevLow,
}

// SetCapabilityStatusSetter wires the providers state machine (nil ⇒ suspend/reinstate refuse).
func (s *Service) SetCapabilityStatusSetter(c CapabilityStatusSetter) { s.capability = c }

// AdminReactivateService puts a deactivated vet service back in the catalog.
func (s *Service) AdminReactivateService(ctx context.Context, adminID, serviceID string) error {
	ct, err := s.db.Exec(ctx, `UPDATE vet_services SET active=true, updated_at=now() WHERE id=$1`, serviceID)
	if err != nil {
		return fmt.Errorf("vet: reactivate service: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return errors.New("vet: service not found")
	}
	s.audited(adminID, "", "health.vet.service.reactivate", serviceID, map[string]any{keyActive: false}, map[string]any{keyActive: true})
	return nil
}

// AdminSetProviderStatus suspends or reinstates a VET provider capability.
func (s *Service) AdminSetProviderStatus(ctx context.Context, adminID, providerID, action, note string) error {
	if s.capability == nil {
		return ErrGovernanceUnwired
	}
	var isVet bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM health_providers WHERE id=$1 AND domain='VET')`, providerID).Scan(&isVet); err != nil {
		return fmt.Errorf("vet: provider lookup: %w", err)
	}
	if !isVet {
		return ErrProviderNotFound
	}
	return s.capability.SetCapabilityStatus(ctx, adminID, providerID, action, note)
}

// AdminConsoleModerationItem is ModerationItem in the console's types.
type AdminConsoleModerationItem struct {
	ID             string    `json:"id"`
	Kind           string    `json:"kind"`
	SubjectID      string    `json:"subject_id"`
	SubjectMasked  string    `json:"subject_masked"`
	Summary        string    `json:"summary"`
	Severity       string    `json:"severity"`
	Status         string    `json:"status"`
	VCNLicenceNo   *string   `json:"vcn_licence_no"`
	ReporterMasked *string   `json:"reporter_masked"`
	CreatedAt      time.Time `json:"created_at"`
}

func (s *Service) AdminListModeration(ctx context.Context) ([]AdminConsoleModerationItem, error) {
	rows, err := s.db.Query(ctx, `
		SELECT m.id::text, m.kind, m.subject_provider_id::text, COALESCE(hp.display_name,''), m.summary,
		       m.severity, m.status, NULLIF(COALESCE(dv.licence_number,''),''), m.reporter_user_id::text, m.created_at
		FROM vet_moderation_items m
		LEFT JOIN health_providers hp ON hp.id = m.subject_provider_id
		LEFT JOIN doctor_vet_profiles dv ON dv.user_id = hp.owner_user_id
		ORDER BY (m.status IN ('open','investigating')) DESC, m.created_at DESC LIMIT 500`)
	if err != nil {
		return nil, fmt.Errorf("vet: console moderation: %w", err)
	}
	defer rows.Close()
	out := []AdminConsoleModerationItem{}
	for rows.Next() {
		var m AdminConsoleModerationItem
		var reporter *string
		if err := rows.Scan(&m.ID, &m.Kind, &m.SubjectID, &m.SubjectMasked, &m.Summary, &m.Severity, &m.Status,
			&m.VCNLicenceNo, &reporter, &m.CreatedAt); err != nil {
			return nil, err
		}
		if reporter != nil {
			masked := maskedOwner(*reporter)
			m.ReporterMasked = &masked
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ReportVet raises a moderation item against a VET provider. A repeated
// (reporter, idempotency key) returns the original item id.
func (s *Service) ReportVet(ctx context.Context, reporterID, providerID, kind, summary, idemKey string) (string, error) {
	severity, ok := reportKinds[kind]
	summary = strings.TrimSpace(summary)
	if !ok || summary == "" || len(summary) > 1000 {
		return "", ErrReportInvalid
	}
	var isVet bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM health_providers WHERE id=$1 AND domain='VET')`, providerID).Scan(&isVet); err != nil {
		return "", fmt.Errorf("vet: provider lookup: %w", err)
	}
	if !isVet {
		return "", ErrProviderNotFound
	}
	var key any
	if idemKey != "" {
		key = idemKey
		var existing string
		err := s.db.QueryRow(ctx, `SELECT id::text FROM vet_moderation_items WHERE reporter_user_id=$1 AND idempotency_key=$2`, reporterID, idemKey).Scan(&existing)
		if err == nil {
			return existing, nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("vet: report replay: %w", err)
		}
	}
	var id string
	if err := s.db.QueryRow(ctx, `
		INSERT INTO vet_moderation_items (kind, subject_provider_id, summary, severity, reporter_user_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text`, kind, providerID, summary, severity, reporterID, key).Scan(&id); err != nil {
		return "", fmt.Errorf("vet: report insert: %w", err)
	}
	s.audited(reporterID, "", "health.vet.moderation.report", id, nil, map[string]any{"kind": kind, keyProviderID: providerID})
	return id, nil
}

// AdminModerate applies an admin action to an open/investigating item.
func (s *Service) AdminModerate(ctx context.Context, adminID, itemID, action, note string) (string, error) {
	next := map[string]string{"investigate": modInvestigating, "resolve": modResolved, "ignore": modIgnored, "suspend_provider": modResolved}[action]
	if next == "" {
		return "", ErrModerationBadAction
	}
	var status, providerID string
	if err := s.db.QueryRow(ctx, `SELECT status, subject_provider_id::text FROM vet_moderation_items WHERE id=$1`, itemID).Scan(&status, &providerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrModerationNotFound
		}
		return "", fmt.Errorf("vet: moderation lookup: %w", err)
	}
	if status != modOpen && status != modInvestigating {
		return "", ErrModerationClosed
	}
	if action == "investigate" && status == modInvestigating {
		return status, nil
	}
	if action == "suspend_provider" {
		if err := s.AdminSetProviderStatus(ctx, adminID, providerID, actionSuspend, note); err != nil {
			return "", err
		}
	}
	ct, err := s.db.Exec(ctx, `
		UPDATE vet_moderation_items SET status=$2, resolution=$3, resolution_note=$4, decided_by=$5, updated_at=now()
		WHERE id=$1 AND status IN ('open','investigating')`, itemID, next, action, note, adminID)
	if err != nil {
		return "", fmt.Errorf("vet: moderation update: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return "", ErrModerationClosed // raced with another admin
	}
	s.audited(adminID, "", "health.vet.moderation.action", itemID,
		map[string]any{keyStatus: status}, map[string]any{keyStatus: next, "action": action, keyProviderID: providerID, "note": note})
	return next, nil
}

// ── handlers ────────────────────────────────────────────────────────────────

func governanceFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrProviderNotFound), errors.Is(err, ErrModerationNotFound):
		failErr(c, http.StatusNotFound, err)
	case errors.Is(err, ErrModerationBadAction), errors.Is(err, ErrReportInvalid):
		failErr(c, http.StatusBadRequest, err)
	case errors.Is(err, ErrGovernanceUnwired):
		failErr(c, http.StatusServiceUnavailable, err)
	default:
		failErr(c, http.StatusConflict, err)
	}
}

type noteBody struct {
	Note   string `json:"note"`
	Action string `json:"action"`
}

func bindNote(c *gin.Context) (noteBody, bool) {
	var b noteBody
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&b); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
			return b, false
		}
	}
	b.Note = strings.TrimSpace(b.Note)
	return b, true
}

// AdminReactivateService — POST /admin/services/:id/reactivate
func (h *Handler) AdminReactivateService(c *gin.Context) {
	id, ok := uuidPathID(c, "service id")
	if !ok {
		return
	}
	if err := h.svc.AdminReactivateService(c.Request.Context(), ginutil.UserID(c), id); err != nil {
		failVet(c, http.StatusConflict, err)
		return
	}
	okJSON(c, http.StatusOK, gin.H{"id": id})
}

// AdminProviderStatus returns the handler for POST /admin/providers/:id/{suspend|reinstate}.
func (h *Handler) AdminProviderStatus(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := uuidPathID(c, "provider id")
		if !ok {
			return
		}
		b, ok := bindNote(c)
		if !ok {
			return
		}
		if err := h.svc.AdminSetProviderStatus(c.Request.Context(), ginutil.UserID(c), id, action, b.Note); err != nil {
			governanceFail(c, err)
			return
		}
		okJSON(c, http.StatusOK, gin.H{"id": id, "action": action})
	}
}

// AdminListModeration — GET /admin/moderation
func (h *Handler) AdminListModeration(c *gin.Context) {
	d, err := h.svc.AdminListModeration(c.Request.Context())
	consoleOK(c, d, err)
}

// AdminModerate — POST /admin/moderation/:id/action {action, note}
func (h *Handler) AdminModerate(c *gin.Context) {
	id, ok := uuidPathID(c, "moderation id")
	if !ok {
		return
	}
	b, ok := bindNote(c)
	if !ok {
		return
	}
	status, err := h.svc.AdminModerate(c.Request.Context(), ginutil.UserID(c), id, b.Action, b.Note)
	if err != nil {
		governanceFail(c, err)
		return
	}
	okJSON(c, http.StatusOK, gin.H{"id": id, keyStatus: status})
}

// ReportVet — POST /vets/:id/report {kind, summary}  (member)
func (h *Handler) ReportVet(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := uuidPathID(c, "vet id")
	if !ok {
		return
	}
	var b struct {
		Kind    string `json:"kind"`
		Summary string `json:"summary"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	rid, err := h.svc.ReportVet(c.Request.Context(), uid, id, b.Kind, b.Summary, ginutil.IdempotencyKey(c))
	if err != nil {
		governanceFail(c, err)
		return
	}
	okJSON(c, http.StatusCreated, gin.H{"id": rid, keyStatus: modOpen})
}
