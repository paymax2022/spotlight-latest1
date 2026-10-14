package cryptosvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGFeeStore keeps the fee-schedule history in public.crypto_fee_schedules: append-only, one
// complete schedule per row, the active schedule being the highest version.
type PGFeeStore struct {
	pool *pgxpool.Pool
	base FeeSchedule // applies until the first version is stored
}

var _ FeeStore = (*PGFeeStore)(nil)

// NewPGFeeStore wraps pool; base is the schedule in force before any version is stored.
func NewPGFeeStore(pool *pgxpool.Pool, base FeeSchedule) *PGFeeStore {
	return &PGFeeStore{pool: pool, base: base}
}

// feeLockKey serialises appends so the version check and the insert are one atomic step.
const feeLockKey = "crypto_fee_schedule"

const feeCols = `version, major_bps, other_bps, majors, overrides, reason, created_by, created_at`

func scanFees(row pgx.Row) (VersionedFees, error) {
	var (
		v        VersionedFees
		majors   []string
		overJSON []byte
	)
	if err := row.Scan(&v.Version, &v.Schedule.MajorBps, &v.Schedule.OtherBps, &majors, &overJSON, &v.Reason, &v.CreatedBy, &v.CreatedAt); err != nil {
		return VersionedFees{}, err
	}
	v.Schedule.MaxBps = HardMaxBps
	v.Schedule.Majors = make(map[string]struct{}, len(majors))
	for _, m := range majors {
		v.Schedule.Majors[m] = struct{}{}
	}
	if len(overJSON) > 0 {
		var o map[string]int
		if err := json.Unmarshal(overJSON, &o); err != nil {
			return VersionedFees{}, fmt.Errorf("cryptosvc: stored fee overrides are not valid: %w", err)
		}
		if len(o) > 0 {
			v.Schedule.Overrides = o
		}
	}
	return v, nil
}

// Current returns the active schedule, or the code default (Version 0) when none is stored. A
// stored row above the ceiling is returned as an error, never used.
func (s *PGFeeStore) Current(ctx context.Context) (VersionedFees, error) {
	v, err := scanFees(s.pool.QueryRow(ctx, `SELECT `+feeCols+` FROM public.crypto_fee_schedules ORDER BY version DESC LIMIT 1`))
	if errors.Is(err, pgx.ErrNoRows) {
		return VersionedFees{Version: 0, Schedule: s.base, Reason: "configured default", CreatedBy: "system"}, nil
	}
	if err != nil {
		return VersionedFees{}, err
	}
	if err := v.Schedule.Validate(); err != nil {
		return VersionedFees{}, err
	}
	return v, nil
}

// History returns up to limit versions, newest first.
func (s *PGFeeStore) History(ctx context.Context, limit int) ([]VersionedFees, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+feeCols+` FROM public.crypto_fee_schedules ORDER BY version DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VersionedFees{}
	for rows.Next() {
		v, err := scanFees(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func sameSchedule(a, b FeeScheduleInput) bool {
	x, y := a.normalised(), b.normalised()
	sort.Strings(x.Majors)
	sort.Strings(y.Majors)
	if len(x.Overrides) == 0 && len(y.Overrides) == 0 {
		x.Overrides, y.Overrides = nil, nil
	}
	return reflect.DeepEqual(x, y)
}

// Append stores a new version under an advisory lock: replay or conflict on the idempotency key
// first, then the optimistic version check, then the insert.
func (s *PGFeeStore) Append(ctx context.Context, in FeeScheduleInput) (VersionedFees, bool, error) {
	sch, err := in.Schedule()
	if err != nil {
		return VersionedFees{}, false, err
	}
	n := in.normalised()
	over, err := overridesJSON(n.Overrides)
	if err != nil {
		return VersionedFees{}, false, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return VersionedFees{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, feeLockKey); err != nil {
		return VersionedFees{}, false, err
	}

	if prev, err := scanFees(tx.QueryRow(ctx, `SELECT `+feeCols+` FROM public.crypto_fee_schedules WHERE idempotency_key = $1`, in.IdempotencyKey)); err == nil {
		if !sameSchedule(prev.asInput(), in) {
			return VersionedFees{}, false, ErrFeeIdempotencyConflict
		}
		return prev, false, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return VersionedFees{}, false, err
	}

	var cur int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(version), 0) FROM public.crypto_fee_schedules`).Scan(&cur); err != nil {
		return VersionedFees{}, false, err
	}
	if cur != in.ExpectedVersion {
		return VersionedFees{}, false, ErrFeeVersionConflict
	}
	majors := make([]string, 0, len(sch.Majors))
	for m := range sch.Majors {
		majors = append(majors, m)
	}
	sort.Strings(majors)
	v, err := scanFees(tx.QueryRow(ctx,
		`INSERT INTO public.crypto_fee_schedules (major_bps, other_bps, majors, overrides, reason, created_by, idempotency_key)
		 VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING `+feeCols,
		sch.MajorBps, sch.OtherBps, majors, string(over), strings.TrimSpace(in.Reason), in.Actor, in.IdempotencyKey))
	if err != nil {
		return VersionedFees{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return VersionedFees{}, false, err
	}
	return v, true, nil
}
