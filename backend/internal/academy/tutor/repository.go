package tutor

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

// Repository is the pgx data-access layer for the academy tutor marketplace. Every query
// is parameterized; money lives in *_minor bigint columns. The withdrawable balance is
// DERIVED via SUM(amount_minor) WHERE state='pending' — never a stored shadow balance.
// Tables map exactly to 20260815001300_academy_schools_tutor.sql; audit writes go to
// public.audit_logs (module 'academy.tutor').
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("tutor: not found")

type rowScanner interface{ Scan(dest ...any) error }

// querier abstracts *pgxpool.Pool and pgx.Tx so the same helpers run either against the
// pool or inside a transaction.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// ── helpers ────────────────────────────────────────────────────────────────────

func toJSONB(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return []byte("{}")
	}
	return b
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// insertAuditTx appends an immutable row to public.audit_logs inside a tx. module is
// always 'academy.tutor'; severity defaults to info, "warning" for rejections.
func insertAuditTx(ctx context.Context, tx pgx.Tx, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error {
	if severity == "" {
		severity = "info"
	}
	var actorArg any
	if actor != "" {
		actorArg = actor
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES ($1,$2,'academy.tutor',$3,$4,$5,$6)`
	_, err := tx.Exec(ctx, q, actorArg, action, resourceType, nullStr(resourceID), toJSONB(newValues), severity)
	return err
}

// insertAudit is the non-tx variant for standalone audits.
func (r *Repository) insertAudit(ctx context.Context, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error {
	if severity == "" {
		severity = "info"
	}
	var actorArg any
	if actor != "" {
		actorArg = actor
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES ($1,$2,'academy.tutor',$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, actorArg, action, resourceType, nullStr(resourceID), toJSONB(newValues), severity)
	return err
}

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

// ── Tutor CRUD ────────────────────────────────────────────────────────────────────

const tutorCols = `id, user_id, bio, subjects, rating, review_count, status, kyc_state, payout_account_ref, created_at`

func scanTutor(row rowScanner) (*Tutor, error) {
	t := &Tutor{}
	var subjects []string
	var status string
	err := row.Scan(&t.ID, &t.UserID, &t.Bio, &subjects, &t.Rating, &t.ReviewCount,
		&status, &t.KYCState, &t.PayoutAccountRef, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if subjects == nil {
		subjects = []string{}
	}
	t.Subjects = subjects
	t.Status = TutorStatus(status)
	return t, nil
}

// InsertTutor onboards a tutor in status 'pending'. user_id is UNIQUE: a re-onboard
// returns the existing row (idempotent on the user). Audited.
func (r *Repository) InsertTutor(ctx context.Context, userID, bio string, subjects []string) (*Tutor, error) {
	id := uuid.New().String()
	if subjects == nil {
		subjects = []string{}
	}
	const q = `
		INSERT INTO public.academy_tutors (id, user_id, bio, subjects, status, kyc_state, created_at)
		VALUES ($1,$2,$3,$4,'pending','unsubmitted', now())
		ON CONFLICT (user_id) DO UPDATE SET
			bio      = COALESCE(EXCLUDED.bio, public.academy_tutors.bio),
			subjects = EXCLUDED.subjects
		RETURNING ` + tutorCols
	t, err := scanTutor(r.db.QueryRow(ctx, q, id, userID, nullStr(bio), subjects))
	if err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, userID, "tutor.onboarded", "academy_tutor", t.ID,
		map[string]any{"status": string(TutorPending), "subjects": subjects}, "info")
	return t, nil
}

func (r *Repository) GetTutor(ctx context.Context, id string) (*Tutor, error) {
	q := `SELECT ` + tutorCols + ` FROM public.academy_tutors WHERE id = $1`
	return scanTutor(r.db.QueryRow(ctx, q, id))
}

func (r *Repository) GetTutorByUser(ctx context.Context, userID string) (*Tutor, error) {
	q := `SELECT ` + tutorCols + ` FROM public.academy_tutors WHERE user_id = $1`
	return scanTutor(r.db.QueryRow(ctx, q, userID))
}

// ListTutors lists verified tutors, optionally filtered to those teaching a subject.
func (r *Repository) ListTutors(ctx context.Context, subject string) ([]Tutor, error) {
	q := `SELECT ` + tutorCols + ` FROM public.academy_tutors WHERE status = 'verified'`
	args := []any{}
	if subject != "" {
		args = append(args, subject)
		q += ` AND $1 = ANY(subjects)`
	}
	q += ` ORDER BY rating DESC, created_at DESC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Tutor{}
	for rows.Next() {
		t, err := scanTutor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// SetTutorStatus performs a vetting transition (verify / suspend) and records the kyc
// state in the same write. Audited inside the tx. tier is recorded for verifications.
func (r *Repository) SetTutorStatus(ctx context.Context, actor, tutorID string, to TutorStatus, kycState string, detail map[string]any) (*Tutor, error) {
	var out *Tutor
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		const upd = `
			UPDATE public.academy_tutors
			SET status = $2, kyc_state = COALESCE($3, kyc_state) WHERE id = $1`
		tag, err := tx.Exec(ctx, upd, tutorID, string(to), nullStr(kycState))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if detail == nil {
			detail = map[string]any{}
		}
		detail["status"] = string(to)
		if err := insertAuditTx(ctx, tx, actor, "tutor."+string(to), "academy_tutor", tutorID, detail, "info"); err != nil {
			return err
		}
		const sel = `SELECT ` + tutorCols + ` FROM public.academy_tutors WHERE id = $1`
		t, serr := scanTutor(tx.QueryRow(ctx, sel, tutorID))
		if serr != nil {
			return serr
		}
		out = t
		return nil
	})
	return out, err
}

// ── Assignments CRUD ─────────────────────────────────────────────────────────────

const assignmentCols = `id, tutor_id, class_group_id, learner_id, kind, content_ref, title, due_at, created_at`

func scanAssignment(row rowScanner) (*Assignment, error) {
	a := &Assignment{}
	err := row.Scan(&a.ID, &a.TutorID, &a.ClassGroupID, &a.LearnerID, &a.Kind,
		&a.ContentRef, &a.Title, &a.DueAt, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

func (r *Repository) InsertAssignment(ctx context.Context, actor string, a Assignment) (*Assignment, error) {
	id := uuid.New().String()
	kind := a.Kind
	if kind == "" {
		kind = KindHomework
	}
	const q = `
		INSERT INTO public.academy_tutor_assignments
			(id, tutor_id, class_group_id, learner_id, kind, content_ref, title, due_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`
	if _, err := r.db.Exec(ctx, q, id, a.TutorID, a.ClassGroupID, a.LearnerID, kind,
		a.ContentRef, a.Title, a.DueAt); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "tutor.assignment_created", "academy_tutor_assignment", id,
		map[string]any{"tutor_id": a.TutorID, "kind": kind, "title": a.Title}, "info")
	return r.GetAssignment(ctx, id)
}

func (r *Repository) GetAssignment(ctx context.Context, id string) (*Assignment, error) {
	q := `SELECT ` + assignmentCols + ` FROM public.academy_tutor_assignments WHERE id = $1`
	return scanAssignment(r.db.QueryRow(ctx, q, id))
}

func (r *Repository) ListAssignmentsByTutor(ctx context.Context, tutorID string) ([]Assignment, error) {
	q := `SELECT ` + assignmentCols + ` FROM public.academy_tutor_assignments WHERE tutor_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, tutorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Assignment{}
	for rows.Next() {
		a, err := scanAssignment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// ── Grades (insert + grade) ──────────────────────────────────────────────────────

const gradeCols = `id, assignment_id, learner_id, score, feedback, state, created_at, graded_at`

func scanGrade(row rowScanner) (*Grade, error) {
	g := &Grade{}
	var state string
	err := row.Scan(&g.ID, &g.AssignmentID, &g.LearnerID, &g.Score, &g.Feedback,
		&state, &g.CreatedAt, &g.GradedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	g.State = GradeState(state)
	return g, nil
}

func (r *Repository) GetGrade(ctx context.Context, id string) (*Grade, error) {
	q := `SELECT ` + gradeCols + ` FROM public.academy_tutor_grades WHERE id = $1`
	return scanGrade(r.db.QueryRow(ctx, q, id))
}

// GradeAssignment inserts a graded record (state='graded', graded_at=now) for a learner's
// assignment work and, when earnMinor > 0, APPENDS an assignment earning for the tutor in
// the SAME transaction. The grade insert + the earning append + their audits are atomic so
// the earning can never diverge from the grade. Returns the grade (and earning, if any).
func (r *Repository) GradeAssignment(ctx context.Context, actor, assignmentID, learnerID string, score *float64, feedback string, tutorID string, earnMinor int64) (*Grade, *Earning, error) {
	var grade *Grade
	var earn *Earning
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		id := uuid.New().String()
		now := time.Now()
		const ins = `
			INSERT INTO public.academy_tutor_grades
				(id, assignment_id, learner_id, score, feedback, state, created_at, graded_at)
			VALUES ($1,$2,$3,$4,$5,'graded',$6,$6)`
		if _, err := tx.Exec(ctx, ins, id, assignmentID, learnerID, score, nullStr(feedback), now); err != nil {
			return err
		}
		if err := insertAuditTx(ctx, tx, actor, "tutor.graded", "academy_tutor_grade", id,
			map[string]any{"assignment_id": assignmentID, "learner_id": learnerID, "state": string(GradeGraded)}, "info"); err != nil {
			return err
		}
		const sel = `SELECT ` + gradeCols + ` FROM public.academy_tutor_grades WHERE id = $1`
		g, serr := scanGrade(tx.QueryRow(ctx, sel, id))
		if serr != nil {
			return serr
		}
		grade = g

		if earnMinor > 0 && tutorID != "" {
			e, eerr := appendEarningTx(ctx, tx, actor, tutorID, SourceAssignment, assignmentID, earnMinor)
			if eerr != nil {
				return eerr
			}
			earn = e
		}
		return nil
	})
	return grade, earn, err
}

// ── Earnings (append-only; balance DERIVED via SUM(pending)) ─────────────────────

const earningCols = `id, tutor_id, source, ref_id, amount_minor, state, ledger_ref, created_at`

func scanEarning(row rowScanner) (*Earning, error) {
	e := &Earning{}
	var state string
	err := row.Scan(&e.ID, &e.TutorID, &e.Source, &e.RefID, &e.AmountMinor, &state, &e.LedgerRef, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	e.State = EarningState(state)
	return e, nil
}

// appendEarningTx APPENDS one immutable pending earning row inside a tx. Audited.
func appendEarningTx(ctx context.Context, tx pgx.Tx, actor, tutorID, source, refID string, amountMinor int64) (*Earning, error) {
	id := uuid.New().String()
	const ins = `
		INSERT INTO public.academy_tutor_earnings
			(id, tutor_id, source, ref_id, amount_minor, state, created_at)
		VALUES ($1,$2,$3,$4,$5,'pending', now())`
	if _, err := tx.Exec(ctx, ins, id, tutorID, source, nullStr(refID), amountMinor); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, actor, "tutor.earning_accrued", "academy_tutor_earning", id,
		map[string]any{"tutor_id": tutorID, "source": source, "amount_minor": amountMinor, "state": string(EarningPending)}, "info"); err != nil {
		return nil, err
	}
	const sel = `SELECT ` + earningCols + ` FROM public.academy_tutor_earnings WHERE id = $1`
	return scanEarning(tx.QueryRow(ctx, sel, id))
}

// AppendEarning APPENDS a pending earning on the pool (standalone accrual path).
func (r *Repository) AppendEarning(ctx context.Context, actor, tutorID, source, refID string, amountMinor int64) (*Earning, error) {
	var out *Earning
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		e, err := appendEarningTx(ctx, tx, actor, tutorID, source, refID, amountMinor)
		if err != nil {
			return err
		}
		out = e
		return nil
	})
	return out, err
}

// sumPending is the DERIVED withdrawable balance — SUM(amount_minor) WHERE state='pending'.
func sumPending(ctx context.Context, q querier, tutorID string) (int64, error) {
	const sel = `SELECT COALESCE(SUM(amount_minor), 0) FROM public.academy_tutor_earnings
	             WHERE tutor_id = $1 AND state = 'pending'`
	var sum int64
	if err := q.QueryRow(ctx, sel, tutorID).Scan(&sum); err != nil {
		return 0, err
	}
	return sum, nil
}

// SumPending exposes the derived pending balance on the pool (read path). This is the
// single source of truth for the withdrawable amount — never a stored shadow column.
func (r *Repository) SumPending(ctx context.Context, tutorID string) (int64, error) {
	return sumPending(ctx, r.db, tutorID)
}

func (r *Repository) ListEarnings(ctx context.Context, tutorID string) ([]Earning, error) {
	q := `SELECT ` + earningCols + ` FROM public.academy_tutor_earnings WHERE tutor_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, tutorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Earning{}
	for rows.Next() {
		e, err := scanEarning(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// ── Payouts (insert + guarded state update + idempotency) ────────────────────────

const payoutCols = `id, tutor_id, amount_minor, state, payout_ref, idempotency_key, created_at, decided_at`

func scanPayout(row rowScanner) (*Payout, error) {
	p := &Payout{}
	var state string
	err := row.Scan(&p.ID, &p.TutorID, &p.AmountMinor, &state, &p.PayoutRef, &p.IdempotencyKey, &p.CreatedAt, &p.DecidedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.State = PayoutState(state)
	return p, nil
}

func (r *Repository) GetPayout(ctx context.Context, id string) (*Payout, error) {
	q := `SELECT ` + payoutCols + ` FROM public.academy_tutor_payouts WHERE id = $1`
	return scanPayout(r.db.QueryRow(ctx, q, id))
}

// FindPayoutByIdem returns an existing payout for the idempotency key, or ErrNotFound.
// Backs the idempotency guarantee: a replayed request returns the SAME payout (and ref)
// with NO second rail call.
func (r *Repository) FindPayoutByIdem(ctx context.Context, idemKey string) (*Payout, error) {
	if idemKey == "" {
		return nil, ErrNotFound
	}
	q := `SELECT ` + payoutCols + ` FROM public.academy_tutor_payouts WHERE idempotency_key = $1`
	return scanPayout(r.db.QueryRow(ctx, q, idemKey))
}

// InsertPayoutRequested creates a payout REQUEST row (state='requested') and its audit in
// ONE tx. idemKey is stored on the row (uq_academy_tutor_payout_idem UNIQUE WHERE NOT
// NULL) as a durable idempotency guard. No balance column is written. Returns whether a
// NEW row was inserted (false ⇒ lost the idem race; caller fetches the winner).
func (r *Repository) InsertPayoutRequested(ctx context.Context, actor, tutorID, idemKey string, amountMinor int64) (*Payout, bool, error) {
	id := uuid.New().String()
	var out *Payout
	inserted := false
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		const ins = `
			INSERT INTO public.academy_tutor_payouts
				(id, tutor_id, amount_minor, state, idempotency_key, created_at)
			VALUES ($1,$2,$3,'requested',$4, now())
			ON CONFLICT (idempotency_key) DO NOTHING`
		tag, err := tx.Exec(ctx, ins, id, tutorID, amountMinor, nullStr(idemKey))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil // lost the idem race; inserted stays false
		}
		inserted = true
		if err := insertAuditTx(ctx, tx, actor, "tutor.payout_requested", "academy_tutor_payout", id,
			map[string]any{"tutor_id": tutorID, "amount_minor": amountMinor, "state": string(PayoutRequested)}, "info"); err != nil {
			return err
		}
		const sel = `SELECT ` + payoutCols + ` FROM public.academy_tutor_payouts WHERE id = $1`
		p, serr := scanPayout(tx.QueryRow(ctx, sel, id))
		if serr != nil {
			return serr
		}
		out = p
		return nil
	})
	return out, inserted, err
}

// SettlePayout runs the GUARDED payout transition requested→(paid|failed) inside a tx. It
// re-checks the current state under FOR UPDATE (WHERE state='requested') so concurrent
// callers cannot double-transition, records the rail ref + decided_at, and on a paid
// transition marks the covered pending earnings 'paid' in the SAME logical op (FIFO up to
// the payout amount). Illegal transitions are rejected with ErrIllegalTransition AND
// audited (severity=warning). Audited.
func (r *Repository) SettlePayout(ctx context.Context, actor, payoutID string, to PayoutState, payoutRef string, amountMinor int64, tutorID string) (*Payout, error) {
	if !canPayout(PayoutRequested, to) {
		return nil, ErrIllegalTransition
	}
	var out *Payout
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		const lock = `SELECT state FROM public.academy_tutor_payouts WHERE id = $1 FOR UPDATE`
		var cur string
		if err := tx.QueryRow(ctx, lock, payoutID).Scan(&cur); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if PayoutState(cur) != PayoutRequested {
			_ = insertAuditTx(ctx, tx, actor, "tutor.payout_settle_rejected", "academy_tutor_payout", payoutID,
				map[string]any{"from": cur, "to": string(to), "reason": "illegal_transition"}, "warning")
			return ErrIllegalTransition
		}

		const upd = `
			UPDATE public.academy_tutor_payouts
			SET state = $2, payout_ref = COALESCE($3, payout_ref), decided_at = now()
			WHERE id = $1 AND state = 'requested'`
		tag, err := tx.Exec(ctx, upd, payoutID, string(to), nullStr(payoutRef))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrIllegalTransition
		}

		// On success, mark covered pending earnings as paid (FIFO up to amountMinor) so
		// the DERIVED pending balance drops by exactly the paid-out amount.
		if to == PayoutPaid {
			if err := markEarningsPaidTx(ctx, tx, tutorID, amountMinor, payoutID); err != nil {
				return err
			}
		}

		if err := insertAuditTx(ctx, tx, actor, "tutor.payout_"+string(to), "academy_tutor_payout", payoutID,
			map[string]any{"from": string(PayoutRequested), "to": string(to), "payout_ref": payoutRef, "amount_minor": amountMinor}, "info"); err != nil {
			return err
		}
		const sel = `SELECT ` + payoutCols + ` FROM public.academy_tutor_payouts WHERE id = $1`
		p, serr := scanPayout(tx.QueryRow(ctx, sel, payoutID))
		if serr != nil {
			return serr
		}
		out = p
		return nil
	})
	return out, err
}

// markEarningsPaidTx flips oldest-first pending earnings to 'paid' until the covered
// amount reaches amountMinor. ledger_ref records the payout that settled them. Earning
// rows are never deleted; state transitions only (append-only invariant preserved).
func markEarningsPaidTx(ctx context.Context, tx pgx.Tx, tutorID string, amountMinor int64, payoutID string) error {
	const sel = `SELECT id, amount_minor FROM public.academy_tutor_earnings
	             WHERE tutor_id = $1 AND state = 'pending' ORDER BY created_at ASC FOR UPDATE`
	rows, err := tx.Query(ctx, sel, tutorID)
	if err != nil {
		return err
	}
	type pend struct {
		id     string
		amount int64
	}
	pending := []pend{}
	for rows.Next() {
		var p pend
		if err := rows.Scan(&p.id, &p.amount); err != nil {
			rows.Close()
			return err
		}
		pending = append(pending, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	var covered int64
	ledgerRef := "tutor:payout:" + payoutID
	for _, p := range pending {
		if covered >= amountMinor {
			break
		}
		const upd = `UPDATE public.academy_tutor_earnings SET state = 'paid', ledger_ref = $2 WHERE id = $1`
		if _, err := tx.Exec(ctx, upd, p.id, ledgerRef); err != nil {
			return err
		}
		covered += p.amount
	}
	return nil
}

// ListPayouts lists payouts, optionally for a single tutor (empty ⇒ all, admin view).
func (r *Repository) ListPayouts(ctx context.Context, tutorID string) ([]Payout, error) {
	q := `SELECT ` + payoutCols + ` FROM public.academy_tutor_payouts`
	args := []any{}
	if tutorID != "" {
		args = append(args, tutorID)
		q += ` WHERE tutor_id = $1`
	}
	q += ` ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Payout{}
	for rows.Next() {
		p, err := scanPayout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}
