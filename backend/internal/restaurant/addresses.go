package restaurant

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// SavedAddress is a customer's reusable delivery address (GEO-001/005/006).
type SavedAddress struct {
	ID        string   `json:"id"`
	Label     string   `json:"label"`
	Address   string   `json:"address"`
	Lat       *float64 `json:"lat,omitempty"`
	Lng       *float64 `json:"lng,omitempty"`
	IsDefault bool     `json:"is_default"`
}

// validateAddress checks the required fields + coordinate ranges (GEO-001). Coordinates
// are optional (geocoding may fill them later) but, if present, must be on-globe.
func validateAddress(a SavedAddress) error {
	if l := strings.TrimSpace(a.Label); l == "" || len(l) > 60 {
		return fmt.Errorf("restaurant: address label must be 1–60 chars")
	}
	if ad := strings.TrimSpace(a.Address); len(ad) < 3 || len(ad) > 300 {
		return fmt.Errorf("restaurant: address must be 3–300 chars")
	}
	if a.Lat != nil && (*a.Lat < -90 || *a.Lat > 90) {
		return fmt.Errorf("restaurant: lat out of range")
	}
	if a.Lng != nil && (*a.Lng < -180 || *a.Lng > 180) {
		return fmt.Errorf("restaurant: lng out of range")
	}
	return nil
}

// AddAddress saves a delivery address for a customer. The first address (or one flagged
// default) becomes the default; setting a new default clears the previous one so the
// one-default invariant holds.
func (s *Service) AddAddress(ctx context.Context, userID string, a SavedAddress) (*SavedAddress, error) {
	if err := validateAddress(a); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM customer_addresses WHERE user_id=$1`, userID).Scan(&count); err != nil {
		return nil, err
	}
	makeDefault := a.IsDefault || count == 0 // first address is the default
	if makeDefault {
		if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default=FALSE WHERE user_id=$1 AND is_default`, userID); err != nil {
			return nil, err
		}
	}
	a.ID = uuid.New().String()
	a.IsDefault = makeDefault
	if _, err := tx.Exec(ctx,
		`INSERT INTO customer_addresses (id, user_id, label, address, lat, lng, is_default)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		a.ID, userID, strings.TrimSpace(a.Label), strings.TrimSpace(a.Address), a.Lat, a.Lng, a.IsDefault); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &a, nil
}

// ListAddresses returns a customer's saved addresses, default first.
func (s *Service) ListAddresses(ctx context.Context, userID string) ([]SavedAddress, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, label, address, lat, lng, is_default FROM customer_addresses
		 WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SavedAddress{}
	for rows.Next() {
		var a SavedAddress
		if err := rows.Scan(&a.ID, &a.Label, &a.Address, &a.Lat, &a.Lng, &a.IsDefault); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// SetDefaultAddress marks one of the customer's addresses as default (object-level authz
// via the user_id predicate) and clears the previous default in one transaction.
func (s *Service) SetDefaultAddress(ctx context.Context, userID, addressID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `SELECT 1 FROM customer_addresses WHERE id=$1 AND user_id=$2`, addressID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("restaurant: address not found")
	}
	if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default=FALSE WHERE user_id=$1 AND is_default`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default=TRUE, updated_at=now() WHERE id=$1 AND user_id=$2`, addressID, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteAddress removes a customer's saved address.
func (s *Service) DeleteAddress(ctx context.Context, userID, addressID string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM customer_addresses WHERE id=$1 AND user_id=$2`, addressID, userID)
	return err
}
