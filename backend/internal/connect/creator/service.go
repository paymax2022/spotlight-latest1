package connectcreator

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidKind   = errors.New("connect: invalid portfolio kind")
	ErrInvalidPolicy = errors.New("connect: invalid fan-message policy")
	ErrNotCreator    = errors.New("connect: not the creator")
	ErrBadTransition = errors.New("connect: invalid collab state transition")
	ErrNoProfile     = errors.New("connect: create a creator profile first")
)

type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

type Service struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service { return &Service{db: db, audit: audit} }

// UpsertProfile creates/updates the caller's creator profile.
func (s *Service) UpsertProfile(ctx context.Context, userID string, in ProfileInput) (*Profile, error) {
	const q = `INSERT INTO connect_creator_profiles (user_id, handle, display_name, category, bio)
		VALUES ($1, NULLIF($2,''), $3, $4, $5)
		ON CONFLICT (user_id) DO UPDATE SET
			handle=COALESCE(NULLIF(EXCLUDED.handle,''), connect_creator_profiles.handle),
			display_name=EXCLUDED.display_name, category=EXCLUDED.category, bio=EXCLUDED.bio, updated_at=now()
		RETURNING id, user_id, COALESCE(handle,''), COALESCE(display_name,''), COALESCE(category,''),
			COALESCE(bio,''), verification_status, fan_messages, created_at`
	p := &Profile{}
	if err := s.db.QueryRow(ctx, q, userID, in.Handle, in.DisplayName, in.Category, in.Bio).Scan(
		&p.ID, &p.UserID, &p.Handle, &p.DisplayName, &p.Category, &p.Bio,
		&p.VerificationStatus, &p.FanMessages, &p.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: upsert creator profile: %w", err)
	}
	return p, nil
}

func (s *Service) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `SELECT id, user_id, COALESCE(handle,''), COALESCE(display_name,''), COALESCE(category,''),
			COALESCE(bio,''), verification_status, fan_messages, created_at
		FROM connect_creator_profiles WHERE user_id=$1`
	p := &Profile{}
	if err := s.db.QueryRow(ctx, q, userID).Scan(
		&p.ID, &p.UserID, &p.Handle, &p.DisplayName, &p.Category, &p.Bio,
		&p.VerificationStatus, &p.FanMessages, &p.CreatedAt); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *Service) creatorIDFor(ctx context.Context, userID string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx, `SELECT id FROM connect_creator_profiles WHERE user_id=$1`, userID).Scan(&id); err != nil {
		return "", ErrNoProfile
	}
	return id, nil
}

// AddPortfolioItem adds a portfolio item (moderation_status=pending → not public).
func (s *Service) AddPortfolioItem(ctx context.Context, userID string, in PortfolioInput) (*PortfolioItem, error) {
	kind := in.Kind
	if kind == "" {
		kind = "image"
	}
	switch kind {
	case "image", "video", "link", "audio":
	default:
		return nil, ErrInvalidKind
	}
	creatorID, err := s.creatorIDFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	id := uuid.New().String()
	const q = `INSERT INTO connect_portfolio_items (id, creator_id, title, url, kind, position)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, creator_id, title, COALESCE(url,''), kind, moderation_status, position, created_at`
	it := &PortfolioItem{}
	if err := s.db.QueryRow(ctx, q, id, creatorID, in.Title, in.URL, kind, in.Position).Scan(
		&it.ID, &it.CreatorID, &it.Title, &it.URL, &it.Kind, &it.ModerationStatus, &it.Position, &it.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: add portfolio item: %w", err)
	}
	return it, nil
}

// ListPortfolio returns the caller's own items (all statuses).
func (s *Service) ListPortfolio(ctx context.Context, userID string) ([]PortfolioItem, error) {
	const q = `SELECT i.id, i.creator_id, i.title, COALESCE(i.url,''), i.kind, i.moderation_status, i.position, i.created_at
		FROM connect_portfolio_items i
		JOIN connect_creator_profiles c ON c.id=i.creator_id
		WHERE c.user_id=$1 ORDER BY i.position, i.created_at`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list portfolio: %w", err)
	}
	defer rows.Close()
	var out []PortfolioItem
	for rows.Next() {
		var it PortfolioItem
		if err := rows.Scan(&it.ID, &it.CreatorID, &it.Title, &it.URL, &it.Kind,
			&it.ModerationStatus, &it.Position, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// RequestVerification moves verification → pending with an encrypted evidence ref.
func (s *Service) RequestVerification(ctx context.Context, userID, evidenceRef string) error {
	const q = `UPDATE connect_creator_profiles
		SET verification_status='pending', verification_ref=$2, updated_at=now()
		WHERE user_id=$1 AND verification_status IN ('unverified','rejected')`
	tag, err := s.db.Exec(ctx, q, userID, evidenceRef)
	if err != nil {
		return fmt.Errorf("connect: request creator verification: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("connect: create a creator profile or verification already in progress")
	}
	_ = s.audit.WriteAudit(ctx, "connect.creator.verification.request", userID,
		"connect_creator_profile", userID, map[string]any{"status": "pending"})
	return nil
}

// ReviewVerification is the admin decision (approve/reject) — audited.
func (s *Service) ReviewVerification(ctx context.Context, adminID, creatorUserID string, approve bool, reason string) error {
	status := VerRejected
	if approve {
		status = VerVerified
	}
	const q = `UPDATE connect_creator_profiles
		SET verification_status=$2, verified_at=CASE WHEN $2='verified' THEN now() ELSE verified_at END, updated_at=now()
		WHERE user_id=$1 AND verification_status='pending'`
	tag, err := s.db.Exec(ctx, q, creatorUserID, string(status))
	if err != nil {
		return fmt.Errorf("connect: review creator verification: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("connect: no pending creator verification for user")
	}
	_ = s.audit.WriteAudit(ctx, "connect.creator.verification.review", adminID,
		"connect_creator_profile", creatorUserID, map[string]any{"status": string(status), "reason": reason})
	return nil
}

// ListVerificationQueue returns pending creator verifications (admin).
func (s *Service) ListVerificationQueue(ctx context.Context, limit int) ([]Profile, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, user_id, COALESCE(handle,''), COALESCE(display_name,''), COALESCE(category,''),
			COALESCE(bio,''), verification_status, fan_messages, created_at
		FROM connect_creator_profiles WHERE verification_status='pending'
		ORDER BY updated_at ASC LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: verification queue: %w", err)
	}
	defer rows.Close()
	var out []Profile
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.ID, &p.UserID, &p.Handle, &p.DisplayName, &p.Category,
			&p.Bio, &p.VerificationStatus, &p.FanMessages, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetFanPolicy updates the server-side fan-message control.
func (s *Service) SetFanPolicy(ctx context.Context, userID string, policy FanMessagePolicy) error {
	if !ValidFanPolicy(policy) {
		return ErrInvalidPolicy
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE connect_creator_profiles SET fan_messages=$2, updated_at=now() WHERE user_id=$1`,
		userID, string(policy))
	if err != nil {
		return fmt.Errorf("connect: set fan policy: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNoProfile
	}
	return nil
}

// SubmitCollab creates a pending collaboration request to a creator.
func (s *Service) SubmitCollab(ctx context.Context, fromUserID string, in CollabInput) (*CollabRequest, error) {
	id := uuid.New().String()
	const q = `INSERT INTO connect_collab_requests (id, from_user_id, creator_id, subject, body, budget_kobo)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, from_user_id, creator_id, COALESCE(subject,''), COALESCE(body,''), budget_kobo, status, created_at`
	r := &CollabRequest{}
	if err := s.db.QueryRow(ctx, q, id, fromUserID, in.CreatorID, in.Subject, in.Body, in.BudgetKobo).Scan(
		&r.ID, &r.FromUserID, &r.CreatorID, &r.Subject, &r.Body, &r.BudgetKobo, &r.Status, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: submit collab: %w", err)
	}
	_ = s.audit.WriteAudit(ctx, "connect.collab.request", fromUserID, "connect_collab_request", r.ID,
		map[string]any{"creator_id": in.CreatorID})
	return r, nil
}

// ListCollabsForCreator returns collab requests addressed to the caller's creator profile.
func (s *Service) ListCollabsForCreator(ctx context.Context, userID string) ([]CollabRequest, error) {
	const q = `SELECT cr.id, cr.from_user_id, cr.creator_id, COALESCE(cr.subject,''), COALESCE(cr.body,''),
			cr.budget_kobo, cr.status, cr.created_at
		FROM connect_collab_requests cr
		JOIN connect_creator_profiles c ON c.id=cr.creator_id
		WHERE c.user_id=$1 ORDER BY cr.created_at DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list collabs: %w", err)
	}
	defer rows.Close()
	var out []CollabRequest
	for rows.Next() {
		var r CollabRequest
		if err := rows.Scan(&r.ID, &r.FromUserID, &r.CreatorID, &r.Subject, &r.Body,
			&r.BudgetKobo, &r.Status, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RespondCollab lets the creator-owner accept/decline a pending collab (object-level authz).
func (s *Service) RespondCollab(ctx context.Context, userID, collabID string, accept bool) (*CollabRequest, error) {
	// Authz: caller must own the creator profile the request targets, and it must be pending.
	var status string
	if err := s.db.QueryRow(ctx,
		`SELECT cr.status FROM connect_collab_requests cr
		 JOIN connect_creator_profiles c ON c.id=cr.creator_id
		 WHERE cr.id=$1 AND c.user_id=$2`, collabID, userID).Scan(&status); err != nil {
		return nil, ErrNotCreator
	}
	target := "declined"
	if accept {
		target = "accepted"
	}
	if !validCollabTransition(status, target) {
		return nil, ErrBadTransition
	}
	const q = `UPDATE connect_collab_requests SET status=$2, responded_at=now(), updated_at=now()
		WHERE id=$1 RETURNING id, from_user_id, creator_id, COALESCE(subject,''), COALESCE(body,''), budget_kobo, status, created_at`
	r := &CollabRequest{}
	if err := s.db.QueryRow(ctx, q, collabID, target).Scan(
		&r.ID, &r.FromUserID, &r.CreatorID, &r.Subject, &r.Body, &r.BudgetKobo, &r.Status, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: respond collab: %w", err)
	}
	_ = s.audit.WriteAudit(ctx, "connect.collab.respond", userID, "connect_collab_request", r.ID,
		map[string]any{"status": target})
	return r, nil
}
