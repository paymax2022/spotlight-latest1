package kycverify

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/provider"
)

// A higher tier is meant to add independent evidence, not repeat the evidence
// already given. Once an ID type (BVN, NIN, passport…) has PASSED an ID-number
// check for a lower tier, the same type cannot be submitted again for a higher
// tier — the user must supply a different one.

// ErrIDTypeAlreadyUsed — the ID type already passed verification for a lower
// tier of this user. 409.
var ErrIDTypeAlreadyUsed = errors.New("kycverify: this ID type was already used for a previous verification tier; use a different ID")

func normIDType(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// idTypeAlreadyUsed reports whether idType is among the previously verified
// types. An empty idType never matches (the provider call rejects it anyway).
func idTypeAlreadyUsed(used []string, idType string) bool {
	want := normIDType(idType)
	if want == "" {
		return false
	}
	for _, u := range used {
		if normIDType(u) == want {
			return true
		}
	}
	return false
}

// UsedIDTypes returns the distinct ID types (lowercase) that PASSED an
// ID-number check in this user's sessions for a tier BELOW targetTier. Sessions
// at the same tier are excluded so a retry within the tier can reuse its own ID.
func (r *Repository) UsedIDTypes(ctx context.Context, userID string, targetTier int) ([]string, error) {
	const q = `
		SELECT DISTINCT lower(c.extracted_fields->>$4)
		FROM verification_check c
		JOIN verification_session s ON s.id = c.session_id
		WHERE c.user_id = $1
		  AND c.type = $2
		  AND c.status = $3
		  AND s.target_tier < $5
		  AND coalesce(c.extracted_fields->>$4, '') <> ''`
	rows, err := r.db.Query(ctx, q, userID, string(provider.KycIDNumber), string(provider.KycPassed), idTypeField, targetTier)
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: used id types: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("kycverify repo: scan used id type: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// UsedIDTypes is the service-level read used by GET /kyc/ids/used.
func (s *Service) UsedIDTypes(ctx context.Context, userID string, targetTier int) ([]string, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if targetTier < 1 || targetTier > 3 {
		return nil, ErrInvalidTier
	}
	return s.repo.UsedIDTypes(ctx, userID, targetTier)
}

// guardIDTypeReuse rejects an ID-number check whose type already passed for a
// lower tier. Fails closed: if the history cannot be read the check is refused.
func (s *Service) guardIDTypeReuse(ctx context.Context, userID string, targetTier int, idType string) error {
	if targetTier <= 1 {
		return nil
	}
	used, err := s.repo.UsedIDTypes(ctx, userID, targetTier)
	if err != nil {
		return err
	}
	if idTypeAlreadyUsed(used, idType) {
		return ErrIDTypeAlreadyUsed
	}
	return nil
}

// UsedIDTypes handles GET /api/finance/kyc/ids/used?target_tier=N
func (h *Handler) UsedIDTypes(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	tier, err := strconv.Atoi(c.Query("target_tier"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "target_tier required"})
		return
	}
	used, err := h.svc.UsedIDTypes(c.Request.Context(), uid, tier)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id_types": used})
}
