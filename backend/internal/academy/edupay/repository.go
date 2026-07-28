package edupay

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

// Repository is the pgx data-access layer for academy EduPay. Every query is
// parameterized; money lives in *_minor bigint columns. Pot balances are DERIVED via
// SUM(contributions) — never a stored shadow balance. Tables map exactly to
// 20260815001100_academy_spine_edupay.sql; idempotency reuses academy_idempotency_keys
// from 20260815001000_academy_commerce_audit.sql; audit reuses academy_commerce_audit.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// querier abstracts *pgxpool.Pool and pgx.Tx so the same helpers run either against
// the pool or inside a transaction.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// ── Schools (CRUD) ──────────────────────────────────────────────────────────────

func (r *Repository) InsertSchool(ctx context.Context, name, code, vaRef, contact string) (*School, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_schools (id, name, code, virtual_account_ref, contact, status, created_at)
	           VALUES ($1,$2,$3,$4,$5,'active',$6)`
	if _, err := r.db.Exec(ctx, q, id, name, nullStr(code), nullStr(vaRef), nullStr(contact), now); err != nil {
		return nil, err
	}
	return r.GetSchool(ctx, id)
}

func (r *Repository) GetSchool(ctx context.Context, id string) (*School, error) {
	const q = `SELECT id, name, code, virtual_account_ref, contact, status, created_at
	           FROM academy_schools WHERE id = $1`
	var s School
	err := r.db.QueryRow(ctx, q, id).Scan(&s.ID, &s.Name, &s.Code, &s.VirtualAccountRef, &s.Contact, &s.Status, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *Repository) ListSchools(ctx context.Context) ([]School, error) {
	const q = `SELECT id, name, code, virtual_account_ref, contact, status, created_at
	           FROM academy_schools WHERE status = 'active' ORDER BY name ASC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []School{}
	for rows.Next() {
		var s School
		if err := rows.Scan(&s.ID, &s.Name, &s.Code, &s.VirtualAccountRef, &s.Contact, &s.Status, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── Fee schedules (CRUD / reads) ────────────────────────────────────────────────

func (r *Repository) InsertFeeSchedule(ctx context.Context, schoolID, name, classCode, term string, amountMinor int64, currency string, dueDate *time.Time) (*FeeSchedule, error) {
	id := uuid.New().String()
	now := time.Now()
	if currency == "" {
		currency = "NGN"
	}
	const q = `INSERT INTO academy_fee_schedules (id, school_id, class_code, term, name, amount_minor, currency, due_date, status, created_at)
	           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`
	if _, err := r.db.Exec(ctx, q, id, schoolID, nullStr(classCode), nullStr(term), name, amountMinor, currency, dueDate, now); err != nil {
		return nil, err
	}
	return r.GetFeeSchedule(ctx, id)
}

func (r *Repository) GetFeeSchedule(ctx context.Context, id string) (*FeeSchedule, error) {
	const q = `SELECT id, school_id, class_code, term, name, amount_minor, currency, due_date, status, created_at
	           FROM academy_fee_schedules WHERE id = $1`
	f, err := scanFeeSchedule(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}

// ListFeeSchedules filters by school and/or class code (either may be empty).
func (r *Repository) ListFeeSchedules(ctx context.Context, schoolID, classCode string) ([]FeeSchedule, error) {
	q := `SELECT id, school_id, class_code, term, name, amount_minor, currency, due_date, status, created_at
	      FROM academy_fee_schedules WHERE status = 'active'`
	args := []any{}
	if schoolID != "" {
		args = append(args, schoolID)
		q += " AND school_id = $" + itoa(len(args))
	}
	if classCode != "" {
		args = append(args, classCode)
		q += " AND class_code = $" + itoa(len(args))
	}
	q += " ORDER BY created_at DESC"
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FeeSchedule{}
	for rows.Next() {
		f, err := scanFeeSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *f)
	}
	return out, rows.Err()
}

func scanFeeSchedule(row pgx.Row) (*FeeSchedule, error) {
	f := &FeeSchedule{Currency: "NGN"}
	err := row.Scan(&f.ID, &f.SchoolID, &f.ClassCode, &f.Term, &f.Name, &f.AmountMinor, &f.Currency, &f.DueDate, &f.Status, &f.CreatedAt)
	if err != nil {
		return nil, err
	}
	return f, nil
}

// ── EduPay account link ─────────────────────────────────────────────────────────

// LinkAccount links a payer to a school for a named student. Idempotent on the
// UNIQUE (user_id, school_id, student_name): a re-link returns the existing row.
func (r *Repository) LinkAccount(ctx context.Context, userID, schoolID, studentName, studentClass string) (*EduPayAccount, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_edupay_accounts (id, user_id, school_id, student_name, student_class, status, created_at)
	           VALUES ($1,$2,$3,$4,$5,'active',$6)
	           ON CONFLICT (user_id, school_id, student_name) DO UPDATE SET status = 'active'
	           RETURNING id, user_id, school_id, student_name, student_class, status, created_at`
	var a EduPayAccount
	err := r.db.QueryRow(ctx, q, id, userID, schoolID, studentName, nullStr(studentClass), now).
		Scan(&a.ID, &a.UserID, &a.SchoolID, &a.StudentName, &a.StudentClass, &a.Status, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *Repository) ListAccounts(ctx context.Context, userID string) ([]EduPayAccount, error) {
	const q = `SELECT id, user_id, school_id, student_name, student_class, status, created_at
	           FROM academy_edupay_accounts WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EduPayAccount{}
	for rows.Next() {
		var a EduPayAccount
		if err := rows.Scan(&a.ID, &a.UserID, &a.SchoolID, &a.StudentName, &a.StudentClass, &a.Status, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── Savings pots (saved_minor DERIVED from SUM(contributions)) ──────────────────

func (r *Repository) InsertPot(ctx context.Context, userID, goalName string, targetMinor int64, feeScheduleID string) (*SavingsPot, error) {
	id := uuid.New().String()
	now := time.Now()
	// saved_minor starts at 0 and is ALWAYS recomputed from contributions; never
	// mutated as a shadow balance (golden rule: no shadow balances).
	const q = `INSERT INTO academy_savings_pots (id, user_id, goal_name, target_minor, saved_minor, fee_schedule_id, status, created_at)
	           VALUES ($1,$2,$3,$4,0,$5,'active',$6)`
	if _, err := r.db.Exec(ctx, q, id, userID, goalName, targetMinor, nullStr(feeScheduleID), now); err != nil {
		return nil, err
	}
	return r.GetPot(ctx, userID, id)
}

// GetPot returns a pot with saved_minor DERIVED from the sum of its contributions.
func (r *Repository) GetPot(ctx context.Context, userID, id string) (*SavingsPot, error) {
	const q = `SELECT p.id, p.user_id, p.goal_name, p.target_minor,
	                  COALESCE((SELECT SUM(c.amount_minor) FROM academy_pot_contributions c WHERE c.pot_id = p.id), 0) AS saved_minor,
	                  p.fee_schedule_id, p.status, p.created_at
	           FROM academy_savings_pots p WHERE p.id = $1 AND p.user_id = $2`
	var p SavingsPot
	err := r.db.QueryRow(ctx, q, id, userID).
		Scan(&p.ID, &p.UserID, &p.GoalName, &p.TargetMinor, &p.SavedMinor, &p.FeeScheduleID, &p.Status, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repository) ListPots(ctx context.Context, userID string) ([]SavingsPot, error) {
	const q = `SELECT p.id, p.user_id, p.goal_name, p.target_minor,
	                  COALESCE((SELECT SUM(c.amount_minor) FROM academy_pot_contributions c WHERE c.pot_id = p.id), 0) AS saved_minor,
	                  p.fee_schedule_id, p.status, p.created_at
	           FROM academy_savings_pots p WHERE p.user_id = $1 ORDER BY p.created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SavingsPot{}
	for rows.Next() {
		var p SavingsPot
		if err := rows.Scan(&p.ID, &p.UserID, &p.GoalName, &p.TargetMinor, &p.SavedMinor, &p.FeeScheduleID, &p.Status, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SumContributions is the DERIVED pot balance — the single source of truth for
// "saved_minor". Runs inside the supplied querier so a fund + read are consistent.
func sumContributions(ctx context.Context, q querier, potID string) (int64, error) {
	const sel = `SELECT COALESCE(SUM(amount_minor), 0) FROM academy_pot_contributions WHERE pot_id = $1`
	var sum int64
	if err := q.QueryRow(ctx, sel, potID).Scan(&sum); err != nil {
		return 0, err
	}
	return sum, nil
}

// SumContributions exposes the derived balance on the pool (read path).
func (r *Repository) SumContributions(ctx context.Context, potID string) (int64, error) {
	return sumContributions(ctx, r.db, potID)
}

// appendContribution APPENDS one immutable contribution row. Idempotent on the
// globally-UNIQUE idempotency_key (uq_academy_pot_contrib_idem): a replay is a no-op.
// Returns whether a NEW row was inserted (false ⇒ replay; no new money collected).
func appendContribution(ctx context.Context, q querier, potID, userID string, amountMinor int64, walletRef, idemKey string) (bool, error) {
	id := uuid.New().String()
	const ins = `INSERT INTO academy_pot_contributions (id, pot_id, user_id, amount_minor, wallet_ref, idempotency_key, created_at)
	             VALUES ($1,$2,$3,$4,$5,$6, now())
	             ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := q.Exec(ctx, ins, id, potID, userID, amountMinor, nullStr(walletRef), idemKey)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func setPotStatus(ctx context.Context, q querier, potID, status string) error {
	const upd = `UPDATE academy_savings_pots SET status = $2 WHERE id = $1`
	_, err := q.Exec(ctx, upd, potID, status)
	return err
}

// ── Disbursements (guarded SM) ──────────────────────────────────────────────────

// InsertDisbursement creates a disbursement in fee_due. idemKey is stored on the row
// (UNIQUE WHERE NOT NULL) as a second idempotency guard beyond the idem-key store.
func insertDisbursement(ctx context.Context, q querier, feeScheduleID, schoolID, payerUserID, studentRef string, amountMinor int64, currency, source, idemKey string) (*Disbursement, error) {
	id := uuid.New().String()
	now := time.Now()
	if currency == "" {
		currency = "NGN"
	}
	const ins = `INSERT INTO academy_disbursements
	    (id, fee_schedule_id, school_id, payer_user_id, student_ref, amount_minor, currency, state, source, idempotency_key, created_at)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,'fee_due',$8,$9,$10)`
	if _, err := q.Exec(ctx, ins, id, nullStr(feeScheduleID), schoolID, payerUserID, nullStr(studentRef),
		amountMinor, currency, source, nullStr(idemKey), now); err != nil {
		return nil, err
	}
	return &Disbursement{
		ID: id, FeeScheduleID: ptrOrNil(feeScheduleID), SchoolID: schoolID, PayerUserID: payerUserID,
		StudentRef: ptrOrNil(studentRef), AmountMinor: amountMinor, Currency: currency,
		State: DisbFeeDue, Source: source, IdempotencyKey: ptrOrNil(idemKey), CreatedAt: now,
	}, nil
}

func (r *Repository) GetDisbursement(ctx context.Context, id string) (*Disbursement, error) {
	const q = `SELECT id, fee_schedule_id, school_id, payer_user_id, student_ref, amount_minor, currency,
	                  state, source, payment_ref, payout_ref, idempotency_key, created_at, reconciled_at
	           FROM academy_disbursements WHERE id = $1`
	d, err := scanDisbursement(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

func (r *Repository) ListDisbursements(ctx context.Context, payerUserID string) ([]Disbursement, error) {
	const q = `SELECT id, fee_schedule_id, school_id, payer_user_id, student_ref, amount_minor, currency,
	                  state, source, payment_ref, payout_ref, idempotency_key, created_at, reconciled_at
	           FROM academy_disbursements WHERE payer_user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, payerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Disbursement{}
	for rows.Next() {
		d, err := scanDisbursement(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

func scanDisbursement(row pgx.Row) (*Disbursement, error) {
	d := &Disbursement{}
	var state string
	err := row.Scan(&d.ID, &d.FeeScheduleID, &d.SchoolID, &d.PayerUserID, &d.StudentRef, &d.AmountMinor,
		&d.Currency, &state, &d.Source, &d.PaymentRef, &d.PayoutRef, &d.IdempotencyKey, &d.CreatedAt, &d.ReconciledAt)
	if err != nil {
		return nil, err
	}
	d.State = DisbState(state)
	return d, nil
}

// setDisbState performs a GUARDED disbursement transition inside a tx. It re-checks the
// current state under FOR UPDATE (WHERE state=$from) so concurrent callers cannot
// double-transition, and rejects illegal transitions with ErrIllegalTransition.
func setDisbState(ctx context.Context, tx pgx.Tx, disbID string, from, to DisbState, paymentRef, payoutRef *string) error {
	if !canDisb(from, to) {
		return ErrIllegalTransition
	}
	const sel = `SELECT state FROM academy_disbursements WHERE id = $1 FOR UPDATE`
	var cur string
	if err := tx.QueryRow(ctx, sel, disbID).Scan(&cur); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if DisbState(cur) != from {
		return ErrIllegalTransition
	}
	reconciledAt := "reconciled_at"
	setReconciled := ""
	if to == DisbReconciled {
		setReconciled = ", " + reconciledAt + " = now()"
	}
	upd := `UPDATE academy_disbursements
	        SET state = $2,
	            payment_ref = COALESCE($3, payment_ref),
	            payout_ref = COALESCE($4, payout_ref)` + setReconciled + `
	        WHERE id = $1 AND state = $5`
	tag, err := tx.Exec(ctx, upd, disbID, string(to), paymentRef, payoutRef, string(from))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrIllegalTransition
	}
	return nil
}

// ── Scholarships + awards ───────────────────────────────────────────────────────

func (r *Repository) InsertScholarship(ctx context.Context, sponsorID, name string, criteria json.RawMessage, budgetMinor int64) (*Scholarship, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_scholarships (id, sponsor_id, name, criteria, budget_minor, awarded_minor, status, created_at)
	           VALUES ($1,$2,$3,$4,$5,0,'active',$6)`
	if _, err := r.db.Exec(ctx, q, id, nullStr(sponsorID), name, toJSON(criteria), budgetMinor, now); err != nil {
		return nil, err
	}
	return r.GetScholarship(ctx, id)
}

func (r *Repository) GetScholarship(ctx context.Context, id string) (*Scholarship, error) {
	const q = `SELECT id, sponsor_id, name, criteria, budget_minor, awarded_minor, status, created_at
	           FROM academy_scholarships WHERE id = $1`
	var s Scholarship
	var criteria []byte
	err := r.db.QueryRow(ctx, q, id).Scan(&s.ID, &s.SponsorID, &s.Name, &criteria, &s.BudgetMinor, &s.AwardedMinor, &s.Status, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	s.Criteria = rawOrEmptyObject(criteria)
	return &s, nil
}

func (r *Repository) ListScholarships(ctx context.Context) ([]Scholarship, error) {
	const q = `SELECT id, sponsor_id, name, criteria, budget_minor, awarded_minor, status, created_at
	           FROM academy_scholarships WHERE status = 'active' ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Scholarship{}
	for rows.Next() {
		var s Scholarship
		var criteria []byte
		if err := rows.Scan(&s.ID, &s.SponsorID, &s.Name, &criteria, &s.BudgetMinor, &s.AwardedMinor, &s.Status, &s.CreatedAt); err != nil {
			return nil, err
		}
		s.Criteria = rawOrEmptyObject(criteria)
		out = append(out, s)
	}
	return out, rows.Err()
}

// insertAward creates a scholarship award in granted. Idempotent on the UNIQUE
// idempotency_key (uq_academy_scholaward_idem). Returns whether a NEW row was inserted.
func insertAward(ctx context.Context, q querier, scholarshipID, userID, feeScheduleID string, amountMinor int64, idemKey string) (*ScholarshipAward, bool, error) {
	id := uuid.New().String()
	now := time.Now()
	const ins = `INSERT INTO academy_scholarship_awards (id, scholarship_id, user_id, fee_schedule_id, amount_minor, state, idempotency_key, created_at)
	             VALUES ($1,$2,$3,$4,$5,'granted',$6,$7)
	             ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := q.Exec(ctx, ins, id, scholarshipID, userID, nullStr(feeScheduleID), amountMinor, nullStr(idemKey), now)
	if err != nil {
		return nil, false, err
	}
	if tag.RowsAffected() == 0 {
		// Replay: return the existing award for this idempotency key.
		ex, gerr := getAwardByIdem(ctx, q, idemKey)
		return ex, false, gerr
	}
	return &ScholarshipAward{
		ID: id, ScholarshipID: scholarshipID, UserID: userID, FeeScheduleID: ptrOrNil(feeScheduleID),
		AmountMinor: amountMinor, State: "granted", IdempotencyKey: ptrOrNil(idemKey), CreatedAt: now,
	}, true, nil
}

func getAwardByIdem(ctx context.Context, q querier, idemKey string) (*ScholarshipAward, error) {
	const sel = `SELECT id, scholarship_id, user_id, fee_schedule_id, amount_minor, state, idempotency_key, created_at
	             FROM academy_scholarship_awards WHERE idempotency_key = $1`
	var a ScholarshipAward
	err := q.QueryRow(ctx, sel, idemKey).Scan(&a.ID, &a.ScholarshipID, &a.UserID, &a.FeeScheduleID, &a.AmountMinor, &a.State, &a.IdempotencyKey, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// addAwardedMinor increments the scholarship's running awarded total inside a tx.
func addAwardedMinor(ctx context.Context, q querier, scholarshipID string, amountMinor int64) error {
	const upd = `UPDATE academy_scholarships SET awarded_minor = awarded_minor + $2 WHERE id = $1`
	_, err := q.Exec(ctx, upd, scholarshipID, amountMinor)
	return err
}

func setAwardState(ctx context.Context, q querier, awardID, state string) error {
	const upd = `UPDATE academy_scholarship_awards SET state = $2 WHERE id = $1`
	_, err := q.Exec(ctx, upd, awardID, state)
	return err
}

// ── Idempotency store (reuses academy_idempotency_keys) ─────────────────────────

type idemRecord struct {
	ResultRef   string
	RequestHash string
	Result      json.RawMessage
}

// FindIdem returns a prior result for (key, scope), or ErrNotFound.
func (r *Repository) FindIdem(ctx context.Context, key, scope string) (*idemRecord, error) {
	const q = `SELECT result_ref, request_hash, result FROM academy_idempotency_keys
	           WHERE idempotency_key = $1 AND scope = $2`
	var rec idemRecord
	var resultRef, reqHash *string
	var result []byte
	err := r.db.QueryRow(ctx, q, key, scope).Scan(&resultRef, &reqHash, &result)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if resultRef != nil {
		rec.ResultRef = *resultRef
	}
	if reqHash != nil {
		rec.RequestHash = *reqHash
	}
	rec.Result = rawOrEmptyObject(result)
	return &rec, nil
}

// saveIdem persists (key, scope) -> result inside the given querier (usually a tx).
func saveIdem(ctx context.Context, q querier, key, scope, userID, requestHash, resultRef string, result any) error {
	const ins = `INSERT INTO academy_idempotency_keys
		(idempotency_key, scope, user_id, request_hash, result_ref, result)
		VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key, scope) DO NOTHING`
	_, err := q.Exec(ctx, ins, key, scope, nullStr(userID), nullStr(requestHash), nullStr(resultRef), toJSON(result))
	return err
}

// ── Audit (immutable; reuses academy_commerce_audit) ────────────────────────────

func writeAudit(ctx context.Context, q querier, actorID, action, entityType, entityID, fromState, toState, idemKey string, detail any) error {
	const ins = `INSERT INTO academy_commerce_audit
		(actor_id, action, entity_type, entity_id, from_state, to_state, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, entityType, nullUUID(entityID),
		nullStr(fromState), nullStr(toState), toJSON(detail), nullStr(idemKey))
	return err
}

// ── tx helper ───────────────────────────────────────────────────────────────────

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

// ── small helpers ─────────────────────────────────────────────────────────────

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullUUID is for uuid columns where empty string must become NULL (entity_id is uuid).
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

// itoa is a tiny dependency-free int→string for positional placeholder numbers.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
