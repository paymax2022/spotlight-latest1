package promotions

import "time"

// Banner represents a promotional banner/hero image.
type Banner struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	ImageURL    string    `json:"image_url"` // Cloudflare R2 URL
	ActionLink  string    `json:"action_link,omitempty"`
	ActionLabel string    `json:"action_label,omitempty"`
	Module      string    `json:"module"` // health, restaurant, mobility, etc.
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
