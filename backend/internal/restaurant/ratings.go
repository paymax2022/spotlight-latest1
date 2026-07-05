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

	r := &OrderRating{
		ID:              uuid.New().String(),
		OrderID:         orderID,
		RaterID:         raterID,
		RestaurantID:    restaurantID,
		RestaurantStars: req.RestaurantStars,
		RiderStars:      req.RiderStars,
		Comment:         req.Comment,
	}
	if riderPtr != nil {
		r.RiderID = *riderPtr
	}

	const ins = `INSERT INTO restaurant_ratings
	    (id, order_id, rater_id, restaurant_id, restaurant_stars, rider_id, rider_stars, comment)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''))
	    ON CONFLICT (order_id, rater_id) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins,
		r.ID, orderID, raterID, restaurantID, req.RestaurantStars, riderPtr, req.RiderStars, req.Comment); err != nil {
		return nil, err
	}

	s.recomputeRestaurantRating(ctx, restaurantID)
	return r, nil
}

// recomputeRestaurantRating recalculates a restaurant's average rating from its
// received restaurant_stars and writes it back to the restaurants.rating column.
func (s *Service) recomputeRestaurantRating(ctx context.Context, restaurantID string) {
	var avg float64
	s.db.QueryRow(ctx,
		`SELECT COALESCE(AVG(restaurant_stars),5.0) FROM restaurant_ratings WHERE restaurant_id=$1`,
		restaurantID).Scan(&avg)
	s.db.Exec(ctx, `UPDATE restaurants SET rating=$1, updated_at=NOW() WHERE id=$2`, avg, restaurantID)
}
