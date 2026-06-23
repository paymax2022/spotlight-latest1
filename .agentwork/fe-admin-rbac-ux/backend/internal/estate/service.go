package estate

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
	platformRedis "spotlight/backend/internal/platform/redis"
)

// Service manages estates, visitor passes, and private elections.
type Service struct {
	db    *pgxpool.Pool
	redis *goredis.Client
}

func NewService(db *pgxpool.Pool, redis *goredis.Client) *Service {
	return &Service{db: db, redis: redis}
}

// CreateEstate creates a new estate and assigns the creator as estate_admin.
func (s *Service) CreateEstate(ctx context.Context, adminID string, req CreateEstateRequest) (*Estate, error) {
	e := &Estate{
		ID:        uuid.New().String(),
		Name:      req.Name,
		Address:   req.Address,
		AdminID:   adminID,
		CreatedAt: time.Now(),
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertEstate = `INSERT INTO estates (id, name, address, admin_id) VALUES ($1,$2,$3,$4)`
	if _, err := tx.Exec(ctx, insertEstate, e.ID, e.Name, e.Address, e.AdminID); err != nil {
		return nil, fmt.Errorf("estate: insert estate: %w", err)
	}
	const insertResident = `INSERT INTO estate_residents (estate_id, user_id, unit, role) VALUES ($1,$2,'',  'estate_admin')`
	if _, err := tx.Exec(ctx, insertResident, e.ID, adminID); err != nil {
		return nil, fmt.Errorf("estate: insert admin resident: %w", err)
	}
	return e, tx.Commit(ctx)
}

// AddResident adds a verified resident to an estate (admin only).
func (s *Service) AddResident(ctx context.Context, estateID, adminID, userID, unit string) (*Resident, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	r := &Resident{
		ID:       uuid.New().String(),
		EstateID: estateID,
		UserID:   userID,
		Unit:     unit,
		Role:     "resident",
	}
	const q = `
		INSERT INTO estate_residents (id, estate_id, user_id, unit, role)
		VALUES ($1,$2,$3,$4,'resident')
		ON CONFLICT (estate_id, user_id) DO UPDATE SET unit = EXCLUDED.unit
		RETURNING id, estate_id, user_id, unit, role, created_at`
	return r, s.db.QueryRow(ctx, q, r.ID, r.EstateID, r.UserID, r.Unit).Scan(
		&r.ID, &r.EstateID, &r.UserID, &r.Unit, &r.Role, &r.CreatedAt,
	)
}

// IssueVisitorPass creates a visitor QR pass for a resident.
func (s *Service) IssueVisitorPass(ctx context.Context, estateID, issuerID string, req IssuePassRequest) (*VisitorPass, error) {
	if err := s.assertResident(ctx, estateID, issuerID); err != nil {
		return nil, err
	}
	if req.ValidUntil.Before(req.ValidFrom) {
		return nil, fmt.Errorf("estate: valid_until must be after valid_from")
	}
	p := &VisitorPass{
		ID:          uuid.New().String(),
		EstateID:    estateID,
		IssuedBy:    issuerID,
		VisitorName: req.VisitorName,
		Purpose:     req.Purpose,
		QRCode:      uuid.New().String(),
		ValidFrom:   req.ValidFrom,
		ValidUntil:  req.ValidUntil,
		Status:      "active",
		CreatedAt:   time.Now(),
	}
	const q = `
		INSERT INTO visitor_passes (id, estate_id, issued_by, visitor_name, purpose, qr_code, valid_from, valid_until, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`
	_, err := s.db.Exec(ctx, q, p.ID, p.EstateID, p.IssuedBy, p.VisitorName, p.Purpose, p.QRCode, p.ValidFrom, p.ValidUntil)
	return p, err
}

// ScanVisitorPass marks a pass as used. Only estate security (admin) can scan.
func (s *Service) ScanVisitorPass(ctx context.Context, estateID, scannerID, qrCode string) (*VisitorPass, error) {
	if err := s.assertEstateAdmin(ctx, estateID, scannerID); err != nil {
		return nil, err
	}
	now := time.Now()
	const q = `
		UPDATE visitor_passes SET status='used', used_at=$1
		WHERE qr_code=$2 AND estate_id=$3 AND status='active' AND valid_from <= $1 AND valid_until >= $1
		RETURNING id, estate_id, issued_by, visitor_name, purpose, qr_code, valid_from, valid_until, used_at, status, created_at`
	p := &VisitorPass{}
	if err := s.db.QueryRow(ctx, q, now, qrCode, estateID).Scan(
		&p.ID, &p.EstateID, &p.IssuedBy, &p.VisitorName, &p.Purpose,
		&p.QRCode, &p.ValidFrom, &p.ValidUntil, &p.UsedAt, &p.Status, &p.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("estate: pass not found, already used, or expired")
	}
	return p, nil
}

// CreateElection creates a new election within an estate (admin only).
func (s *Service) CreateElection(ctx context.Context, estateID, creatorID string, req CreateElectionRequest) (*Election, error) {
	if err := s.assertEstateAdmin(ctx, estateID, creatorID); err != nil {
		return nil, err
	}
	if req.EndsAt.Before(req.StartsAt) {
		return nil, fmt.Errorf("estate: ends_at must be after starts_at")
	}
	if len(req.Candidates) < 2 {
		return nil, fmt.Errorf("estate: election must have at least 2 candidates")
	}

	el := &Election{
		ID:          uuid.New().String(),
		EstateID:    estateID,
		Title:       req.Title,
		Description: req.Description,
		StartsAt:    req.StartsAt,
		EndsAt:      req.EndsAt,
		Status:      "draft",
		CreatedBy:   creatorID,
		CreatedAt:   time.Now(),
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertEl = `INSERT INTO elections (id, estate_id, title, description, starts_at, ends_at, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7)`
	if _, err := tx.Exec(ctx, insertEl, el.ID, el.EstateID, el.Title, el.Description, el.StartsAt, el.EndsAt, el.CreatedBy); err != nil {
		return nil, fmt.Errorf("estate: insert election: %w", err)
	}
	for _, c := range req.Candidates {
		c.ID = uuid.New().String()
		c.ElectionID = el.ID
		const insertC = `INSERT INTO election_candidates (id, election_id, name, bio) VALUES ($1,$2,$3,$4)`
		if _, err := tx.Exec(ctx, insertC, c.ID, c.ElectionID, c.Name, c.Bio); err != nil {
			return nil, fmt.Errorf("estate: insert candidate: %w", err)
		}
	}
	return el, tx.Commit(ctx)
}

// CastVote casts a vote in an open election using a Redlock-protected atomic check.
// Enforces one-vote-per-resident via UNIQUE(election_id, voter_id).
func (s *Service) CastVote(ctx context.Context, estateID, electionID, voterID string, req CastVoteRequest) (*Vote, error) {
	// Verify voter is a resident.
	if err := s.assertResident(ctx, estateID, voterID); err != nil {
		return nil, err
	}
	// Verify election is open.
	var status string
	var startsAt, endsAt time.Time
	if err := s.db.QueryRow(ctx, `SELECT status, starts_at, ends_at FROM elections WHERE id=$1 AND estate_id=$2`, electionID, estateID).
		Scan(&status, &startsAt, &endsAt); err != nil {
		return nil, fmt.Errorf("estate: election not found")
	}
	now := time.Now()
	if status != "open" || now.Before(startsAt) || now.After(endsAt) {
		return nil, fmt.Errorf("estate: election is not currently open for voting")
	}

	// Acquire Redlock to prevent duplicate concurrent submissions.
	lockKey := fmt.Sprintf("election:%s:voter:%s", electionID, voterID)
	if s.redis != nil {
		ok, token, err := platformRedis.AcquireLock(ctx, s.redis, lockKey, 10*time.Second)
		if err != nil || !ok {
			return nil, fmt.Errorf("estate: vote lock contention — try again")
		}
		defer platformRedis.ReleaseLock(ctx, s.redis, lockKey, token)
	}

	v := &Vote{
		ID:          uuid.New().String(),
		ElectionID:  electionID,
		VoterID:     voterID,
		CandidateID: req.CandidateID,
		CastAt:      time.Now(),
	}
	const q = `
		INSERT INTO election_votes (id, election_id, voter_id, candidate_id)
		VALUES ($1,$2,$3,$4)`
	if _, err := s.db.Exec(ctx, q, v.ID, v.ElectionID, v.VoterID, v.CandidateID); err != nil {
		return nil, fmt.Errorf("estate: vote already cast or candidate invalid")
	}
	return v, nil
}

// GetResults returns the tally for a closed/tallied election.
func (s *Service) GetResults(ctx context.Context, estateID, electionID string) ([]Candidate, error) {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM elections WHERE id=$1 AND estate_id=$2`, electionID, estateID).Scan(&status); err != nil {
		return nil, fmt.Errorf("estate: election not found")
	}
	if status != "closed" && status != "tallied" {
		return nil, fmt.Errorf("estate: results only available after election closes")
	}
	const q = `
		SELECT ec.id, ec.election_id, ec.name, ec.bio, COUNT(ev.id) AS votes
		FROM election_candidates ec
		LEFT JOIN election_votes ev ON ev.candidate_id = ec.id
		WHERE ec.election_id = $1
		GROUP BY ec.id ORDER BY votes DESC`
	rows, err := s.db.Query(ctx, q, electionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Candidate
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.ID, &c.ElectionID, &c.Name, &c.Bio, &c.Votes); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Service) assertEstateAdmin(ctx context.Context, estateID, userID string) error {
	return s.assertRoles(ctx, estateID, userID, "estate_admin")
}

func (s *Service) assertResident(ctx context.Context, estateID, userID string) error {
	return s.assertRoles(ctx, estateID, userID, "resident", "estate_admin")
}

func (s *Service) assertRoles(ctx context.Context, estateID, userID string, roles ...string) error {
	const q = `SELECT role FROM estate_residents WHERE estate_id=$1 AND user_id=$2`
	var role string
	if err := s.db.QueryRow(ctx, q, estateID, userID).Scan(&role); err != nil {
		return fmt.Errorf("estate: not a member of this estate")
	}
	for _, r := range roles {
		if role == r {
			return nil
		}
	}
	return fmt.Errorf("estate: insufficient role")
}
