package loyalty

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/credential"
)

// Phase-3 Paymax Black extension. ADDITIVE to the P2 loyalty engine: Black is the
// top tier ABOVE TIER3. It does NOT rewrite the P2 tier engine — it adds a separate
// Black membership table, configurable perks, perk redemption via the shared
// credential primitive (single-use at an event gate), and partner-offer settlement.
//
// Perks are NON-CASH (NL-4 / NL-5): a Black perk delivers access/content/discount
// (early tickets, lounge), never a financial return or cash-out.

// TierBlack is the top membership level (above TIER3).
const TierBlack Tier = "BLACK"

// BlackMember is a Paymax Black enrolment. Eligibility is decided by the admin/
// upgrade flow (spend + tenure); this row is the granted standing.
type BlackMember struct {
	UserID     string     `json:"user_id"`
	State      string     `json:"state"` // ACTIVE | CANCELLED
	GrantedAt  time.Time  `json:"granted_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CancelledAt *time.Time `json:"cancelled_at,omitempty"`
}

// Perk is a redeemable Black benefit (config-driven). RedeemVia constrains the
// rail: "credential" perks mint a single-use credential validated at an event gate.
type Perk struct {
	ID          string `json:"id"`
	Code        string `json:"code"`         // EARLY_TICKETS | LOUNGE | ...
	Title       string `json:"title"`
	Kind        string `json:"kind"`         // early_access | lounge | discount | partner
	RedeemVia   string `json:"redeem_via"`   // credential | entitlement
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
		return nil, fmt.Errorf("loyalty: user required")
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
		return fmt.Errorf("loyalty: not an active black member")
	}
	b.base.log(userID, "loyalty.black.cancel", userID, nil)
	return nil
}

// GetMember returns a user's Black standing (or ErrNotBlack if none/active).
func (b *BlackService) GetMember(ctx context.Context, userID string) (*BlackMember, error) {
	const q = `SELECT user_id, state, granted_at, expires_at, cancelled_at FROM loyalty_black_members WHERE user_id=$1`
	var m BlackMember
	if err := b.base.db.QueryRow(ctx, q, userID).Scan(&m.UserID, &m.State, &m.GrantedAt, &m.ExpiresAt, &m.CancelledAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotBlack
		}
		return nil, err
	}
	return &m, nil
}

// isActiveBlack returns true only for an ACTIVE, unexpired Black member.
func (b *BlackService) isActiveBlack(ctx context.Context, userID string) (bool, error) {
	m, err := b.GetMember(ctx, userID)
	if err == ErrNotBlack {
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
func (b *BlackService) RedeemPerk(ctx context.Context, userID, perkCode, contextRef string) (*PerkRedemption, error) {
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
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("loyalty: perk %s not found", perkCode)
		}
		return nil, err
	}
	if !active {
		return nil, fmt.Errorf("loyalty: perk inactive")
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
	// single-use + replay rejection.
	if redeemVia == "credential" && b.cred != nil {
		c, err := b.cred.Issue(ctx, userID, credential.KindLoyaltyPerk, credential.Policy{
			SingleUse: true,
			ValidFrom: time.Now(),
		})
		if err != nil {
			return nil, fmt.Errorf("loyalty: issue perk credential: %w", err)
		}
		red.CredentialID = &c.ID
	}

	const ins = `INSERT INTO perk_redemptions (id, user_id, perk_code, context_ref, credential_id, created_at)
	             VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := b.base.db.Exec(ctx, ins, red.ID, red.UserID, red.PerkCode, red.ContextRef, red.CredentialID, red.CreatedAt); err != nil {
		return nil, fmt.Errorf("loyalty: insert perk redemption: %w", err)
	}
	b.base.log(userID, "loyalty.black.perk.redeem", red.ID, map[string]any{"perk": perkCode, "context": contextRef})
	return red, nil
}

// RecordPartnerSettlement books a partner-funded offer redemption for billing
// reconciliation. The member never receives cash (NL-5) — this settles partner ↔
// Paymax, not Paymax ↔ member.
func (b *BlackService) RecordPartnerSettlement(ctx context.Context, partnerID, offerID string, amountKobo int64) (*PartnerSettlement, error) {
	if amountKobo < 0 {
		return nil, fmt.Errorf("loyalty: settlement amount must be non-negative kobo")
	}
	ps := &PartnerSettlement{
		ID:         uuid.New().String(),
		PartnerID:  partnerID,
		OfferID:    offerID,
		AmountKobo: amountKobo,
		Status:     "PENDING",
		CreatedAt:  time.Now(),
	}
	const ins = `INSERT INTO partner_settlements (id, partner_id, offer_id, amount_kobo, status, created_at)
	             VALUES ($1,$2,$3,$4,'PENDING',$5)`
	if _, err := b.base.db.Exec(ctx, ins, ps.ID, ps.PartnerID, ps.OfferID, ps.AmountKobo, ps.CreatedAt); err != nil {
		return nil, fmt.Errorf("loyalty: insert partner settlement: %w", err)
	}
	return ps, nil
}

// Sentinel errors.
var (
	ErrNotBlack       = fmt.Errorf("loyalty: not an active Paymax Black member")
	ErrPerkCapReached = fmt.Errorf("loyalty: monthly perk redemption cap reached")
)
