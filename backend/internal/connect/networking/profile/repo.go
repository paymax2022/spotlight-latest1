package connectnetprofile

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository holds the parameterized pgx queries for the network-profile tables.
// Dates are read as ::text so the API speaks plain YYYY-MM-DD strings. No query
// here touches the finance ledger.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ─────────────────────────────── Experience ──────────────────────────────────

// InsertExperience creates an experience row. When idemKey is non-empty a retried
// create with the same (user, key) returns the existing row (idempotent no-op).
func (r *Repository) InsertExperience(ctx context.Context, userID string, in ExperienceInput, idemKey string) (*Experience, error) {
	const q = `INSERT INTO connect_experience
			(user_id, title, company, location, start_date, end_date, description, idempotency_key)
		VALUES ($1,$2,$3,NULLIF($4,''),$5::date,NULLIF($6,'')::date,NULLIF($7,''),NULLIF($8,''))
		ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
			DO UPDATE SET user_id = EXCLUDED.user_id
		RETURNING id, user_id, title, company, COALESCE(location,''),
			start_date::text, end_date::text, COALESCE(description,''), created_at`
	e := &Experience{}
	if err := r.db.QueryRow(ctx, q, userID, in.Title, in.Company, in.Location,
		in.StartDate, in.EndDate, in.Description, idemKey).Scan(
		&e.ID, &e.UserID, &e.Title, &e.Company, &e.Location,
		&e.StartDate, &e.EndDate, &e.Description, &e.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: insert experience: %w", err)
	}
	return e, nil
}

// UpdateExperience edits an experience row the caller owns (object-level authz in SQL).
func (r *Repository) UpdateExperience(ctx context.Context, userID, id string, in ExperienceInput) (*Experience, error) {
	const q = `UPDATE connect_experience SET
			title=$3, company=$4, location=NULLIF($5,''),
			start_date=$6::date, end_date=NULLIF($7,'')::date, description=NULLIF($8,'')
		WHERE id=$1 AND user_id=$2
		RETURNING id, user_id, title, company, COALESCE(location,''),
			start_date::text, end_date::text, COALESCE(description,''), created_at`
	e := &Experience{}
	if err := r.db.QueryRow(ctx, q, id, userID, in.Title, in.Company, in.Location,
		in.StartDate, in.EndDate, in.Description).Scan(
		&e.ID, &e.UserID, &e.Title, &e.Company, &e.Location,
		&e.StartDate, &e.EndDate, &e.Description, &e.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("connect: update experience: %w", err)
	}
	return e, nil
}

// DeleteExperience removes an experience row the caller owns.
func (r *Repository) DeleteExperience(ctx context.Context, userID, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM connect_experience WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return fmt.Errorf("connect: delete experience: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListExperience returns a user's experience timeline (public professional info).
func (r *Repository) ListExperience(ctx context.Context, userID string) ([]Experience, error) {
	const q = `SELECT id, user_id, title, company, COALESCE(location,''),
			start_date::text, end_date::text, COALESCE(description,''), created_at
		FROM connect_experience WHERE user_id=$1 ORDER BY start_date DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list experience: %w", err)
	}
	defer rows.Close()
	out := []Experience{}
	for rows.Next() {
		var e Experience
		if err := rows.Scan(&e.ID, &e.UserID, &e.Title, &e.Company, &e.Location,
			&e.StartDate, &e.EndDate, &e.Description, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// HasExperience reports whether the user has at least one experience row.
func (r *Repository) HasExperience(ctx context.Context, userID string) (bool, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM connect_experience WHERE user_id=$1`, userID).Scan(&n)
	return n > 0, err
}

// ─────────────────────────────── Education ───────────────────────────────────

func (r *Repository) InsertEducation(ctx context.Context, userID string, in EducationInput, idemKey string) (*Education, error) {
	const q = `INSERT INTO connect_education
			(user_id, institution, degree, field, start_date, end_date, idempotency_key)
		VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5::date,NULLIF($6,'')::date,NULLIF($7,''))
		ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
			DO UPDATE SET user_id = EXCLUDED.user_id
		RETURNING id, user_id, institution, COALESCE(degree,''), COALESCE(field,''),
			start_date::text, end_date::text, created_at`
	e := &Education{}
	if err := r.db.QueryRow(ctx, q, userID, in.Institution, in.Degree, in.Field,
		in.StartDate, in.EndDate, idemKey).Scan(
		&e.ID, &e.UserID, &e.Institution, &e.Degree, &e.Field,
		&e.StartDate, &e.EndDate, &e.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: insert education: %w", err)
	}
	return e, nil
}

func (r *Repository) UpdateEducation(ctx context.Context, userID, id string, in EducationInput) (*Education, error) {
	const q = `UPDATE connect_education SET
			institution=$3, degree=NULLIF($4,''), field=NULLIF($5,''),
			start_date=$6::date, end_date=NULLIF($7,'')::date
		WHERE id=$1 AND user_id=$2
		RETURNING id, user_id, institution, COALESCE(degree,''), COALESCE(field,''),
			start_date::text, end_date::text, created_at`
	e := &Education{}
	if err := r.db.QueryRow(ctx, q, id, userID, in.Institution, in.Degree, in.Field,
		in.StartDate, in.EndDate).Scan(
		&e.ID, &e.UserID, &e.Institution, &e.Degree, &e.Field,
		&e.StartDate, &e.EndDate, &e.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("connect: update education: %w", err)
	}
	return e, nil
}

func (r *Repository) DeleteEducation(ctx context.Context, userID, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM connect_education WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return fmt.Errorf("connect: delete education: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) ListEducation(ctx context.Context, userID string) ([]Education, error) {
	const q = `SELECT id, user_id, institution, COALESCE(degree,''), COALESCE(field,''),
			start_date::text, end_date::text, created_at
		FROM connect_education WHERE user_id=$1 ORDER BY start_date DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list education: %w", err)
	}
	defer rows.Close()
	out := []Education{}
	for rows.Next() {
		var e Education
		if err := rows.Scan(&e.ID, &e.UserID, &e.Institution, &e.Degree, &e.Field,
			&e.StartDate, &e.EndDate, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repository) HasEducation(ctx context.Context, userID string) (bool, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM connect_education WHERE user_id=$1`, userID).Scan(&n)
	return n > 0, err
}

// ─────────────────────────────────── About ───────────────────────────────────

func (r *Repository) UpsertAbout(ctx context.Context, userID, summary string) (*About, error) {
	const q = `INSERT INTO connect_network_about (user_id, summary)
		VALUES ($1,$2)
		ON CONFLICT (user_id) DO UPDATE SET summary=EXCLUDED.summary, updated_at=now()
		RETURNING user_id, summary, updated_at`
	a := &About{}
	if err := r.db.QueryRow(ctx, q, userID, summary).Scan(&a.UserID, &a.Summary, &a.UpdatedAt); err != nil {
		return nil, fmt.Errorf("connect: upsert about: %w", err)
	}
	return a, nil
}

func (r *Repository) GetAbout(ctx context.Context, userID string) (*About, error) {
	const q = `SELECT user_id, summary, updated_at FROM connect_network_about WHERE user_id=$1`
	a := &About{UserID: userID}
	err := r.db.QueryRow(ctx, q, userID).Scan(&a.UserID, &a.Summary, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, nil // empty about is a valid zero state
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get about: %w", err)
	}
	return a, nil
}

// HasAbout reports a non-empty summary.
func (r *Repository) HasAbout(ctx context.Context, userID string) (bool, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_network_about WHERE user_id=$1 AND length(trim(summary))>0`,
		userID).Scan(&n)
	return n > 0, err
}

// ──────────────────────────── Recommendations ────────────────────────────────

// InsertRecommendation creates a recommendation in the given initial state. A
// retried write for the same (author, subject) pair returns the existing row.
func (r *Repository) InsertRecommendation(ctx context.Context, authorID, subjectID, body string, state RecoState) (*Recommendation, error) {
	const q = `INSERT INTO connect_recommendations (author_user_id, subject_user_id, body, state)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (author_user_id, subject_user_id) DO NOTHING
		RETURNING id, author_user_id, subject_user_id, body, state, created_at, updated_at`
	rec := &Recommendation{}
	err := r.db.QueryRow(ctx, q, authorID, subjectID, body, string(state)).Scan(
		&rec.ID, &rec.AuthorUserID, &rec.SubjectUserID, &rec.Body, &rec.State, &rec.CreatedAt, &rec.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Idempotent: a recommendation already exists for this pair — return it.
		return r.getRecommendation(ctx, authorID, subjectID)
	}
	if err != nil {
		return nil, fmt.Errorf("connect: insert recommendation: %w", err)
	}
	return rec, nil
}

func (r *Repository) getRecommendation(ctx context.Context, authorID, subjectID string) (*Recommendation, error) {
	const q = `SELECT id, author_user_id, subject_user_id, body, state, created_at, updated_at
		FROM connect_recommendations WHERE author_user_id=$1 AND subject_user_id=$2`
	rec := &Recommendation{}
	if err := r.db.QueryRow(ctx, q, authorID, subjectID).Scan(
		&rec.ID, &rec.AuthorUserID, &rec.SubjectUserID, &rec.Body, &rec.State, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
		return nil, fmt.Errorf("connect: get recommendation: %w", err)
	}
	return rec, nil
}

// GetRecommendationByID fetches a single recommendation regardless of state (used
// by the service for authz + FSM checks before a guarded transition).
func (r *Repository) GetRecommendationByID(ctx context.Context, id string) (*Recommendation, error) {
	const q = `SELECT id, author_user_id, subject_user_id, body, state, created_at, updated_at
		FROM connect_recommendations WHERE id=$1`
	rec := &Recommendation{}
	if err := r.db.QueryRow(ctx, q, id).Scan(
		&rec.ID, &rec.AuthorUserID, &rec.SubjectUserID, &rec.Body, &rec.State, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("connect: get recommendation by id: %w", err)
	}
	return rec, nil
}

// TransitionRecommendation applies a guarded state change, re-checking the current
// state in the WHERE clause so concurrent transitions cannot race past the FSM.
func (r *Repository) TransitionRecommendation(ctx context.Context, id string, from, to RecoState) (*Recommendation, error) {
	const q = `UPDATE connect_recommendations SET state=$3, updated_at=now()
		WHERE id=$1 AND state=$2
		RETURNING id, author_user_id, subject_user_id, body, state, created_at, updated_at`
	rec := &Recommendation{}
	if err := r.db.QueryRow(ctx, q, id, string(from), string(to)).Scan(
		&rec.ID, &rec.AuthorUserID, &rec.SubjectUserID, &rec.Body, &rec.State, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrBadTransition
		}
		return nil, fmt.Errorf("connect: transition recommendation: %w", err)
	}
	return rec, nil
}

// qListAcceptedForSubject is the PUBLIC read path SQL (RC-03). PN-4: the WHERE
// clause hard-filters state='accepted_visible', so drafted/sent/declined rows are
// physically unreachable here — a second, independent guard on top of the RLS
// reader policy. Exposed as a package const so a test can assert the filter.
const qListAcceptedForSubject = `SELECT id, author_user_id, subject_user_id, body, state, created_at, updated_at
		FROM connect_recommendations
		WHERE subject_user_id=$1 AND state='accepted_visible'
		ORDER BY created_at DESC`

// ListAcceptedForSubject is the PUBLIC read path (RC-03). PN-4: it returns ONLY
// accepted_visible rows.
func (r *Repository) ListAcceptedForSubject(ctx context.Context, subjectID string) ([]Recommendation, error) {
	return r.queryRecommendations(ctx, qListAcceptedForSubject, subjectID)
}

// ListInboxForSubject is RC-02: the subject's pending (sent) recommendations.
func (r *Repository) ListInboxForSubject(ctx context.Context, subjectID string) ([]Recommendation, error) {
	const q = `SELECT id, author_user_id, subject_user_id, body, state, created_at, updated_at
		FROM connect_recommendations
		WHERE subject_user_id=$1 AND state='sent'
		ORDER BY created_at DESC`
	return r.queryRecommendations(ctx, q, subjectID)
}

// ListAuthored returns the caller's own written recommendations (any state).
func (r *Repository) ListAuthored(ctx context.Context, authorID string) ([]Recommendation, error) {
	const q = `SELECT id, author_user_id, subject_user_id, body, state, created_at, updated_at
		FROM connect_recommendations WHERE author_user_id=$1 ORDER BY created_at DESC`
	return r.queryRecommendations(ctx, q, authorID)
}

// AdminList returns recommendations for moderation, optionally filtered by state.
func (r *Repository) AdminList(ctx context.Context, state string, limit int) ([]Recommendation, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, author_user_id, subject_user_id, body, state, created_at, updated_at
		FROM connect_recommendations
		WHERE ($1='' OR state=$1)
		ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, state, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: admin list recommendations: %w", err)
	}
	defer rows.Close()
	return scanRecommendations(rows)
}

func (r *Repository) queryRecommendations(ctx context.Context, q string, arg string) ([]Recommendation, error) {
	rows, err := r.db.Query(ctx, q, arg)
	if err != nil {
		return nil, fmt.Errorf("connect: query recommendations: %w", err)
	}
	defer rows.Close()
	return scanRecommendations(rows)
}

func scanRecommendations(rows pgx.Rows) ([]Recommendation, error) {
	out := []Recommendation{}
	for rows.Next() {
		var rec Recommendation
		if err := rows.Scan(&rec.ID, &rec.AuthorUserID, &rec.SubjectUserID, &rec.Body,
			&rec.State, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// VerifiedBadge reports whether the user carries a verified business/professional
// badge (binary signal only — PN-1). Best-effort: reads the existing
// connect_professional_profiles projection; any error is treated as "not verified"
// (fail-closed) so the strength calc never over-credits an unverified profile.
func (r *Repository) VerifiedBadge(ctx context.Context, userID string) bool {
	var verified bool
	err := r.db.QueryRow(ctx,
		`SELECT verification_status = 'verified'
		 FROM connect_professional_profiles WHERE user_id=$1`, userID).Scan(&verified)
	if err != nil {
		return false
	}
	return verified
}

// CountAcceptedForSubject counts accepted_visible recommendations (strength signal).
func (r *Repository) CountAcceptedForSubject(ctx context.Context, subjectID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_recommendations WHERE subject_user_id=$1 AND state='accepted_visible'`,
		subjectID).Scan(&n)
	return n, err
}

// AdminHideRecommendation forces a recommendation to declined_hidden for policy
// violations (removes it from every public read path). Moderation-only.
func (r *Repository) AdminHideRecommendation(ctx context.Context, id string) (*Recommendation, error) {
	const q = `UPDATE connect_recommendations SET state='declined_hidden', updated_at=now()
		WHERE id=$1
		RETURNING id, author_user_id, subject_user_id, body, state, created_at, updated_at`
	rec := &Recommendation{}
	if err := r.db.QueryRow(ctx, q, id).Scan(
		&rec.ID, &rec.AuthorUserID, &rec.SubjectUserID, &rec.Body, &rec.State, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("connect: hide recommendation: %w", err)
	}
	return rec, nil
}

// ──────────────────────── Recommendation requests (RC-04) ────────────────────

func (r *Repository) InsertRecommendationRequest(ctx context.Context, requesterID, targetID, note string) (*RecommendationRequest, error) {
	const q = `INSERT INTO connect_recommendation_requests (requester_user_id, target_user_id, note)
		VALUES ($1,$2,NULLIF($3,''))
		ON CONFLICT (requester_user_id, target_user_id) DO UPDATE SET note=EXCLUDED.note
		RETURNING id, requester_user_id, target_user_id, COALESCE(note,''), state, created_at`
	req := &RecommendationRequest{}
	if err := r.db.QueryRow(ctx, q, requesterID, targetID, note).Scan(
		&req.ID, &req.RequesterUserID, &req.TargetUserID, &req.Note, &req.State, &req.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: insert recommendation request: %w", err)
	}
	return req, nil
}
