package restaurant

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// FOOD-UAT-H-002 rollout gap: every restaurant that existed before permit expiry
// shipped has permit_expires_at IS NULL, and PermitValidFor treats NULL as "no permit
// on file" — so none of them could be re-opened after deploy. BackfillNullPermits is
// the one-shot ops tool that stamps a default expiry on those rows.

// permitBackfillMaxRows is the safety ceiling for one backfill call. A larger fleet
// needs a deliberate second call, so a fat-fingered date can't touch the whole table
// in a single request.
const permitBackfillMaxRows = 10000

// BackfillNullPermits stamps defaultExpiresAt on up to permitBackfillMaxRows currently
// OPEN restaurants whose permit_expires_at is NULL and audits every row. defaultExpiresAt
// must be in the future (otherwise the sweeper would immediately close them again).
// Returns the ids touched.
func (s *Service) BackfillNullPermits(ctx context.Context, adminID string, defaultExpiresAt, now time.Time) ([]string, error) {
	if !defaultExpiresAt.After(now) {
		return nil, fmt.Errorf("restaurant: default_expires_at must be in the future")
	}
	rows, err := s.db.Query(ctx, `
		WITH target AS (
		  SELECT id FROM restaurants
		   WHERE permit_expires_at IS NULL AND is_open = TRUE
		   ORDER BY id
		   LIMIT $2
		   FOR UPDATE SKIP LOCKED
		)
		UPDATE restaurants r
		   SET permit_expires_at = $1, updated_at = NOW()
		  FROM target
		 WHERE r.id = target.id
		RETURNING r.id::text`, defaultExpiresAt, permitBackfillMaxRows)
	if err != nil {
		return nil, fmt.Errorf("restaurant: permit backfill: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return ids, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return ids, err
	}
	if s.audit != nil {
		for _, id := range ids {
			s.audit.LogAction(adminID, "", "restaurant.permit.backfilled", "restaurant", "restaurant", id,
				map[string]any{"permit_expires_at": nil},
				map[string]any{"permit_expires_at": defaultExpiresAt}, "", "", "warning")
		}
	}
	return ids, nil
}

// AdminBackfillNullPermits → POST /api/restaurant/admin/permits/backfill-null
// ?default_expires_at=<RFC3339> (restaurant.admin.onboarding).
func (h *Handler) AdminBackfillNullPermits(c *gin.Context) {
	raw := strings.TrimSpace(c.Query("default_expires_at"))
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "default_expires_at (RFC3339) is required"})
		return
	}
	exp, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "default_expires_at must be an RFC3339 timestamp"})
		return
	}
	ids, err := h.svc.BackfillNullPermits(c.Request.Context(), ginutil.UserID(c), exp, time.Now())
	if err != nil {
		st := http.StatusInternalServerError
		if strings.Contains(err.Error(), "must be in the future") {
			st = http.StatusBadRequest
		}
		c.JSON(st, gin.H{keyError: httperr.Msg(c, st, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"updated":           len(ids),
		"restaurant_ids":    ids,
		"permit_expires_at": exp,
		"ceiling":           permitBackfillMaxRows,
		"truncated":         len(ids) >= permitBackfillMaxRows,
	})
}
