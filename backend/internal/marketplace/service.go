package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Service handles all marketplace operations with integrated audit logging.
type Service struct {
	Db    *pgxpool.Pool
	Redis *redis.Client
}

// NewService creates a new marketplace service.
func NewService(db *pgxpool.Pool, redis *redis.Client) *Service {
	return &Service{
		Db:    db,
		Redis: redis,
	}
}

// Listing represents a marketplace listing.
type Listing struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	Category     string    `json:"category"`
	PriceKobo    int64     `json:"price_kobo"`
	Currency     string    `json:"currency"`
	Status       string    `json:"status"` // DRAFT, PUBLISHED, SOLD, REMOVED
	Condition    string    `json:"condition"`
	LocationLat  float64   `json:"location_lat"`
	LocationLng  float64   `json:"location_lng"`
	LocationText string    `json:"location_text"`
	ImageURLs    []string  `json:"image_urls"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	PublishedAt  *time.Time `json:"published_at"`
	DeletedAt    *time.Time `json:"deleted_at"`
}

// CreateListingInput is the input for creating a new listing.
type CreateListingInput struct {
	Title       string   `json:"title" validate:"required,max=255"`
	Description string   `json:"description" validate:"required,max=5000"`
	Category    string   `json:"category" validate:"required"`
	PriceKobo   int64    `json:"price_kobo" validate:"required,gt=0"`
	Condition   string   `json:"condition"`
	LocationLat float64  `json:"location_lat"`
	LocationLng float64  `json:"location_lng"`
	LocationText string  `json:"location_text"`
	ImageURLs   []string `json:"image_urls"`
}

// UpdateListingInput is the input for updating a listing.
type UpdateListingInput struct {
	Title       *string   `json:"title"`
	Description *string   `json:"description"`
	Category    *string   `json:"category"`
	PriceKobo   *int64    `json:"price_kobo"`
	Condition   *string   `json:"condition"`
	LocationLat *float64  `json:"location_lat"`
	LocationLng *float64  `json:"location_lng"`
	LocationText *string  `json:"location_text"`
	ImageURLs   []string  `json:"image_urls"`
}

// AuditLog represents an audit log entry.
type AuditLog struct {
	ID        string                 `json:"id"`
	EntityType string                `json:"entity_type"`
	EntityID  string                 `json:"entity_id"`
	ActorID   string                 `json:"actor_id"`
	Action    string                 `json:"action"`
	Changes   map[string]interface{} `json:"changes"`
	CreatedAt time.Time              `json:"created_at"`
}

// CreateListing creates a new marketplace listing with audit logging.
func (s *Service) CreateListing(
	ctx context.Context,
	userID string,
	input CreateListingInput,
	requestID string,
	ipAddress string,
	userAgent string,
) (*Listing, error) {
	const query = `
		INSERT INTO marketplace_listings (
			user_id, title, description, category, price_kobo, currency,
			status, condition, location_lat, location_lng, location_text,
			image_urls, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
		RETURNING
			id, user_id, title, description, category, price_kobo, currency,
			status, condition, location_lat, location_lng, location_text,
			image_urls, created_at, updated_at, published_at, deleted_at
	`

	listing := &Listing{}

	// Start transaction for atomicity
	tx, err := s.Db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Create listing
	err = tx.QueryRow(ctx, query,
		userID, input.Title, input.Description, input.Category,
		input.PriceKobo, "NGN", "DRAFT", input.Condition,
		input.LocationLat, input.LocationLng, input.LocationText,
		input.ImageURLs,
	).Scan(
		&listing.ID, &listing.UserID, &listing.Title, &listing.Description,
		&listing.Category, &listing.PriceKobo, &listing.Currency,
		&listing.Status, &listing.Condition, &listing.LocationLat, &listing.LocationLng,
		&listing.LocationText, (*pgx.Array[string])(&listing.ImageURLs),
		&listing.CreatedAt, &listing.UpdatedAt, &listing.PublishedAt, &listing.DeletedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create listing: %w", err)
	}

	// Log the action
	displayText := fmt.Sprintf("%s created listing: %s", userID, input.Title)
	logErr := s.logAction(ctx, tx, LogActionInput{
		EntityType:  "listing",
		EntityID:    listing.ID,
		ActorID:     userID,
		Action:      "CREATE",
		Changes: map[string]interface{}{
			"new": listing,
		},
		RequestID:   requestID,
		IPAddress:   ipAddress,
		UserAgent:   userAgent,
		DisplayText: displayText,
	})
	if logErr != nil {
		// Log errors shouldn't fail the transaction, just log them
		fmt.Printf("Failed to log action: %v\n", logErr)
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Invalidate cache
	s.Redis.Del(ctx, fmt.Sprintf("listings:%s", userID))

	// Publish real-time event
	_ = s.PublishListingEvent(ctx, "listing.created", listing)

	return listing, nil
}

// GetListing retrieves a listing by ID with audit trail.
func (s *Service) GetListing(ctx context.Context, listingID string) (*Listing, error) {
	const query = `
		SELECT
			id, user_id, title, description, category, price_kobo, currency,
			status, condition, location_lat, location_lng, location_text,
			image_urls, created_at, updated_at, published_at, deleted_at
		FROM marketplace_listings
		WHERE id = $1 AND deleted_at IS NULL
	`

	listing := &Listing{}
	err := s.Db.QueryRow(ctx, query, listingID).Scan(
		&listing.ID, &listing.UserID, &listing.Title, &listing.Description,
		&listing.Category, &listing.PriceKobo, &listing.Currency,
		&listing.Status, &listing.Condition, &listing.LocationLat, &listing.LocationLng,
		&listing.LocationText, (*pgx.Array[string])(&listing.ImageURLs),
		&listing.CreatedAt, &listing.UpdatedAt, &listing.PublishedAt, &listing.DeletedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("listing not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get listing: %w", err)
	}

	return listing, nil
}

// UpdateListing updates a marketplace listing with audit logging.
func (s *Service) UpdateListing(
	ctx context.Context,
	listingID string,
	userID string,
	input UpdateListingInput,
	requestID string,
	ipAddress string,
	userAgent string,
) (*Listing, error) {
	tx, err := s.Db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get current listing
	oldListing, err := s.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}

	// Verify ownership (only owner can update)
	if oldListing.UserID != userID {
		return nil, fmt.Errorf("unauthorized: you can only update your own listings")
	}

	// Prepare update query dynamically
	updates := map[string]interface{}{}
	if input.Title != nil {
		updates["title"] = *input.Title
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.Category != nil {
		updates["category"] = *input.Category
	}
	if input.PriceKobo != nil {
		updates["price_kobo"] = *input.PriceKobo
	}
	if input.Condition != nil {
		updates["condition"] = *input.Condition
	}
	if input.ImageURLs != nil {
		updates["image_urls"] = input.ImageURLs
	}

	if len(updates) == 0 {
		return oldListing, nil // No changes
	}

	// Build SQL update query
	query := "UPDATE marketplace_listings SET updated_at = NOW()"
	args := []interface{}{listingID}
	idx := 2

	for key, value := range updates {
		query += fmt.Sprintf(", %s = $%d", key, idx)
		args = append(args, value)
		idx++
	}

	query += " WHERE id = $1 RETURNING id, user_id, title, description, category, price_kobo, currency, status, condition, location_lat, location_lng, location_text, image_urls, created_at, updated_at, published_at, deleted_at"

	newListing := &Listing{}
	err = tx.QueryRow(ctx, query, args...).Scan(
		&newListing.ID, &newListing.UserID, &newListing.Title, &newListing.Description,
		&newListing.Category, &newListing.PriceKobo, &newListing.Currency,
		&newListing.Status, &newListing.Condition, &newListing.LocationLat, &newListing.LocationLng,
		&newListing.LocationText, (*pgx.Array[string])(&newListing.ImageURLs),
		&newListing.CreatedAt, &newListing.UpdatedAt, &newListing.PublishedAt, &newListing.DeletedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update listing: %w", err)
	}

	// Log the action
	oldData, _ := json.Marshal(oldListing)
	newData, _ := json.Marshal(newListing)
	var oldMap, newMap map[string]interface{}
	json.Unmarshal(oldData, &oldMap)
	json.Unmarshal(newData, &newMap)

	displayText := fmt.Sprintf("%s updated listing: %s", userID, newListing.Title)
	logErr := s.logAction(ctx, tx, LogActionInput{
		EntityType:  "listing",
		EntityID:    listingID,
		ActorID:     userID,
		Action:      "UPDATE",
		Changes: map[string]interface{}{
			"old": oldMap,
			"new": newMap,
		},
		RequestID:   requestID,
		IPAddress:   ipAddress,
		UserAgent:   userAgent,
		DisplayText: displayText,
	})
	if logErr != nil {
		fmt.Printf("Failed to log action: %v\n", logErr)
	}

	// Commit
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Invalidate cache
	s.Redis.Del(ctx, fmt.Sprintf("listings:%s", userID))

	// Publish real-time event
	_ = s.PublishListingEvent(ctx, "listing.updated", newListing)

	return newListing, nil
}

// DeleteListing soft-deletes a listing with audit logging.
func (s *Service) DeleteListing(
	ctx context.Context,
	listingID string,
	userID string,
	requestID string,
	ipAddress string,
	userAgent string,
) error {
	tx, err := s.Db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get listing
	listing, err := s.GetListing(ctx, listingID)
	if err != nil {
		return err
	}

	// Verify ownership
	if listing.UserID != userID {
		return fmt.Errorf("unauthorized: you can only delete your own listings")
	}

	// Soft delete
	const query = `
		UPDATE marketplace_listings
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`

	_, err = tx.Exec(ctx, query, listingID)
	if err != nil {
		return fmt.Errorf("failed to delete listing: %w", err)
	}

	// Log the action
	displayText := fmt.Sprintf("%s deleted listing: %s", userID, listing.Title)
	logErr := s.logAction(ctx, tx, LogActionInput{
		EntityType:  "listing",
		EntityID:    listingID,
		ActorID:     userID,
		Action:      "DELETE",
		Changes: map[string]interface{}{
			"old": listing,
		},
		RequestID:   requestID,
		IPAddress:   ipAddress,
		UserAgent:   userAgent,
		DisplayText: displayText,
	})
	if logErr != nil {
		fmt.Printf("Failed to log action: %v\n", logErr)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Invalidate cache
	s.Redis.Del(ctx, fmt.Sprintf("listings:%s", userID))

	// Publish real-time event
	_ = s.PublishListingEvent(ctx, "listing.deleted", listing)

	return nil
}

// GetAuditTrail retrieves the audit trail for a listing.
func (s *Service) GetAuditTrail(ctx context.Context, listingID string, limit int) ([]*AuditLog, error) {
	const query = `
		SELECT id, entity_type, entity_id, actor_id, action, changes, created_at
		FROM marketplace_audit_logs
		WHERE entity_type = 'listing' AND entity_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`

	rows, err := s.Db.Query(ctx, query, listingID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get audit trail: %w", err)
	}
	defer rows.Close()

	var logs []*AuditLog
	for rows.Next() {
		log := &AuditLog{}
		var changesJSON []byte

		err := rows.Scan(
			&log.ID, &log.EntityType, &log.EntityID, &log.ActorID,
			&log.Action, &changesJSON, &log.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan audit log: %w", err)
		}

		// Parse JSON changes
		if changesJSON != nil {
			err = json.Unmarshal(changesJSON, &log.Changes)
			if err != nil {
				fmt.Printf("Failed to unmarshal changes: %v\n", err)
			}
		}

		logs = append(logs, log)
	}

	return logs, nil
}

// LogActionInput is the input for logging an action.
type LogActionInput struct {
	EntityType  string
	EntityID    string
	ActorID     string
	Action      string
	Changes     map[string]interface{}
	RequestID   string
	IPAddress   string
	UserAgent   string
	DisplayText string
}

// logAction logs an action to the audit table (must be called within a transaction).
func (s *Service) logAction(ctx context.Context, tx pgx.Tx, input LogActionInput) error {
	changesJSON, _ := json.Marshal(input.Changes)

	const query = `
		SELECT log_marketplace_action($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`

	var logID string
	err := tx.QueryRow(ctx, query,
		input.EntityType,
		input.EntityID,
		input.ActorID,
		input.Action,
		changesJSON,
		input.RequestID,
		input.IPAddress,
		input.UserAgent,
		input.DisplayText,
	).Scan(&logID)

	if err != nil {
		return fmt.Errorf("failed to log action: %w", err)
	}

	return nil
}

// PublishListingEvent publishes a real-time listing event.
func (s *Service) PublishListingEvent(ctx context.Context, eventType string, listing *Listing) error {
	event := map[string]interface{}{
		"type":      eventType,
		"listing":   listing,
		"timestamp": time.Now().Unix(),
	}

	eventJSON, _ := json.Marshal(event)

	// Publish to Redis pub/sub for real-time delivery
	return s.Redis.Publish(ctx, "marketplace:events", string(eventJSON)).Err()
}
