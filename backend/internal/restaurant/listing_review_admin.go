package restaurant

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// RateOrderHonest → POST /restaurant/orders/:orderId/rate. Same contract as
// RateOrder but a duplicate submit is answered 409 with the existing review id
// (FOOD-UAT-G-002) rather than 201 with an id that was never stored.
func (h *Handler) RateOrderHonest(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req RateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	r, err := h.svc.RateOrder(c.Request.Context(), c.Param("orderId"), userID, req)
	if err != nil {
		var dup *DuplicateReviewError
		if errors.As(err, &dup) {
			c.JSON(http.StatusConflict, gin.H{keyError: dup.Error(), "id": dup.ExistingID, "existing_id": dup.ExistingID})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, r)
}

// AdminReview is a review as seen by a moderator (includes rater + audit trail).
type AdminReview struct {
	ID               string  `json:"id"`
	OrderID          string  `json:"order_id"`
	RestaurantID     string  `json:"restaurant_id"`
	RaterID          string  `json:"rater_id"`
	Stars            int     `json:"restaurant_stars"`
	Comment          string  `json:"comment,omitempty"`
	ModerationStatus string  `json:"moderation_status"`
	CreatedAt        string  `json:"created_at"`
	HiddenAt         *string `json:"hidden_at,omitempty"`
	HiddenBy         *string `json:"hidden_by,omitempty"`
	HiddenReason     *string `json:"hidden_reason,omitempty"`
	FlaggedAt        *string `json:"flagged_at,omitempty"`
}

// AdminReviewFilter narrows AdminListReviews. Zero values mean "no filter".
type AdminReviewFilter struct {
	RestaurantID string
	Status       string // visible|flagged|hidden
	Flagged      bool
	Limit        int
	Offset       int
}

// AdminListReviews returns reviews for moderators, newest first, plus the total.
func (s *Service) AdminListReviews(ctx context.Context, f AdminReviewFilter) ([]AdminReview, int, error) {
	if f.Status != "" && f.Status != "visible" && f.Status != "flagged" && f.Status != "hidden" {
		return nil, 0, errors.New("restaurant: status must be visible|flagged|hidden")
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 25
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	const where = `WHERE ($1 = '' OR restaurant_id::text = $1)
	                 AND ($2 = '' OR moderation_status = $2)
	                 AND (NOT $3 OR moderation_status = 'flagged')`
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM restaurant_ratings `+where,
		f.RestaurantID, f.Status, f.Flagged).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id::text, order_id::text, restaurant_id::text, rater_id::text, restaurant_stars,
		       COALESCE(comment,''), moderation_status, created_at::text,
		       hidden_at::text, hidden_by::text, hidden_reason, flagged_at::text
		  FROM restaurant_ratings `+where+`
		 ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
		f.RestaurantID, f.Status, f.Flagged, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AdminReview{}
	for rows.Next() {
		var r AdminReview
		if err := rows.Scan(&r.ID, &r.OrderID, &r.RestaurantID, &r.RaterID, &r.Stars, &r.Comment,
			&r.ModerationStatus, &r.CreatedAt, &r.HiddenAt, &r.HiddenBy, &r.HiddenReason, &r.FlaggedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// AdminSetReviewState applies action (hide|restore|flag) and records who/why.
// The star average is recomputed so hidden reviews never count.
func (s *Service) AdminSetReviewState(ctx context.Context, reviewID, adminID, action, reason string) error {
	var q string
	args := []any{reviewID}
	switch action {
	case "hide":
		q = `UPDATE restaurant_ratings SET moderation_status='hidden', hidden_at=now(), hidden_by=NULLIF($2,'')::uuid, hidden_reason=NULLIF($3,'')
		      WHERE id=$1 RETURNING restaurant_id`
		args = append(args, adminID, reason)
	case "restore":
		q = `UPDATE restaurant_ratings SET moderation_status='visible', hidden_at=NULL, hidden_by=NULL, hidden_reason=NULL
		      WHERE id=$1 RETURNING restaurant_id`
	case "flag":
		q = `UPDATE restaurant_ratings SET moderation_status='flagged', flagged_at=now()
		      WHERE id=$1 AND moderation_status <> 'hidden' RETURNING restaurant_id`
	default:
		return errors.New("restaurant: unknown review action")
	}
	var restaurantID string
	if err := s.db.QueryRow(ctx, q, args...).Scan(&restaurantID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("restaurant: review not found")
		}
		return fmt.Errorf("restaurant: moderate review: %w", err)
	}
	s.recomputeRestaurantRating(ctx, restaurantID)
	return nil
}

// AdminListReviews → GET /api/restaurant/admin/reviews (restaurant.admin.reviews).
func (h *Handler) AdminListReviews(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	flagged := strings.EqualFold(c.Query("flagged"), "true") || c.Query("flagged") == "1"
	items, total, err := h.svc.AdminListReviews(c.Request.Context(), AdminReviewFilter{
		RestaurantID: c.Query("restaurant_id"), Status: c.Query("status"), Flagged: flagged, Limit: limit, Offset: offset,
	})
	if err != nil {
		code := http.StatusInternalServerError
		if strings.Contains(err.Error(), "must be") {
			code = http.StatusBadRequest
		}
		c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "limit": max(1, min(100, func() int {
		if limit <= 0 {
			return 25
		}
		return limit
	}())), "offset": max(0, offset)})
}

func (h *Handler) adminReviewAction(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Reason string `json:"reason"`
		}
		_ = c.ShouldBindJSON(&body)
		if err := h.svc.AdminSetReviewState(c.Request.Context(), c.Param("id"), ginutil.UserID(c), action, strings.TrimSpace(body.Reason)); err != nil {
			code := http.StatusInternalServerError
			if strings.Contains(err.Error(), "not found") {
				code = http.StatusNotFound
			}
			c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "action": action, "ok": true})
	}
}

// AdminHideReview / AdminRestoreReview / AdminFlagReview →
// POST /api/restaurant/admin/reviews/:id/{hide,restore,flag}.
func (h *Handler) AdminHideReview(c *gin.Context)    { h.adminReviewAction("hide")(c) }
func (h *Handler) AdminRestoreReview(c *gin.Context) { h.adminReviewAction("restore")(c) }
func (h *Handler) AdminFlagReview(c *gin.Context)    { h.adminReviewAction("flag")(c) }
