package promotions

import (
	"context"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"time"
)

const (
	keyError = "error"
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

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ListBanners → GET /promotions/banners?module={module}
// Returns active promotional banners for a given module.
func (h *Handler) ListBanners(c *gin.Context) {
	module := c.Query("module")
	if module == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "module parameter required"})
		return
	}

	banners, err := h.svc.ListActiveBanners(c.Request.Context(), module)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "failed to load banners"})
		return
	}

	if banners == nil {
		banners = []Banner{} // Return empty array instead of null
	}
	c.JSON(http.StatusOK, gin.H{"banners": banners})
}

// CreateBanner → POST /promotions/banners (admin only)
// Creates a new promotional banner. Requires admin role.
func (h *Handler) CreateBanner(c *gin.Context) {
	var input BannerInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
		return
	}

	banner, err := h.svc.CreateBanner(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "failed to create banner"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"banner": banner})
}

// UpdateBanner → PATCH /promotions/banners/:id (admin only)
// Updates a promotional banner.
func (h *Handler) UpdateBanner(c *gin.Context) {
	var input BannerInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
		return
	}

	banner, err := h.svc.UpdateBanner(c.Request.Context(), c.Param("id"), input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "failed to update banner"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"banner": banner})
}

// DeleteBanner → DELETE /promotions/banners/:id (admin only)
// Soft-deletes a promotional banner.
func (h *Handler) DeleteBanner(c *gin.Context) {
	if err := h.svc.DeleteBanner(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "failed to delete banner"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// Banner represents a promotional banner/hero image.
type Banner struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	ImageURL    string    `json:"image_url"` // Cloudflare R2 URL
	ActionLink  string    `json:"action_link,omitempty"`
	ActionLabel string    `json:"action_label,omitempty"`
	Module      string    `json:"module"`   // health, restaurant, mobility, etc.
	Priority    int       `json:"priority"` // Higher = shown first
	StartDate   time.Time `json:"start_date"`
	EndDate     time.Time `json:"end_date"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// BannerInput is the request body for creating/updating banners.
type BannerInput struct {
	Title       string    `json:"title" binding:"required,max=200"`
	Description string    `json:"description" binding:"max=500"`
	ImageURL    string    `json:"image_url" binding:"required"` // Pre-uploaded R2 URL
	ActionLink  string    `json:"action_link" binding:"max=500"`
	ActionLabel string    `json:"action_label" binding:"max=100"`
	Module      string    `json:"module" binding:"required,max=50"` // health, restaurant, etc.
	Priority    int       `json:"priority" binding:"min=0,max=1000"`
	StartDate   time.Time `json:"start_date"`
	EndDate     time.Time `json:"end_date"`
	IsActive    bool      `json:"is_active"`
}
