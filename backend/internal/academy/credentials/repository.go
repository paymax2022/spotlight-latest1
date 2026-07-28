package credentials

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the credentials module. Credential
// rows are issued by staff/the trade package and are learner-scoped on read; the
// verification registry is public-read. Credential issue (pending→issued + registry
// upsert + audit) and revoke (issued→revoked + registry update + audit) each happen
// in ONE transaction so the public registry can never diverge from the credential.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("credentials: not found")

type rowScanner interface{ Scan(dest ...any) error }

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

// insertAuditTx appends an immutable row to public.audit_logs inside a tx.
// module is always 'academy.credentials'; severity defaults to info, "warning" for rejections.
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
		VALUES ($1,$2,'academy.credentials',$3,$4,$5,$6)`
	_, err := tx.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
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
		VALUES ($1,$2,'academy.credentials',$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

// HolderName best-effort resolves the holder display name for the public registry
// from academy_profiles. Empty when unknown — no PII beyond a display name is read.
func (r *Repository) HolderName(ctx context.Context, userID string) string {
	const q = `
		SELECT display_name FROM public.academy_profiles
		WHERE user_id = $1 AND display_name IS NOT NULL
		ORDER BY created_at ASC LIMIT 1`
	var name *string
	if err := r.db.QueryRow(ctx, q, userID).Scan(&name); err != nil || name == nil {
		return ""
	}
	return *name
}

// ── Credential scanning ──────────────────────────────────────────────────────────

func scanCredential(row rowScanner) (*Credential, error) {
	c := &Credential{}
	err := row.Scan(&c.ID, &c.UserID, &c.Kind, &c.Title, &c.TradeTrack, &c.SubjectID,
		&c.VerificationID, &c.Signature, &c.State, &c.Reason, &c.IssuedAt, &c.RevokedAt, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

const credCols = `id, user_id, kind, title, trade_track, subject_id, verification_id,
	signature, state, reason, issued_at, revoked_at, created_at`

func (r *Repository) GetCredential(ctx context.Context, id string) (*Credential, error) {
	q := `SELECT ` + credCols + ` FROM public.academy_credentials WHERE id = $1`
	return scanCredential(r.db.QueryRow(ctx, q, id))
}

// ListCredentialsByUser returns a learner's own credentials (newest first).
func (r *Repository) ListCredentialsByUser(ctx context.Context, userID string) ([]Credential, error) {
	q := `SELECT ` + credCols + ` FROM public.academy_credentials WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Credential{}
	for rows.Next() {
		c, err := scanCredential(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// ListIssuedByUser returns ONLY the user's issued credentials — feeds the earning
// bridge eligibility computation.
func (r *Repository) ListIssuedByUser(ctx context.Context, userID string) ([]Credential, error) {
	q := `SELECT ` + credCols + ` FROM public.academy_credentials
		WHERE user_id = $1 AND state = 'issued' ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Credential{}
	for rows.Next() {
		c, err := scanCredential(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// IssueCredential creates a credential pending→issued in ONE tx and registers it in
// the public verification registry (status=valid). The credential row is inserted in
// state 'pending', then the guarded transition to 'issued' is applied with issued_at
// + signature, and the registry row is upserted. Audited.
func (r *Repository) IssueCredential(ctx context.Context, actor string, c Credential, holderName string) (*Credential, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	id := uuid.New().String()
	now := time.Now()

	// 1. Insert pending (the SM start state). Audited as pending.
	const ins = `
		INSERT INTO public.academy_credentials
			(id, user_id, kind, title, trade_track, subject_id, verification_id, signature, state, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`
	if _, err := tx.Exec(ctx, ins, id, c.UserID, c.Kind, c.Title, c.TradeTrack, c.SubjectID,
		c.VerificationID, c.Signature, now); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, actor, "credential.created", "academy_credential", id,
		map[string]any{"state": string(CredPending), "kind": c.Kind, "verification_id": c.VerificationID}, "info"); err != nil {
		return nil, err
	}

	// 2. Guarded pending → issued (defence in depth; canCred already checked by service).
	if !canCred(CredPending, CredIssued) {
		return nil, ErrIllegalTransition
	}
	const upd = `
		UPDATE public.academy_credentials
		SET state = 'issued', issued_at = $2 WHERE id = $1`
	if _, err := tx.Exec(ctx, upd, id, now); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, actor, "credential.issued", "academy_credential", id,
		map[string]any{"from": string(CredPending), "to": string(CredIssued), "verification_id": c.VerificationID}, "info"); err != nil {
		return nil, err
	}

	// 3. Register in the PUBLIC verification registry (source of truth), status=valid.
	const reg = `
		INSERT INTO public.academy_credential_verifications
			(verification_id, credential_id, holder_name, title, kind, status, issued_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,'valid',$6, now())
		ON CONFLICT (verification_id) DO UPDATE SET
			credential_id = EXCLUDED.credential_id,
			holder_name   = EXCLUDED.holder_name,
			title         = EXCLUDED.title,
			kind          = EXCLUDED.kind,
			status        = 'valid',
			issued_at     = EXCLUDED.issued_at,
			updated_at    = now()`
	var holderArg any
	if holderName != "" {
		holderArg = holderName
	}
	if _, err := tx.Exec(ctx, reg, c.VerificationID, id, holderArg, c.Title, c.Kind, now); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetCredential(ctx, id)
}

// RevokeCredential runs the guarded issued→revoked transition and updates the public
// registry (status=revoked) in ONE tx. Illegal transitions are rejected AND audited
// (severity=warning). The status read + update + registry update + audit happen in
// one tx so the guard reads the committed current state.
func (r *Repository) RevokeCredential(ctx context.Context, actor, id, reason string) (*Credential, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var from CredState
	var verificationID string
	err = tx.QueryRow(ctx,
		`SELECT state, verification_id FROM public.academy_credentials WHERE id = $1 FOR UPDATE`, id).
		Scan(&from, &verificationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if !canCred(from, CredRevoked) {
		_ = insertAuditTx(ctx, tx, actor, "credential.revoke_rejected", "academy_credential", id,
			map[string]any{"from": string(from), "to": string(CredRevoked), "reason": "illegal_transition"}, "warning")
		_ = tx.Commit(ctx) // persist the rejection audit
		return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, CredRevoked)
	}

	const upd = `
		UPDATE public.academy_credentials
		SET state = 'revoked', reason = $2, revoked_at = now() WHERE id = $1`
	if _, err := tx.Exec(ctx, upd, id, reason); err != nil {
		return nil, err
	}

	// Registry is the public source of truth — flip it to revoked too.
	const reg = `
		UPDATE public.academy_credential_verifications
		SET status = 'revoked', updated_at = now() WHERE verification_id = $1`
	if _, err := tx.Exec(ctx, reg, verificationID); err != nil {
		return nil, err
	}

	if err := insertAuditTx(ctx, tx, actor, "credential.revoked", "academy_credential", id,
		map[string]any{"from": string(from), "to": string(CredRevoked), "reason": reason, "verification_id": verificationID}, "info"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetCredential(ctx, id)
}

// ── Verification registry (public read) ──────────────────────────────────────────

func (r *Repository) GetVerification(ctx context.Context, verificationID string) (*PublicVerification, error) {
	const q = `
		SELECT verification_id, holder_name, title, kind, status, issued_at
		FROM public.academy_credential_verifications WHERE verification_id = $1`
	v := &PublicVerification{}
	var holder *string
	err := r.db.QueryRow(ctx, q, verificationID).
		Scan(&v.VerificationID, &holder, &v.Title, &v.Kind, &v.Status, &v.IssuedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if holder != nil {
		v.HolderName = *holder
	}
	return v, nil
}

// ── Earning opportunities (catalog) ──────────────────────────────────────────────

func scanOpportunity(row rowScanner) (*EarningOpportunity, error) {
	o := &EarningOpportunity{}
	var rules []byte
	err := row.Scan(&o.ID, &o.Code, &o.Title, &o.Role, &rules, &o.Description, &o.Status, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(rules, &o.EligibilityRules)
	return o, nil
}

const oppCols = `id, code, title, role, eligibility_rules, description, status, created_at`

func (r *Repository) GetOpportunity(ctx context.Context, id string) (*EarningOpportunity, error) {
	q := `SELECT ` + oppCols + ` FROM public.academy_earning_opportunities WHERE id = $1`
	return scanOpportunity(r.db.QueryRow(ctx, q, id))
}

// ListOpportunities returns active opportunities by default; activeOnly=false lists all.
func (r *Repository) ListOpportunities(ctx context.Context, activeOnly bool) ([]EarningOpportunity, error) {
	q := `SELECT ` + oppCols + ` FROM public.academy_earning_opportunities`
	if activeOnly {
		q += ` WHERE status = 'active'`
	}
	q += ` ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EarningOpportunity{}
	for rows.Next() {
		o, err := scanOpportunity(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

func (r *Repository) InsertOpportunity(ctx context.Context, actor string, req CreateOpportunityRequest) (*EarningOpportunity, error) {
	id := uuid.New().String()
	status := req.Status
	if status == "" {
		status = "active"
	}
	const q = `
		INSERT INTO public.academy_earning_opportunities
			(id, code, title, role, eligibility_rules, description, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := r.db.Exec(ctx, q, id, req.Code, req.Title, req.Role,
		toJSONB(req.EligibilityRules), req.Description, status); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "earning_opportunity.created", "academy_earning_opportunity", id,
		map[string]any{"code": req.Code, "role": req.Role}, "info")
	return r.GetOpportunity(ctx, id)
}

func (r *Repository) UpdateOpportunity(ctx context.Context, actor, id string, req UpdateOpportunityRequest) (*EarningOpportunity, error) {
	var sb strings.Builder
	sb.WriteString(`UPDATE public.academy_earning_opportunities SET `)
	args := []any{}
	set := func(col string, v any) {
		args = append(args, v)
		if len(args) > 1 {
			sb.WriteString(", ")
		}
		sb.WriteString(fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if req.Title != nil {
		set("title", *req.Title)
	}
	if req.Role != nil {
		set("role", *req.Role)
	}
	if req.EligibilityRules != nil {
		set("eligibility_rules", toJSONB(*req.EligibilityRules))
	}
	if req.Description != nil {
		set("description", *req.Description)
	}
	if req.Status != nil {
		set("status", *req.Status)
	}
	if len(args) == 0 {
		return r.GetOpportunity(ctx, id) // nothing to update
	}
	args = append(args, id)
	sb.WriteString(fmt.Sprintf(" WHERE id = $%d", len(args)))
	tag, err := r.db.Exec(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "earning_opportunity.updated", "academy_earning_opportunity", id, nil, "info")
	return r.GetOpportunity(ctx, id)
}

// ── Earning applications (idempotent apply → route) ───────────────────────────────

func scanApplication(row rowScanner) (*EarningApplication, error) {
	a := &EarningApplication{}
	err := row.Scan(&a.ID, &a.UserID, &a.OpportunityID, &a.State, &a.PaymaxRef,
		&a.Reason, &a.IdempotencyKey, &a.CreatedAt, &a.DecidedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

const appCols = `id, user_id, opportunity_id, state, paymax_ref, reason, idempotency_key, created_at, decided_at`

// FindApplicationByIdem returns an existing application for the idempotency key, or
// ErrNotFound. Backs the idempotency guarantee: a replayed apply returns the SAME
// application (and the same paymax_ref) without a second route.
func (r *Repository) FindApplicationByIdem(ctx context.Context, idemKey string) (*EarningApplication, error) {
	if idemKey == "" {
		return nil, ErrNotFound
	}
	q := `SELECT ` + appCols + ` FROM public.academy_earning_applications WHERE idempotency_key = $1`
	return scanApplication(r.db.QueryRow(ctx, q, idemKey))
}

// InsertApplication creates an application in state 'submitted'. The unique partial
// index uq_academy_earnapp_idem enforces one application per idempotency_key at the DB
// layer (the service also pre-checks via FindApplicationByIdem). Audited.
func (r *Repository) InsertApplication(ctx context.Context, userID, opportunityID, idemKey string) (*EarningApplication, error) {
	id := uuid.New().String()
	var idemArg any
	if idemKey != "" {
		idemArg = idemKey
	}
	const q = `
		INSERT INTO public.academy_earning_applications
			(id, user_id, opportunity_id, state, idempotency_key)
		VALUES ($1,$2,$3,'submitted',$4)`
	if _, err := r.db.Exec(ctx, q, id, userID, opportunityID, idemArg); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, userID, "earning_application.submitted", "academy_earning_application", id,
		map[string]any{"opportunity_id": opportunityID, "state": string(AppSubmitted)}, "info")
	return r.GetApplication(ctx, id)
}

func (r *Repository) GetApplication(ctx context.Context, id string) (*EarningApplication, error) {
	q := `SELECT ` + appCols + ` FROM public.academy_earning_applications WHERE id = $1`
	return scanApplication(r.db.QueryRow(ctx, q, id))
}

// MarkApplicationRouted records the Paymax role-upgrade reference and moves the
// application submitted→routed. Audited. Idempotent on the application id: re-routing
// an already-routed application is a no-op that returns the existing row.
func (r *Repository) MarkApplicationRouted(ctx context.Context, userID, id, paymaxRef string) (*EarningApplication, error) {
	const q = `
		UPDATE public.academy_earning_applications
		SET state = 'routed', paymax_ref = $2, decided_at = now()
		WHERE id = $1 AND state = 'submitted'`
	if _, err := r.db.Exec(ctx, q, id, paymaxRef); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, userID, "earning_application.routed", "academy_earning_application", id,
		map[string]any{"from": string(AppSubmitted), "to": string(AppRouted), "paymax_ref": paymaxRef}, "info")
	return r.GetApplication(ctx, id)
}
