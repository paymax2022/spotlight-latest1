package referrals

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/httperr"
)

// ReferredBy answers "who referred this user" for the admin user profile.
//
// Every user is meant to be connected to a referrer: a real one when they signed up
// with a code, otherwise the house (Admin) account. A user with NO attribution row
// is reported as not attributed rather than being given a made-up referrer; the
// house sweep (AssignHouseToUnattributed) is what closes that gap.
type ReferredBy struct {
	UserID     string `json:"user_id"`
	Attributed bool   `json:"attributed"`
	// IsHouse is true when the referrer is the house (Admin) account, not a person.
	IsHouse         bool       `json:"is_house"`
	AttributionID   string     `json:"attribution_id,omitempty"`
	AttributionType string     `json:"attribution_type,omitempty"` // code | deeplink | context | regional_house | global_house
	Status          string     `json:"status,omitempty"`           // grace | locked
	CodeUsed        string     `json:"code_used,omitempty"`
	AttributedAt    *time.Time `json:"attributed_at,omitempty"`

	ReferrerID    string `json:"referrer_id,omitempty"`
	ReferrerName  string `json:"referrer_name,omitempty"`
	ReferrerEmail string `json:"referrer_email,omitempty"`
	ReferrerCode  string `json:"referrer_code,omitempty"`

	HouseAccountID string `json:"house_account_id,omitempty"`
	HouseCode      string `json:"house_code,omitempty"`
	HouseOwnerID   string `json:"house_owner_id,omitempty"`
	HouseOwnerName string `json:"house_owner_name,omitempty"`
}

// ReferredBy loads the user's attribution and, for a real referrer, their name and
// referral code (the engine's referral_links code, else the legacy one).
func (s *RewardService) ReferredBy(ctx context.Context, userID string) (*ReferredBy, error) {
	out := &ReferredBy{UserID: userID}
	const q = `
		SELECT a.id::text, COALESCE(a.referrer_id::text, ''), COALESCE(a.house_account_id::text, ''),
		       a.attribution_type, COALESCE(a.code_used, ''), a.is_house, a.status, a.created_at,
		       COALESCE(ru.full_name, ''), COALESCE(ru.email, ''),
		       COALESCE(rl.code, fc.code, ''),
		       COALESCE(h.code, ''), COALESCE(h.owner_user_id::text, ''), COALESCE(hu.full_name, '')
		FROM referral_attributions a
		LEFT JOIN user_profiles ru ON ru.id = a.referrer_id
		LEFT JOIN referral_links rl ON rl.referrer_id = a.referrer_id
		LEFT JOIN finance_referral_codes fc ON fc.user_id = a.referrer_id
		LEFT JOIN referral_house_accounts h ON h.id = a.house_account_id
		LEFT JOIN user_profiles hu ON hu.id = h.owner_user_id
		WHERE a.referred_user_id = $1
		LIMIT 1`
	var at time.Time
	err := s.db.QueryRow(ctx, q, userID).Scan(
		&out.AttributionID, &out.ReferrerID, &out.HouseAccountID,
		&out.AttributionType, &out.CodeUsed, &out.IsHouse, &out.Status, &at,
		&out.ReferrerName, &out.ReferrerEmail,
		&out.ReferrerCode,
		&out.HouseCode, &out.HouseOwnerID, &out.HouseOwnerName)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return nil, fmt.Errorf("referrals: referred-by lookup: %w", err)
	}
	out.Attributed = true
	out.AttributedAt = &at
	return out, nil
}

// HouseSweepOpts configures AssignHouseToUnattributed.
type HouseSweepOpts struct {
	// HouseAccountID is the house (Admin) account unattributed users are connected to.
	HouseAccountID string
	// MinAge leaves very new users alone: signup attributes them itself, and a row
	// written first would make that attribution a no-op.
	MinAge time.Duration
	// GraceWindow is the late-claim window. A user still inside it stays claimable
	// (status grace) so they can still enter a code; an older one is locked.
	GraceWindow time.Duration
	// Limit bounds one run.
	Limit int
	// OnlyUserIDs restricts the run to these users (tests, targeted repair). Nil
	// means everyone.
	OnlyUserIDs []string
}

// AssignHouseToUnattributed connects every user without a referral_attributions row
// to the house (Admin) account, so every user has a referrer. It never touches a
// user who already has a row, and is idempotent. Returns how many users it connected.
//
// The roster is public.user_profiles. A house attribution is notional: it has no
// human referrer, so the rewards engine pays nobody for it.
func (s *RewardService) AssignHouseToUnattributed(ctx context.Context, o HouseSweepOpts) (int64, error) {
	if o.HouseAccountID == "" {
		return 0, errors.New("referrals: house sweep requires a house account")
	}
	if o.Limit <= 0 {
		o.Limit = 500
	}
	const q = `
		INSERT INTO referral_attributions
			(referred_user_id, house_account_id, attribution_type, is_house, status, grace_expires_at)
		SELECT up.id, $1::uuid, 'global_house', true,
		       CASE WHEN COALESCE(up.created_at, 'epoch'::timestamptz) + make_interval(secs => $3) > now()
		            THEN 'grace' ELSE 'locked' END,
		       CASE WHEN COALESCE(up.created_at, 'epoch'::timestamptz) + make_interval(secs => $3) > now()
		            THEN up.created_at + make_interval(secs => $3) END
		FROM user_profiles up
		WHERE COALESCE(up.created_at, 'epoch'::timestamptz) < now() - make_interval(secs => $2)
		  AND ($5::uuid[] IS NULL OR up.id = ANY($5::uuid[]))
		  AND NOT EXISTS (SELECT 1 FROM referral_attributions a WHERE a.referred_user_id = up.id)
		ORDER BY up.created_at NULLS FIRST
		LIMIT $4
		ON CONFLICT (referred_user_id) DO NOTHING`
	var only any // nil -> SQL NULL
	if o.OnlyUserIDs != nil {
		only = o.OnlyUserIDs
	}
	tag, err := s.db.Exec(ctx, q, o.HouseAccountID, o.MinAge.Seconds(), o.GraceWindow.Seconds(), o.Limit, only)
	if err != nil {
		return 0, fmt.Errorf("referrals: house sweep: %w", err)
	}
	return tag.RowsAffected(), nil
}

// ReferredByReader is the read seam AdminGetReferredBy needs (satisfied by *RewardService).
type ReferredByReader interface {
	ReferredBy(ctx context.Context, userID string) (*ReferredBy, error)
}

// AdminGetReferredBy handles GET /finance/admin/referrals/:user_id/referred-by.
func AdminGetReferredBy(r ReferredByReader) gin.HandlerFunc {
	return func(c *gin.Context) {
		v, err := r.ReferredBy(c.Request.Context(), c.Param("user_id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		c.JSON(http.StatusOK, v)
	}
}
