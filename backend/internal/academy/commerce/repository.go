package commerce

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

// Repository is the pgx data-access layer for academy commerce. Every query is
// parameterized; money lives in *_minor bigint columns (never balances). Tables map
// exactly to the academy migrations.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// querier abstracts *pgxpool.Pool and pgx.Tx so the same helpers run either against
// the pool or inside a transaction. Both satisfy this signature set directly.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// ── Catalog reads ──────────────────────────────────────────────────────────────

func (r *Repository) ListPlans(ctx context.Context) ([]Plan, error) {
	const q = `SELECT id, code, name, price_minor, period, features, status
	           FROM academy_plans WHERE status = 'active' ORDER BY price_minor ASC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Plan{}
	for rows.Next() {
		var p Plan
		var features []byte
		if err := rows.Scan(&p.ID, &p.Code, &p.Name, &p.PriceMinor, &p.Period, &features, &p.Status); err != nil {
			return nil, err
		}
		p.Features = rawOrEmptyObject(features)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetPlan(ctx context.Context, id string) (*Plan, error) {
	const q = `SELECT id, code, name, price_minor, period, features, status
	           FROM academy_plans WHERE id = $1`
	var p Plan
	var features []byte
	err := r.db.QueryRow(ctx, q, id).Scan(&p.ID, &p.Code, &p.Name, &p.PriceMinor, &p.Period, &features, &p.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.Features = rawOrEmptyObject(features)
	return &p, nil
}

func (r *Repository) ListBundles(ctx context.Context, arenaID string) ([]ExamBundle, error) {
	q := `SELECT id, arena_id, name, price_minor, contents, season, status
	      FROM academy_exam_bundles WHERE status = 'active'`
	args := []any{}
	if arenaID != "" {
		q += ` AND arena_id = $1`
		args = append(args, arenaID)
	}
	q += ` ORDER BY price_minor ASC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExamBundle{}
	for rows.Next() {
		var b ExamBundle
		var contents []byte
		if err := rows.Scan(&b.ID, &b.ArenaID, &b.Name, &b.PriceMinor, &contents, &b.Season, &b.Status); err != nil {
			return nil, err
		}
		b.Contents = rawOrEmptyObject(contents)
		out = append(out, b)
	}
	return out, rows.Err()
}

func (r *Repository) GetBundle(ctx context.Context, id string) (*ExamBundle, error) {
	const q = `SELECT id, arena_id, name, price_minor, contents, season, status
	           FROM academy_exam_bundles WHERE id = $1`
	var b ExamBundle
	var contents []byte
	err := r.db.QueryRow(ctx, q, id).Scan(&b.ID, &b.ArenaID, &b.Name, &b.PriceMinor, &contents, &b.Season, &b.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	b.Contents = rawOrEmptyObject(contents)
	return &b, nil
}

// ── Offline content-bundle manifest (read-only) ────────────────────────────────

func (r *Repository) GetContentBundleManifest(ctx context.Context, id string) (*BundleManifest, error) {
	const q = `SELECT id, name, version_id, arena_code, size_budget_bytes, lesson_ids, status, manifest
	           FROM academy_content_bundles WHERE id = $1`
	var m BundleManifest
	var manifest []byte
	err := r.db.QueryRow(ctx, q, id).Scan(&m.ID, &m.Name, &m.VersionID, &m.ArenaCode,
		&m.SizeBudgetBytes, &m.LessonIDs, &m.Status, &manifest)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if m.LessonIDs == nil {
		m.LessonIDs = []string{}
	}
	m.Manifest = rawOrEmptyObject(manifest)
	return &m, nil
}

// ── Orders ─────────────────────────────────────────────────────────────────────

// InsertOrder creates an order locked to checkout with the price from the catalog.
func (r *Repository) InsertOrder(ctx context.Context, userID, kind, refID string, amountMinor int64) (*Order, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_orders (id, user_id, kind, ref_id, amount_minor, state, created_at)
	           VALUES ($1,$2,$3,$4,$5,'checkout',$6)`
	if _, err := r.db.Exec(ctx, q, id, userID, kind, refID, amountMinor, now); err != nil {
		return nil, err
	}
	return &Order{ID: id, UserID: userID, Kind: kind, RefID: refID, AmountMinor: amountMinor,
		Currency: "NGN", State: OrderCheckout, CreatedAt: now}, nil
}

func (r *Repository) GetOrder(ctx context.Context, userID, id string) (*Order, error) {
	const q = `SELECT id, user_id, kind, ref_id, amount_minor, state, payment_ref, bnpl_ref, created_at
	           FROM academy_orders WHERE id = $1 AND user_id = $2`
	o, err := scanOrder(r.db.QueryRow(ctx, q, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

// GetOrderAny fetches an order without the user scope (admin refund path).
func (r *Repository) GetOrderAny(ctx context.Context, id string) (*Order, error) {
	const q = `SELECT id, user_id, kind, ref_id, amount_minor, state, payment_ref, bnpl_ref, created_at
	           FROM academy_orders WHERE id = $1`
	o, err := scanOrder(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

func scanOrder(row pgx.Row) (*Order, error) {
	o := &Order{Currency: "NGN"}
	err := row.Scan(&o.ID, &o.UserID, &o.Kind, &o.RefID, &o.AmountMinor, &o.State,
		&o.PaymentRef, &o.BNPLRef, &o.CreatedAt)
	if err != nil {
		return nil, err
	}
	return o, nil
}

// ── Idempotency store ──────────────────────────────────────────────────────────

// idemRecord is a persisted idempotency result.
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

// ── Entitlements ───────────────────────────────────────────────────────────────

// GrantEntitlement flips an entitlement active for (user, kind, refID, source).
// Idempotent via UNIQUE(user_id, kind, ref_id): a replay returns the existing row.
// Runs inside the supplied querier so it commits atomically with the order transition.
func grantEntitlement(ctx context.Context, q querier, userID, kind, refID, source string) (*Entitlement, bool, error) {
	id := uuid.New().String()
	now := time.Now()
	const ins = `INSERT INTO academy_entitlements (id, user_id, kind, ref_id, state, source, granted_at)
	             VALUES ($1,$2,$3,$4,'active',$5,$6)
	             ON CONFLICT (user_id, kind, ref_id) DO UPDATE
	               SET state = 'active'
	             RETURNING id, user_id, kind, ref_id, state, source, granted_at,
	                       (xmax = 0) AS inserted`
	var e Entitlement
	var inserted bool
	err := q.QueryRow(ctx, ins, id, userID, kind, refID, source, now).
		Scan(&e.ID, &e.UserID, &e.Kind, &e.RefID, &e.State, &e.Source, &e.GrantedAt, &inserted)
	if err != nil {
		return nil, false, err
	}
	return &e, inserted, nil
}

// revokeEntitlement flips active→revoked for (user, kind, refID). Returns whether a
// row was changed (false ⇒ nothing active to reverse).
func revokeEntitlement(ctx context.Context, q querier, userID, kind, refID string) (bool, error) {
	const upd = `UPDATE academy_entitlements SET state = 'revoked'
	             WHERE user_id = $1 AND kind = $2 AND ref_id = $3 AND state = 'active'`
	tag, err := q.Exec(ctx, upd, userID, kind, refID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// HasActiveEntitlement is the exported gating check projection.
func (r *Repository) HasActiveEntitlement(ctx context.Context, userID, kind, refID string) (bool, error) {
	const q = `SELECT EXISTS(
	             SELECT 1 FROM academy_entitlements
	             WHERE user_id = $1 AND kind = $2 AND ref_id = $3 AND state = 'active')`
	var ok bool
	if err := r.db.QueryRow(ctx, q, userID, kind, refID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

func (r *Repository) ListEntitlements(ctx context.Context, userID string) ([]Entitlement, error) {
	const q = `SELECT id, user_id, kind, ref_id, state, source, granted_at
	           FROM academy_entitlements WHERE user_id = $1 ORDER BY granted_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entitlement{}
	for rows.Next() {
		var e Entitlement
		if err := rows.Scan(&e.ID, &e.UserID, &e.Kind, &e.RefID, &e.State, &e.Source, &e.GrantedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ── Audit (immutable) ──────────────────────────────────────────────────────────

func writeAudit(ctx context.Context, q querier, actorID, action, entityType, entityID, fromState, toState, idemKey string, detail any) error {
	const ins = `INSERT INTO academy_commerce_audit
		(actor_id, action, entity_type, entity_id, from_state, to_state, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, entityType, nullStr(entityID),
		nullStr(fromState), nullStr(toState), toJSON(detail), nullStr(idemKey))
	return err
}

// ── Subscriptions ──────────────────────────────────────────────────────────────

func insertSubscription(ctx context.Context, q querier, userID, planID, idemKey string) (*Subscription, error) {
	id := uuid.New().String()
	now := time.Now()
	const ins = `INSERT INTO academy_subscriptions (id, user_id, plan_id, state, started_at, idempotency_key)
	             VALUES ($1,$2,$3,'active',$4,$5)`
	if _, err := q.Exec(ctx, ins, id, userID, planID, now, idemKey); err != nil {
		return nil, err
	}
	return &Subscription{ID: id, UserID: userID, PlanID: planID, State: "active", StartedAt: now}, nil
}

// ── Access cards ───────────────────────────────────────────────────────────────

func (r *Repository) InsertCard(ctx context.Context, batch, serial, pinHash, grantKind, grantRefID string) (string, error) {
	id := uuid.New().String()
	const ins = `INSERT INTO academy_access_cards (id, batch, serial, pin_hash, grant_kind, grant_ref_id, state)
	             VALUES ($1,$2,$3,$4,$5,$6,'issued')`
	if _, err := r.db.Exec(ctx, ins, id, batch, serial, pinHash, grantKind, grantRefID); err != nil {
		return "", err
	}
	return id, nil
}

// ListAccessCards returns access-card rows for the admin console, newest first,
// optionally filtered by batch. pin_hash is NEVER selected/serialised.
func (r *Repository) ListAccessCards(ctx context.Context, batch string, limit int) ([]AccessCard, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	const cols = `id, batch, serial, grant_kind, grant_ref_id, state, agent_id, activated_by, activated_at, created_at`
	var rows pgx.Rows
	var err error
	if batch != "" {
		rows, err = r.db.Query(ctx, `SELECT `+cols+` FROM academy_access_cards WHERE batch = $1 ORDER BY created_at DESC LIMIT $2`, batch, limit)
	} else {
		rows, err = r.db.Query(ctx, `SELECT `+cols+` FROM academy_access_cards ORDER BY created_at DESC LIMIT $1`, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AccessCard{}
	for rows.Next() {
		var ac AccessCard
		if err := rows.Scan(&ac.ID, &ac.Batch, &ac.Serial, &ac.GrantKind, &ac.GrantRefID,
			&ac.State, &ac.AgentID, &ac.ActivatedBy, &ac.ActivatedAt, &ac.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ac)
	}
	return out, rows.Err()
}

// OrdersOverview aggregates academy_orders by state (count + summed amount_minor)
// for the admin payments console. Read-only; no money moves.
func (r *Repository) OrdersOverview(ctx context.Context) (*OrdersOverview, error) {
	const q = `SELECT state, COUNT(*), COALESCE(SUM(amount_minor),0)
	           FROM academy_orders GROUP BY state ORDER BY state`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ov := &OrdersOverview{ByState: []OrderStateSummary{}}
	for rows.Next() {
		var s OrderStateSummary
		if err := rows.Scan(&s.State, &s.Count, &s.AmountMinor); err != nil {
			return nil, err
		}
		ov.ByState = append(ov.ByState, s)
		ov.TotalOrders += s.Count
		ov.TotalAmountMinor += s.AmountMinor
	}
	return ov, rows.Err()
}

func (r *Repository) AllocateCards(ctx context.Context, agentID, batch string, serials []string) (int64, error) {
	if batch != "" {
		const upd = `UPDATE academy_access_cards SET agent_id = $1, state = 'allocated'
		             WHERE batch = $2 AND state = 'issued'`
		tag, err := r.db.Exec(ctx, upd, agentID, batch)
		if err != nil {
			return 0, err
		}
		return tag.RowsAffected(), nil
	}
	const upd = `UPDATE academy_access_cards SET agent_id = $1, state = 'allocated'
	             WHERE serial = ANY($2) AND state = 'issued'`
	tag, err := r.db.Exec(ctx, upd, agentID, serials)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// cardForActivation locks the card row FOR UPDATE inside a tx and returns its state
// + pin_hash + grant target.
func cardForActivation(ctx context.Context, tx pgx.Tx, serial string) (id, state, pinHash, grantKind, grantRef string, activatedBy *string, err error) {
	const q = `SELECT id, state, pin_hash, grant_kind, grant_ref_id, activated_by
	           FROM academy_access_cards WHERE serial = $1 FOR UPDATE`
	err = tx.QueryRow(ctx, q, serial).Scan(&id, &state, &pinHash, &grantKind, &grantRef, &activatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrAccessCardInvalid
	}
	return
}

func markCardActivated(ctx context.Context, q querier, id, userID string) error {
	const upd = `UPDATE academy_access_cards
	             SET state = 'activated', activated_by = $2, activated_at = now()
	             WHERE id = $1`
	_, err := q.Exec(ctx, upd, id, userID)
	return err
}

// ── Sync (deterministic idempotent upsert) ─────────────────────────────────────

// upsertSyncEvent records one client event idempotently keyed by (user, clientEventId).
// Returns whether the row was newly inserted (false ⇒ replay; deterministic no-op).
func upsertSyncEvent(ctx context.Context, q querier, userID string, ev SyncEvent, resolution string) (bool, error) {
	const ins = `INSERT INTO academy_sync_events
		(user_id, client_event_id, kind, payload, client_ts, resolution)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id, client_event_id) DO NOTHING`
	tag, err := q.Exec(ctx, ins, userID, ev.ClientEventID, ev.Kind, rawOrEmptyObject(ev.Payload), ev.ClientTS, resolution)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ── tx helper ──────────────────────────────────────────────────────────────────

// withTx runs fn inside a transaction, committing on nil error and rolling back otherwise.
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

// ── small helpers ──────────────────────────────────────────────────────────────

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
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
