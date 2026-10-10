package care

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	triage "spotlight/backend/internal/health/triage"
)

// ErrNotFound is the uniform object-level denial on member-facing care paths:
// a missing referral/escalation, and one owned by another user, are
// INDISTINGUISHABLE — a "forbidden" on a foreign referral vs "not found" on a
// missing one would let a member probe referral ids (and their payment state).
var ErrNotFound = errors.New("care: not found")

// ErrIdempotencyRequired is returned when a money mutation (PayReferral) is
// invoked without an idempotency key — money mutations fail closed (400).
var ErrIdempotencyRequired = errors.New("care: idempotency key required")

// ErrIllegalTransition is returned when a guarded compare-and-set finds the row in
// an unexpected state (lost the race or an illegal request) — fail-closed.
var ErrIllegalTransition = errors.New("care: illegal state transition")

// Auditor — minimal immutable-audit slice (SC-12). nil is safe. Mirrors the slice
// the pharmacy/lab modules use so the orchestrator can inject one audit sink.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Repository is the persistence port for the care loop. A pgx implementation backs
// production (parameterised SQL, guarded compare-and-set transitions); fakes back
// the unit tests. Every state mutation is a guarded UPDATE … WHERE state=$from so a
// concurrent or out-of-order request can never skip a step (SC-5/SC-12).
type Repository interface {
	CreateReferral(ctx context.Context, r *CareReferral) error
	GetReferral(ctx context.Context, id string) (*CareReferral, error)
	// GetReferralByIdemAny is the idempotent-replay lookup ACROSS owners — the
	// partial UNIQUE index on idempotency_key is global, so the service reads
	// the holder row and folds a foreign-owned key to ErrNotFound BEFORE any
	// charge attempt (a scoped lookup would miss the foreign row and let the
	// charge run first).
	GetReferralByIdemAny(ctx context.Context, idemKey string) (*CareReferral, error)
	ListReferralsByUser(ctx context.Context, userID string) ([]CareReferral, error)
	// UpdateReferralState is the guarded transition: it sets state=to (plus the
	// optional fields) ONLY when the row is currently in `from`. RowsAffected 0 →
	// ErrIllegalTransition. set carries target_ref/amount_minor/payment_ref.
	UpdateReferralState(ctx context.Context, id string, from, to triage.ReferralState, set ReferralPatch) error
	// PinReferralIdem binds idempotency_key to a still-`routed` referral BEFORE
	// money moves — the guarded CAS (state='routed' AND key IS NULL) plus the
	// UNIQUE index serialize concurrent payers so only one ever reaches Charge.
	PinReferralIdem(ctx context.Context, id, idemKey string) error
	// GetSessionDisposition returns the triage session's recorded disposition
	// level, owner-fused: a missing session and one owned by another user are
	// indistinguishable (ErrNotFound). Nil level = session has no disposition.
	GetSessionDisposition(ctx context.Context, sessionID, userID string) (*int, error)

	CreateEscalation(ctx context.Context, e *Escalation) error
	GetEscalation(ctx context.Context, id string) (*Escalation, error)
	// GetOpenEscalationBySession returns the session's still-open escalation
	// (raised/notified/acknowledged) or ErrNotFound — the dedupe guard that
	// bounds emergency escalation broadcasts to one live case per session.
	GetOpenEscalationBySession(ctx context.Context, sessionID string) (*Escalation, error)
	ListEscalations(ctx context.Context, state string) ([]Escalation, error)
	UpdateEscalationState(ctx context.Context, id string, from, to triage.EscalationState, clinicianID *string, stamp *time.Time) error
}

// ReferralPatch carries the optional columns a guarded referral transition may set.
type ReferralPatch struct {
	TargetRef      *string
	AmountMinor    *int64
	PaymentRef     *string
	IdempotencyKey *string
}

// pgxRepo is the production Repository over the pgx pool.
type pgxRepo struct {
	db    *pgxpool.Pool
	audit Auditor
}

// NewRepository builds the pgx-backed Repository.
func NewRepository(db *pgxpool.Pool, audit Auditor) Repository { return &pgxRepo{db: db, audit: audit} }

func (r *pgxRepo) CreateReferral(ctx context.Context, c *CareReferral) error {
	const q = `
		INSERT INTO health_triage_care_referrals
			(id, session_id, user_id, disposition_level, route, target_ref, state, amount_minor, payment_ref, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	_, err := r.db.Exec(ctx, q, c.ID, c.SessionID, c.UserID, c.DispositionLevel, c.Route,
		c.TargetRef, string(c.State), c.AmountMinor, c.PaymentRef, c.IdempotencyKey)
	if err != nil {
		return fmt.Errorf("care: create referral: %w", err)
	}
	r.log(c.UserID, c.UserID, "health.triage.care.referral.create", "care_referral", c.ID,
		nil, map[string]any{"route": c.Route, "state": string(c.State), "amount_minor": c.AmountMinor})
	return nil
}

func (r *pgxRepo) GetReferral(ctx context.Context, id string) (*CareReferral, error) {
	const q = `
		SELECT id, session_id, user_id, disposition_level, route, target_ref, state,
		       amount_minor, payment_ref, idempotency_key, created_at, updated_at
		FROM health_triage_care_referrals WHERE id=$1`
	return scanReferral(r.db.QueryRow(ctx, q, id))
}

func (r *pgxRepo) GetReferralByIdemAny(ctx context.Context, idemKey string) (*CareReferral, error) {
	const q = `
		SELECT id, session_id, user_id, disposition_level, route, target_ref, state,
		       amount_minor, payment_ref, idempotency_key, created_at, updated_at
		FROM health_triage_care_referrals WHERE idempotency_key=$1`
	return scanReferral(r.db.QueryRow(ctx, q, idemKey))
}

func (r *pgxRepo) PinReferralIdem(ctx context.Context, id, idemKey string) error {
	// Guarded pin: only a still-`routed` referral with no key bound yet can take
	// one. RowsAffected 0 → ErrIllegalTransition (lost the race, or the row
	// already moved). A key already bound to ANOTHER referral trips the partial
	// UNIQUE index — surfaced as an error (409 at the edge), never a second pin.
	const q = `
		UPDATE health_triage_care_referrals
		SET idempotency_key=$2, updated_at=now()
		WHERE id=$1 AND state='routed' AND idempotency_key IS NULL`
	tag, err := r.db.Exec(ctx, q, id, idemKey)
	if err != nil {
		return fmt.Errorf("care: pin idempotency key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrIllegalTransition
	}
	return nil
}

func (r *pgxRepo) GetSessionDisposition(ctx context.Context, sessionID, userID string) (*int, error) {
	// Owner-fused: a foreign session is indistinguishable from a missing one.
	var level *int
	if err := r.db.QueryRow(ctx,
		`SELECT disposition_level FROM health_triage_sessions WHERE id=$1 AND user_id=$2`,
		sessionID, userID).Scan(&level); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("care: session disposition: %w", err)
	}
	return level, nil
}

func (r *pgxRepo) ListReferralsByUser(ctx context.Context, userID string) ([]CareReferral, error) {
	const q = `
		SELECT id, session_id, user_id, disposition_level, route, target_ref, state,
		       amount_minor, payment_ref, idempotency_key, created_at, updated_at
		FROM health_triage_care_referrals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CareReferral
	for rows.Next() {
		c, err := scanReferralRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (r *pgxRepo) UpdateReferralState(ctx context.Context, id string, from, to triage.ReferralState, set ReferralPatch) error {
	// Guarded compare-and-set: COALESCE keeps existing columns when the patch leaves
	// them nil. WHERE state=$from is the optimistic guard (SC-12) — RowsAffected 0
	// means the row was not in the expected state.
	const q = `
		UPDATE health_triage_care_referrals
		SET state=$3,
		    target_ref      = COALESCE($4, target_ref),
		    amount_minor    = COALESCE($5, amount_minor),
		    payment_ref     = COALESCE($6, payment_ref),
		    idempotency_key = COALESCE($7, idempotency_key),
		    updated_at      = now()
		WHERE id=$1 AND state=$2`
	tag, err := r.db.Exec(ctx, q, id, string(from), string(to), set.TargetRef, set.AmountMinor, set.PaymentRef, set.IdempotencyKey)
	if err != nil {
		return fmt.Errorf("care: update referral state: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrIllegalTransition
	}
	r.log("", "", "health.triage.care.referral.transition", "care_referral", id,
		map[string]any{"state": string(from)}, map[string]any{"state": string(to)})
	return nil
}

// ErrEscalationExists is returned by CreateEscalation when the partial unique
// index (one open escalation per session — ADR-PR646) dedupes the insert: a
// concurrent emergency Refer already opened a case for this session.
var ErrEscalationExists = errors.New("care: open escalation already exists for session")

func (r *pgxRepo) CreateEscalation(ctx context.Context, e *Escalation) error {
	const q = `
		INSERT INTO health_triage_escalations (id, session_id, user_id, state, reason)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (session_id) WHERE state IN ('raised','notified','acknowledged')
		DO NOTHING`
	tag, err := r.db.Exec(ctx, q, e.ID, e.SessionID, e.UserID, string(e.State), e.Reason)
	if err != nil {
		return fmt.Errorf("care: create escalation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrEscalationExists
	}
	r.log(e.UserID, e.UserID, "health.triage.care.escalation.raise", "escalation", e.ID,
		nil, map[string]any{"state": string(e.State), "reason": e.Reason})
	return nil
}

func (r *pgxRepo) GetEscalation(ctx context.Context, id string) (*Escalation, error) {
	const q = `
		SELECT id, session_id, user_id, state, reason, clinician_id, raised_at, ack_at, resolved_at
		FROM health_triage_escalations WHERE id=$1`
	return scanEscalation(r.db.QueryRow(ctx, q, id))
}

func (r *pgxRepo) GetOpenEscalationBySession(ctx context.Context, sessionID string) (*Escalation, error) {
	const q = `
		SELECT id, session_id, user_id, state, reason, clinician_id, raised_at, ack_at, resolved_at
		FROM health_triage_escalations
		WHERE session_id=$1 AND state IN ('raised','notified','acknowledged')
		ORDER BY raised_at DESC LIMIT 1`
	return scanEscalation(r.db.QueryRow(ctx, q, sessionID))
}

func (r *pgxRepo) ListEscalations(ctx context.Context, state string) ([]Escalation, error) {
	const q = `
		SELECT id, session_id, user_id, state, reason, clinician_id, raised_at, ack_at, resolved_at
		FROM health_triage_escalations
		WHERE ($1 = '' OR state = $1)
		ORDER BY raised_at DESC LIMIT 200`
	rows, err := r.db.Query(ctx, q, state)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Escalation
	for rows.Next() {
		e, err := scanEscalationRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

func (r *pgxRepo) UpdateEscalationState(ctx context.Context, id string, from, to triage.EscalationState, clinicianID *string, stamp *time.Time) error {
	// Guarded transition; stamp lands on the right column depending on the target
	// state (ack_at on acknowledged, resolved_at on resolved). clinician_id is set
	// on acknowledge and preserved thereafter via COALESCE.
	var q string
	switch to {
	case triage.EscAcknowledged:
		q = `UPDATE health_triage_escalations
		     SET state=$3, clinician_id=COALESCE($4, clinician_id), ack_at=COALESCE($5, now())
		     WHERE id=$1 AND state=$2`
	case triage.EscResolved:
		q = `UPDATE health_triage_escalations
		     SET state=$3, clinician_id=COALESCE($4, clinician_id), resolved_at=COALESCE($5, now())
		     WHERE id=$1 AND state=$2`
	default:
		q = `UPDATE health_triage_escalations
		     SET state=$3, clinician_id=COALESCE($4, clinician_id)
		     WHERE id=$1 AND state=$2`
	}
	tag, err := r.db.Exec(ctx, q, id, string(from), string(to), clinicianID, stamp)
	if err != nil {
		return fmt.Errorf("care: update escalation state: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrIllegalTransition
	}
	r.log("", "", "health.triage.care.escalation.transition", "escalation", id,
		map[string]any{"state": string(from)}, map[string]any{"state": string(to)})
	return nil
}

func (r *pgxRepo) log(actor, target, action, resourceType, resourceID string, oldV, newV map[string]any) {
	if r.audit == nil {
		return
	}
	r.audit.LogAction(actor, target, action, "health.triage.care", resourceType, resourceID, oldV, newV, "", "", "info")
}

type scannable interface {
	Scan(dest ...any) error
}

func scanReferral(row scannable) (*CareReferral, error) {
	c, err := scanReferralRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

func scanReferralRow(row scannable) (*CareReferral, error) {
	var c CareReferral
	var state string
	if err := row.Scan(&c.ID, &c.SessionID, &c.UserID, &c.DispositionLevel, &c.Route, &c.TargetRef,
		&state, &c.AmountMinor, &c.PaymentRef, &c.IdempotencyKey, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	c.State = triage.ReferralState(state)
	return &c, nil
}

func scanEscalation(row scannable) (*Escalation, error) {
	e, err := scanEscalationRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

func scanEscalationRow(row scannable) (*Escalation, error) {
	var e Escalation
	var state string
	if err := row.Scan(&e.ID, &e.SessionID, &e.UserID, &state, &e.Reason, &e.ClinicianID,
		&e.RaisedAt, &e.AckAt, &e.ResolvedAt); err != nil {
		return nil, err
	}
	e.State = triage.EscalationState(state)
	return &e, nil
}
