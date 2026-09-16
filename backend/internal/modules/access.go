package modules

import (
	"context"
	"fmt"
	"time"
)

// AccessLevel says who may use a module once it is published for the environment.
type AccessLevel string

const (
	// AccessGeneral — any signed-in user. Profile, support, browse-only surfaces.
	AccessGeneral AccessLevel = "general"
	// AccessRestricted — needs a completed KYC tier OR an explicit admin grant.
	AccessRestricted AccessLevel = "restricted"
)

// kycTierUnlocking is the tier at which a user earns restricted modules without a
// grant. Tier 0 is "registered, no KYC"; anything above it has completed some
// verification.
const kycTierUnlocking = 1

// UserAccess is one user's effective module access, already intersected with what the
// environment publishes.
type UserAccess struct {
	// Modules the user may open and use.
	Modules []string `json:"modules"`
	// ComingSoon modules the user may SEE but not use. Carried through so the client
	// can render the teaser; a user with no access to a restricted module does not get
	// it here at all.
	ComingSoon []string `json:"comingSoon"`
	// KycTier is echoed so a client can explain WHY something is missing ("complete
	// verification to unlock") instead of silently hiding it.
	KycTier int `json:"kycTier"`
}

// grantedKeys returns the modules explicitly granted to a user and still in force —
// not revoked, not expired.
func (s *Service) grantedKeys(ctx context.Context, userID string) (map[string]struct{}, error) {
	const q = `
		SELECT module_key FROM user_module_grants
		 WHERE user_id = $1
		   AND revoked_at IS NULL
		   AND (expires_at IS NULL OR expires_at > NOW())`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]struct{}{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out[k] = struct{}{}
	}
	return out, rows.Err()
}

// userKycTier reads the profile tier. A missing profile is treated as tier 0 —
// "registered but unverified" — which is the safe reading, not an error.
func (s *Service) userKycTier(ctx context.Context, userID string) (int, error) {
	var tier *int
	err := s.db.QueryRow(ctx, `SELECT kyc_tier FROM user_profiles WHERE id = $1`, userID).Scan(&tier)
	if err != nil {
		// No row: unverified. Any other error is real and must not be silently
		// downgraded to tier 0, because that decides access.
		if err.Error() == "no rows in result set" {
			return 0, nil
		}
		return 0, fmt.Errorf("modules: read kyc tier: %w", err)
	}
	if tier == nil {
		return 0, nil
	}
	return *tier, nil
}

// AccessFor resolves what a specific user may use in this environment.
//
// Three gates compose, in this order:
//  1. the module must be PUBLISHED for the environment (registry + FEATURE_* flag);
//  2. 'general' modules are then open to any signed-in user;
//  3. 'restricted' modules need kyc_tier >= 1 OR a live admin grant.
//
// IMPORTANT — this decides MODULE ACCESS ONLY. It says nothing about money. Wallet
// debits, transfers and escrow continue to obey finance/tiers, so a Tier 0 user handed
// a grant can open a module and use its non-money features while still being unable to
// transact. That separation is deliberate: it lets support open a module without
// making an AML decision.
func (s *Service) AccessFor(ctx context.Context, userID string) (UserAccess, error) {
	all, err := s.List(ctx)
	if err != nil {
		return UserAccess{}, err
	}
	tier, err := s.userKycTier(ctx, userID)
	if err != nil {
		return UserAccess{}, err
	}
	grants, err := s.grantedKeys(ctx, userID)
	if err != nil {
		return UserAccess{}, err
	}

	acc := UserAccess{Modules: []string{}, ComingSoon: []string{}, KycTier: tier}
	for _, m := range all {
		visible, soon := m.VisibleIn(s.env), m.ComingSoonIn(s.env)
		if !visible && !soon {
			continue // not published for this environment — invisible to everyone
		}
		if !m.UserMayAccess(tier, grants) {
			continue
		}
		if visible {
			acc.Modules = append(acc.Modules, m.Key)
		} else {
			acc.ComingSoon = append(acc.ComingSoon, m.Key)
		}
	}
	return acc, nil
}

// UserMayAccess applies the access level to one user. Pure, so the precedence is
// testable without a database.
func (m Module) UserMayAccess(kycTier int, grants map[string]struct{}) bool {
	if m.AccessLevel != AccessRestricted {
		return true // 'general' (and any unset value) is open to signed-in users
	}
	if kycTier >= kycTierUnlocking {
		return true
	}
	_, granted := grants[m.Key]
	return granted
}

// Grant opens a restricted module for one user.
//
// expiresAt nil means permanent. Re-granting an existing row REVIVES it (clearing any
// revocation) rather than erroring, so an admin re-granting after a mistaken revoke
// converges instead of hitting the primary key.
func (s *Service) Grant(ctx context.Context, userID, moduleKey, adminID, note string, expiresAt *time.Time) error {
	const q = `
		INSERT INTO user_module_grants (user_id, module_key, expires_at, granted_by, note)
		VALUES ($1,$2,$3,NULLIF($4,'')::uuid,NULLIF($5,''))
		ON CONFLICT (user_id, module_key) DO UPDATE
		   SET revoked_at = NULL,
		       expires_at = EXCLUDED.expires_at,
		       granted_by = EXCLUDED.granted_by,
		       note       = EXCLUDED.note,
		       updated_at = NOW()`
	if _, err := s.db.Exec(ctx, q, userID, moduleKey, expiresAt, adminID, note); err != nil {
		return fmt.Errorf("modules: grant %s to %s: %w", moduleKey, userID, err)
	}
	return nil
}

// Revoke closes a grant. Soft — the row stays so "who had access when" is still
// answerable after an incident. Revoking a grant that does not exist is a no-op.
func (s *Service) Revoke(ctx context.Context, userID, moduleKey string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE user_module_grants SET revoked_at = NOW(), updated_at = NOW()
		  WHERE user_id = $1 AND module_key = $2 AND revoked_at IS NULL`,
		userID, moduleKey)
	return err
}

// ListGrants returns every grant row for a user, revoked and expired included, so the
// console can show history rather than only what is live right now.
func (s *Service) ListGrants(ctx context.Context, userID string) ([]GrantRow, error) {
	const q = `
		SELECT module_key, expires_at, revoked_at, granted_by::text, COALESCE(note,''), created_at
		  FROM user_module_grants WHERE user_id = $1 ORDER BY module_key`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GrantRow{}
	for rows.Next() {
		var g GrantRow
		if err := rows.Scan(&g.ModuleKey, &g.ExpiresAt, &g.RevokedAt, &g.GrantedBy, &g.Note, &g.CreatedAt); err != nil {
			return nil, err
		}
		g.Active = g.RevokedAt == nil && (g.ExpiresAt == nil || g.ExpiresAt.After(time.Now()))
		out = append(out, g)
	}
	return out, rows.Err()
}

// GrantRow is one grant as the admin console sees it.
type GrantRow struct {
	ModuleKey string     `json:"module_key"`
	Active    bool       `json:"active"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
	GrantedBy *string    `json:"granted_by,omitempty"`
	Note      string     `json:"note,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}
