package social

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/services"
)

const maxContactMatchPhones = 500

// ContactMatch is a device-contact phone number that belongs to a Paymax user
// who has claimed a cashtag. Users without a cashtag are never returned, so a
// phone number alone cannot be used to enumerate accounts.
type ContactMatch struct {
	Phone  string `json:"phone"` // the NSN the caller sent, normalised
	Handle string `json:"handle"`
	Name   string `json:"display_name"`
}

// MatchContacts maps normalised phone numbers to cashtag holders, excluding the caller.
func (s *Service) MatchContacts(ctx context.Context, callerID string, phones []string) ([]ContactMatch, error) {
	seen := make(map[string]struct{}, len(phones))
	nsns := make([]string, 0, len(phones))
	for _, p := range phones {
		n := services.NormalizePhone(p)
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		nsns = append(nsns, n)
	}
	out := []ContactMatch{}
	if len(nsns) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT right(regexp_replace(COALESCE(up.phone,''), '\D', '', 'g'), 10) AS nsn,
		       ch.handle,
		       COALESCE(NULLIF(trim(up.full_name), ''), ch.handle)
		  FROM public.user_profiles up
		  JOIN public.cashtag_handles ch ON ch.user_id = up.id
		 WHERE right(regexp_replace(COALESCE(up.phone,''), '\D', '', 'g'), 10) = ANY($1)
		   AND up.id::text <> $2`, nsns, callerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m ContactMatch
		if err := rows.Scan(&m.Phone, &m.Handle, &m.Name); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (h *Handler) MatchContacts(c *gin.Context) {
	var req struct {
		Phones []string `json:"phones"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Phones) == 0 || len(req.Phones) > maxContactMatchPhones {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "phones: 1-500 numbers required"})
		return
	}
	matches, err := h.svc.MatchContacts(c.Request.Context(), ginutil.UserID(c), req.Phones)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "matches": matches})
}
