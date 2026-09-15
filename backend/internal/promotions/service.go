package promotions

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// ListActiveBanners returns all active banners for a given module, ordered by priority.
func (s *Service) ListActiveBanners(ctx context.Context, module string) ([]Banner, error) {
	const q = `
		SELECT id, title, description, image_url, action_link, action_label,
		       module, priority, start_date, end_date, is_active, created_at, updated_at
		FROM promotions_banners
		WHERE module = $1
		  AND is_active = true
		  AND start_date <= NOW()
		  AND end_date > NOW()
		ORDER BY priority DESC, created_at DESC`

	rows, err := s.db.Query(ctx, q, module)
	if err != nil {
		return nil, fmt.Errorf("query banners: %w", err)
	}
	defer rows.Close()

	var banners []Banner
	for rows.Next() {
		var b Banner
		if err := rows.Scan(&b.ID, &b.Title, &b.Description, &b.ImageURL, &b.ActionLink,
			&b.ActionLabel, &b.Module, &b.Priority, &b.StartDate, &b.EndDate, &b.IsActive,
			&b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan banner: %w", err)
		}
		banners = append(banners, b)
	}
	return banners, rows.Err()
}

// CreateBanner creates a new promotional banner (admin only).
func (s *Service) CreateBanner(ctx context.Context, input BannerInput) (*Banner, error) {
	const q = `
		INSERT INTO promotions_banners
		(id, title, description, image_url, action_link, action_label, module, priority,
		 start_date, end_date, is_active, created_at, updated_at)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
		RETURNING id, title, description, image_url, action_link, action_label, module, priority,
		          start_date, end_date, is_active, created_at, updated_at`

	var b Banner
	if err := s.db.QueryRow(ctx, q, input.Title, input.Description, input.ImageURL,
		input.ActionLink, input.ActionLabel, input.Module, input.Priority,
		input.StartDate, input.EndDate, input.IsActive).Scan(
		&b.ID, &b.Title, &b.Description, &b.ImageURL, &b.ActionLink, &b.ActionLabel,
		&b.Module, &b.Priority, &b.StartDate, &b.EndDate, &b.IsActive, &b.CreatedAt, &b.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert banner: %w", err)
	}
	return &b, nil
}

// UpdateBanner updates a promotional banner (admin only).
func (s *Service) UpdateBanner(ctx context.Context, bannerID string, input BannerInput) (*Banner, error) {
	const q = `
		UPDATE promotions_banners
		SET title = $1, description = $2, image_url = $3, action_link = $4, action_label = $5,
		    module = $6, priority = $7, start_date = $8, end_date = $9, is_active = $10, updated_at = NOW()
		WHERE id = $11
		RETURNING id, title, description, image_url, action_link, action_label, module, priority,
		          start_date, end_date, is_active, created_at, updated_at`

	var b Banner
	if err := s.db.QueryRow(ctx, q, input.Title, input.Description, input.ImageURL,
		input.ActionLink, input.ActionLabel, input.Module, input.Priority,
		input.StartDate, input.EndDate, input.IsActive, bannerID).Scan(
		&b.ID, &b.Title, &b.Description, &b.ImageURL, &b.ActionLink, &b.ActionLabel,
		&b.Module, &b.Priority, &b.StartDate, &b.EndDate, &b.IsActive, &b.CreatedAt, &b.UpdatedAt); err != nil {
		return nil, fmt.Errorf("update banner: %w", err)
	}
	return &b, nil
}

// DeleteBanner soft-deletes a promotional banner.
func (s *Service) DeleteBanner(ctx context.Context, bannerID string) error {
	const q = `UPDATE promotions_banners SET is_active = false, updated_at = NOW() WHERE id = $1`
	_, err := s.db.Exec(ctx, q, bannerID)
	return err
}
