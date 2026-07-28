package restaurant

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// RateOrderRequest rates the restaurant and (if present) the rider for a
// delivered order. Stars are 1..5.
type RateOrderRequest struct {
	RestaurantStars int    `json:"restaurant_stars" binding:"required,min=1,max=5"`
	RiderStars      *int   `json:"rider_stars,omitempty"`
	Comment         string `json:"comment"`
}

// OrderRating is a persisted rating record.
type OrderRating struct {
	ID              string `json:"id"`
	OrderID         string `json:"order_id"`
	RaterID         string `json:"rater_id"`
	RestaurantID    string `json:"restaurant_id"`
	RestaurantStars int    `json:"restaurant_stars"`
	RiderID         string `json:"rider_id,omitempty"`
	RiderStars      *int   `json:"rider_stars,omitempty"`
	Comment         string `json:"comment,omitempty"`
}

// RateOrder records the customer's rating of the restaurant and (optionally) the
// rider for a delivered order, then recomputes the restaurant's average rating.
// Only the order's customer may rate, and only once the order is delivered.
func (s *Service) RateOrder(ctx context.Context, orderID, raterID string, req RateOrderRequest) (*OrderRating, error) {
	var customerID, restaurantID, status string
	var riderPtr *string
	const q = `SELECT customer_id, restaurant_id, rider_id, status FROM orders WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&customerID, &restaurantID, &riderPtr, &status); err != nil {
		return nil, fmt.Errorf("restaurant: order not found")
	}
	if raterID != customerID {
		return nil, fmt.Errorf("restaurant: only the customer may rate this order")
	}
	if status != string(OrderDelivered) {
		return nil, fmt.Errorf("restaurant: order is not delivered yet")
	}

	// Sanitize the free-text comment (SEC-007) and auto-flag abusive content for a
	// moderator (RV-004) — flagged reviews stay visible until a human hides them, so a
	// false positive never silently suppresses a legitimate review.
	comment := sanitizeReviewComment(req.Comment)
	moderation := autoFlagComment(comment)
	r := &OrderRating{
		ID:              uuid.New().String(),
		OrderID:         orderID,
		RaterID:         raterID,
		RestaurantID:    restaurantID,
		RestaurantStars: req.RestaurantStars,
		RiderStars:      req.RiderStars,
		Comment:         comment,
	}
	if riderPtr != nil {
		r.RiderID = *riderPtr
	}

	const ins = `INSERT INTO restaurant_ratings
	    (id, order_id, rater_id, restaurant_id, restaurant_stars, rider_id, rider_stars, comment, moderation_status)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9)
	    ON CONFLICT (order_id, rater_id) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins,
		r.ID, orderID, raterID, restaurantID, req.RestaurantStars, riderPtr, req.RiderStars, comment, moderation); err != nil {
		return nil, err
	}

	s.recomputeRestaurantRating(ctx, restaurantID)
	return r, nil
}

// recomputeRestaurantRating recalculates a restaurant's average rating from its
// received restaurant_stars and writes it back to the restaurants.rating column.
func (s *Service) recomputeRestaurantRating(ctx context.Context, restaurantID string) {
	var avg float64
	// Hidden (moderated-away) reviews are excluded so a suppressed fake review can't
	// skew the average.
	s.db.QueryRow(ctx,
		`SELECT COALESCE(AVG(restaurant_stars),5.0) FROM restaurant_ratings WHERE restaurant_id=$1 AND moderation_status <> 'hidden'`,
		restaurantID).Scan(&avg)
	s.db.Exec(ctx, `UPDATE restaurants SET rating=$1, updated_at=NOW() WHERE id=$2`, avg, restaurantID)
}

// PublicReview is a review as shown publicly — anonymized (no rater identity, SEC-009)
// and moderation-filtered.
type PublicReview struct {
	Stars     int    `json:"stars"`
	Comment   string `json:"comment,omitempty"`
	CreatedAt string `json:"created_at"`
}

// ListReviews returns a restaurant's public reviews: hidden ones are excluded and the
// rater identity is never exposed. Newest first.
func (s *Service) ListReviews(ctx context.Context, restaurantID string) ([]PublicReview, error) {
	rows, err := s.db.Query(ctx,
		`SELECT restaurant_stars, COALESCE(comment,''), created_at::text
		 FROM restaurant_ratings
		 WHERE restaurant_id=$1 AND moderation_status <> 'hidden'
		 ORDER BY created_at DESC LIMIT 100`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PublicReview{}
	for rows.Next() {
		var r PublicReview
		if err := rows.Scan(&r.Stars, &r.Comment, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ModerateReview sets a review's moderation status (RV-004). Intended for platform ops
// (route fail-closed behind restaurant.admin.onboarding). Recomputes the rating when a
// review is hidden/unhidden so the average reflects only visible reviews.
func (s *Service) ModerateReview(ctx context.Context, reviewID, status string) error {
	if status != "visible" && status != "flagged" && status != "hidden" {
		return fmt.Errorf("restaurant: moderation status must be visible|flagged|hidden")
	}
	var restaurantID string
	if err := s.db.QueryRow(ctx,
		`UPDATE restaurant_ratings SET moderation_status=$1 WHERE id=$2 RETURNING restaurant_id`,
		status, reviewID).Scan(&restaurantID); err != nil {
		return fmt.Errorf("restaurant: review not found")
	}
	s.recomputeRestaurantRating(ctx, restaurantID)
	return nil
}
