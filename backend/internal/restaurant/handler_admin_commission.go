package restaurant

// FOOD-UAT-F-003 admin routes (RBAC restaurant.admin.commission):
//   GET    /api/restaurant/admin/commission
//   PUT    /api/restaurant/admin/commission
//   DELETE /api/restaurant/admin/commission/:restaurantId

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// CommissionConfigRow is one restaurant_commission_config row as listed to admins.
type CommissionConfigRow struct {
	RestaurantID  *string   `json:"restaurant_id"` // nil = global default
	ProviderBps   int       `json:"provider_split_bps"`
	RiderBps      int       `json:"rider_split_bps"`
	PlatformBps   int       `json:"platform_split_bps"`
	EffectiveFrom time.Time `json:"effective_from"`
	CreatedBy     *string   `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
}

// ErrCommissionInvalid marks a malformed commission request (→ 422).
var ErrCommissionInvalid = errors.New("restaurant: invalid commission config")

// AdminListCommission returns the global default followed by every override.
func (s *Service) AdminListCommission(ctx context.Context) ([]CommissionConfigRow, error) {
	rows, err := s.db.Query(ctx, `
		SELECT restaurant_id::text, provider_split_bps, rider_split_bps, platform_split_bps,
		       effective_from, created_by::text, created_at
		  FROM restaurant_commission_config
		 ORDER BY (restaurant_id IS NOT NULL), created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CommissionConfigRow{}
	for rows.Next() {
		var r CommissionConfigRow
		if err := rows.Scan(&r.RestaurantID, &r.ProviderBps, &r.RiderBps, &r.PlatformBps, &r.EffectiveFrom, &r.CreatedBy, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AdminSetCommission upserts the global (restaurantID == "") or a per-restaurant split.
func (s *Service) AdminSetCommission(ctx context.Context, adminID, restaurantID string, split CommissionSplit) error {
	if err := split.Valid(); err != nil {
		return errors.Join(ErrCommissionInvalid, err)
	}
	if restaurantID != "" {
		if _, err := uuid.Parse(restaurantID); err != nil {
			return errors.Join(ErrCommissionInvalid, errors.New("restaurant_id must be a UUID"))
		}
	}
	var by any
	if _, err := uuid.Parse(adminID); err == nil {
		by = adminID
	}
	var rid any
	if restaurantID != "" {
		rid = restaurantID
	}
	prev, _ := s.loadCommissionSplit(ctx, restaurantID)
	_, err := s.db.Exec(ctx, `
		INSERT INTO restaurant_commission_config (restaurant_id, provider_split_bps, rider_split_bps, platform_split_bps, effective_from, created_by)
		VALUES ($1, $2, $3, $4, now(), $5)
		ON CONFLICT ((COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)))
		DO UPDATE SET provider_split_bps = EXCLUDED.provider_split_bps,
		              rider_split_bps    = EXCLUDED.rider_split_bps,
		              platform_split_bps = EXCLUDED.platform_split_bps,
		              effective_from     = EXCLUDED.effective_from,
		              created_by         = EXCLUDED.created_by,
		              created_at         = now()`,
		rid, split.ProviderBps, split.RiderBps, split.PlatformBps, by)
	if err != nil {
		return err
	}
	s.InvalidateCommissionCache()
	s.auditCommission(adminID, "restaurant.commission.set", restaurantID, prev, split)
	return nil
}

// AdminDeleteCommission removes a per-restaurant override (falls back to global).
// The global default row cannot be deleted. Returns false when no override existed.
func (s *Service) AdminDeleteCommission(ctx context.Context, adminID, restaurantID string) (bool, error) {
	if _, err := uuid.Parse(restaurantID); err != nil {
		return false, errors.Join(ErrCommissionInvalid, errors.New("restaurant_id must be a UUID"))
	}
	prev, _ := s.loadCommissionSplit(ctx, restaurantID)
	tag, err := s.db.Exec(ctx, `DELETE FROM restaurant_commission_config WHERE restaurant_id = $1`, restaurantID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	s.InvalidateCommissionCache()
	s.auditCommission(adminID, "restaurant.commission.delete", restaurantID, prev, DefaultCommissionSplit)
	return true, nil
}

func (s *Service) auditCommission(adminID, action, restaurantID string, old, nw CommissionSplit) {
	if s.audit == nil {
		return
	}
	target := restaurantID
	if target == "" {
		target = "global"
	}
	s.audit.LogAction(adminID, "", action, "restaurant", "restaurant_commission_config", target,
		map[string]any{"provider_split_bps": old.ProviderBps, "rider_split_bps": old.RiderBps, "platform_split_bps": old.PlatformBps},
		map[string]any{"provider_split_bps": nw.ProviderBps, "rider_split_bps": nw.RiderBps, "platform_split_bps": nw.PlatformBps},
		"", "", "warning")
}

func commissionErrCode(err error) int {
	if errors.Is(err, ErrCommissionInvalid) {
		return http.StatusUnprocessableEntity
	}
	return http.StatusInternalServerError
}

// AdminListCommission → GET /api/restaurant/admin/commission.
func (h *Handler) AdminListCommission(c *gin.Context) {
	rows, err := h.svc.AdminListCommission(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"commission": rows, "default_builtin": DefaultCommissionSplit})
}

// AdminPutCommission → PUT /api/restaurant/admin/commission. Body
// {restaurant_id?: uuid (omit = global), provider_split_bps, rider_split_bps, platform_split_bps}.
func (h *Handler) AdminPutCommission(c *gin.Context) {
	var body struct {
		RestaurantID string `json:"restaurant_id"`
		ProviderBps  *int   `json:"provider_split_bps" binding:"required"`
		RiderBps     *int   `json:"rider_split_bps" binding:"required"`
		PlatformBps  *int   `json:"platform_split_bps" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	split := CommissionSplit{ProviderBps: *body.ProviderBps, RiderBps: *body.RiderBps, PlatformBps: *body.PlatformBps}
	if err := h.svc.AdminSetCommission(c.Request.Context(), ginutil.UserID(c), body.RestaurantID, split); err != nil {
		code := commissionErrCode(err)
		c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

// AdminDeleteCommission → DELETE /api/restaurant/admin/commission/:restaurantId.
func (h *Handler) AdminDeleteCommission(c *gin.Context) {
	removed, err := h.svc.AdminDeleteCommission(c.Request.Context(), ginutil.UserID(c), c.Param("restaurantId"))
	if err != nil {
		code := commissionErrCode(err)
		c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
		return
	}
	if !removed {
		c.JSON(http.StatusNotFound, gin.H{keyError: "no override for that restaurant"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": true})
}
