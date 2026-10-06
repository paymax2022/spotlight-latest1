package kyc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// VAProvisioner provisions a user's virtual account on tier upgrade. Kept as a
// narrow interface so the kyc package stays decoupled from the va package
// (satisfied by *va.Service.ProvisionForUser).
type VAProvisioner interface {
	ProvisionForUser(ctx context.Context, userID string) error
}

// Service manages KYC tier transitions.
type Service struct {
	db *pgxpool.Pool
	va VAProvisioner // optional; set via WithVAProvisioner
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// WithVAProvisioner wires virtual-account provisioning so that approving a user
// to Tier 1+ automatically creates their NGN virtual account with the provider.
func (s *Service) WithVAProvisioner(p VAProvisioner) *Service {
	s.va = p
	return s
}

// GetProfile returns the current KYC profile for a user.
func (s *Service) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `
		SELECT id, COALESCE(kyc_tier, 0), COALESCE(kyc_status, 'none'),
		       kyc_submitted_at, kyc_verified_at, COALESCE(phone_verified, false),
		       document_type, kyc_requested_tier
		FROM user_profiles
		WHERE id = $1`
	p := &Profile{UserID: userID}
	var tier int
	err := s.db.QueryRow(ctx, q, userID).Scan(
		&p.UserID, &tier, &p.Status,
		&p.SubmittedAt, &p.VerifiedAt, &p.PhoneVerified,
		&p.DocumentType, &p.RequestedTier,
	)
	if err != nil {
		return nil, fmt.Errorf("kyc: get profile user=%s: %w", userID, err)
	}
	p.Tier = Tier(tier)
	return p, nil
}

// Initiate moves the user to status=pending for the requested tier.
// Idempotent: submitting again while already in 'pending' is a no-op.
// The status written here MUST be a value user_profiles_kyc_status_check
// actually permits (unverified/pending/verified/failed/suspended — see
// 20260613000000_kyc_fields.sql). It used to write 'submitted', which the
// constraint rejects outright, so every real submission failed and
// ListPending's `WHERE kyc_status = 'submitted'` could never match a row
// even if it hadn't (backend/internal/handlers/admin_console_handler_test.go
// already documents this exact mismatch for the older admin console, which
// works around it by checking both values).
func (s *Service) Initiate(ctx context.Context, userID string, req InitiateRequest) (*Profile, error) {
	// The UPDATE below writes DocumentType straight into
	// user_profiles.document_type, which is bound by the
	// user_profiles_document_type_check CHECK constraint
	// (supabase/migrations/20260613000000_kyc_fields.sql). Validate BEFORE
	// opening the tx: an out-of-enum value rejected by the CHECK surfaces to
	// the caller as an opaque 500 — and did exactly that on
	// /api/v1/kyc/tier2+3, whose handler passed 'government_id'/'liveness'.
	if req.DocumentType != nil && !allowedDocumentTypes[*req.DocumentType] {
		return nil, ErrInvalidDocumentType
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("kyc: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Captured for the audit row below — kyc_events.old_status/old_tier record
	// what the profile was BEFORE this transition, and new_tier is NOT NULL even
	// though Initiate itself never changes the tier (only Approve does).
	var oldStatus string
	var oldTier int
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(kyc_status,'unverified'), COALESCE(kyc_tier,0) FROM user_profiles WHERE id=$1 FOR UPDATE`,
		userID).Scan(&oldStatus, &oldTier); err != nil {
		return nil, fmt.Errorf("kyc: lookup user=%s: %w", userID, err)
	}

	const update = `
		UPDATE user_profiles
		SET kyc_status = 'pending',
		    kyc_submitted_at = NOW(),
		    kyc_requested_tier = $2,
		    document_type = COALESCE($3, document_type),
		    document_ref  = COALESCE($4, document_ref),
		    bvn_hash      = COALESCE($5, bvn_hash),
		    nin_hash      = COALESCE($6, nin_hash),
		    updated_at    = NOW()
		WHERE id = $1 AND kyc_status NOT IN ('submitted', 'pending')
		RETURNING id`

	var returnedID string
	err = tx.QueryRow(ctx, update,
		userID, req.RequestedTier, req.DocumentType, req.DocumentRef,
		hashIfPresent(req.BVN), hashIfPresent(req.NIN),
	).Scan(&returnedID)
	if err != nil {
		// no row = already submitted/pending — idempotent success
		if err.Error() == "no rows in result set" {
			_ = tx.Rollback(ctx)
			return s.GetProfile(ctx, userID)
		}
		return nil, fmt.Errorf("kyc: initiate user=%s: %w", userID, err)
	}

	const audit = `
		INSERT INTO kyc_events (user_id, old_status, new_status, old_tier, new_tier, document_type)
		VALUES ($1, $2, 'pending', $3, $3, $4)`
	if _, err := tx.Exec(ctx, audit, userID, oldStatus, oldTier, req.DocumentType); err != nil {
		return nil, fmt.Errorf("kyc: write audit event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("kyc: commit initiate: %w", err)
	}
	return s.GetProfile(ctx, userID)
}

// Approve is called by an admin or the webhook adapter to upgrade a user's tier.
func (s *Service) Approve(ctx context.Context, userID string, newTier int, actorID *string) (*Profile, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("kyc: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var oldStatus string
	var oldTier int
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(kyc_status,'unverified'), COALESCE(kyc_tier,0) FROM user_profiles WHERE id=$1 FOR UPDATE`,
		userID).Scan(&oldStatus, &oldTier); err != nil {
		return nil, fmt.Errorf("kyc: lookup user=%s: %w", userID, err)
	}

	const update = `
		UPDATE user_profiles
		SET kyc_tier = $2, kyc_status = 'verified', kyc_verified_at = NOW(), updated_at = NOW()
		WHERE id = $1`
	if _, err := tx.Exec(ctx, update, userID, newTier); err != nil {
		return nil, fmt.Errorf("kyc: approve user=%s: %w", userID, err)
	}

	const audit = `
		INSERT INTO kyc_events (user_id, old_status, new_status, old_tier, new_tier, actor_id)
		VALUES ($1, $2, 'verified', $3, $4, $5)`
	if _, err := tx.Exec(ctx, audit, userID, oldStatus, oldTier, newTier, actorID); err != nil {
		return nil, fmt.Errorf("kyc: write audit event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("kyc: commit approve: %w", err)
	}

	// On upgrade to Tier 1+, provision the user's NGN virtual account with the
	// provider (idempotent). Non-fatal: the tier upgrade stands even if the
	// provider call fails — GetOrProvision via GET /finance/va/me self-heals.
	if newTier >= 1 && s.va != nil {
		if err := s.va.ProvisionForUser(ctx, userID); err != nil {
			log.Printf("kyc: VA provisioning after tier-%d approval for user=%s failed (will self-heal on next /va/me): %v", newTier, userID, err)
		}
	}

	return s.GetProfile(ctx, userID)
}

// ListPending returns all profiles currently awaiting admin review (status=pending).
func (s *Service) ListPending(ctx context.Context, limit, offset int) ([]Profile, error) {
	const q = `
		SELECT id, COALESCE(kyc_tier, 0), COALESCE(kyc_status, 'none'),
		       kyc_submitted_at, kyc_verified_at, COALESCE(phone_verified, false),
		       document_type, kyc_requested_tier
		FROM user_profiles
		WHERE kyc_status = 'pending'
		ORDER BY kyc_submitted_at ASC
		LIMIT $1 OFFSET $2`

	rows, err := s.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("kyc: list pending: %w", err)
	}
	defer rows.Close()

	var profiles []Profile
	for rows.Next() {
		var p Profile
		var tier int
		if err := rows.Scan(
			&p.UserID, &tier, &p.Status,
			&p.SubmittedAt, &p.VerifiedAt, &p.PhoneVerified,
			&p.DocumentType, &p.RequestedTier,
		); err != nil {
			return nil, fmt.Errorf("kyc: scan pending row: %w", err)
		}
		p.Tier = Tier(tier)
		profiles = append(profiles, p)
	}
	return profiles, rows.Err()
}

// Fail marks a KYC attempt as failed. The status update and its audit row
// commit in one tx — a crash between them must never leave a status change
// with no audit trail.
func (s *Service) Fail(ctx context.Context, userID string, actorID *string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("kyc: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var oldStatus string
	var oldTier int
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(kyc_status,'unverified'), COALESCE(kyc_tier,0) FROM user_profiles WHERE id=$1 FOR UPDATE`,
		userID).Scan(&oldStatus, &oldTier); err != nil {
		return fmt.Errorf("kyc: lookup user=%s: %w", userID, err)
	}

	const update = `UPDATE user_profiles SET kyc_status='failed', updated_at=NOW() WHERE id=$1`
	if _, err := tx.Exec(ctx, update, userID); err != nil {
		return fmt.Errorf("kyc: fail user=%s: %w", userID, err)
	}

	const audit = `
		INSERT INTO kyc_events (user_id, old_status, new_status, old_tier, new_tier, actor_id)
		VALUES ($1, $2, 'failed', $3, $3, $4)`
	if _, err := tx.Exec(ctx, audit, userID, oldStatus, oldTier, actorID); err != nil {
		return fmt.Errorf("kyc: write audit event: %w", err)
	}

	return tx.Commit(ctx)
}

// hashIfPresent returns a deterministic argon2id hash of the value if non-nil.
// Uses a SHA-256-derived salt so the same input always produces the same hash,
// allowing lookups by hash. argon2id params: time=1, memory=64MiB, threads=4, keyLen=32.
func hashIfPresent(v *string) *string {
	if v == nil || *v == "" {
		return nil
	}
	salt := sha256.Sum256([]byte(*v))
	key := argon2.IDKey([]byte(*v), salt[:], 1, 64*1024, 4, 32)
	hashed := "argon2id:" + hex.EncodeToString(key)
	return &hashed
}

// Handler exposes KYC endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetMe handles GET /finance/kyc/me
func (h *Handler) GetMe(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	profile, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, profile)
}

// Initiate/Approve/Reject/ListPending have no HTTP routes here — tier/status
// moves go through the KYC verification gateway (internal/finance/kycverify),
// which requires real provider evidence before admin review. The Service
// methods remain because Approve is still kycverify's tier-write sink (see
// kycTierElevator in internal/app/finance_routes.go) and Initiate is still
// called by the mobile tier-submission handlers
// (internal/handlers/kyc_connect_handler.go).

// Status mirrors the kyc_status check constraint in the Supabase migration.
type Status string

const (
	StatusNone      Status = "none"
	StatusPending   Status = "pending"
	StatusSubmitted Status = "submitted"
	StatusVerified  Status = "verified"
	StatusFailed    Status = "failed"
)

// ErrInvalidDocumentType — InitiateRequest.DocumentType outside the
// user_profiles_document_type_check enum (BVN/NIN/PASSPORT/DRIVERS_LICENSE —
// 20260613000000_kyc_fields.sql). Callers map it to 400; the alternative was an
// opaque 500 CHECK-constraint violation at the UPDATE.
var ErrInvalidDocumentType = errors.New("kyc: document_type outside the allowed set")

// allowedDocumentTypes mirrors user_profiles_document_type_check. Keep in sync
// with the migration; widening the set requires a (non-additive) constraint
// change, so tier-2/3 submissions deliberately send nil — document_ref carries
// the uploaded artifact URI instead.
var allowedDocumentTypes = map[string]bool{
	"BVN":             true,
	"NIN":             true,
	"PASSPORT":        true,
	"DRIVERS_LICENSE": true,
}

// Tier is the verified access level (0–3).
type Tier int

// Profile is the KYC state for a user.
type Profile struct {
	UserID        string     `json:"user_id"`
	Tier          Tier       `json:"kyc_tier"`
	Status        Status     `json:"kyc_status"`
	SubmittedAt   *time.Time `json:"kyc_submitted_at,omitempty"`
	VerifiedAt    *time.Time `json:"kyc_verified_at,omitempty"`
	PhoneVerified bool       `json:"phone_verified"`
	DocumentType  *string    `json:"document_type,omitempty"`
	RequestedTier *int       `json:"requested_tier,omitempty"`
}

// InitiateRequest is the body for POST /finance/kyc/initiate.
type InitiateRequest struct {
	// Tier the user is requesting (1, 2, or 3).
	RequestedTier int     `json:"requested_tier" binding:"required,min=1,max=3"`
	DocumentType  *string `json:"document_type,omitempty"`
	DocumentRef   *string `json:"document_ref,omitempty"`
	BVN           *string `json:"bvn,omitempty"`
	NIN           *string `json:"nin,omitempty"`
}

// AuditEvent is written to kyc_events on every state transition. Field names
// mirror the actual table (20260613010000_kyc_events.sql) — old_status/
// new_status/old_tier/new_tier/document_type/actor_id/note — not an
// event_type column, which the table has never had.
type AuditEvent struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	OldStatus    *string   `json:"old_status,omitempty"`
	NewStatus    Status    `json:"new_status"`
	OldTier      *Tier     `json:"old_tier,omitempty"`
	NewTier      Tier      `json:"new_tier"`
	DocumentType *string   `json:"document_type,omitempty"`
	ActorID      *string   `json:"actor_id,omitempty"`
	Note         *string   `json:"note,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}
