// Package repo holds the pgxpool implementations of every port declared in
// arena/service/ports.go. It is the ONLY place that touches the Arena tables.
// The merit repo is the physical append-only store (NDC-1,2,6): Insert writes a
// verified arena.SignedMeritEntry and relies on the unique constraint
// arena_merit_no_replay to reject replays; it never verifies signatures itself
// (that is MeritService.Append's job) and holds no signer.
package repo

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/service"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// querier is the subset of pgx used by the repos, satisfied directly by both
// *pgxpool.Pool and pgx.Tx. It lets a repo run standalone or enlisted in an outer
// tx threaded through the context (see withTx / q), so CROWNED's award +
// credential + pot side-effects commit atomically with the state change.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type txKey struct{}

// withTx returns a context carrying an enlisted tx.
func withTx(ctx context.Context, tx pgx.Tx) context.Context {
	return context.WithValue(ctx, txKey{}, tx)
}

// q returns the querier for the current context: the enlisted tx if present,
// otherwise the pool. Repos call this instead of touching their pool directly so
// they transparently join an outer transaction.
func q(ctx context.Context, pool *pgxpool.Pool) querier {
	if tx, ok := ctx.Value(txKey{}).(pgx.Tx); ok && tx != nil {
		return tx
	}
	return pool
}

// This file holds the THIN adapters that let the Arena rails reuse the finance
// primitives WITHOUT importing any signer. The Support / Play-Along / Pot rails
// receive only these ports and therefore cannot construct a merit entry (NDC-1).

// LedgerAdapter implements service.LedgerPort over the finance ledger.Service.
// It is the ONLY money capability the money rails hold.
type LedgerAdapter struct{ svc *ledger.Service }

// NewLedgerAdapter wraps a finance ledger.Service as an Arena LedgerPort.
func NewLedgerAdapter(svc *ledger.Service) *LedgerAdapter { return &LedgerAdapter{svc: svc} }

var _ service.LedgerPort = (*LedgerAdapter)(nil)

// Credit posts money into userID's wallet from a standing account.
func (l *LedgerAdapter) Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error {
	return l.svc.Credit(ctx, userID, reference, idempotencyKey, debitAccountID, amountKobo)
}

// Debit posts money out of userID's wallet into a standing account.
func (l *LedgerAdapter) Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error {
	return l.svc.Debit(ctx, userID, reference, idempotencyKey, creditAccountID, amountKobo)
}

// StandingAccountID resolves (or creates) a standing account id by type name.
func (l *LedgerAdapter) StandingAccountID(ctx context.Context, accountType string) (string, error) {
	acc, err := l.svc.GetOrCreateStandingAccount(ctx, ledger.AccountType(accountType))
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// DebitLimitAdapter implements service.DebitLimitPort over finance
// tiers.Service — the SAME EnforceWalletDebitLimit the canonical transfer rail
// runs (E2E-FIN-046). The Support rail injects it via WithDebitLimiter; absent
// the adapter the rail fails closed on ErrTierGateUnwired.
type DebitLimitAdapter struct{ svc *tiers.Service }

// NewDebitLimitAdapter wraps a finance tiers.Service as an Arena DebitLimitPort.
func NewDebitLimitAdapter(svc *tiers.Service) *DebitLimitAdapter { return &DebitLimitAdapter{svc: svc} }

var _ service.DebitLimitPort = (*DebitLimitAdapter)(nil)

// EnforceWalletDebitLimit delegates to the finance tiers service unwrapped so
// the handler maps tiers.ErrWalletDisabled / tiers.ErrDailyLimitExceeded to 403.
func (a *DebitLimitAdapter) EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	return a.svc.EnforceWalletDebitLimit(ctx, userID, amountKobo)
}

// TierAdapter implements service.TierPort by reading the user's KYC tier from the
// finance kyc.Service (NDC-3 identity gate).
type TierAdapter struct{ svc *kyc.Service }

// NewTierAdapter wraps a finance kyc.Service as an Arena TierPort.
func NewTierAdapter(svc *kyc.Service) *TierAdapter { return &TierAdapter{svc: svc} }

var _ service.TierPort = (*TierAdapter)(nil)

// UserTier reads a user's current KYC tier. An absent profile is treated as
// tier 0 (fail-closed against the required-tier gate).
func (t *TierAdapter) UserTier(ctx context.Context, userID string) (int, error) {
	p, err := t.svc.GetProfile(ctx, userID)
	if err != nil {
		return 0, err
	}
	if p == nil {
		return 0, nil
	}
	return int(p.Tier), nil
}

// AuditRepo writes immutable arena_audit_log rows (UPDATE/DELETE blocked by the
// arena_audit_log_immutable trigger).
type AuditRepo struct{ pool *pgxpool.Pool }

// NewAuditRepo builds the audit repo.
func NewAuditRepo(pool *pgxpool.Pool) *AuditRepo { return &AuditRepo{pool: pool} }

var _ service.AuditRepo = (*AuditRepo)(nil)

// Log appends one immutable audit line. Enlists in an outer tx when present so a
// transition's audit commits atomically with the state change. before/after are
// passed as native maps (pgx encodes them to jsonb); nil → SQL NULL.
func (r *AuditRepo) Log(ctx context.Context, rec service.AuditRecord) error {
	_, err := q(ctx, r.pool).Exec(ctx, `
		INSERT INTO arena_audit_log
			(competition_id, actor_id, entity_type, entity_id, action, reason, before, after)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, $3, NULLIF($4,'')::uuid, $5, NULLIF($6,''), $7, $8)`,
		rec.CompetitionID, rec.ActorID, rec.EntityType, rec.EntityID, rec.Action, rec.Reason,
		jsonbOrNil(rec.Before), jsonbOrNil(rec.After))
	return err
}

// jsonbOrNil returns nil (SQL NULL) for a nil map so an absent before/after stays
// NULL rather than encoding an empty object.
func jsonbOrNil(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}

// AwardRepo persists finalized signed award results (append-only; UPDATE/DELETE
// blocked by the arena_award_result_immutable trigger).
type AwardRepo struct{ pool *pgxpool.Pool }

// NewAwardRepo builds the award repo.
func NewAwardRepo(pool *pgxpool.Pool) *AwardRepo { return &AwardRepo{pool: pool} }

var _ service.AwardRepo = (*AwardRepo)(nil)

// Finalize records a signed award result. computed_from records which rails fed
// the award (the crown = {MERIT} only). Enlists in an outer tx when present
// (CROWNED path). A duplicate (competition, award_type, subject) → ErrConflict.
func (r *AwardRepo) Finalize(ctx context.Context, competitionID, awardType, subjectID string, computedFrom []string, value float64, signature string) error {
	_, err := q(ctx, r.pool).Exec(ctx, `
		INSERT INTO arena_award_result
			(competition_id, award_type, subject_id, computed_from, value, signature)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6,''))
		ON CONFLICT (competition_id, award_type, subject_id) DO NOTHING`,
		competitionID, awardType, subjectID, computedFrom, value, signature)
	return err
}

// CompetitionRepo persists competitions, immutable config versions and
// authorized scoring adapters.
type CompetitionRepo struct{ pool *pgxpool.Pool }

// NewCompetitionRepo builds the competition repo.
func NewCompetitionRepo(pool *pgxpool.Pool) *CompetitionRepo { return &CompetitionRepo{pool: pool} }

var _ service.CompetitionRepo = (*CompetitionRepo)(nil)

// Create makes a new DRAFT competition.
func (r *CompetitionRepo) Create(ctx context.Context, slug, name, timezone, createdBy string) (*service.Competition, error) {
	var c service.Competition
	err := r.pool.QueryRow(ctx, `
		INSERT INTO arena_competition (slug, name, timezone, created_by)
		VALUES ($1,$2,$3, NULLIF($4,'')::uuid)
		RETURNING id, slug, name, status, timezone, config_version`,
		slug, name, timezone, createdBy).
		Scan(&c.ID, &c.Slug, &c.Name, &c.Status, &c.Timezone, &c.ConfigVersion)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, service.ErrConflict
		}
		return nil, err
	}
	return &c, nil
}

// Get returns a competition by id.
func (r *CompetitionRepo) Get(ctx context.Context, id string) (*service.Competition, error) {
	var c service.Competition
	err := r.pool.QueryRow(ctx, `
		SELECT id, slug, name, status, timezone, config_version
		  FROM arena_competition WHERE id = $1`, id).
		Scan(&c.ID, &c.Slug, &c.Name, &c.Status, &c.Timezone, &c.ConfigVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// List returns competitions (public catalogue).
func (r *CompetitionRepo) List(ctx context.Context, limit, offset int) ([]service.Competition, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, slug, name, status, timezone, config_version
		  FROM arena_competition
		 ORDER BY created_at DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.Competition{}
	for rows.Next() {
		var c service.Competition
		if err := rows.Scan(&c.ID, &c.Slug, &c.Name, &c.Status, &c.Timezone, &c.ConfigVersion); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// PublishConfig writes a new immutable config version and bumps config_version
// atomically. Extra config knobs (KYC gate, merit cuts, play-along, pot rules)
// are folded into the rails JSON under a reserved "_arena" key so the additive
// schema is preserved (no new columns needed).
func (r *CompetitionRepo) PublishConfig(ctx context.Context, competitionID, publishedBy string, cfg service.Config) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var next int
	err = tx.QueryRow(ctx, `
		SELECT config_version + 1 FROM arena_competition WHERE id = $1 FOR UPDATE`, competitionID).Scan(&next)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, service.ErrNotFound
	}
	if err != nil {
		return 0, err
	}

	rails := cfg.Rails
	if rails == nil {
		rails = map[string]any{}
	}
	// Fold the scalar gates into the rails JSON under a reserved key.
	rails["_arena"] = map[string]any{
		"required_kyc_tier":          cfg.RequiredKYCTier,
		"qualify_top_n":              cfg.QualifyTopN,
		"finalist_top_n":             cfg.FinalistTopN,
		"playalong_threshold":        cfg.PlayAlongThreshold,
		"playalong_cashback_kobo":    cfg.PlayAlongCashbackKobo,
		"playalong_cashback_per_day": cfg.PlayAlongCashbackPerDay,
		"pot_approvals_required":     cfg.PotApprovalsRequired,
	}
	// Pass native maps; pgx encodes them to jsonb via encoding/json.
	if _, err := tx.Exec(ctx, `
		INSERT INTO arena_competition_config
			(competition_id, version, rails, awards, rubric_versions, published_by)
		VALUES ($1,$2,$3,$4,$5, NULLIF($6,'')::uuid)`,
		competitionID, next, rails, orEmptyMap(cfg.Awards), orEmptyMap(cfg.RubricVersions), publishedBy); err != nil {
		if isUniqueViolation(err) {
			return 0, service.ErrConflict
		}
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE arena_competition SET config_version = $2, updated_at = now() WHERE id = $1`,
		competitionID, next); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return next, nil
}

// CurrentConfig returns the latest published config for a competition.
func (r *CompetitionRepo) CurrentConfig(ctx context.Context, competitionID string) (*service.Config, error) {
	var (
		version   int
		railsRaw  []byte
		awardsRaw []byte
		rubricRaw []byte
	)
	err := r.pool.QueryRow(ctx, `
		SELECT version, rails, awards, rubric_versions
		  FROM arena_competition_config
		 WHERE competition_id = $1
		 ORDER BY version DESC LIMIT 1`, competitionID).
		Scan(&version, &railsRaw, &awardsRaw, &rubricRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	cfg := service.Config{CompetitionID: competitionID, Version: version}
	var rails map[string]any
	_ = json.Unmarshal(railsRaw, &rails)
	if rails != nil {
		if inner, ok := rails["_arena"].(map[string]any); ok {
			cfg.RequiredKYCTier = jsonInt(inner["required_kyc_tier"])
			cfg.QualifyTopN = jsonInt(inner["qualify_top_n"])
			cfg.FinalistTopN = jsonInt(inner["finalist_top_n"])
			cfg.PlayAlongThreshold = jsonInt(inner["playalong_threshold"])
			cfg.PlayAlongCashbackKobo = int64(jsonInt(inner["playalong_cashback_kobo"]))
			cfg.PlayAlongCashbackPerDay = jsonInt(inner["playalong_cashback_per_day"])
			cfg.PotApprovalsRequired = jsonInt(inner["pot_approvals_required"])
		}
		delete(rails, "_arena")
	}
	cfg.Rails = rails
	_ = json.Unmarshal(awardsRaw, &cfg.Awards)
	_ = json.Unmarshal(rubricRaw, &cfg.RubricVersions)
	return &cfg, nil
}

// RegisterAdapter authorizes a scoring adapter (stores its public key). Only
// adapters registered here can produce a verifiable merit entry (NDC-2).
func (r *CompetitionRepo) RegisterAdapter(ctx context.Context, competitionID string, a service.AuthorizedAdapter) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO arena_authorized_adapter (competition_id, adapter_id, source_type, public_key, active)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (competition_id, adapter_id)
		DO UPDATE SET source_type = EXCLUDED.source_type,
		              public_key  = EXCLUDED.public_key,
		              active      = EXCLUDED.active`,
		competitionID, a.AdapterID, a.SourceType, a.PublicKey, a.Active)
	return err
}

func orEmptyMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

// jsonInt coerces a JSON-decoded numeric (float64) into an int, tolerating nil.
func jsonInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}

// ContestantRepo persists contestants + guarded lifecycle transitions. The
// unique(competition_id,user_id) constraint enforces NDC-3 (one human → one entry).
type ContestantRepo struct{ pool *pgxpool.Pool }

// NewContestantRepo builds the contestant repo.
func NewContestantRepo(pool *pgxpool.Pool) *ContestantRepo { return &ContestantRepo{pool: pool} }

var _ service.ContestantRepo = (*ContestantRepo)(nil)

func scanContestant(row pgx.Row) (*service.Contestant, error) {
	var (
		c       service.Contestant
		state   string
		kycTier *int
		home    *string
		batch   *string
	)
	if err := row.Scan(&c.ID, &c.CompetitionID, &c.UserID, &state, &kycTier, &home, &batch); err != nil {
		return nil, err
	}
	c.State = arena.ContestantState(state)
	if kycTier != nil {
		c.KYCTier = *kycTier
	}
	if home != nil {
		c.HomeState = *home
	}
	if batch != nil {
		c.TheoryBatch = *batch
	}
	return &c, nil
}

const contestantCols = `id, competition_id, user_id, state, kyc_tier, home_state, theory_batch`

// Create makes a new APPLIED contestant. A duplicate (competition_id,user_id) →
// ErrConflict (NDC-3).
func (r *ContestantRepo) Create(ctx context.Context, competitionID, userID string, kycTier int, homeState string) (*service.Contestant, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO arena_contestant (competition_id, user_id, kyc_tier, home_state, state)
		VALUES ($1,$2,$3, NULLIF($4,''), 'APPLIED')
		RETURNING `+contestantCols, competitionID, userID, kycTier, homeState)
	c, err := scanContestant(row)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, service.ErrConflict
		}
		return nil, err
	}
	return c, nil
}

// Get returns a contestant by id.
func (r *ContestantRepo) Get(ctx context.Context, competitionID, contestantID string) (*service.Contestant, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT `+contestantCols+` FROM arena_contestant
		 WHERE competition_id = $1 AND id = $2`, competitionID, contestantID)
	c, err := scanContestant(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	return c, err
}

// GetByUser returns the caller's own contestant row.
func (r *ContestantRepo) GetByUser(ctx context.Context, competitionID, userID string) (*service.Contestant, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT `+contestantCols+` FROM arena_contestant
		 WHERE competition_id = $1 AND user_id = $2`, competitionID, userID)
	c, err := scanContestant(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	return c, err
}

// ListByState lists contestants in a given lifecycle state (review queue etc.).
func (r *ContestantRepo) ListByState(ctx context.Context, competitionID string, state arena.ContestantState) ([]service.Contestant, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+contestantCols+` FROM arena_contestant
		 WHERE competition_id = $1 AND state = $2
		 ORDER BY created_at`, competitionID, string(state))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.Contestant{}
	for rows.Next() {
		c, err := scanContestant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// UpdateState performs the state change atomically with sideEffect (award
// finalize + credential issue + pot trigger on CROWNED) in ONE tx. The row is
// locked FOR UPDATE and the compare-and-set on `from` guards against a lost
// update; a stale `from` → ErrConflict.
func (r *ContestantRepo) UpdateState(ctx context.Context, contestantID string, from, to arena.ContestantState, sideEffect func(ctx context.Context) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var current string
	err = tx.QueryRow(ctx, `SELECT state FROM arena_contestant WHERE id = $1 FOR UPDATE`, contestantID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return service.ErrNotFound
	}
	if err != nil {
		return err
	}
	if arena.ContestantState(current) != from {
		return service.ErrConflict
	}

	tag, err := tx.Exec(ctx, `
		UPDATE arena_contestant SET state = $2, updated_at = now()
		 WHERE id = $1 AND state = $3`, contestantID, string(to), string(from))
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return service.ErrConflict
	}

	if sideEffect != nil {
		// Run side-effects inside the SAME tx so CROWNED's award/credential/pot
		// trigger commit-or-rollback with the state change.
		txCtx := withTx(ctx, tx)
		if err := sideEffect(txCtx); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// CredentialRepo persists issued credentials and the public verify-by-hash read
// (NDC-7). Credentials are independently revocable.
type CredentialRepo struct{ pool *pgxpool.Pool }

// NewCredentialRepo builds the credential repo.
func NewCredentialRepo(pool *pgxpool.Pool) *CredentialRepo { return &CredentialRepo{pool: pool} }

var _ service.CredentialRepo = (*CredentialRepo)(nil)

// Issue persists a credential. Enlists in an outer tx when present (CROWNED path).
// A duplicate verifiable_hash is a safe no-op (idempotent grant).
func (r *CredentialRepo) Issue(ctx context.Context, c service.Credential) error {
	_, err := q(ctx, r.pool).Exec(ctx, `
		INSERT INTO arena_credential
			(user_id, competition_id, type, status, verifiable_hash, issued_at)
		VALUES ($1, NULLIF($2,'')::uuid, $3, 'ACTIVE', $4, now())
		ON CONFLICT (verifiable_hash) DO NOTHING`,
		c.UserID, c.CompetitionID, c.Type, c.VerifiableHash)
	return err
}

// GetByHash resolves a credential by its public verifiable hash.
func (r *CredentialRepo) GetByHash(ctx context.Context, hash string) (*service.Credential, error) {
	var (
		c         service.Credential
		compID    *string
		revokedAt *time.Time
		reason    *string
	)
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, competition_id, type, status, verifiable_hash,
		       issued_at, revoked_at, revoke_reason
		  FROM arena_credential WHERE verifiable_hash = $1`, hash).
		Scan(&c.ID, &c.UserID, &compID, &c.Type, &c.Status, &c.VerifiableHash,
			&c.IssuedAt, &revokedAt, &reason)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if compID != nil {
		c.CompetitionID = *compID
	}
	c.RevokedAt = revokedAt
	if reason != nil {
		c.RevokeReason = *reason
	}
	return &c, nil
}

// Revoke flips a credential to REVOKED (independent of any other Paymax
// capability). Idempotent: re-revoking is a no-op.
func (r *CredentialRepo) Revoke(ctx context.Context, hash, reason string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE arena_credential
		   SET status = 'REVOKED', revoked_at = now(), revoke_reason = $2
		 WHERE verifiable_hash = $1 AND status = 'ACTIVE'`, hash, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Either unknown hash or already revoked; treat unknown as not-found.
		var exists bool
		if e := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM arena_credential WHERE verifiable_hash = $1)`, hash).Scan(&exists); e == nil && !exists {
			return service.ErrNotFound
		}
	}
	return nil
}

// EngagementRepo persists idempotent Play-Along / prediction events (engagement
// ledger — NEVER merit).
type EngagementRepo struct{ pool *pgxpool.Pool }

// NewEngagementRepo builds the engagement repo.
func NewEngagementRepo(pool *pgxpool.Pool) *EngagementRepo { return &EngagementRepo{pool: pool} }

var _ service.EngagementRepo = (*EngagementRepo)(nil)

// Record inserts an idempotent engagement event and returns the spectator's
// running points total and whether this call was a duplicate (idempotency_key
// already seen). The insert uses ON CONFLICT DO NOTHING; duplicate is detected by
// zero rows affected.
func (r *EngagementRepo) Record(ctx context.Context, competitionID, spectatorID, eventType, subjectID, idemKey string, points int) (int, bool, error) {
	var duplicate bool
	var err error

	var totalPoints int

	tag, err := r.pool.Exec(ctx, `
		INSERT INTO arena_engagement_event
			(competition_id, spectator_id, type, subject_id, points, idempotency_key)
		VALUES ($1, $2, $3, NULLIF($4,'')::uuid, $5, $6)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		competitionID, spectatorID, eventType, subjectID, points, idemKey)
	if err != nil {
		return 0, false, err
	}
	duplicate = tag.RowsAffected() == 0

	err = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(points),0) FROM arena_engagement_event
		 WHERE competition_id = $1 AND spectator_id = $2`, competitionID, spectatorID).Scan(&totalPoints)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	return totalPoints, duplicate, err
}

// CashbackCountToday counts today's play-along passes for a spectator (the rate
// limit on ledgered cashback). A QUIZ_PASS row is written once per successful
// attempt and carries the cashback marker; counting them bounds cashback per day.
func (r *EngagementRepo) CashbackCountToday(ctx context.Context, competitionID, spectatorID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM arena_engagement_event
		 WHERE competition_id = $1 AND spectator_id = $2
		   AND type = 'QUIZ_PASS'
		   AND created_at >= date_trunc('day', now())`, competitionID, spectatorID).Scan(&n)
	return n, err
}

// MeritRepo is the pgxpool-backed append-only signed merit ledger.
type MeritRepo struct{ pool *pgxpool.Pool }

// NewMeritRepo builds the merit repo.
func NewMeritRepo(pool *pgxpool.Pool) *MeritRepo { return &MeritRepo{pool: pool} }

var _ service.MeritRepo = (*MeritRepo)(nil)

// AuthorizedAdapters returns a competition's active adapter public keys, used to
// build the verifier BEFORE any append (NDC-2).
func (r *MeritRepo) AuthorizedAdapters(ctx context.Context, competitionID string) ([]service.AuthorizedAdapter, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT adapter_id, source_type, public_key, active
		  FROM arena_authorized_adapter
		 WHERE competition_id = $1`, competitionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.AuthorizedAdapter{}
	for rows.Next() {
		var a service.AuthorizedAdapter
		if err := rows.Scan(&a.AdapterID, &a.SourceType, &a.PublicKey, &a.Active); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// LastEntryHash returns the contestant's most recent entry_hash for chaining
// (nil for genesis). entry_hash is stored hex-encoded.
func (r *MeritRepo) LastEntryHash(ctx context.Context, competitionID, contestantID string) ([]byte, error) {
	var hexHash string
	err := r.pool.QueryRow(ctx, `
		SELECT entry_hash FROM arena_merit_entry
		 WHERE competition_id = $1 AND contestant_id = $2
		 ORDER BY recorded_at DESC, signed_at DESC
		 LIMIT 1`, competitionID, contestantID).Scan(&hexHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // genesis
	}
	if err != nil {
		return nil, err
	}
	if hexHash == "" {
		return nil, nil
	}
	return hex.DecodeString(hexHash)
}

// Insert persists a verified entry. A duplicate (arena_merit_no_replay) → ErrReplay.
func (r *MeritRepo) Insert(ctx context.Context, e arena.SignedMeritEntry) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO arena_merit_entry
			(competition_id, contestant_id, source_type, source_adapter_id, stage,
			 rubric_version, raw_score, normalized_score, reason,
			 canonical_payload, signature, prev_hash, entry_hash, signed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		e.Payload.CompetitionID,
		e.Payload.ContestantID,
		string(e.Payload.SourceType),
		e.Payload.AdapterID,
		string(e.Payload.Stage),
		e.Payload.RubricVersion,
		e.Payload.RawScore,
		e.Payload.NormalizedScore,
		e.Payload.Reason,
		string(e.Canonical),
		base64.StdEncoding.EncodeToString(e.Signature),
		hex.EncodeToString(e.PrevHash),
		hex.EncodeToString(e.EntryHash),
		e.Payload.SignedAt.UTC(),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return service.ErrReplay
		}
		return err
	}
	return nil
}

// Leaderboard reads the refreshed matview for a stage.
func (r *MeritRepo) Leaderboard(ctx context.Context, competitionID string, stage arena.Stage) ([]service.LeaderRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT contestant_id, stage, total_score
		  FROM arena_merit_leaderboard
		 WHERE competition_id = $1 AND stage = $2
		 ORDER BY total_score DESC, contestant_id`, competitionID, string(stage))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.LeaderRow{}
	for rows.Next() {
		var lr service.LeaderRow
		var st string
		if err := rows.Scan(&lr.ContestantID, &st, &lr.TotalScore); err != nil {
			return nil, err
		}
		lr.Stage = arena.Stage(st)
		out = append(out, lr)
	}
	return out, rows.Err()
}

// RefreshLeaderboard refreshes the materialized view. CONCURRENTLY requires the
// unique index (present); falls back to a plain refresh if concurrency fails.
func (r *MeritRepo) RefreshLeaderboard(ctx context.Context) error {
	if _, err := r.pool.Exec(ctx, `REFRESH MATERIALIZED VIEW CONCURRENTLY arena_merit_leaderboard`); err != nil {
		if _, ferr := r.pool.Exec(ctx, `REFRESH MATERIALIZED VIEW arena_merit_leaderboard`); ferr != nil {
			return ferr
		}
	}
	return nil
}

// ContestantMerit lists a contestant's merit rows (read side).
func (r *MeritRepo) ContestantMerit(ctx context.Context, competitionID, contestantID string) ([]service.MeritEntryRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, competition_id, contestant_id, source_type, source_adapter_id,
		       stage, normalized_score, entry_hash, signed_at
		  FROM arena_merit_entry
		 WHERE competition_id = $1 AND contestant_id = $2
		 ORDER BY signed_at`, competitionID, contestantID)
	if err != nil {
		return nil, err
	}
	return scanMeritRows(rows)
}

// CompetitionMerit lists all merit rows for a competition (auditor read).
func (r *MeritRepo) CompetitionMerit(ctx context.Context, competitionID string) ([]service.MeritEntryRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, competition_id, contestant_id, source_type, source_adapter_id,
		       stage, normalized_score, entry_hash, signed_at
		  FROM arena_merit_entry
		 WHERE competition_id = $1
		 ORDER BY signed_at`, competitionID)
	if err != nil {
		return nil, err
	}
	return scanMeritRows(rows)
}

func scanMeritRows(rows pgx.Rows) ([]service.MeritEntryRow, error) {
	defer rows.Close()
	out := []service.MeritEntryRow{}
	for rows.Next() {
		var m service.MeritEntryRow
		var signedAt time.Time
		if err := rows.Scan(&m.ID, &m.CompetitionID, &m.ContestantID, &m.SourceType,
			&m.SourceAdapterID, &m.Stage, &m.NormalizedScore, &m.EntryHash, &signedAt); err != nil {
			return nil, err
		}
		m.SignedAt = signedAt
		out = append(out, m)
	}
	return out, rows.Err()
}

// isUniqueViolation reports whether err is a Postgres 23505 unique_violation.
// dbutil covers the SQLState chain; the text fallback survives for adapters that
// surface the violation as a plain string without a pgconn.PgError.
func isUniqueViolation(err error) bool {
	return dbutil.IsUniqueViolation(err) ||
		strings.Contains(err.Error(), "23505") ||
		strings.Contains(err.Error(), "duplicate key")
}

// PotRepo persists the pot disbursement state machine (NDC-4). The pot TOTAL is
// never stored here — it is projected from arena_support_txn by the service. This
// repo holds only the control state: distinct approvals + the idempotent
// DISBURSED flip.
type PotRepo struct{ pool *pgxpool.Pool }

// NewPotRepo builds the pot repo.
func NewPotRepo(pool *pgxpool.Pool) *PotRepo { return &PotRepo{pool: pool} }

var _ service.PotRepo = (*PotRepo)(nil)

// State returns the current pot disbursement status + approvals recorded. A
// competition with no control row yet is PENDING with zero approvals.
func (r *PotRepo) State(ctx context.Context, competitionID string) (string, int, error) {
	var status string
	var approvals int

	err := r.pool.QueryRow(ctx, `
		SELECT status FROM arena_pot_disbursement WHERE competition_id = $1`, competitionID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		status = "PENDING"
	} else if err != nil {
		return "", 0, err
	}
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM arena_pot_approval WHERE competition_id = $1`, competitionID).Scan(&approvals)
	return status, approvals, err
}

// Approve records one distinct approver (idempotent per approver) and returns the
// resulting approval count.
func (r *PotRepo) Approve(ctx context.Context, competitionID, approverID string) (int, error) {
	var approvals int

	if _, err := r.pool.Exec(ctx, `
		INSERT INTO arena_pot_disbursement (competition_id, status)
		VALUES ($1, 'PENDING') ON CONFLICT (competition_id) DO NOTHING`, competitionID); err != nil {
		return 0, err
	}
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO arena_pot_approval (competition_id, approver_id)
		VALUES ($1, $2) ON CONFLICT (competition_id, approver_id) DO NOTHING`,
		competitionID, approverID); err != nil {
		return 0, err
	}
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM arena_pot_approval WHERE competition_id = $1`, competitionID).Scan(&approvals)
	return approvals, err
}

// MarkDisbursed flips the pot to DISBURSED atomically with payout (the ledger
// movement), idempotent by idemKey. A second call with the pot already DISBURSED
// is a safe no-op and does NOT re-run the payout.
func (r *PotRepo) MarkDisbursed(ctx context.Context, competitionID, idemKey string, payout func(ctx context.Context) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock (or create) the control row.
	if _, err := tx.Exec(ctx, `
		INSERT INTO arena_pot_disbursement (competition_id, status)
		VALUES ($1, 'PENDING') ON CONFLICT (competition_id) DO NOTHING`, competitionID); err != nil {
		return err
	}
	var status string
	if err := tx.QueryRow(ctx, `
		SELECT status FROM arena_pot_disbursement WHERE competition_id = $1 FOR UPDATE`, competitionID).Scan(&status); err != nil {
		return err
	}
	if status == "DISBURSED" {
		return nil // idempotent no-op
	}

	// Run the payout inside the SAME tx so money + state flip commit together.
	if err := payout(withTx(ctx, tx)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE arena_pot_disbursement
		   SET status = 'DISBURSED', idempotency_key = $2, disbursed_at = now(), updated_at = now()
		 WHERE competition_id = $1`, competitionID, idemKey); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SupportRepo tags ledgered gifts to a competition (money → display only, NEVER
// merit) and reads the pot aggregates. The money movement is a finance ledger
// entry; this row is a projection tagged for the pot + People's Champion.
type SupportRepo struct{ pool *pgxpool.Pool }

// NewSupportRepo builds the support repo.
func NewSupportRepo(pool *pgxpool.Pool) *SupportRepo { return &SupportRepo{pool: pool} }

var _ service.SupportRepo = (*SupportRepo)(nil)

// TagAfterLedger records the support row AFTER the money movement succeeded.
// Idempotent by idempotency_key (a duplicate is a safe no-op).
func (r *SupportRepo) TagAfterLedger(ctx context.Context, competitionID, contestantID, homeState, backerID, ledgerRef, idemKey string, amountKobo int64) error {
	_, err := q(ctx, r.pool).Exec(ctx, `
		INSERT INTO arena_support_txn
			(competition_id, contestant_id, home_state, backer_id, amount_kobo, rail, ledger_ref, idempotency_key)
		VALUES ($1, NULLIF($2,'')::uuid, NULLIF($3,''), $4, $5, 'SUPPORT', $6, $7)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		competitionID, contestantID, homeState, backerID, amountKobo, ledgerRef, idemKey)
	return err
}

// Rows returns all tagged support contributions for a competition (pot + tallies).
func (r *SupportRepo) Rows(ctx context.Context, competitionID string) ([]service.SupportRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT COALESCE(contestant_id::text,''), COALESCE(home_state,''), amount_kobo
		  FROM arena_support_txn
		 WHERE competition_id = $1`, competitionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.SupportRow{}
	for rows.Next() {
		var sr service.SupportRow
		if err := rows.Scan(&sr.ContestantID, &sr.HomeState, &sr.AmountKobo); err != nil {
			return nil, err
		}
		out = append(out, sr)
	}
	return out, rows.Err()
}
