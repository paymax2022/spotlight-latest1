package restaurant

import (
	"context"
	"errors"
)

// sqlStater matches a pgx-wrapped *pgconn.PgError without importing pgconn —
// mirrors marketplace's identical helper (internal/marketplace/repository.go);
// not shared across packages since neither exports it.
type sqlStater interface{ SQLState() string }

// isUniqueViolation reports whether err is a Postgres 23505 unique_violation.
func isUniqueViolation(err error) bool {
	var pgErr sqlStater
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}

// LikeRestaurant records callerUserID liking restaurantID. Idempotent: liking
// twice is not an error, same as marketplace's InsertFollow — the caller only
// ever expresses "I like this", never "increment a counter".
func (s *Service) LikeRestaurant(ctx context.Context, callerUserID, restaurantID string) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO restaurant_likes (user_id, restaurant_id) VALUES ($1, $2)`,
		callerUserID, restaurantID)
	if err != nil {
		if isUniqueViolation(err) {
			return nil // already liked — idempotent, not an error
		}
		return err
	}
	return nil
}

// UnlikeRestaurant removes callerUserID's like, if any. Idempotent: unliking
// something never liked (or already unliked) is a no-op, not an error.
func (s *Service) UnlikeRestaurant(ctx context.Context, callerUserID, restaurantID string) error {
	_, err := s.db.Exec(ctx,
		`DELETE FROM restaurant_likes WHERE user_id = $1 AND restaurant_id = $2`,
		callerUserID, restaurantID)
	return err
}
