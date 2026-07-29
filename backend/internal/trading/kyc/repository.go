package kyc

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// Get loads a user's record. exists=false means no row yet — the caller treats
// that as a synthetic NOT_STARTED (access is denied for it, fail-closed).
func (r *Repository) Get(ctx context.Context, userID string) (rec Record, exists bool, err error) {
	var status string
	err = r.db.QueryRow(ctx, `
		SELECT status, submitted_at, reviewed_at, reviewer_id, reason_code, bypass_expires_at, exposure_cap_kobo, version
		FROM public.trading_kyc WHERE user_id=$1`, userID).
		Scan(&status, &rec.SubmittedAt, &rec.ReviewedAt, &rec.ReviewerID, &rec.ReasonCode, &rec.BypassExpiresAt, &rec.ExposureCapKobo, &rec.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{UserID: userID, Status: StatusNotStarted}, false, nil
	}
	if err != nil {
		return Record{}, false, err
	}
	rec.UserID = userID
	rec.Status = Status(status)
	return rec, true, nil
}

// Apply is the ONE write path: it upserts the record to `next` (guarded on the
// expected version for an existing row) and appends an immutable audit event, in a
// single transaction. A version mismatch returns ErrVersionConflict.
type Apply struct {
	To              Status
	ExpectVersion   int // the version the caller read; ignored when the row is new
	RowExists       bool
	EventType       string
	ActorID         *string
	Reason          *string
	SetSubmittedNow bool
	SetReviewedNow  bool
	BypassExpiresAt *time.Time // set on bypass; cleared (nil) otherwise for non-bypass
	ExposureCap     *int64
	KeepBypassFields bool // true only for the BYPASS transition (persist expiry/cap)
}

func (r *Repository) Apply(ctx context.Context, userID string, from Status, a Apply) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if a.RowExists {
		submitted := "submitted_at"
		if a.SetSubmittedNow {
			submitted = "now()"
		}
		reviewed := "reviewed_at"
		if a.SetReviewedNow {
			reviewed = "now()"
		}
		// On a non-bypass transition, clear the bypass time-box/cap so a stale
		// bypass window can never linger past a later state change.
		bypassExpr := "NULL"
		capExpr := "NULL"
		args := []any{userID, string(a.To), a.ExpectVersion, a.ActorID, a.Reason}
		if a.KeepBypassFields {
			bypassExpr = "$6"
			capExpr = "$7"
			args = append(args, a.BypassExpiresAt, a.ExposureCap)
		}
		ct, err := tx.Exec(ctx, `
			UPDATE public.trading_kyc SET
				status=$2,
				reviewer_id=COALESCE($4, reviewer_id),
				reason_code=$5,
				submitted_at=`+submitted+`,
				reviewed_at=`+reviewed+`,
				bypass_expires_at=`+bypassExpr+`,
				exposure_cap_kobo=`+capExpr+`,
				version=version+1,
				updated_at=now()
			WHERE user_id=$1 AND version=$3`, args...)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrVersionConflict
		}
	} else {
		var subAt, revAt any
		if a.SetSubmittedNow {
			subAt = time.Now()
		}
		if a.SetReviewedNow {
			revAt = time.Now()
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.trading_kyc
				(user_id,status,reviewer_id,reason_code,submitted_at,reviewed_at,bypass_expires_at,exposure_cap_kobo,version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)`,
			userID, string(a.To), a.ActorID, a.Reason, subAt, revAt, a.BypassExpiresAt, a.ExposureCap); err != nil {
			return err
		}
	}

	fromStr := string(from)
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.trading_kyc_events (user_id,event_type,old_status,new_status,actor_id,reason)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		userID, a.EventType, fromStr, string(a.To), a.ActorID, a.Reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// InsertBypassRegister records the compliance-register row for a bypass grant.
func (r *Repository) InsertBypassRegister(ctx context.Context, b Bypass) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.trading_kyc_bypass (user_id,maker_id,checker_id,reason,exposure_cap_kobo,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		b.UserID, b.MakerID, b.CheckerID, b.Reason, b.ExposureCapKobo, b.ExpiresAt)
	return err
}

// DueBypasses returns BYPASSED records whose time-box has passed (for the sweeper).
func (r *Repository) DueBypasses(ctx context.Context, now time.Time, limit int) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT user_id FROM public.trading_kyc
		WHERE status='BYPASSED' AND (bypass_expires_at IS NULL OR bypass_expires_at <= $1)
		ORDER BY bypass_expires_at ASC NULLS FIRST LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ListByStatus returns records in a given status (admin review queue).
func (r *Repository) ListByStatus(ctx context.Context, status Status, limit int) ([]Record, error) {
	rows, err := r.db.Query(ctx, `
		SELECT user_id, status, submitted_at, reviewed_at, reviewer_id, reason_code, bypass_expires_at, exposure_cap_kobo, version
		FROM public.trading_kyc WHERE status=$1 ORDER BY submitted_at ASC NULLS LAST LIMIT $2`, string(status), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Record
	for rows.Next() {
		var rec Record
		var st string
		if err := rows.Scan(&rec.UserID, &st, &rec.SubmittedAt, &rec.ReviewedAt, &rec.ReviewerID, &rec.ReasonCode, &rec.BypassExpiresAt, &rec.ExposureCapKobo, &rec.Version); err != nil {
			return nil, err
		}
		rec.Status = Status(st)
		out = append(out, rec)
	}
	return out, rows.Err()
}
