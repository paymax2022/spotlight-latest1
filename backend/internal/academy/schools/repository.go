package schools

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the data-access contract the service depends on. The pgx *Repository is the
// production implementation; tests inject a fake (no DB) to exercise the seat-capped,
// idempotent bulk-enrolment and licence SM logic.
type Store interface {
	// Institutions
	InsertInstitution(ctx context.Context, name, typ, adminUserID string, whiteLabel json.RawMessage, vaRef string) (*Institution, error)
	GetInstitution(ctx context.Context, id string) (*Institution, error)
	ListInstitutions(ctx context.Context) ([]Institution, error)
	ListInstitutionsByAdmin(ctx context.Context, adminUserID string) ([]Institution, error)

	// Licences
	InsertLicence(ctx context.Context, institutionID, tier string, seats int, priceMinor int64, startsAt, expiresAt *time.Time) (*Licence, error)
	GetLicence(ctx context.Context, id string) (*Licence, error)
	ListLicences(ctx context.Context, institutionID string) ([]Licence, error)
	ActiveLicence(ctx context.Context, institutionID string) (*Licence, error)
	// SetLicenceState performs a GUARDED transition (caller pre-checks canLicence; the
	// store re-checks current state atomically). Returns ErrIllegalTransition on mismatch.
	SetLicenceState(ctx context.Context, licenceID string, from, to LicenceState) (*Licence, error)

	// Class groups
	InsertClassGroup(ctx context.Context, institutionID, name, classCode, teacherUserID string) (*ClassGroup, error)
	ListClassGroups(ctx context.Context, institutionID string) ([]ClassGroup, error)

	// Enrolment — atomic, seat-capped, idempotent insert + seat increment.
	// Returns: seated (a new seat was consumed), replay (already enrolled — no new seat),
	// and the licence's used/total AFTER the operation.
	EnrollSeated(ctx context.Context, institutionID, classGroupID, learnerUserID, idemKey string) (seated, replay bool, used, seats int, err error)
	// RemoveEnrollment flips active→removed and frees a seat atomically. Returns whether
	// a seat was freed (false ⇒ nothing active to remove).
	RemoveEnrollment(ctx context.Context, institutionID, learnerUserID string) (freed bool, err error)
	CountEnrollmentsByState(ctx context.Context, institutionID string) (map[string]int, error)

	// Billing
	InsertBilling(ctx context.Context, institutionID, period string, amountMinor int64) (*Billing, error)
	GetBilling(ctx context.Context, id string) (*Billing, error)
	SetBillingPaid(ctx context.Context, billingID, paymentRef string) (*Billing, error)

	// Audit (public.audit_logs, module 'academy.schools')
	WriteAudit(ctx context.Context, actorID, action, resourceType, resourceID string, detail any) error
}

// Repository is the pgx implementation of Store. Every query is parameterized; money
// lives in *_minor bigint columns. Tables map exactly to
// 20260815001300_academy_schools_tutor.sql.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// querier abstracts *pgxpool.Pool and pgx.Tx so the same helpers run either against the
// pool or inside a transaction.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// ── Institutions ──────────────────────────────────────────────────────────────────

func (r *Repository) InsertInstitution(ctx context.Context, name, typ, adminUserID string, whiteLabel json.RawMessage, vaRef string) (*Institution, error) {
	id := uuid.New().String()
	now := time.Now()
	if typ == "" {
		typ = "school"
	}
	const q = `INSERT INTO academy_institutions (id, name, type, admin_user_id, white_label, virtual_account_ref, status, created_at)
	           VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`
	if _, err := r.db.Exec(ctx, q, id, name, typ, nullStr(adminUserID), toJSON(whiteLabel), nullStr(vaRef), now); err != nil {
		return nil, err
	}
	return r.GetInstitution(ctx, id)
}

func (r *Repository) GetInstitution(ctx context.Context, id string) (*Institution, error) {
	const q = `SELECT id, name, type, admin_user_id, white_label, virtual_account_ref, status, created_at
	           FROM academy_institutions WHERE id = $1`
	return scanInstitution(r.db.QueryRow(ctx, q, id))
}

func (r *Repository) ListInstitutions(ctx context.Context) ([]Institution, error) {
	const q = `SELECT id, name, type, admin_user_id, white_label, virtual_account_ref, status, created_at
	           FROM academy_institutions ORDER BY created_at DESC`
	return r.queryInstitutions(ctx, q)
}

func (r *Repository) ListInstitutionsByAdmin(ctx context.Context, adminUserID string) ([]Institution, error) {
	const q = `SELECT id, name, type, admin_user_id, white_label, virtual_account_ref, status, created_at
	           FROM academy_institutions WHERE admin_user_id = $1 ORDER BY created_at DESC`
	return r.queryInstitutions(ctx, q, adminUserID)
}

func (r *Repository) queryInstitutions(ctx context.Context, q string, args ...any) ([]Institution, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Institution{}
	for rows.Next() {
		i, err := scanInstitution(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

func scanInstitution(row pgx.Row) (*Institution, error) {
	var i Institution
	var white []byte
	err := row.Scan(&i.ID, &i.Name, &i.Type, &i.AdminUserID, &white, &i.VirtualAccountRef, &i.Status, &i.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	i.WhiteLabel = rawOrEmptyObject(white)
	return &i, nil
}

// ── Licences ──────────────────────────────────────────────────────────────────────

func (r *Repository) InsertLicence(ctx context.Context, institutionID, tier string, seats int, priceMinor int64, startsAt, expiresAt *time.Time) (*Licence, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_licences (id, institution_id, tier, seats, used_seats, price_minor, starts_at, expires_at, state, created_at)
	           VALUES ($1,$2,$3,$4,0,$5,$6,$7,'active',$8)`
	if _, err := r.db.Exec(ctx, q, id, institutionID, tier, seats, priceMinor, startsAt, expiresAt, now); err != nil {
		return nil, err
	}
	return r.GetLicence(ctx, id)
}

func (r *Repository) GetLicence(ctx context.Context, id string) (*Licence, error) {
	const q = `SELECT id, institution_id, tier, seats, used_seats, price_minor, starts_at, expires_at, state, created_at
	           FROM academy_licences WHERE id = $1`
	return scanLicence(r.db.QueryRow(ctx, q, id))
}

func (r *Repository) ListLicences(ctx context.Context, institutionID string) ([]Licence, error) {
	const q = `SELECT id, institution_id, tier, seats, used_seats, price_minor, starts_at, expires_at, state, created_at
	           FROM academy_licences WHERE institution_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, institutionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Licence{}
	for rows.Next() {
		l, err := scanLicence(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// ActiveLicence returns the most-recent active licence for an institution, or ErrNoActiveLicence.
func (r *Repository) ActiveLicence(ctx context.Context, institutionID string) (*Licence, error) {
	const q = `SELECT id, institution_id, tier, seats, used_seats, price_minor, starts_at, expires_at, state, created_at
	           FROM academy_licences WHERE institution_id = $1 AND state = 'active'
	           ORDER BY created_at DESC LIMIT 1`
	l, err := scanLicence(r.db.QueryRow(ctx, q, institutionID))
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNoActiveLicence
	}
	return l, err
}

func scanLicence(row pgx.Row) (*Licence, error) {
	var l Licence
	var state string
	err := row.Scan(&l.ID, &l.InstitutionID, &l.Tier, &l.Seats, &l.UsedSeats, &l.PriceMinor,
		&l.StartsAt, &l.ExpiresAt, &state, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	l.State = LicenceState(state)
	return &l, nil
}

// SetLicenceState performs a GUARDED transition inside a tx. It re-checks the current
// state under FOR UPDATE (WHERE state=$from) so concurrent callers cannot
// double-transition, and rejects illegal transitions with ErrIllegalTransition.
func (r *Repository) SetLicenceState(ctx context.Context, licenceID string, from, to LicenceState) (*Licence, error) {
	if !canLicence(from, to) {
		return nil, ErrIllegalTransition
	}
	var out *Licence
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		const sel = `SELECT state FROM academy_licences WHERE id = $1 FOR UPDATE`
		var cur string
		if err := tx.QueryRow(ctx, sel, licenceID).Scan(&cur); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrLicenceNotFound
			}
			return err
		}
		if LicenceState(cur) != from {
			return ErrIllegalTransition
		}
		const upd = `UPDATE academy_licences SET state = $2 WHERE id = $1 AND state = $3`
		tag, err := tx.Exec(ctx, upd, licenceID, string(to), string(from))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrIllegalTransition
		}
		l, err := scanLicence(tx.QueryRow(ctx, `SELECT id, institution_id, tier, seats, used_seats, price_minor, starts_at, expires_at, state, created_at FROM academy_licences WHERE id = $1`, licenceID))
		if err != nil {
			return err
		}
		out = l
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ── Class groups ────────────────────────────────────────────────────────────────

func (r *Repository) InsertClassGroup(ctx context.Context, institutionID, name, classCode, teacherUserID string) (*ClassGroup, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_class_groups (id, institution_id, name, class_code, teacher_user_id, created_at)
	           VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := r.db.Exec(ctx, q, id, institutionID, name, nullStr(classCode), nullStr(teacherUserID), now); err != nil {
		return nil, err
	}
	return &ClassGroup{ID: id, InstitutionID: institutionID, Name: name,
		ClassCode: ptrOrNil(classCode), TeacherUserID: ptrOrNil(teacherUserID), CreatedAt: now}, nil
}

func (r *Repository) ListClassGroups(ctx context.Context, institutionID string) ([]ClassGroup, error) {
	const q = `SELECT id, institution_id, name, class_code, teacher_user_id, created_at
	           FROM academy_class_groups WHERE institution_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, institutionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ClassGroup{}
	for rows.Next() {
		var g ClassGroup
		if err := rows.Scan(&g.ID, &g.InstitutionID, &g.Name, &g.ClassCode, &g.TeacherUserID, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ── Enrolment (atomic, seat-capped, idempotent) ───────────────────────────────────

// EnrollSeated enrols one learner with seat accounting in a SINGLE transaction:
//  1. Lock the institution's active licence FOR UPDATE (serialises seat counting).
//  2. If the learner is already enrolled (UNIQUE institution_id, learner_user_id)
//     return replay=true with NO new seat (idempotent).
//  3. If used_seats >= seats, reject with ErrSeatLimitExceeded (seat-capped, fail-closed).
//  4. Otherwise insert the enrolment (active) and increment used_seats atomically.
func (r *Repository) EnrollSeated(ctx context.Context, institutionID, classGroupID, learnerUserID, idemKey string) (seated, replay bool, used, seats int, err error) {
	err = r.withTx(ctx, func(tx pgx.Tx) error {
		// Lock the active licence row so concurrent enrolments cannot oversell seats.
		const lockLic = `SELECT id, seats, used_seats FROM academy_licences
		                 WHERE institution_id = $1 AND state = 'active'
		                 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
		var licID string
		if e := tx.QueryRow(ctx, lockLic, institutionID).Scan(&licID, &seats, &used); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return ErrNoActiveLicence
			}
			return e
		}

		// Already enrolled? Idempotent replay — no new seat. (Counts both active and
		// invited; a removed learner re-enrolling re-activates and re-seats below.)
		const existing = `SELECT state FROM academy_enrollments
		                  WHERE institution_id = $1 AND learner_user_id = $2 FOR UPDATE`
		var st string
		switch e := tx.QueryRow(ctx, existing, institutionID, learnerUserID).Scan(&st); {
		case e == nil:
			if st != EnrollRemoved {
				replay = true
				return nil // already seated → replay, no second seat
			}
			// Re-enrolling a removed learner consumes a seat again.
			if used >= seats {
				return ErrSeatLimitExceeded
			}
			const reactivate = `UPDATE academy_enrollments
			    SET state = 'active', class_group_id = COALESCE($3, class_group_id),
			        idempotency_key = COALESCE(idempotency_key, $4)
			    WHERE institution_id = $1 AND learner_user_id = $2`
			if _, e2 := tx.Exec(ctx, reactivate, institutionID, learnerUserID, nullStr(classGroupID), nullStr(idemKey)); e2 != nil {
				return e2
			}
		case errors.Is(e, pgx.ErrNoRows):
			// Seat cap: fail-closed when the licence is full.
			if used >= seats {
				return ErrSeatLimitExceeded
			}
			id := uuid.New().String()
			const ins = `INSERT INTO academy_enrollments
			    (id, institution_id, class_group_id, learner_user_id, state, idempotency_key, created_at)
			    VALUES ($1,$2,$3,$4,'active',$5, now())`
			if _, e2 := tx.Exec(ctx, ins, id, institutionID, nullStr(classGroupID), learnerUserID, nullStr(idemKey)); e2 != nil {
				return e2
			}
		default:
			return e
		}

		// New seat consumed: increment used_seats atomically under the lock.
		const incr = `UPDATE academy_licences SET used_seats = used_seats + 1
		              WHERE id = $1 AND used_seats < seats RETURNING used_seats`
		if e := tx.QueryRow(ctx, incr, licID).Scan(&used); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return ErrSeatLimitExceeded
			}
			return e
		}
		seated = true
		return nil
	})
	return seated, replay, used, seats, err
}

// RemoveEnrollment flips active→removed and frees a seat atomically.
func (r *Repository) RemoveEnrollment(ctx context.Context, institutionID, learnerUserID string) (freed bool, err error) {
	err = r.withTx(ctx, func(tx pgx.Tx) error {
		const lockLic = `SELECT id FROM academy_licences
		                 WHERE institution_id = $1 AND state = 'active'
		                 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
		var licID string
		if e := tx.QueryRow(ctx, lockLic, institutionID).Scan(&licID); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return ErrNoActiveLicence
			}
			return e
		}
		const upd = `UPDATE academy_enrollments SET state = 'removed'
		             WHERE institution_id = $1 AND learner_user_id = $2 AND state = 'active'`
		tag, e := tx.Exec(ctx, upd, institutionID, learnerUserID)
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			return nil // nothing active to remove (idempotent)
		}
		// Free a seat (never below zero).
		const dec = `UPDATE academy_licences SET used_seats = GREATEST(used_seats - 1, 0) WHERE id = $1`
		if _, e := tx.Exec(ctx, dec, licID); e != nil {
			return e
		}
		freed = true
		return nil
	})
	return freed, err
}

func (r *Repository) CountEnrollmentsByState(ctx context.Context, institutionID string) (map[string]int, error) {
	const q = `SELECT state, COUNT(*) FROM academy_enrollments WHERE institution_id = $1 GROUP BY state`
	rows, err := r.db.Query(ctx, q, institutionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out[st] = n
	}
	return out, rows.Err()
}

// ── Billing ─────────────────────────────────────────────────────────────────────

func (r *Repository) InsertBilling(ctx context.Context, institutionID, period string, amountMinor int64) (*Billing, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_institution_billing (id, institution_id, period, amount_minor, state, created_at)
	           VALUES ($1,$2,$3,$4,'open',$5)`
	if _, err := r.db.Exec(ctx, q, id, institutionID, period, amountMinor, now); err != nil {
		return nil, err
	}
	return &Billing{ID: id, InstitutionID: institutionID, Period: period, AmountMinor: amountMinor,
		State: BillingOpen, CreatedAt: now}, nil
}

func (r *Repository) GetBilling(ctx context.Context, id string) (*Billing, error) {
	const q = `SELECT id, institution_id, period, amount_minor, state, payment_ref, created_at
	           FROM academy_institution_billing WHERE id = $1`
	var b Billing
	err := r.db.QueryRow(ctx, q, id).Scan(&b.ID, &b.InstitutionID, &b.Period, &b.AmountMinor, &b.State, &b.PaymentRef, &b.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// SetBillingPaid flips a billing line open→paid atomically (WHERE state='open' guards a
// double charge). Returns ErrBillingNotOpen if it was not open.
func (r *Repository) SetBillingPaid(ctx context.Context, billingID, paymentRef string) (*Billing, error) {
	const upd = `UPDATE academy_institution_billing SET state = 'paid', payment_ref = $2
	             WHERE id = $1 AND state = 'open'`
	tag, err := r.db.Exec(ctx, upd, billingID, nullStr(paymentRef))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrBillingNotOpen
	}
	return r.GetBilling(ctx, billingID)
}

// ── Audit (public.audit_logs, module 'academy.schools') ───────────────────────────

func (r *Repository) WriteAudit(ctx context.Context, actorID, action, resourceType, resourceID string, detail any) error {
	const ins = `INSERT INTO public.audit_logs (actor_user_id, action, module, resource_type, resource_id, new_values)
	             VALUES ($1,$2,'academy.schools',$3,$4,$5)`
	_, err := r.db.Exec(ctx, ins, nullUUID(actorID), action, nullStr(resourceType), nullStr(resourceID), toJSON(detail))
	return err
}

// ── tx helper ─────────────────────────────────────────────────────────────────────

func (r *Repository) withTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── small helpers ─────────────────────────────────────────────────────────────────

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullUUID is for uuid columns where empty string must become NULL.
func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}

func toJSON(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	if b, ok := v.([]byte); ok {
		if len(b) == 0 {
			return []byte("{}")
		}
		return b
	}
	if rm, ok := v.(json.RawMessage); ok {
		if len(rm) == 0 {
			return []byte("{}")
		}
		return rm
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}
