package loyalty

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/points"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Phase-3 Paymax Black extension. ADDITIVE to the P2 loyalty engine: Black is the
// top tier ABOVE TIER3. It does NOT rewrite the P2 tier engine — it adds a separate
// Black membership table, configurable perks, perk redemption via the shared
// credential primitive (single-use at an event gate), and partner-offer settlement.
// Perks are NON-CASH (NL-4 / NL-5): a Black perk delivers access/content/discount
// (early tickets, lounge), never a financial return or cash-out.

// TierBlack is the top membership level (above TIER3).
const TierBlack Tier = "BLACK"

// BlackMember is a Paymax Black enrolment. Eligibility is decided by the admin/
// upgrade flow (spend + tenure); this row is the granted standing.
type BlackMember struct {
	UserID      string     `json:"user_id"`
	State       string     `json:"state"` // ACTIVE | CANCELLED
	GrantedAt   time.Time  `json:"granted_at"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	CancelledAt *time.Time `json:"cancelled_at,omitempty"`
}

// Perk is a redeemable Black benefit (config-driven). RedeemVia constrains the
// rail: "credential" perks mint a single-use credential validated at an event gate.
type Perk struct {
	ID          string `json:"id"`
	Code        string `json:"code"` // EARLY_TICKETS | LOUNGE | ...
	Title       string `json:"title"`
	Kind        string `json:"kind"`       // early_access | lounge | discount | partner
	RedeemVia   string `json:"redeem_via"` // credential | entitlement
	MaxPerMonth int    `json:"max_per_month"`
	Active      bool   `json:"active"`
}

// PerkRedemption records one Black perk claim. For credential perks the
// credential_id links to the issued single-use credential.
type PerkRedemption struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	PerkCode     string    `json:"perk_code"`
	ContextRef   string    `json:"context_ref"` // event id the perk is redeemed against
	CredentialID *string   `json:"credential_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// Partner is a Black partner brand. PartnerOffer is a perk a partner funds.
type Partner struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

// PartnerSettlement records what Paymax owes/collects with a partner for redeemed
// offers (settlement is non-cash to the member — it reconciles partner billing).
type PartnerSettlement struct {
	ID         string    `json:"id"`
	PartnerID  string    `json:"partner_id"`
	OfferID    string    `json:"offer_id"`
	AmountKobo int64     `json:"amount_kobo"`
	Status     string    `json:"status"` // PENDING | SETTLED
	CreatedAt  time.Time `json:"created_at"`
}

// BlackService is the Phase-3 Black surface. It is a sibling of the P2 loyalty
// Service (not a rewrite). It depends on the shared credential primitive to mint
// single-use perk credentials redeemed at event gates.
type BlackService struct {
	base *Service
	cred *credential.Service
}

// NewBlackService composes the P2 loyalty service + credential primitive.
func NewBlackService(base *Service, cred *credential.Service) *BlackService {
	return &BlackService{base: base, cred: cred}
}

// Enroll grants Black standing to a user. authZ for who may enroll is enforced at
// the route layer (loyalty.black.manage). Idempotent on (user_id) ACTIVE.
func (b *BlackService) Enroll(ctx context.Context, userID string, expiresAt *time.Time) (*BlackMember, error) {
	if userID == "" {
		return nil, errors.New("loyalty: user required")
	}
	const ins = `
		INSERT INTO loyalty_black_members (user_id, state, granted_at, expires_at)
		VALUES ($1,'ACTIVE',now(),$2)
		ON CONFLICT (user_id) DO UPDATE SET state='ACTIVE', expires_at=EXCLUDED.expires_at, cancelled_at=NULL`
	if _, err := b.base.db.Exec(ctx, ins, userID, expiresAt); err != nil {
		return nil, fmt.Errorf("loyalty: enroll black: %w", err)
	}
	b.base.log(userID, "loyalty.black.enroll", userID, map[string]any{"expires_at": expiresAt})
	return b.GetMember(ctx, userID)
}

// Cancel ends a Black membership (guarded ACTIVE → CANCELLED).
func (b *BlackService) Cancel(ctx context.Context, userID string) error {
	const q = `UPDATE loyalty_black_members SET state='CANCELLED', cancelled_at=now() WHERE user_id=$1 AND state='ACTIVE'`
	ct, err := b.base.db.Exec(ctx, q, userID)
	if err != nil {
		return fmt.Errorf("loyalty: cancel black: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return errors.New("loyalty: not an active black member")
	}
	b.base.log(userID, "loyalty.black.cancel", userID, nil)
	return nil
}

// GetMember returns a user's Black standing (or ErrNotBlack if none/active).
func (b *BlackService) GetMember(ctx context.Context, userID string) (*BlackMember, error) {
	const q = `SELECT user_id, state, granted_at, expires_at, cancelled_at FROM loyalty_black_members WHERE user_id=$1`
	var m BlackMember
	if err := b.base.db.QueryRow(ctx, q, userID).Scan(&m.UserID, &m.State, &m.GrantedAt, &m.ExpiresAt, &m.CancelledAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotBlack
		}
		return nil, err
	}
	return &m, nil
}

// isActiveBlack returns true only for an ACTIVE, unexpired Black member.
func (b *BlackService) isActiveBlack(ctx context.Context, userID string) (bool, error) {
	m, err := b.GetMember(ctx, userID)
	if errors.Is(err, ErrNotBlack) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if m.State != "ACTIVE" {
		return false, nil
	}
	if m.ExpiresAt != nil && m.ExpiresAt.Before(time.Now()) {
		return false, nil
	}
	return true, nil
}

// ListPerks returns active Black perks (member-visible catalog).
func (b *BlackService) ListPerks(ctx context.Context) ([]Perk, error) {
	const q = `SELECT id, code, title, kind, redeem_via, max_per_month, active FROM loyalty_perks WHERE active=true ORDER BY title`
	rows, err := b.base.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Perk
	for rows.Next() {
		var p Perk
		if err := rows.Scan(&p.ID, &p.Code, &p.Title, &p.Kind, &p.RedeemVia, &p.MaxPerMonth, &p.Active); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// RedeemPerk grants a Black perk for an event context. Eligibility is fail-closed:
// the caller must be an ACTIVE Black member. For a "credential" perk a single-use
// credential is minted (validated at the event gate by the shared credential
// primitive — single-use + replay-rejected). The redemption is audited (NL-12).
// NL-5/NL-4: a perk is access/content only, never cash.
//
// idemKey is the REQUIRED client Idempotency-Key (iron rule): a replay returns
// the original PerkRedemption — no second credential mint and no duplicate row
// (perk_redemptions.idempotency_key dedupes the insert).
func (b *BlackService) RedeemPerk(ctx context.Context, userID, perkCode, contextRef, idemKey string) (*PerkRedemption, error) {
	if idemKey == "" {
		return nil, points.ErrIdempotencyRequired
	}
	// Replay short-circuit before any fresh work (esp. the credential mint):
	// return the original row.
	prior, err := b.perkRedemptionByIdem(ctx, userID, idemKey)
	if err == nil {
		// Same key + different params is a CONFLICT, not a replay: silently
		// returning the original perk to a different-perk/different-event
		// request would grant the wrong benefit. The stored row carries the
		// full request shape (perk_code + context_ref) — no params-hash needed.
		if prior.PerkCode != perkCode || prior.ContextRef != contextRef {
			return nil, points.ErrIdempotencyConflict
		}
		// No audit event on replay: LogAction appends unconditionally (no
		// dedupe), so one row per replayed request would inflate audit_logs.
		return prior, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("loyalty: perk replay check: %w", err)
	}

	ok, err := b.isActiveBlack(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotBlack
	}

	const pq = `SELECT code, redeem_via, max_per_month, active FROM loyalty_perks WHERE code=$1`
	var code, redeemVia string
	var maxPerMonth int
	var active bool
	if err := b.base.db.QueryRow(ctx, pq, perkCode).Scan(&code, &redeemVia, &maxPerMonth, &active); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("loyalty: perk %s not found", perkCode)
		}
		return nil, err
	}
	if !active {
		return nil, errors.New("loyalty: perk inactive")
	}

	// Monthly cap (fail-closed): never over-grant a capped perk.
	if maxPerMonth > 0 {
		var used int
		const cq = `SELECT COUNT(*) FROM perk_redemptions
		            WHERE user_id=$1 AND perk_code=$2 AND created_at >= date_trunc('month', now())`
		if err := b.base.db.QueryRow(ctx, cq, userID, perkCode).Scan(&used); err != nil {
			return nil, err
		}
		if used >= maxPerMonth {
			return nil, ErrPerkCapReached
		}
	}

	red := &PerkRedemption{
		ID:         uuid.New().String(),
		UserID:     userID,
		PerkCode:   perkCode,
		ContextRef: contextRef,
		CreatedAt:  time.Now(),
	}

	// Credential-rail perks (lounge, early-ticket gate): mint a single-use credential
	// the member presents at the event. Reuse of the shared primitive guarantees
	// single-use + replay rejection. Fail-closed: a credential-rail perk with no
	// credential primitive available is an error, never a credential-less row
	// the member could not present at the gate.
	if redeemVia == "credential" {
		if b.cred == nil {
			return nil, errors.New("loyalty: credential primitive unavailable for credential perk")
		}
		c, err := b.cred.Issue(ctx, userID, credential.KindLoyaltyPerk, credential.Policy{
			SingleUse: true,
			ValidFrom: time.Now(),
		})
		if err != nil {
			return nil, fmt.Errorf("loyalty: issue perk credential: %w", err)
		}
		red.CredentialID = &c.ID
	}

	const ins = `INSERT INTO perk_redemptions (id, user_id, perk_code, context_ref, credential_id, idempotency_key, created_at)
	             VALUES ($1,$2,$3,$4,$5,$6,$7)
	             ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
	if _, err := b.base.db.Exec(ctx, ins, red.ID, red.UserID, red.PerkCode, red.ContextRef, red.CredentialID, idemKey, red.CreatedAt); err != nil {
		// The minted credential never got attached to a redemption — revoke it
		// so it cannot pass a gate scan unattached.
		b.revokeOrphanCredential(ctx, red.CredentialID)
		return nil, fmt.Errorf("loyalty: insert perk redemption: %w", err)
	}
	// Read back what stands under the key — the row just written or, on a lost
	// same-key race, the winner's.
	stored, err := b.perkRedemptionByIdem(ctx, userID, idemKey)
	if err != nil {
		b.revokeOrphanCredential(ctx, red.CredentialID)
		return nil, fmt.Errorf("loyalty: perk conflict read-back: %w", err)
	}
	if stored.ID != red.ID {
		// Race lost: the winner's row references its own credential, so the
		// credential minted above is an orphan — revoke it rather than leave an
		// ACTIVE credential floating outside any redemption.
		b.revokeOrphanCredential(ctx, red.CredentialID)
		if stored.PerkCode != perkCode || stored.ContextRef != contextRef {
			return nil, points.ErrIdempotencyConflict
		}
		// Same-key race lost to an identical request: return the winner's row.
		// No audit event — only the winner emits the mutation event.
		return stored, nil
	}
	if stored.PerkCode != perkCode || stored.ContextRef != contextRef {
		// Unreachable for our own freshly-written row — defence-in-depth.
		return nil, points.ErrIdempotencyConflict
	}
	b.base.log(userID, "loyalty.black.perk.redeem", stored.ID, map[string]any{"perk": perkCode, "context": contextRef})
	return stored, nil
}

// revokeOrphanCredential best-effort revokes a credential minted for a
// redemption row that failed to persist (insert error / read-back failure /
// lost same-key race). Without it the credential stays ACTIVE-but-unattached —
// an orphan that could still pass a gate scan. Runs on a detached context so a
// cancelled request still cleans up; failures are audit-logged, never fatal.
func (b *BlackService) revokeOrphanCredential(ctx context.Context, credentialID *string) {
	if b.cred == nil || credentialID == nil || *credentialID == "" {
		return
	}
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := b.cred.Revoke(cctx, *credentialID); err != nil {
		b.base.log("", "loyalty.black.perk.orphan_revoke_error", *credentialID, map[string]any{"err": err.Error()})
	}
}

// perkRedemptionByIdem loads the perk redemption recorded under a client
// idempotency key.
func (b *BlackService) perkRedemptionByIdem(ctx context.Context, userID, idemKey string) (*PerkRedemption, error) {
	const q = `SELECT id, user_id, perk_code, context_ref, credential_id, created_at
		FROM perk_redemptions WHERE user_id=$1 AND idempotency_key=$2`
	var r PerkRedemption
	if err := b.base.db.QueryRow(ctx, q, userID, idemKey).Scan(
		&r.ID, &r.UserID, &r.PerkCode, &r.ContextRef, &r.CredentialID, &r.CreatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

// RecordPartnerSettlement books a partner-funded offer redemption for billing
// reconciliation. The member never receives cash (NL-5) — this settles partner ↔
// Paymax, not Paymax ↔ member.
//
// idemKey is the REQUIRED client Idempotency-Key (iron rule — this is a money
// mutation: a retried booking must never double-book partner billing). Dedupe is
// scoped (actor_user_id, idempotency_key): the same key from a different admin is
// a different mutation. A replay under the same admin+key returns the original
// settlement; a replay carrying different params (partner/offer/amount) is a
// 409 conflict, never a silent original.
func (b *BlackService) RecordPartnerSettlement(ctx context.Context, actorUserID, partnerID, offerID string, amountKobo int64, idemKey string) (*PartnerSettlement, error) {
	if idemKey == "" {
		return nil, points.ErrIdempotencyRequired
	}
	if actorUserID == "" {
		return nil, errors.New("loyalty: settlement actor required")
	}
	if amountKobo < 0 {
		return nil, errors.New("loyalty: settlement amount must be non-negative kobo")
	}
	// partner_id/offer_id are uuid columns: the DB stores them canonically but
	// the request shape is compared against the read-back string, so a
	// valid-but-non-canonical input (uppercase/braced) would 409 its own row
	// forever under its key. Normalize before insert AND compare.
	if pid, err := uuid.Parse(partnerID); err != nil {
		return nil, fmt.Errorf("loyalty: invalid partner id: %w", err)
	} else {
		partnerID = pid.String()
	}
	if offerID != "" {
		oid, err := uuid.Parse(offerID)
		if err != nil {
			return nil, fmt.Errorf("loyalty: invalid offer id: %w", err)
		}
		offerID = oid.String()
	}
	// Replay short-circuit before any fresh work.
	prior, err := b.settlementByIdem(ctx, actorUserID, idemKey)
	if err == nil {
		if prior.PartnerID != partnerID || prior.OfferID != offerID || prior.AmountKobo != amountKobo {
			return nil, points.ErrIdempotencyConflict
		}
		return prior, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("loyalty: settlement replay check: %w", err)
	}
	ps := &PartnerSettlement{
		ID:         uuid.New().String(),
		PartnerID:  partnerID,
		OfferID:    offerID,
		AmountKobo: amountKobo,
		Status:     "PENDING",
		CreatedAt:  time.Now(),
	}
	const ins = `INSERT INTO partner_settlements (id, partner_id, offer_id, amount_kobo, status, actor_user_id, idempotency_key, created_at)
	             VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7)
	             ON CONFLICT (actor_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
	var offerArg any
	if ps.OfferID != "" {
		offerArg = ps.OfferID
	}
	if _, err := b.base.db.Exec(ctx, ins, ps.ID, ps.PartnerID, offerArg, ps.AmountKobo, actorUserID, idemKey, ps.CreatedAt); err != nil {
		return nil, fmt.Errorf("loyalty: insert partner settlement: %w", err)
	}
	// Read back what stands under the key — the row just written or the winner
	// of a same-key race — then apply the same params check.
	stored, err := b.settlementByIdem(ctx, actorUserID, idemKey)
	if err != nil {
		return nil, fmt.Errorf("loyalty: settlement conflict read-back: %w", err)
	}
	if stored.PartnerID != partnerID || stored.OfferID != offerID || stored.AmountKobo != amountKobo {
		return nil, points.ErrIdempotencyConflict
	}
	if stored.ID != ps.ID {
		// Race lost to an identical request: return the winner's row. No audit
		// event — only the winner emits the mutation event.
		return stored, nil
	}
	b.base.log(actorUserID, "loyalty.black.settlement.record", stored.ID,
		map[string]any{"partner": partnerID, "offer": offerID, "amount_kobo": amountKobo})
	return stored, nil
}

// settlementByIdem loads the partner settlement recorded under an admin's
// idempotency key.
func (b *BlackService) settlementByIdem(ctx context.Context, actorUserID, idemKey string) (*PartnerSettlement, error) {
	const q = `SELECT id, partner_id, COALESCE(offer_id::text,''), amount_kobo, status, created_at
		FROM partner_settlements WHERE actor_user_id=$1 AND idempotency_key=$2`
	var s PartnerSettlement
	if err := b.base.db.QueryRow(ctx, q, actorUserID, idemKey).Scan(
		&s.ID, &s.PartnerID, &s.OfferID, &s.AmountKobo, &s.Status, &s.CreatedAt); err != nil {
		return nil, err
	}
	return &s, nil
}

// Sentinel errors.
var (
	ErrNotBlack       = errors.New("loyalty: not an active Paymax Black member")
	ErrPerkCapReached = errors.New("loyalty: monthly perk redemption cap reached")
)

// BlackHandler exposes Paymax Black member + admin endpoints. Member endpoints let
// a Black member view standing + perks and redeem a perk; enrolment, partner and
// settlement management are RBAC-gated admin actions (loyalty.black.manage).
type BlackHandler struct {
	svc *BlackService
}

func NewBlackHandler(svc *BlackService) *BlackHandler { return &BlackHandler{svc: svc} }

// Register mounts Black routes. The caller passes member = finance.Group("/loyalty")
// (base already "/loyalty" — only "/black" must be added here) and
// admin = adminGroupTop5(r, "/api/loyalty/admin/black") (base already includes
// "/black" — neither "/loyalty" nor "/black" may be re-added here, or Gin will
// double the segment, e.g. /api/finance/loyalty/loyalty/black/me).
//
//	member: /api/finance/loyalty/black/*
//	admin : /api/loyalty/admin/black/*  (RBAC loyalty.black.*)
func (h *BlackHandler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	member.GET("/black/me", h.Me)
	member.GET("/black/perks", h.Perks)
	member.POST("/black/redeem", h.Redeem)

	admin.POST("/enroll", guard("loyalty.black.manage"), h.AdminEnroll)
	admin.POST("/cancel", guard("loyalty.black.manage"), h.AdminCancel)
	admin.POST("/partner-settlement", guard("loyalty.black.manage"), h.AdminPartnerSettlement)
}

func (h *BlackHandler) Me(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	m, err := h.svc.GetMember(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrNotBlack) {
			c.JSON(http.StatusOK, gin.H{"success": true, "is_black": false})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "is_black": true, "member": m})
}

func (h *BlackHandler) Perks(c *gin.Context) {
	perks, err := h.svc.ListPerks(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "perks": perks})
}

type redeemPerkRequest struct {
	PerkCode   string `json:"perk_code" binding:"required"`
	ContextRef string `json:"context_ref" binding:"required"`
}

func (h *BlackHandler) Redeem(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req redeemPerkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	// Iron rule: every money mutation requires the client Idempotency-Key — a
	// replay must never mint a second perk credential. The BFF edge synthesizes
	// one for callers that omit it; the backend always requires it.
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	red, err := h.svc.RedeemPerk(c.Request.Context(), userID, req.PerkCode, req.ContextRef, key)
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, ErrNotBlack):
			status = http.StatusForbidden
		case errors.Is(err, ErrPerkCapReached):
			status = http.StatusTooManyRequests
		case errors.Is(err, points.ErrIdempotencyConflict):
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "redemption": red})
}

type enrollRequest struct {
	UserID    string  `json:"user_id" binding:"required"`
	ExpiresAt *string `json:"expires_at,omitempty"` // RFC3339
}

func (h *BlackHandler) AdminEnroll(c *gin.Context) {
	var req enrollRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	var exp *time.Time
	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "expires_at must be RFC3339"})
			return
		}
		exp = &t
	}
	m, err := h.svc.Enroll(c.Request.Context(), req.UserID, exp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "member": m})
}

type cancelRequest struct {
	UserID string `json:"user_id" binding:"required"`
}

func (h *BlackHandler) AdminCancel(c *gin.Context) {
	var req cancelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.Cancel(c.Request.Context(), req.UserID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type partnerSettlementRequest struct {
	PartnerID  string `json:"partner_id" binding:"required"`
	OfferID    string `json:"offer_id" binding:"required"`
	AmountKobo int64  `json:"amount_kobo"`
}

func (h *BlackHandler) AdminPartnerSettlement(c *gin.Context) {
	// Dedupe is scoped to the calling admin (actor + key).
	actor, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var req partnerSettlementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	// Iron rule: partner settlement is a money mutation — the client
	// Idempotency-Key is required so a retry can never double-book partner
	// billing.
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	ps, err := h.svc.RecordPartnerSettlement(c.Request.Context(), actor, req.PartnerID, req.OfferID, req.AmountKobo, key)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, points.ErrIdempotencyConflict) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "settlement": ps})
}
