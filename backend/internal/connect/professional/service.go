package connectprofessional

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrSelfIntro     = errors.New("connect: cannot send an intro to yourself")
	ErrNotRecipient  = errors.New("connect: only the recipient may respond")
	ErrBadTransition = errors.New("connect: invalid intro state transition")
	ErrNoConsent     = errors.New("connect: contact exchange requires an accepted intro")
	ErrNotRoomOwner  = errors.New("connect: only the room owner/moderator may moderate")
)

// Auditor mirrors the connect safety WriteAudit hook.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

type Service struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service { return &Service{db: db, audit: audit} }

// UpsertProfile creates/updates the caller's professional profile.
func (s *Service) UpsertProfile(ctx context.Context, userID string, in ProfileInput) (*Profile, error) {
	const q = `INSERT INTO connect_professional_profiles
		(user_id, headline, company, role_title, industry, bio)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id) DO UPDATE SET
			headline=EXCLUDED.headline, company=EXCLUDED.company, role_title=EXCLUDED.role_title,
			industry=EXCLUDED.industry, bio=EXCLUDED.bio, updated_at=now()
		RETURNING id, user_id, headline, company, role_title, industry, bio, verification_status, visible, created_at`
	p := &Profile{}
	if err := s.db.QueryRow(ctx, q, userID, in.Headline, in.Company, in.RoleTitle, in.Industry, in.Bio).Scan(
		&p.ID, &p.UserID, &p.Headline, &p.Company, &p.RoleTitle, &p.Industry, &p.Bio,
		&p.VerificationStatus, &p.Visible, &p.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: upsert pro profile: %w", err)
	}
	return p, nil
}

// GetProfile returns the caller's professional profile.
func (s *Service) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `SELECT id, user_id, headline, company, role_title, industry, bio, verification_status, visible, created_at
		FROM connect_professional_profiles WHERE user_id = $1`
	p := &Profile{}
	if err := s.db.QueryRow(ctx, q, userID).Scan(
		&p.ID, &p.UserID, &p.Headline, &p.Company, &p.RoleTitle, &p.Industry, &p.Bio,
		&p.VerificationStatus, &p.Visible, &p.CreatedAt); err != nil {
		return nil, err
	}
	return p, nil
}

// RequestBusinessVerification moves verification to 'pending' and stores the
// encrypted evidence reference (NEVER plaintext PII). Guarded transition.
func (s *Service) RequestBusinessVerification(ctx context.Context, userID, evidenceRef string) error {
	const q = `UPDATE connect_professional_profiles
		SET verification_status='pending', verification_ref=$2, updated_at=now()
		WHERE user_id=$1 AND verification_status IN ('unverified','rejected')`
	tag, err := s.db.Exec(ctx, q, userID, evidenceRef)
	if err != nil {
		return fmt.Errorf("connect: request business verification: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("connect: verification already pending or verified")
	}
	_ = s.audit.WriteAudit(ctx, "connect.business.verification.request", userID,
		"connect_professional_profile", userID, map[string]any{"status": "pending"})
	return nil
}

// ReviewBusinessVerification is the admin decision (approve/reject) — audited.
func (s *Service) ReviewBusinessVerification(ctx context.Context, adminID, profileUserID string, approve bool, reason string) error {
	status := VerRejected
	if approve {
		status = VerVerified
	}
	const q = `UPDATE connect_professional_profiles
		SET verification_status=$2, verified_at=CASE WHEN $2='verified' THEN now() ELSE verified_at END, updated_at=now()
		WHERE user_id=$1 AND verification_status='pending'`
	tag, err := s.db.Exec(ctx, q, profileUserID, string(status))
	if err != nil {
		return fmt.Errorf("connect: review business verification: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("connect: no pending verification for user")
	}
	_ = s.audit.WriteAudit(ctx, "connect.business.verification.review", adminID,
		"connect_professional_profile", profileUserID,
		map[string]any{"status": string(status), "reason": reason})
	return nil
}

// Discover lists visible professional profiles, optionally filtered by industry.
func (s *Service) Discover(ctx context.Context, viewerID, industry string, limit int) ([]Profile, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	// PN-011 / safety invariant 3: exclude profiles of users the viewer blocked or
	// who blocked the viewer — block is absolute across professional surfaces too.
	const q = `SELECT id, user_id, headline, company, role_title, industry, bio, verification_status, visible, created_at
		FROM connect_professional_profiles pr
		WHERE visible = true AND user_id <> $1 AND ($2 = '' OR industry = $2)
		  AND NOT EXISTS (
		    SELECT 1 FROM connect_blocks b
		    WHERE (b.blocker_id = $1::uuid AND b.blocked_id = pr.user_id)
		       OR (b.blocked_id = $1::uuid AND b.blocker_id = pr.user_id)
		  )
		ORDER BY (verification_status='verified') DESC, created_at DESC LIMIT $3`
	rows, err := s.db.Query(ctx, q, viewerID, industry, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: discover professionals: %w", err)
	}
	defer rows.Close()
	var out []Profile
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.ID, &p.UserID, &p.Headline, &p.Company, &p.RoleTitle,
			&p.Industry, &p.Bio, &p.VerificationStatus, &p.Visible, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SendIntro creates a pending intro request (consent-before-messaging). The
// recipient must accept before any card exchange / messaging is unlocked.
func (s *Service) SendIntro(ctx context.Context, fromUserID string, in IntroInput) (*IntroRequest, error) {
	if fromUserID == in.ToUserID {
		return nil, ErrSelfIntro
	}
	id := uuid.New().String()
	const q = `INSERT INTO connect_intro_requests (id, from_user_id, to_user_id, message)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET message=EXCLUDED.message
		RETURNING id, from_user_id, to_user_id, COALESCE(message,''), status, created_at`
	r := &IntroRequest{}
	if err := s.db.QueryRow(ctx, q, id, fromUserID, in.ToUserID, in.Message).Scan(
		&r.ID, &r.FromUserID, &r.ToUserID, &r.Message, &r.Status, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: send intro: %w", err)
	}
	_ = s.audit.WriteAudit(ctx, "connect.intro.request", fromUserID, "connect_intro_request", r.ID,
		map[string]any{"to_user_id": in.ToUserID})
	return r, nil
}

// RespondIntro lets the recipient accept/decline a pending intro (object-level authz).
func (s *Service) RespondIntro(ctx context.Context, recipientID, introID string, accept bool) (*IntroRequest, error) {
	// Verify the responder is the recipient and the request is pending.
	var fromID string
	var status IntroStatus
	if err := s.db.QueryRow(ctx,
		`SELECT from_user_id, status FROM connect_intro_requests WHERE id=$1 AND to_user_id=$2`,
		introID, recipientID).Scan(&fromID, &status); err != nil {
		return nil, ErrNotRecipient
	}
	target := IntroDeclined
	if accept {
		target = IntroAccepted
	}
	if !validIntroTransition(status, target) {
		return nil, ErrBadTransition
	}
	const q = `UPDATE connect_intro_requests SET status=$2, responded_at=now(), updated_at=now()
		WHERE id=$1 RETURNING id, from_user_id, to_user_id, COALESCE(message,''), status, created_at`
	r := &IntroRequest{}
	if err := s.db.QueryRow(ctx, q, introID, string(target)).Scan(
		&r.ID, &r.FromUserID, &r.ToUserID, &r.Message, &r.Status, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: respond intro: %w", err)
	}
	_ = s.audit.WriteAudit(ctx, "connect.intro.respond", recipientID, "connect_intro_request", r.ID,
		map[string]any{"status": string(target)})
	return r, nil
}

// UpsertCard creates/updates the caller's shareable business card.
func (s *Service) UpsertCard(ctx context.Context, userID string, in CardInput) (*BusinessCard, error) {
	const q = `INSERT INTO connect_business_cards (user_id, name, title, company, email, phone)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id) DO UPDATE SET name=EXCLUDED.name, title=EXCLUDED.title,
			company=EXCLUDED.company, email=EXCLUDED.email, phone=EXCLUDED.phone, updated_at=now()
		RETURNING id, user_id, name, COALESCE(title,''), COALESCE(company,''), COALESCE(email,''), COALESCE(phone,'')`
	bc := &BusinessCard{}
	if err := s.db.QueryRow(ctx, q, userID, in.Name, in.Title, in.Company, in.Email, in.Phone).Scan(
		&bc.ID, &bc.UserID, &bc.Name, &bc.Title, &bc.Company, &bc.Email, &bc.Phone); err != nil {
		return nil, fmt.Errorf("connect: upsert card: %w", err)
	}
	return bc, nil
}

// ExchangeCard saves the other party's card to the caller's contacts, but ONLY
// if an accepted intro exists between them (consent-before-messaging backstop).
func (s *Service) ExchangeCard(ctx context.Context, ownerID, contactID string) (*SavedContact, error) {
	if ownerID == contactID {
		return nil, ErrSelfIntro
	}
	var n int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_intro_requests
		 WHERE status='accepted'
		   AND ((from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1))`,
		ownerID, contactID).Scan(&n); err != nil {
		return nil, fmt.Errorf("connect: check intro consent: %w", err)
	}
	if n == 0 {
		return nil, ErrNoConsent
	}
	id := uuid.New().String()
	const q = `INSERT INTO connect_saved_contacts (id, owner_id, contact_id, card_snapshot, source)
		SELECT $1,$2,$3, COALESCE(to_jsonb(bc.*),'{}'::jsonb), 'professional'
		FROM (SELECT * FROM connect_business_cards WHERE user_id=$3) bc
		ON CONFLICT (owner_id, contact_id) DO NOTHING
		RETURNING id, owner_id, contact_id, source, created_at`
	sc := &SavedContact{}
	err := s.db.QueryRow(ctx, q, id, ownerID, contactID).Scan(
		&sc.ID, &sc.OwnerID, &sc.ContactID, &sc.Source, &sc.CreatedAt)
	if err != nil {
		// ON CONFLICT no-row (already saved): fetch existing.
		if e2 := s.db.QueryRow(ctx,
			`SELECT id, owner_id, contact_id, source, created_at FROM connect_saved_contacts
			 WHERE owner_id=$1 AND contact_id=$2`, ownerID, contactID).Scan(
			&sc.ID, &sc.OwnerID, &sc.ContactID, &sc.Source, &sc.CreatedAt); e2 != nil {
			return nil, fmt.Errorf("connect: exchange card: %w", err)
		}
	}
	return sc, nil
}

// ListContacts returns the caller's saved contacts.
func (s *Service) ListContacts(ctx context.Context, ownerID string) ([]SavedContact, error) {
	const q = `SELECT id, owner_id, contact_id, source, created_at FROM connect_saved_contacts
		WHERE owner_id=$1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, fmt.Errorf("connect: list contacts: %w", err)
	}
	defer rows.Close()
	var out []SavedContact
	for rows.Next() {
		var sc SavedContact
		if err := rows.Scan(&sc.ID, &sc.OwnerID, &sc.ContactID, &sc.Source, &sc.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

// CreateRoom creates a professional room owned by the caller (owner auto-joins).
func (s *Service) CreateRoom(ctx context.Context, ownerID string, in RoomInput) (*Room, error) {
	vis := in.Visibility
	if vis != "private" {
		vis = "public"
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	id := uuid.New().String()
	const q = `INSERT INTO connect_rooms (id, owner_id, name, topic, visibility)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, owner_id, name, COALESCE(topic,''), visibility, status, created_at`
	r := &Room{}
	if err := tx.QueryRow(ctx, q, id, ownerID, in.Name, in.Topic, vis).Scan(
		&r.ID, &r.OwnerID, &r.Name, &r.Topic, &r.Visibility, &r.Status, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: create room: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_room_members (room_id, user_id, role) VALUES ($1,$2,'owner')
		 ON CONFLICT (room_id, user_id) DO NOTHING`, r.ID, ownerID); err != nil {
		return nil, fmt.Errorf("connect: seed room owner: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r, nil
}

// JoinRoom adds the caller as a member of a public room.
func (s *Service) JoinRoom(ctx context.Context, userID, roomID string) error {
	const q = `INSERT INTO connect_room_members (room_id, user_id, role)
		SELECT $1, $2, 'member' FROM connect_rooms r
		WHERE r.id=$1 AND r.status='active' AND r.visibility='public'
		ON CONFLICT (room_id, user_id) DO NOTHING`
	tag, err := s.db.Exec(ctx, q, roomID, userID)
	if err != nil {
		return fmt.Errorf("connect: join room: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either already a member, or room not joinable.
		var exists int
		_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM connect_room_members WHERE room_id=$1 AND user_id=$2`,
			roomID, userID).Scan(&exists)
		if exists == 0 {
			return fmt.Errorf("connect: room not joinable")
		}
	}
	return nil
}

// ModerateRoom lets the owner/moderator mute/remove/promote a member (object-level authz).
func (s *Service) ModerateRoom(ctx context.Context, actorID, roomID string, in RoomModerationInput) error {
	// Authz: actor must be owner or moderator of the room.
	var role string
	if err := s.db.QueryRow(ctx,
		`SELECT role FROM connect_room_members WHERE room_id=$1 AND user_id=$2 AND status='active'`,
		roomID, actorID).Scan(&role); err != nil || (role != "owner" && role != "moderator") {
		return ErrNotRoomOwner
	}
	var q string
	switch in.Action {
	case "mute":
		q = `UPDATE connect_room_members SET status='muted' WHERE room_id=$1 AND user_id=$2`
	case "remove":
		q = `UPDATE connect_room_members SET status='removed' WHERE room_id=$1 AND user_id=$2`
	case "promote":
		q = `UPDATE connect_room_members SET role='moderator' WHERE room_id=$1 AND user_id=$2`
	default:
		return fmt.Errorf("connect: invalid moderation action %q", in.Action)
	}
	if _, err := s.db.Exec(ctx, q, roomID, in.UserID); err != nil {
		return fmt.Errorf("connect: moderate room: %w", err)
	}
	_ = s.audit.WriteAudit(ctx, "connect.room.moderate", actorID, "connect_room", roomID,
		map[string]any{"target": in.UserID, "action": in.Action})
	return nil
}
