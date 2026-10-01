package connectdatesafety

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/jsonx"
	connectsafety "spotlight/backend/internal/connect/safety"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns the date-safety center. All reads/writes are scoped to the owner
// (object-level authz) so one user can never see or mutate another's contacts or
// plans; RLS is the DB backstop.
type Service struct {
	db     *pgxpool.Pool
	safety *connectsafety.Service
}

// NewService wires the date-safety service over the pool + safety backbone.
func NewService(db *pgxpool.Pool, safety *connectsafety.Service) *Service {
	return &Service{db: db, safety: safety}
}

// ErrNotFound is returned when a record does not exist or is not owned by caller.
var ErrNotFound = errors.New("connect: record not found")

// AddContact stores a trusted contact for the owner. Phone is sensitive PII and
// is never logged.
func (s *Service) AddContact(ctx context.Context, userID string, req TrustedContactRequest) (*TrustedContact, error) {
	const ins = `INSERT INTO connect_trusted_contacts (user_id, name, phone, relationship)
		VALUES ($1::uuid, $2, $3, NULLIF($4,''))
		RETURNING id, name, phone, COALESCE(relationship,''), created_at`
	var t TrustedContact
	if err := s.db.QueryRow(ctx, ins, userID, req.Name, req.Phone, req.Relationship).Scan(
		&t.ID, &t.Name, &t.Phone, &t.Relationship, &t.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("connect: add trusted contact: %w", err)
	}
	return &t, nil
}

// ListContacts returns the owner's trusted contacts.
func (s *Service) ListContacts(ctx context.Context, userID string) ([]TrustedContact, error) {
	const q = `SELECT id, name, phone, COALESCE(relationship,''), created_at
		FROM connect_trusted_contacts WHERE user_id = $1::uuid ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list trusted contacts: %w", err)
	}
	defer rows.Close()
	var out []TrustedContact
	for rows.Next() {
		var t TrustedContact
		if err := rows.Scan(&t.ID, &t.Name, &t.Phone, &t.Relationship, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteContact removes a trusted contact the owner holds.
func (s *Service) DeleteContact(ctx context.Context, userID, contactID string) error {
	const del = `DELETE FROM connect_trusted_contacts WHERE id = $1::uuid AND user_id = $2::uuid`
	tag, err := s.db.Exec(ctx, del, contactID, userID)
	if err != nil {
		return fmt.Errorf("connect: delete trusted contact: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CreatePlan creates a date plan owned by the caller for one of their matches.
func (s *Service) CreatePlan(ctx context.Context, userID string, req CreateDatePlanRequest) (*DatePlan, error) {
	const ins = `INSERT INTO connect_date_plans (match_id, owner_id, idea, venue, scheduled_at)
		VALUES ($1::uuid, $2::uuid, NULLIF($3,''), NULLIF($4,''), $5)
		RETURNING ` + planColumns
	return s.scanPlan(s.db.QueryRow(ctx, ins, req.MatchID, userID, req.Idea, req.Venue, req.ScheduledAt))
}

// Share marks a plan shared with one of the owner's trusted contacts and moves
// the check-in state planned→shared (guarded transition).
func (s *Service) Share(ctx context.Context, userID, planID string, req ShareRequest) (*DatePlan, error) {
	// Verify the contact belongs to the same owner (object-level authz).
	const own = `SELECT EXISTS (SELECT 1 FROM connect_trusted_contacts
		WHERE id = $1::uuid AND user_id = $2::uuid)`
	var ok bool
	if err := s.db.QueryRow(ctx, own, req.ContactID, userID).Scan(&ok); err != nil {
		return nil, fmt.Errorf("connect: verify contact: %w", err)
	}
	if !ok {
		return nil, ErrNotFound
	}
	const upd = `UPDATE connect_date_plans
		SET shared_with_contact = true, shared_contact_id = $3::uuid,
		    checkin_state = CASE WHEN checkin_state = 'planned' THEN 'shared' ELSE checkin_state END
		WHERE id = $1::uuid AND owner_id = $2::uuid
		RETURNING ` + planColumns
	return s.scanPlan(s.db.QueryRow(ctx, upd, planID, userID, req.ContactID))
}

// CheckIn advances the plan to checked_in (guarded). Records the check-in time.
func (s *Service) CheckIn(ctx context.Context, userID, planID string) (*DatePlan, error) {
	cur, err := s.getPlan(ctx, userID, planID)
	if err != nil {
		return nil, err
	}
	if !CanTransition(cur.CheckinState, StateCheckedIn) {
		return nil, fmt.Errorf("connect: cannot check in from state %q", cur.CheckinState)
	}
	const upd = `UPDATE connect_date_plans
		SET checkin_state = 'checked_in', checkin_at = now()
		WHERE id = $1::uuid AND owner_id = $2::uuid
		RETURNING ` + planColumns
	return s.scanPlan(s.db.QueryRow(ctx, upd, planID, userID))
}

// Feedback records post-date feedback and completes the plan. If the user marks
// a safety concern, a connect_case is ALSO opened (never fails silently).
func (s *Service) Feedback(ctx context.Context, userID, planID string, req FeedbackRequest) (*DatePlan, error) {
	cur, err := s.getPlan(ctx, userID, planID)
	if err != nil {
		return nil, err
	}
	if !CanTransition(cur.CheckinState, StateCompleted) {
		return nil, fmt.Errorf("connect: cannot complete from state %q", cur.CheckinState)
	}
	// Feedback JSON excludes free-text from any log; only stored in the row.
	fb := map[string]any{"rating": req.Rating, "notes": req.Notes, "safety_report": req.SafetyReport}
	raw := jsonx.Marshal(fb)
	const upd = `UPDATE connect_date_plans
		SET checkin_state = 'completed', feedback = $3::jsonb
		WHERE id = $1::uuid AND owner_id = $2::uuid
		RETURNING ` + planColumns
	plan, err := s.scanPlan(s.db.QueryRow(ctx, upd, planID, userID, string(raw)))
	if err != nil {
		return nil, err
	}
	if req.SafetyReport {
		// Subject is the other participant; resolve from the match defensively.
		subject := s.otherParticipant(ctx, cur.MatchID, userID)
		if _, err := s.safety.OpenCase(ctx, connectsafety.OpenCaseInput{
			ReporterID: userID,
			SubjectID:  subject,
			Type:       "safety",
			SourceRef:  planID,
			Severity:   "high",
			Notes:      "Post-date safety report filed via date planner.",
		}); err != nil {
			// A safety report must never be swallowed.
			return nil, fmt.Errorf("connect: open post-date safety case: %w", err)
		}
	}
	return plan, nil
}

// otherParticipant resolves the OTHER party's auth user id for a match, joining
// through connect_profiles (sibling schema: connect_matches.profile_* →
// connect_profiles.id, connect_profiles.user_id → auth.users). Empty if the
// caller is not a participant or the match is missing.
func (s *Service) otherParticipant(ctx context.Context, matchID, userID string) string {
	const q = `SELECT poth.user_id
		FROM connect_matches m
		JOIN connect_profiles pme  ON pme.id IN (m.profile_a, m.profile_b) AND pme.user_id = $2::uuid
		JOIN connect_profiles poth ON poth.id IN (m.profile_a, m.profile_b) AND poth.id <> pme.id
		WHERE m.id = $1::uuid`
	var other string
	if err := s.db.QueryRow(ctx, q, matchID, userID).Scan(&other); err != nil {
		return ""
	}
	return other
}

const planColumns = `id, match_id, owner_id, idea, venue, scheduled_at,
	shared_with_contact, shared_contact_id, checkin_state, checkin_at, feedback, created_at, updated_at`

func (s *Service) getPlan(ctx context.Context, userID, planID string) (*DatePlan, error) {
	const q = `SELECT ` + planColumns + ` FROM connect_date_plans
		WHERE id = $1::uuid AND owner_id = $2::uuid`
	return s.scanPlan(s.db.QueryRow(ctx, q, planID, userID))
}

func (s *Service) scanPlan(row pgx.Row) (*DatePlan, error) {
	var p DatePlan
	var feedback []byte
	if err := row.Scan(&p.ID, &p.MatchID, &p.OwnerID, &p.Idea, &p.Venue, &p.ScheduledAt,
		&p.SharedWithContact, &p.SharedContactID, &p.CheckinState, &p.CheckinAt, &feedback,
		&p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("connect: scan date plan: %w", err)
	}
	if len(feedback) > 0 {
		_ = json.Unmarshal(feedback, &p.Feedback)
	}
	return &p, nil
}

// Check-in lifecycle (mirrors connect_date_plans.checkin_state CHECK).
const (
	StatePlanned   = "planned"
	StateShared    = "shared"
	StateCheckedIn = "checked_in"
	StateCompleted = "completed"
	StateMissed    = "missed"
)

// allowedTransition encodes the date-plan check-in state machine. Any transition
// not listed here is rejected (guarded transitions, never ad-hoc status writes).
var allowedTransition = map[string]map[string]bool{
	StatePlanned:   {StateShared: true, StateCheckedIn: true, StateCompleted: true, StateMissed: true},
	StateShared:    {StateCheckedIn: true, StateCompleted: true, StateMissed: true},
	StateCheckedIn: {StateCompleted: true, StateMissed: true},
	StateCompleted: {},
	StateMissed:    {},
}

// CanTransition reports whether from→to is an allowed check-in transition.
func CanTransition(from, to string) bool { return allowedTransition[from][to] }

// TrustedContact mirrors a row of public.connect_trusted_contacts.
type TrustedContact struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Phone        string    `json:"phone"`
	Relationship string    `json:"relationship,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// TrustedContactRequest is the create body.
type TrustedContactRequest struct {
	Name         string `json:"name" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
	Relationship string `json:"relationship"`
}

// DatePlan mirrors a row of public.connect_date_plans.
type DatePlan struct {
	ID                string         `json:"id"`
	MatchID           string         `json:"match_id"`
	OwnerID           string         `json:"owner_id"`
	Idea              *string        `json:"idea,omitempty"`
	Venue             *string        `json:"venue,omitempty"`
	ScheduledAt       *time.Time     `json:"scheduled_at,omitempty"`
	SharedWithContact bool           `json:"shared_with_contact"`
	SharedContactID   *string        `json:"shared_contact_id,omitempty"`
	CheckinState      string         `json:"checkin_state"`
	CheckinAt         *time.Time     `json:"checkin_at,omitempty"`
	Feedback          map[string]any `json:"feedback,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

// CreateDatePlanRequest is the create body.
type CreateDatePlanRequest struct {
	MatchID     string     `json:"match_id" binding:"required"`
	Idea        string     `json:"idea"`
	Venue       string     `json:"venue"`
	ScheduledAt *time.Time `json:"scheduled_at"`
}

// ShareRequest shares a plan with a trusted contact.
type ShareRequest struct {
	ContactID string `json:"contact_id" binding:"required"`
}

// FeedbackRequest is post-date feedback; may carry a safety concern that opens a case.
type FeedbackRequest struct {
	Rating       int    `json:"rating"`
	Notes        string `json:"notes"`
	SafetyReport bool   `json:"safety_report"` // true → also open a connect_case
}

// Handler exposes the date-safety center endpoints (all member-scoped).
type Handler struct{ svc *Service }

// NewHandler wires the date-safety handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

var errMap = httperr.New(http.StatusBadRequest,
	httperr.R(http.StatusNotFound, ErrNotFound),
)

// AddContact — POST /api/v1/connect/safety/trusted-contacts
func (h *Handler) AddContact(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var req TrustedContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.svc.AddContact(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not add contact"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": t})
}

// ListContacts — GET /api/v1/connect/safety/trusted-contacts
func (h *Handler) ListContacts(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	list, err := h.svc.ListContacts(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// DeleteContact — DELETE /api/v1/connect/safety/trusted-contacts/:id
func (h *Handler) DeleteContact(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	if err := h.svc.DeleteContact(c.Request.Context(), userID, c.Param("id")); err != nil {
		c.JSON(errMap.Code(err), gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// CreatePlan — POST /api/v1/connect/date-plans
func (h *Handler) CreatePlan(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var req CreateDatePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.CreatePlan(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// Share — POST /api/v1/connect/date-plans/:id/share
func (h *Handler) Share(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var req ShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Share(c.Request.Context(), userID, c.Param("id"), req)
	if err != nil {
		c.JSON(errMap.Code(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// CheckIn — POST /api/v1/connect/date-plans/:id/checkin
func (h *Handler) CheckIn(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	p, err := h.svc.CheckIn(c.Request.Context(), userID, c.Param("id"))
	if err != nil {
		c.JSON(errMap.Code(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// Feedback — POST /api/v1/connect/date-plans/:id/feedback
func (h *Handler) Feedback(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var req FeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Feedback(c.Request.Context(), userID, c.Param("id"), req)
	if err != nil {
		c.JSON(errMap.Code(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}
