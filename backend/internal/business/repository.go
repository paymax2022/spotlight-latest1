package business

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a business profile does not exist.
var ErrNotFound = errors.New("business: not found")

// Repository provides parameterised pgx access to the business_* tables. All state
// transitions flow through transition() so every move is audited append-only.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

const profileCols = `
	id, user_id, entity_type, mode, COALESCE(legal_name,''), COALESCE(proposed_name,''),
	COALESCE(line_of_business,''), status, COALESCE(rc_or_bn_number,''),
	COALESCE(cac_reservation_ref,''), COALESCE(cac_registration_ref,''),
	COALESCE(verification_source,''), registered_at, COALESCE(certificate_url,''),
	fee_kobo, COALESCE(fee_ledger_ref,''),
	metadata, created_at, updated_at`

func scanProfile(row pgx.Row) (*BusinessProfile, error) {
	var p BusinessProfile
	var meta []byte
	var regAt *time.Time
	err := row.Scan(&p.ID, &p.UserID, &p.EntityType, &p.Mode, &p.LegalName, &p.ProposedName,
		&p.LineOfBusiness, &p.Status, &p.RCOrBNNumber, &p.CACReservationRef, &p.CACRegistrationRef,
		&p.VerificationSource, &regAt, &p.CertificateURL, &p.FeeKobo, &p.FeeLedgerRef, &meta, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.RegisteredAt = regAt
	p.Metadata = map[string]any{}
	if len(meta) > 0 {
		_ = json.Unmarshal(meta, &p.Metadata)
	}
	return &p, nil
}

// InsertProfile creates a new profile row and returns its id.
func (r *Repository) InsertProfile(ctx context.Context, userID string, entityType EntityType, mode Mode, proposedName, legalName, lineOfBusiness string, status Status, meta map[string]any) (string, error) {
	if meta == nil {
		meta = map[string]any{}
	}
	raw, _ := json.Marshal(meta)
	const q = `
		INSERT INTO business_profiles
			(user_id, entity_type, mode, proposed_name, legal_name, line_of_business, status, metadata)
		VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7,$8)
		RETURNING id`
	var id string
	err := r.db.QueryRow(ctx, q, userID, string(entityType), string(mode), proposedName, legalName, lineOfBusiness, string(status), raw).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return "", ErrDuplicate
		}
		return "", err
	}
	// Seed a creation event (append-only).
	_ = r.insertEvent(ctx, id, "profile.created", "", string(status), userID, map[string]any{"mode": mode})
	return id, nil
}

func (r *Repository) GetProfile(ctx context.Context, id string) (*BusinessProfile, error) {
	p, err := scanProfile(r.db.QueryRow(ctx, `SELECT `+profileCols+` FROM business_profiles WHERE id = $1`, id))
	if err != nil {
		return nil, err
	}
	props, err := r.ListProprietors(ctx, id)
	if err != nil {
		return nil, err
	}
	p.Proprietors = props
	return p, nil
}

// GetProfileByFeePaystackRef resolves an owned profile by the pending Paystack
// reference stashed in metadata.feePaystack.reference (set at fee-initiate). Scoped
// to the owner (fail-closed) so a reference alone can't reach another user's profile.
func (r *Repository) GetProfileByFeePaystackRef(ctx context.Context, userID, reference string) (*BusinessProfile, error) {
	const q = `SELECT ` + profileCols + ` FROM business_profiles
		WHERE user_id = $1 AND metadata #>> '{feePaystack,reference}' = $2
		ORDER BY updated_at DESC LIMIT 1`
	p, err := scanProfile(r.db.QueryRow(ctx, q, userID, reference))
	if err != nil {
		return nil, err
	}
	props, err := r.ListProprietors(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.Proprietors = props
	return p, nil
}

func (r *Repository) ListByUser(ctx context.Context, userID string) ([]BusinessProfile, error) {
	rows, err := r.db.Query(ctx, `SELECT `+profileCols+` FROM business_profiles WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BusinessProfile
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// HasVerified reports whether the user has at least one verified/registered business.
func (r *Repository) HasVerified(ctx context.Context, userID string) (bool, error) {
	var exists bool
	const q = `SELECT EXISTS (SELECT 1 FROM business_profiles WHERE user_id = $1 AND status IN ('verified','registered'))`
	err := r.db.QueryRow(ctx, q, userID).Scan(&exists)
	return exists, err
}

// transition performs a guarded status change and appends an audit event in ONE
// transaction. Returns ErrConflict if the current status is not in fromStatuses.
// setters is optional extra column assignments applied on the same UPDATE.
func (r *Repository) transition(ctx context.Context, id string, to Status, from []Status, actor, event string, detail map[string]any, setters map[string]any) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Read current status under the row (FOR UPDATE serialises concurrent transitions).
	var cur Status
	err = tx.QueryRow(ctx, `SELECT status FROM business_profiles WHERE id = $1 FOR UPDATE`, id).Scan(&cur)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	// Guard against illegal transitions both by the from-list AND the state machine.
	if !inStatuses(cur, from) || !CanTransition(cur, to) {
		return ErrConflict
	}

	// Build the UPDATE dynamically from the fixed setter allowlist (no free-form SQL).
	setSQL := "status = $1, updated_at = now()"
	args := []any{string(to)}
	i := 2
	for _, col := range setterOrder {
		if v, ok := setters[col]; ok {
			setSQL += ", " + col + " = $" + strconv.Itoa(i)
			args = append(args, v)
			i++
		}
	}
	args = append(args, id)
	if _, err := tx.Exec(ctx, `UPDATE business_profiles SET `+setSQL+` WHERE id = $`+strconv.Itoa(i), args...); err != nil {
		if isUniqueViolation(err) {
			return ErrDuplicate
		}
		return err
	}

	if err := insertEventTx(ctx, tx, id, event, string(cur), string(to), actor, detail); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// setterOrder is the fixed allowlist of columns a transition may set (prevents SQL
// injection via map keys; only these named columns are ever written).
var setterOrder = []string{
	"legal_name", "proposed_name", "line_of_business", "rc_or_bn_number",
	"cac_reservation_ref", "cac_registration_ref", "verification_source",
	"registered_at", "certificate_url", "fee_kobo", "fee_ledger_ref", "metadata",
}

// updateFields applies a set of allowlisted column updates WITHOUT a status change
// (used by pay-fee, which records the fee but keeps status). Also appends an event.
func (r *Repository) updateFields(ctx context.Context, id, actor, event string, detail map[string]any, setters map[string]any) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var cur Status
	if err := tx.QueryRow(ctx, `SELECT status FROM business_profiles WHERE id = $1 FOR UPDATE`, id).Scan(&cur); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	setSQL := "updated_at = now()"
	args := []any{}
	i := 1
	for _, col := range setterOrder {
		if v, ok := setters[col]; ok {
			setSQL += ", " + col + " = $" + strconv.Itoa(i)
			args = append(args, v)
			i++
		}
	}
	args = append(args, id)
	if _, err := tx.Exec(ctx, `UPDATE business_profiles SET `+setSQL+` WHERE id = $`+strconv.Itoa(i), args...); err != nil {
		return err
	}
	if err := insertEventTx(ctx, tx, id, event, string(cur), string(cur), actor, detail); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── Proprietors ───────────────────────────────────────────────────────────────

func (r *Repository) InsertProprietors(ctx context.Context, businessID string, props []Proprietor) error {
	if len(props) == 0 {
		return nil
	}
	const q = `
		INSERT INTO business_profile_proprietors
			(business_id, full_name, role, bvn_masked, nin_masked, share_pct, phone, email)
		VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,NULLIF($7,''),NULLIF($8,''))`
	for _, p := range props {
		role := p.Role
		if role == "" {
			role = "proprietor"
		}
		if _, err := r.db.Exec(ctx, q, businessID, p.FullName, role, p.BVNMasked, p.NINMasked, p.SharePct, p.Phone, p.Email); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) ListProprietors(ctx context.Context, businessID string) ([]Proprietor, error) {
	const q = `
		SELECT id, full_name, role, COALESCE(bvn_masked,''), COALESCE(nin_masked,''),
		       share_pct, COALESCE(phone,''), COALESCE(email,'')
		FROM business_profile_proprietors WHERE business_id = $1 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, businessID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Proprietor
	for rows.Next() {
		var p Proprietor
		if err := rows.Scan(&p.ID, &p.FullName, &p.Role, &p.BVNMasked, &p.NINMasked, &p.SharePct, &p.Phone, &p.Email); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ── Events (append-only) ──────────────────────────────────────────────────────

func (r *Repository) insertEvent(ctx context.Context, businessID, event, from, to, actor string, detail map[string]any) error {
	if detail == nil {
		detail = map[string]any{}
	}
	raw, _ := json.Marshal(detail)
	const q = `
		INSERT INTO business_profile_events (business_id, event, from_status, to_status, actor, detail)
		VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6)`
	_, err := r.db.Exec(ctx, q, businessID, event, from, to, actor, raw)
	return err
}

func insertEventTx(ctx context.Context, tx pgx.Tx, businessID, event, from, to, actor string, detail map[string]any) error {
	if detail == nil {
		detail = map[string]any{}
	}
	raw, _ := json.Marshal(detail)
	const q = `
		INSERT INTO business_profile_events (business_id, event, from_status, to_status, actor, detail)
		VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6)`
	_, err := tx.Exec(ctx, q, businessID, event, from, to, actor, raw)
	return err
}

// ── Admin queries ─────────────────────────────────────────────────────────────

func (r *Repository) AdminList(ctx context.Context, status, mode string, limit int) ([]BusinessProfile, error) {
	q := `SELECT ` + profileCols + ` FROM business_profiles WHERE 1=1`
	args := []any{}
	i := 1
	if status != "" {
		q += " AND status = $" + strconv.Itoa(i)
		args = append(args, status)
		i++
	}
	if mode != "" {
		q += " AND mode = $" + strconv.Itoa(i)
		args = append(args, mode)
		i++
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	q += " ORDER BY created_at DESC LIMIT $" + strconv.Itoa(i)
	args = append(args, limit)
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BusinessProfile
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func inStatuses(s Status, list []Status) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
