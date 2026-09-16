package marketplace

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Notification represents a marketplace notification
type Notification struct {
	ID        string                 `json:"id"`
	UserID    string                 `json:"user_id"`
	Type      string                 `json:"type"` // 'new_offer','price_dropped',etc
	Title     string                 `json:"title"`
	Body      string                 `json:"body,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
	RelatedID string                 `json:"related_id,omitempty"`
	IsRead    bool                   `json:"is_read"`
	ReadAt    *time.Time             `json:"read_at,omitempty"`
	CreatedAt time.Time              `json:"created_at"`
}

// ListNotifications retrieves user's notification feed (newest first, with pagination)
func (s *Service) ListNotifications(ctx context.Context, userID string, limit, offset int) ([]Notification, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	query := `
		SELECT id, user_id, type, title, body, data, related_id, is_read, read_at, created_at
		FROM mkt_notifications
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := s.repo.db.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notifs []Notification
	for rows.Next() {
		var n Notification
		var dataStr string
		var readAt *time.Time

		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &dataStr, &n.RelatedID, &n.IsRead, &readAt, &n.CreatedAt); err != nil {
			return nil, err
		}

		// Parse JSON data
		if dataStr != "" {
			if err := json.Unmarshal([]byte(dataStr), &n.Data); err != nil {
				n.Data = make(map[string]interface{})
			}
		} else {
			n.Data = make(map[string]interface{})
		}

		n.ReadAt = readAt
		notifs = append(notifs, n)
	}

	return notifs, rows.Err()
}

// MarkNotificationRead marks a single notification as read
func (s *Service) MarkNotificationRead(ctx context.Context, userID, notificationID string) (*Notification, error) {
	now := time.Now()

	query := `
		UPDATE mkt_notifications
		SET is_read = true, read_at = $1
		WHERE id = $2 AND user_id = $3
		RETURNING id, user_id, type, title, body, data, related_id, is_read, read_at, created_at
	`

	var n Notification
	var dataStr string

	err := s.repo.db.QueryRow(ctx, query, now, notificationID, userID).Scan(
		&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &dataStr, &n.RelatedID, &n.IsRead, &n.ReadAt, &n.CreatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("notification not found")
		}
		return nil, err
	}

	// Parse JSON data
	if dataStr != "" {
		if err := json.Unmarshal([]byte(dataStr), &n.Data); err != nil {
			n.Data = make(map[string]interface{})
		}
	} else {
		n.Data = make(map[string]interface{})
	}

	return &n, nil
}

// MarkAllNotificationsRead marks all user's notifications as read
func (s *Service) MarkAllNotificationsRead(ctx context.Context, userID string) error {
	now := time.Now()

	query := `
		UPDATE mkt_notifications
		SET is_read = true, read_at = $1
		WHERE user_id = $2 AND is_read = false
	`

	_, err := s.repo.db.Exec(ctx, query, now, userID)
	return err
}

// DeleteNotification deletes/dismisses a notification
func (s *Service) DeleteNotification(ctx context.Context, userID, notificationID string) error {
	query := `
		DELETE FROM mkt_notifications
		WHERE id = $1 AND user_id = $2
	`

	result, err := s.repo.db.Exec(ctx, query, notificationID, userID)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("notification not found")
	}

	return nil
}

// GetUnreadNotificationCount returns the count of unread notifications
func (s *Service) GetUnreadNotificationCount(ctx context.Context, userID string) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM mkt_notifications WHERE user_id = $1 AND is_read = false`

	err := s.repo.db.QueryRow(ctx, query, userID).Scan(&count)
	return count, err
}

// CreateNotification creates a notification for a user (internal use)
func (s *Service) CreateNotification(ctx context.Context, userID, notificationType, title, body string, data map[string]interface{}, relatedID string) (*Notification, error) {
	id := uuid.New().String()
	now := time.Now()

	// Convert data to JSON
	dataJSON, _ := json.Marshal(data)

	query := `
		INSERT INTO mkt_notifications (id, user_id, type, title, body, data, related_id, is_read, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
		RETURNING id, user_id, type, title, body, data, related_id, is_read, read_at, created_at
	`

	var n Notification
	var dataStr string

	err := s.repo.db.QueryRow(ctx, query, id, userID, notificationType, title, body, string(dataJSON), relatedID, now).Scan(
		&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &dataStr, &n.RelatedID, &n.IsRead, &n.ReadAt, &n.CreatedAt,
	)

	if err != nil {
		return nil, err
	}

	// Parse JSON data
	if err := json.Unmarshal([]byte(dataStr), &n.Data); err != nil {
		n.Data = make(map[string]interface{})
	}

	return &n, nil
}

// BroadcastNotification sends notifications to multiple users (e.g., price drop alert)
func (s *Service) BroadcastNotification(ctx context.Context, userIDs []string, notificationType, title, body string, data map[string]interface{}, relatedID string) error {
	if len(userIDs) == 0 {
		return nil
	}

	// Convert data to JSON
	dataJSON, _ := json.Marshal(data)

	query := `
		INSERT INTO mkt_notifications (id, user_id, type, title, body, data, related_id, is_read, created_at)
		SELECT gen_random_uuid(), user_id, $3, $4, $5, $6, $7, false, now()
		FROM (
			SELECT DISTINCT unnest($1::uuid[]) as user_id
		) t
		WHERE user_id IS NOT NULL
	`

	_, err := s.repo.db.Exec(ctx, query, userIDs, notificationType, title, body, string(dataJSON), relatedID)
	return err
}
