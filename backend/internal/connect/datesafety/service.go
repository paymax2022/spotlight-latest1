package connectdatesafety

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	connectsafety "spotlight/backend/internal/connect/safety"
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

// --- Trusted contacts ---

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

// --- Date plans ---

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
	raw, _ := json.Marshal(fb)
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
