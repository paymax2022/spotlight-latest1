package feescompetition

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// repository.go — persistence for Competition + registrations over the net-new
// academy_competitions / academy_competition_registrations tables (migration
// 20260918000000). It also resolves student/school identity for the leaderboard
// enrichment (IdentityResolver) by reading the EXISTING academy_students /
// academy_schools tables — it does NOT own or duplicate that identity data.
//
// No money path here: this repo touches no ledger primitive.

// Store is the persistence port the service depends on. Interface (not the
// concrete pgx repo) so the service is testable with in-memory fakes and no live
// DB — matching the academy convention.
type Store interface {
	CreateCompetition(ctx context.Context, c *Competition) (*Competition, error)
	GetCompetition(ctx context.Context, id string) (*Competition, error)
	UpdateCompetitionStatus(ctx context.Context, id string, status feesstatemachine.CompetitionState) error
	RegisterSchool(ctx context.Context, competitionID, schoolID string) (*CompetitionRegistration, error)
	ListRegistrations(ctx context.Context, competitionID string) ([]CompetitionRegistration, error)
}

// Repository is the pgx-backed Store + IdentityResolver.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds a pgx-backed repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// IsNoRows lets callers detect absence without importing pgx.
func IsNoRows(err error) bool { return err == pgx.ErrNoRows }

// ── Competition CRUD ──────────────────────────────────────────────────────────

func (r *Repository) CreateCompetition(ctx context.Context, c *Competition) (*Competition, error) {
	const q = `
		INSERT INTO public.academy_competitions
			(name, scope, subject, participating_school_ids, sponsor, start_date, end_date, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, name, scope, subject, participating_school_ids, sponsor,
		          start_date, end_date, status, created_at`
	out := &Competition{}
	err := r.db.QueryRow(ctx, q,
		c.Name, c.Scope, c.Subject, c.ParticipatingSchoolIDs, c.Sponsor,
		c.StartDate, c.EndDate, string(c.Status)).
		Scan(&out.ID, &out.Name, &out.Scope, &out.Subject, &out.ParticipatingSchoolIDs,
			&out.Sponsor, &out.StartDate, &out.EndDate, &out.Status, &out.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("competition: create: %w", err)
	}
	return out, nil
}

func (r *Repository) GetCompetition(ctx context.Context, id string) (*Competition, error) {
	const q = `
		SELECT id, name, scope, subject, participating_school_ids, sponsor,
		       start_date, end_date, status, created_at
		FROM public.academy_competitions WHERE id=$1`
	out := &Competition{}
	err := r.db.QueryRow(ctx, q, id).Scan(
		&out.ID, &out.Name, &out.Scope, &out.Subject, &out.ParticipatingSchoolIDs,
		&out.Sponsor, &out.StartDate, &out.EndDate, &out.Status, &out.CreatedAt)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateCompetitionStatus persists a state-machine-approved status change. The
// caller (service) has already validated the transition via feesstatemachine.
func (r *Repository) UpdateCompetitionStatus(ctx context.Context, id string, status feesstatemachine.CompetitionState) error {
	const q = `UPDATE public.academy_competitions SET status=$2 WHERE id=$1`
	tag, err := r.db.Exec(ctx, q, id, string(status))
	if err != nil {
		return fmt.Errorf("competition: update status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ── Registrations ─────────────────────────────────────────────────────────────

// RegisterSchool inserts a registration; the UNIQUE(competition_id, school_id)
// constraint makes a repeat a no-op-safe conflict the service treats as
// idempotent.
func (r *Repository) RegisterSchool(ctx context.Context, competitionID, schoolID string) (*CompetitionRegistration, error) {
	const q = `
		INSERT INTO public.academy_competition_registrations (competition_id, school_id)
		VALUES ($1,$2)
		ON CONFLICT (competition_id, school_id) DO UPDATE SET school_id = EXCLUDED.school_id
		RETURNING id, competition_id, school_id, registered_at`
	out := &CompetitionRegistration{}
	err := r.db.QueryRow(ctx, q, competitionID, schoolID).
		Scan(&out.ID, &out.CompetitionID, &out.SchoolID, &out.RegisteredAt)
	if err != nil {
		return nil, fmt.Errorf("competition: register school: %w", err)
	}
	return out, nil
}

func (r *Repository) ListRegistrations(ctx context.Context, competitionID string) ([]CompetitionRegistration, error) {
	const q = `
		SELECT id, competition_id, school_id, registered_at
		FROM public.academy_competition_registrations
		WHERE competition_id=$1 ORDER BY registered_at`
	rows, err := r.db.Query(ctx, q, competitionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CompetitionRegistration
	for rows.Next() {
		var reg CompetitionRegistration
		if err := rows.Scan(&reg.ID, &reg.CompetitionID, &reg.SchoolID, &reg.RegisteredAt); err != nil {
			return nil, err
		}
		out = append(out, reg)
	}
	return out, rows.Err()
}

// ── IdentityResolver (reads existing academy_students / academy_schools) ────────

// ResolveStudent enriches a gamification user_id with the EdTech student + school
// identity fields the leaderboard needs. minor_flag drives SF-7. Reuses existing
// tables; creates nothing.
func (r *Repository) ResolveStudent(ctx context.Context, studentUserID string) (StudentIdentity, error) {
	const q = `
		SELECT s.id, s.minor_flag, s.school_id, COALESCE(sch.name,'')
		FROM public.academy_students s
		LEFT JOIN public.academy_schools sch ON sch.id = s.school_id
		WHERE s.student_user_id = $1
		LIMIT 1`
	var out StudentIdentity
	err := r.db.QueryRow(ctx, q, studentUserID).Scan(
		&out.StudentID, &out.MinorFlag, &out.SchoolID, &out.SchoolName)
	if err != nil {
		return StudentIdentity{}, err
	}
	// First/last name + photo are sourced from the identity/profile surface at the
	// integration layer; the fees student table holds no display name. Left blank
	// here so the resolver stays a thin reader — the integration task injects a
	// richer resolver that joins user_profiles when display fields are needed.
	return out, nil
}
