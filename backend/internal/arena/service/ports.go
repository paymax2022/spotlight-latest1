package service

import (
	"context"
	"errors"
	"time"

	"spotlight/backend/internal/arena"
)

// Sentinel errors surfaced to the HTTP layer.
var (
	ErrNotFound        = errors.New("arena: not found")
	ErrForbidden       = errors.New("arena: forbidden")
	ErrConflict        = errors.New("arena: conflict")
	ErrInvalidInput    = errors.New("arena: invalid input")
	ErrBadState        = errors.New("arena: illegal state transition")
	ErrKYCTierTooLow   = errors.New("arena: kyc tier below required")   // NDC-3
	ErrUnauthorizedSig = errors.New("arena: merit entry signature not authorized") // NDC-2
	ErrReplay          = errors.New("arena: merit entry is a replay")
	ErrMissingIdem     = errors.New("arena: Idempotency-Key required")
	ErrPotState        = errors.New("arena: pot not in a disbursable state")
	ErrRateLimited     = errors.New("arena: rate limited")
)

// ── Domain records (thin projections; DB is source of truth) ────────────────

// Competition is an Arena competition.
type Competition struct {
	ID            string `json:"id"`
	Slug          string `json:"slug"`
	Name          string `json:"name"`
	Status        string `json:"status"`
	Timezone      string `json:"timezone"`
	ConfigVersion int    `json:"config_version"`
}

// Config is a published, immutable competition config version.
type Config struct {
	CompetitionID           string         `json:"competition_id"`
	Version                 int            `json:"version"`
	Rails                   map[string]any `json:"rails"`
	Awards                  map[string]any `json:"awards"`
	RequiredKYCTier         int            `json:"required_kyc_tier"`         // NDC-3 gate
	QualifyTopN             int            `json:"qualify_top_n"`             // merit cut for QUALIFIED
	FinalistTopN            int            `json:"finalist_top_n"`            // merit cut for FINALIST
	PlayAlongThreshold      int            `json:"playalong_threshold"`       // points → CERTIFIED_SAFE_DRIVER
	PlayAlongCashbackKobo   int64          `json:"playalong_cashback_kobo"`   // ledgered reward on pass
	PlayAlongCashbackPerDay int            `json:"playalong_cashback_per_day"`// rate limit
	PotApprovalsRequired    int            `json:"pot_approvals_required"`    // NDC-4 multi-approve
	RubricVersions          map[string]any `json:"rubric_versions"`
}

// Contestant is a person's entry into a competition.
type Contestant struct {
	ID            string                `json:"id"`
	CompetitionID string                `json:"competition_id"`
	UserID        string                `json:"user_id"`
	State         arena.ContestantState `json:"state"`
	KYCTier       int                   `json:"kyc_tier"`
	HomeState     string                `json:"home_state"`
	TheoryBatch   string                `json:"theory_batch,omitempty"`
}

// MeritEntryRow is a persisted signed merit row (read side).
type MeritEntryRow struct {
	ID              string    `json:"id"`
	CompetitionID   string    `json:"competition_id"`
	ContestantID    string    `json:"contestant_id"`
	SourceType      string    `json:"source_type"`
	SourceAdapterID string    `json:"source_adapter_id"`
	Stage           string    `json:"stage"`
	NormalizedScore float64   `json:"normalized_score"`
	EntryHash       string    `json:"entry_hash"`
	SignedAt        time.Time `json:"signed_at"`
}

// Credential is an issued, verifiable, revocable attestation (NDC-7).
type Credential struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	CompetitionID  string     `json:"competition_id"`
	Type           string     `json:"type"`
	Status         string     `json:"status"`
	VerifiableHash string     `json:"verifiable_hash"`
	IssuedAt       time.Time  `json:"issued_at"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	RevokeReason   string     `json:"revoke_reason,omitempty"`
}

// AuthorizedAdapter is a competition's registered scoring adapter public key.
type AuthorizedAdapter struct {
	AdapterID  string `json:"adapter_id"`
	SourceType string `json:"source_type"`
	PublicKey  string `json:"public_key"`
	Active     bool   `json:"active"`
}

// AuditRecord is one immutable audit line.
type AuditRecord struct {
	CompetitionID string
	ActorID       string
	EntityType    string
	EntityID      string
	Action        string
	Reason        string
	Before        map[string]any
	After         map[string]any
}

// ── Ports (implemented by arena/repo; faked in tests) ───────────────────────

// MeritRepo is the append-only signed merit ledger. It has NO method that writes
// merit from anything but a verified arena.SignedMeritEntry (NDC-1, NDC-2).
type MeritRepo interface {
	// AuthorizedAdapters returns a competition's active adapter public keys, used
	// to build the verifier BEFORE any append.
	AuthorizedAdapters(ctx context.Context, competitionID string) ([]AuthorizedAdapter, error)
	// LastEntryHash returns the contestant's most recent entry_hash for chaining
	// (nil for genesis).
	LastEntryHash(ctx context.Context, competitionID, contestantID string) ([]byte, error)
	// Insert persists a verified entry. Implementations MUST reject a duplicate
	// (arena_merit_no_replay) with ErrReplay.
	Insert(ctx context.Context, e arena.SignedMeritEntry) error
	// Leaderboard reads the (refreshed) merit matview for a stage.
	Leaderboard(ctx context.Context, competitionID string, stage arena.Stage) ([]LeaderRow, error)
	// RefreshLeaderboard refreshes the materialized view.
	RefreshLeaderboard(ctx context.Context) error
	// ContestantMerit lists a contestant's merit rows (read side).
	ContestantMerit(ctx context.Context, competitionID, contestantID string) ([]MeritEntryRow, error)
	// CompetitionMerit lists all merit rows for a competition (auditor read).
	CompetitionMerit(ctx context.Context, competitionID string) ([]MeritEntryRow, error)
}

// CompetitionRepo persists competitions, config versions and authorized adapters.
type CompetitionRepo interface {
	Create(ctx context.Context, slug, name, timezone, createdBy string) (*Competition, error)
	Get(ctx context.Context, id string) (*Competition, error)
	List(ctx context.Context, limit, offset int) ([]Competition, error)
	PublishConfig(ctx context.Context, competitionID, publishedBy string, cfg Config) (int, error)
	CurrentConfig(ctx context.Context, competitionID string) (*Config, error)
	RegisterAdapter(ctx context.Context, competitionID string, a AuthorizedAdapter) error
}

// ContestantRepo persists contestants + guarded lifecycle transitions.
type ContestantRepo interface {
	Create(ctx context.Context, competitionID, userID string, kycTier int, homeState string) (*Contestant, error)
	Get(ctx context.Context, competitionID, contestantID string) (*Contestant, error)
	GetByUser(ctx context.Context, competitionID, userID string) (*Contestant, error)
	ListByState(ctx context.Context, competitionID string, state arena.ContestantState) ([]Contestant, error)
	// UpdateState performs the state change atomically with the side-effect fn
	// (award finalization + credential issue + pot trigger on CROWNED) in ONE tx.
	UpdateState(ctx context.Context, contestantID string, from, to arena.ContestantState, sideEffect func(ctx context.Context) error) error
}

// SupportRepo tags ledgered gifts to a competition and reads the pot aggregates.
type SupportRepo interface {
	// TagAfterLedger records the support row AFTER the money movement succeeded.
	TagAfterLedger(ctx context.Context, competitionID, contestantID, homeState, backerID, ledgerRef, idemKey string, amountKobo int64) error
	Rows(ctx context.Context, competitionID string) ([]SupportRow, error)
}

// EngagementRepo persists idempotent Play-Along / prediction events.
type EngagementRepo interface {
	// Record inserts an idempotent engagement event; returns points-so-far for the
	// spectator and whether this call was a duplicate (idempotency_key already seen).
	Record(ctx context.Context, competitionID, spectatorID, eventType, subjectID, idemKey string, points int) (totalPoints int, duplicate bool, err error)
	// CashbackCountToday counts today's ledgered play-along cashbacks (rate limit).
	CashbackCountToday(ctx context.Context, competitionID, spectatorID string) (int, error)
}

// CredentialRepo persists issued credentials and verify-by-hash reads.
type CredentialRepo interface {
	Issue(ctx context.Context, c Credential) error
	GetByHash(ctx context.Context, hash string) (*Credential, error)
	Revoke(ctx context.Context, hash, reason string) error
}

// AwardRepo persists finalized signed award results (append-only).
type AwardRepo interface {
	Finalize(ctx context.Context, competitionID, awardType, subjectID string, computedFrom []string, value float64, signature string) error
}

// PotRepo persists the pot disbursement state machine (NDC-4).
type PotRepo interface {
	// State returns the current pot disbursement state + approvals recorded.
	State(ctx context.Context, competitionID string) (status string, approvals int, err error)
	// Approve records one distinct approver (idempotent per approver).
	Approve(ctx context.Context, competitionID, approverID string) (approvals int, err error)
	// MarkDisbursed flips the pot to DISBURSED atomically with the payout fn (the
	// ledger movement), idempotent by idemKey.
	MarkDisbursed(ctx context.Context, competitionID, idemKey string, payout func(ctx context.Context) error) error
}

// AuditRepo writes immutable arena_audit_log rows.
type AuditRepo interface {
	Log(ctx context.Context, r AuditRecord) error
}

// LedgerPort is the money primitive the Support / Play-Along / Pot rails reuse.
// It is deliberately the ONLY money capability these rails hold — they receive
// NO signer and cannot construct a merit entry (NDC-1).
type LedgerPort interface {
	// Credit posts money into userID's wallet from a standing account.
	Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error
	// Debit posts money out of userID's wallet into a standing account.
	Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
	// StandingAccountID resolves (or creates) a standing account id by type name.
	StandingAccountID(ctx context.Context, accountType string) (string, error)
}

// TierPort reads a user's KYC tier for the NDC-3 identity gate.
type TierPort interface {
	UserTier(ctx context.Context, userID string) (int, error)
}
