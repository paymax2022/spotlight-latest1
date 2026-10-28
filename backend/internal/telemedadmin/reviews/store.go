package reviews

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the persistence surface the handlers depend on (faked in tests).
type Store interface {
	Summary(ctx context.Context) (Summary, error)
	ListReviews(ctx context.Context, f ListFilter) ([]Review, int, error)
	GetReview(ctx context.Context, source, id string) (*ReviewDetail, error)
	SetHidden(ctx context.Context, actor, source, id string, hidden bool, reason string) (*Review, error)
	ListDisputes(ctx context.Context, f DisputeFilter) ([]Dispute, int, error)
	GetDispute(ctx context.Context, id string) (*DisputeDetail, error)
	Resolve(ctx context.Context, actor, id, decision, reason string) (*Dispute, error)
}

// DB is the slice of pgx the store needs. *pgxpool.Pool satisfies it, and so does
// a pgx.Tx (whose Begin opens a savepoint), which lets tests run the whole store
// inside one rolled-back transaction.
type DB interface {
	Begin(ctx context.Context) (pgx.Tx, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type pgStore struct{ db DB }

// NewStore returns the Postgres-backed store.
func NewStore(db *pgxpool.Pool) Store { return &pgStore{db: db} }

func newStore(db DB) Store { return &pgStore{db: db} }

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// reviewsCTE unifies both review sources. A doctor_module review is hidden via
// detail.moderation.hidden (doctor_reviews has no dedicated column).
const reviewsCTE = `
WITH r AS (
  SELECT tr.id::text AS id, 'telemedicine'::text AS source, d.id::text AS doctor_id, d.user_id::text AS doctor_user_id,
         COALESCE(d.name, '') AS doctor_name, tr.patient_id::text AS patient_id, tr.appointment_id::text AS appointment_id,
         tr.rating::int AS rating, tr.comment AS comment, tr.is_hidden AS hidden,
         NULL::text AS hidden_reason, false AS reported, 0 AS open_disputes, tr.created_at AS created_at
  FROM telemedicine_reviews tr
  JOIN doctors d ON d.id = tr.doctor_id
  UNION ALL
  SELECT dr.id::text, 'doctor_module', d.id::text, dr.user_id::text,
         COALESCE(d.name, ''), NULL::text, NULL::text,
         dr.rating::int, COALESCE(dr.body, ''), COALESCE((dr.detail->'moderation'->>'hidden')::boolean, false),
         dr.detail->'moderation'->>'reason', dr.reported,
         (SELECT COUNT(*) FROM doctor_review_disputes x WHERE x.review_id = dr.id AND x.status = 'open')::int,
         dr.created_at
  FROM doctor_reviews dr
  LEFT JOIN doctors d ON d.user_id = dr.user_id
)`

const reviewCols = `id, source, doctor_id, doctor_user_id, doctor_name, patient_id, appointment_id, rating, comment, hidden, hidden_reason, reported, open_disputes, created_at`

func scanReview(row pgx.Row, extra ...any) (Review, error) {
	var rv Review
	var patient *string
	dest := []any{&rv.ID, &rv.Source, &rv.DoctorID, &rv.DoctorUserID, &rv.DoctorName, &patient, &rv.AppointmentID,
		&rv.Rating, &rv.Comment, &rv.Hidden, &rv.HiddenReason, &rv.Reported, &rv.OpenDisputes, &rv.CreatedAt}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return rv, err
	}
	if patient != nil {
		rv.PatientRef = maskPatient(*patient)
	}
	return rv, nil
}

func (s *pgStore) Summary(ctx context.Context) (Summary, error) {
	var out Summary
	err := s.db.QueryRow(ctx, reviewsCTE+`
		SELECT COUNT(*)::int,
		       COUNT(*) FILTER (WHERE hidden)::int,
		       COUNT(*) FILTER (WHERE NOT hidden AND rating IS NOT NULL AND rating <= 2)::int,
		       COUNT(*) FILTER (WHERE reported)::int
		FROM r`).Scan(&out.TotalReviews, &out.HiddenReviews, &out.LowRatedVisible, &out.ReportedReviews)
	if err != nil {
		return out, fmt.Errorf("reviews: summary: %w", err)
	}
	err = s.db.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status = 'open')::int,
		       COUNT(*) FILTER (WHERE status IN ('upheld','rejected')
		         AND COALESCE((detail->'resolution'->>'at')::timestamptz, created_at) >= now() - interval '30 days')::int
		FROM doctor_review_disputes`).Scan(&out.OpenDisputes, &out.ResolvedDisputes30d)
	if err != nil {
		return out, fmt.Errorf("reviews: dispute summary: %w", err)
	}
	return out, nil
}

func (s *pgStore) ListReviews(ctx context.Context, f ListFilter) ([]Review, int, error) {
	limit, offset := clampPage(f.Limit, f.Offset)
	rows, err := s.db.Query(ctx, reviewsCTE+`
		SELECT `+reviewCols+`, COUNT(*) OVER()::int
		FROM r
		WHERE ($1 = '' OR source = $1)
		  AND ($2 = 0 OR rating = $2)
		  AND ($3::boolean IS NULL OR hidden = $3)
		  AND ($4 = '' OR doctor_id = $4)
		  AND ($5 = '' OR comment ILIKE $5 OR doctor_name ILIKE $5)
		ORDER BY created_at DESC, id
		LIMIT $6 OFFSET $7`,
		f.Source, f.Rating, f.Hidden, f.DoctorID, likePattern(f.Query), limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("reviews: list: %w", err)
	}
	defer rows.Close()
	out := []Review{}
	total := 0
	for rows.Next() {
		rv, err := scanReview(rows, &total)
		if err != nil {
			return nil, 0, fmt.Errorf("reviews: scan: %w", err)
		}
		out = append(out, rv)
	}
	return out, total, rows.Err()
}

func (s *pgStore) getReview(ctx context.Context, q queryRower, source, id string) (*Review, error) {
	rv, err := scanReview(q.QueryRow(ctx, reviewsCTE+`SELECT `+reviewCols+` FROM r WHERE source = $1 AND id = $2`, source, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("reviews: get: %w", err)
	}
	return &rv, nil
}

func (s *pgStore) GetReview(ctx context.Context, source, id string) (*ReviewDetail, error) {
	rv, err := s.getReview(ctx, s.db, source, id)
	if err != nil {
		return nil, err
	}
	out := &ReviewDetail{Review: *rv, Disputes: []Dispute{}, History: []ModerationEvent{}}

	if source == SourceDoctorModule {
		rows, err := s.db.Query(ctx, disputeSelect+` WHERE x.review_id = $1::uuid ORDER BY x.created_at DESC`, id)
		if err != nil {
			return nil, fmt.Errorf("reviews: review disputes: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			d, err := scanDispute(rows)
			if err != nil {
				return nil, err
			}
			out.Disputes = append(out.Disputes, d)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	entityType := "telemedicine_review"
	if source == SourceDoctorModule {
		entityType = "doctor_review"
	}
	hrows, err := s.db.Query(ctx, `
		SELECT action, COALESCE(detail->>'reason', ''), user_id::text, created_at
		FROM doctor_compliance_audit
		WHERE entity_type = $1 AND entity_id = $2
		ORDER BY created_at DESC LIMIT 50`, entityType, id)
	if err != nil {
		return nil, fmt.Errorf("reviews: history: %w", err)
	}
	defer hrows.Close()
	for hrows.Next() {
		var e ModerationEvent
		if err := hrows.Scan(&e.Action, &e.Reason, &e.Actor, &e.At); err != nil {
			return nil, err
		}
		out.History = append(out.History, e)
	}
	return out, hrows.Err()
}

// --- mutation -------------------------------------------------------------

func insertAudit(ctx context.Context, tx pgx.Tx, actor, action, entityType, entityID string, detail map[string]any) error {
	b, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("reviews: audit detail: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail)
		VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`, actor, action, entityType, entityID, string(b)); err != nil {
		return fmt.Errorf("reviews: audit: %w", err)
	}
	return nil
}

// applyHidden flips one review's visibility inside tx. changed is false when the
// review already had the requested state (idempotent replay, no audit row).
func applyHidden(ctx context.Context, tx pgx.Tx, actor, source, id string, hidden bool, reason string, extra map[string]any) (changed bool, err error) {
	action := "telemedicine.admin.review.hidden"
	if !hidden {
		action = "telemedicine.admin.review.unhidden"
	}
	detail := map[string]any{"reason": reason, "source": source}
	for k, v := range extra {
		detail[k] = v
	}

	switch source {
	case SourceTelemedicine:
		var doctorID, doctorUserID string
		var cur bool
		err := tx.QueryRow(ctx, `
			SELECT tr.doctor_id::text, d.user_id::text, tr.is_hidden
			FROM telemedicine_reviews tr JOIN doctors d ON d.id = tr.doctor_id
			WHERE tr.id = $1::uuid FOR UPDATE OF tr`, id).Scan(&doctorID, &doctorUserID, &cur)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotFound
		}
		if err != nil {
			return false, fmt.Errorf("reviews: load review: %w", err)
		}
		if doctorUserID == actor {
			return false, ErrSelfModeration
		}
		if cur == hidden {
			return false, nil
		}
		if _, err := tx.Exec(ctx, `UPDATE telemedicine_reviews SET is_hidden = $2 WHERE id = $1::uuid`, id, hidden); err != nil {
			return false, fmt.Errorf("reviews: update review: %w", err)
		}
		// Keep the doctors.rating / review_count projection consistent with the
		// visible reviews — the same recompute AddReview performs.
		if _, err := tx.Exec(ctx, `
			UPDATE doctors d SET review_count = sub.cnt, rating = ROUND(sub.avg, 2)
			FROM (SELECT COUNT(*) AS cnt, COALESCE(AVG(rating), 0) AS avg
			      FROM telemedicine_reviews WHERE doctor_id = $1::uuid AND is_hidden = FALSE) sub
			WHERE d.id = $1::uuid`, doctorID); err != nil {
			return false, fmt.Errorf("reviews: refresh doctor rating: %w", err)
		}
		detail["doctor_id"] = doctorID
		if err := insertAudit(ctx, tx, actor, action, "telemedicine_review", id, detail); err != nil {
			return false, err
		}
		return true, nil

	case SourceDoctorModule:
		var doctorUserID string
		var cur bool
		err := tx.QueryRow(ctx, `
			SELECT user_id::text, COALESCE((detail->'moderation'->>'hidden')::boolean, false)
			FROM doctor_reviews WHERE id = $1::uuid FOR UPDATE`, id).Scan(&doctorUserID, &cur)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotFound
		}
		if err != nil {
			return false, fmt.Errorf("reviews: load review: %w", err)
		}
		if doctorUserID == actor {
			return false, ErrSelfModeration
		}
		if cur == hidden {
			return false, nil
		}
		if _, err := tx.Exec(ctx, `
			UPDATE doctor_reviews
			SET detail = jsonb_set(COALESCE(detail, '{}'::jsonb), '{moderation}',
			      jsonb_build_object('hidden', $2::boolean, 'reason', $3::text, 'by', $4::text, 'at', to_jsonb(now())))
			WHERE id = $1::uuid`, id, hidden, reason, actor); err != nil {
			return false, fmt.Errorf("reviews: update review: %w", err)
		}
		detail["doctor_user_id"] = doctorUserID
		if err := insertAudit(ctx, tx, actor, action, "doctor_review", id, detail); err != nil {
			return false, err
		}
		return true, nil
	}
	return false, ErrValidation
}

func (s *pgStore) SetHidden(ctx context.Context, actor, source, id string, hidden bool, reason string) (*Review, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("reviews: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := applyHidden(ctx, tx, actor, source, id, hidden, reason, nil); err != nil {
		return nil, err
	}
	rv, err := s.getReview(ctx, tx, source, id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("reviews: commit: %w", err)
	}
	return rv, nil
}

// --- disputes -------------------------------------------------------------

const disputeSelect = `
	SELECT x.id::text, x.kind, x.status, x.reason, x.review_id::text, x.user_id::text, COALESCE(d.name, ''),
	       x.detail->'resolution'->>'reason', (x.detail->'resolution'->>'at')::timestamptz, x.created_at
	FROM doctor_review_disputes x
	LEFT JOIN doctors d ON d.user_id = x.user_id`

func scanDispute(row pgx.Row) (Dispute, error) {
	var d Dispute
	err := row.Scan(&d.ID, &d.Kind, &d.Status, &d.Reason, &d.ReviewID, &d.DoctorUserID, &d.DoctorName,
		&d.ResolutionReason, &d.ResolvedAt, &d.CreatedAt)
	return d, err
}

func (s *pgStore) ListDisputes(ctx context.Context, f DisputeFilter) ([]Dispute, int, error) {
	limit, offset := clampPage(f.Limit, f.Offset)
	rows, err := s.db.Query(ctx, disputeSelect+`
		WHERE ($1 = '' OR x.status = $1) AND ($2 = '' OR x.kind = $2)
		ORDER BY (x.status = 'open') DESC,
		         CASE WHEN x.status = 'open' THEN x.created_at END ASC,
		         x.created_at DESC
		LIMIT $3 OFFSET $4`, f.Status, f.Kind, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("reviews: list disputes: %w", err)
	}
	defer rows.Close()
	out := []Dispute{}
	for rows.Next() {
		d, err := scanDispute(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("reviews: scan dispute: %w", err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var total int
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM doctor_review_disputes x
		WHERE ($1 = '' OR x.status = $1) AND ($2 = '' OR x.kind = $2)`, f.Status, f.Kind).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("reviews: count disputes: %w", err)
	}
	return out, total, nil
}

func (s *pgStore) GetDispute(ctx context.Context, id string) (*DisputeDetail, error) {
	d, err := scanDispute(s.db.QueryRow(ctx, disputeSelect+` WHERE x.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("reviews: get dispute: %w", err)
	}
	out := &DisputeDetail{Dispute: d}
	if d.ReviewID != nil {
		rv, err := s.getReview(ctx, s.db, SourceDoctorModule, *d.ReviewID)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		out.Review = rv
	}
	return out, nil
}

func (s *pgStore) Resolve(ctx context.Context, actor, id, decision, reason string) (*Dispute, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("reviews: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status, doctorUserID string
	var reviewID *string
	err = tx.QueryRow(ctx, `
		SELECT status, user_id::text, review_id::text
		FROM doctor_review_disputes WHERE id = $1::uuid FOR UPDATE`, id).Scan(&status, &doctorUserID, &reviewID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("reviews: load dispute: %w", err)
	}
	if doctorUserID == actor {
		return nil, ErrSelfModeration
	}
	repeat, err := canResolve(status, decision)
	if err != nil {
		return nil, err
	}
	if !repeat {
		if decision == StatusUpheld && reviewID != nil {
			if _, err := applyHidden(ctx, tx, actor, SourceDoctorModule, *reviewID, true, reason,
				map[string]any{"dispute_id": id}); err != nil {
				return nil, err
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE doctor_review_disputes
			SET status = $2,
			    detail = jsonb_set(COALESCE(detail, '{}'::jsonb), '{resolution}',
			      jsonb_build_object('decision', $2::text, 'reason', $3::text, 'by', $4::text, 'at', to_jsonb(now())))
			WHERE id = $1::uuid`, id, decision, reason, actor); err != nil {
			return nil, fmt.Errorf("reviews: update dispute: %w", err)
		}
		if err := insertAudit(ctx, tx, actor, "telemedicine.admin.review_dispute."+decision, "review_dispute", id,
			map[string]any{"decision": decision, "reason": reason, "review_id": reviewID, "doctor_user_id": doctorUserID}); err != nil {
			return nil, err
		}
	}
	d, err := scanDispute(tx.QueryRow(ctx, disputeSelect+` WHERE x.id = $1::uuid`, id))
	if err != nil {
		return nil, fmt.Errorf("reviews: reload dispute: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("reviews: commit: %w", err)
	}
	return &d, nil
}
