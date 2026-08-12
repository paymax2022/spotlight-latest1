package handlers

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GiftingStore provides data access for gifting operations.
type GiftingStore struct {
	db *pgxpool.Pool
}

// NewGiftingStore creates a new gifting store.
func NewGiftingStore(db *pgxpool.Pool) *GiftingStore {
	return &GiftingStore{db: db}
}

// GiftCatalogItem represents a giftable item.
type GiftCatalogItem struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	AmountKobo      int64  `json:"amountKobo"`
	Currency        string `json:"currency"`
	ImageURL        string `json:"imageUrl"`
	Category        string `json:"category"`
	Available       bool   `json:"available"`
}

// GetCatalog retrieves all giftable items.
func (s *GiftingStore) GetCatalog(ctx context.Context) ([]GiftCatalogItem, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			id, name, COALESCE(description, '') as description,
			amount_kobo, 'NGN' as currency, COALESCE(image_url, '') as image_url,
			COALESCE(category, 'general') as category, is_available
		FROM gift_catalog
		WHERE is_active = true
		ORDER BY category, name
	`)
	if err != nil {
		return nil, fmt.Errorf("query catalog: %w", err)
	}
	defer rows.Close()

	var items []GiftCatalogItem
	for rows.Next() {
		var item GiftCatalogItem
		if err := rows.Scan(&item.ID, &item.Name, &item.Description,
			&item.AmountKobo, &item.Currency, &item.ImageURL, &item.Category, &item.Available); err != nil {
			return nil, fmt.Errorf("scan catalog item: %w", err)
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

// GetCatalogItem retrieves a single giftable item.
func (s *GiftingStore) GetCatalogItem(ctx context.Context, itemID string) (*GiftCatalogItem, error) {
	row := s.db.QueryRow(ctx, `
		SELECT
			id, name, COALESCE(description, '') as description,
			amount_kobo, 'NGN' as currency, COALESCE(image_url, '') as image_url,
			COALESCE(category, 'general') as category, is_available
		FROM gift_catalog
		WHERE id = $1 AND is_active = true
	`, itemID)

	var item GiftCatalogItem
	err := row.Scan(&item.ID, &item.Name, &item.Description,
		&item.AmountKobo, &item.Currency, &item.ImageURL, &item.Category, &item.Available)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query catalog item: %w", err)
	}

	return &item, nil
}

// Recipient represents a potential gift recipient.
type Recipient struct {
	UserID   string `json:"userId"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
}

// GetRecipients retrieves user's saved gift recipients.
func (s *GiftingStore) GetRecipients(ctx context.Context, senderUserID string) ([]Recipient, error) {
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT
			u.id as user_id, u.email,
			COALESCE(p.name, '') as name,
			COALESCE(p.nickname, '') as nickname
		FROM auth.users u
		LEFT JOIN profiles p ON u.id = p.user_id
		WHERE u.id != $1
		ORDER BY u.created_at DESC
		LIMIT 50
	`, senderUserID)
	if err != nil {
		return nil, fmt.Errorf("query recipients: %w", err)
	}
	defer rows.Close()

	var recipients []Recipient
	for rows.Next() {
		var r Recipient
		if err := rows.Scan(&r.UserID, &r.Email, &r.Name, &r.Nickname); err != nil {
			return nil, fmt.Errorf("scan recipient: %w", err)
		}
		recipients = append(recipients, r)
	}

	return recipients, rows.Err()
}

// GiftTransaction represents a sent or received gift.
type GiftTransaction struct {
	ID            string `json:"id"`
	Reference     string `json:"reference"`
	SenderID      string `json:"senderId"`
	SenderName    string `json:"senderName"`
	RecipientID   string `json:"recipientId"`
	RecipientName string `json:"recipientName"`
	ItemID        string `json:"itemId"`
	ItemName      string `json:"itemName"`
	AmountKobo    int64  `json:"amountKobo"`
	Currency      string `json:"currency"`
	Message       string `json:"message"`
	Status        string `json:"status"` // "sent", "received", "claimed"
	CreatedAt     string `json:"createdAt"`
}

// SendGift records a gift transaction.
func (s *GiftingStore) SendGift(ctx context.Context, senderID string, recipientID string, itemID string, message string, amountKobo int64, reference string, idemKey string) (*GiftTransaction, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO gift_transactions (
			id, reference, sender_id, recipient_id, item_id, amount_kobo,
			message, status, idempotency_key, created_at
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'sent', $7, NOW()
		)
		RETURNING id, reference, sender_id, recipient_id, item_id, amount_kobo,
		          'NGN' as currency, message, status, created_at::text
	`, reference, senderID, recipientID, itemID, amountKobo, message, idemKey)

	var gt GiftTransaction
	err := row.Scan(&gt.ID, &gt.Reference, &gt.SenderID, &gt.RecipientID, &gt.ItemID,
		&gt.AmountKobo, &gt.Currency, &gt.Message, &gt.Status, &gt.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("send gift: %w", err)
	}

	// Query sender and recipient names for response
	s.enrichGiftTransaction(ctx, &gt)
	return &gt, nil
}

// GetSentGifts retrieves gifts sent by user (paginated).
func (s *GiftingStore) GetSentGifts(ctx context.Context, userID string, limit int, offset int) ([]GiftTransaction, int64, error) {
	// Get total count
	var total int64
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gift_transactions WHERE sender_id = $1
	`, userID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count sent: %w", err)
	}

	// Get paginated results
	rows, err := s.db.Query(ctx, `
		SELECT
			id, reference, sender_id, recipient_id, item_id, amount_kobo,
			'NGN' as currency, COALESCE(message, '') as message, status,
			created_at::text
		FROM gift_transactions
		WHERE sender_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query sent: %w", err)
	}
	defer rows.Close()

	var gifts []GiftTransaction
	for rows.Next() {
		var gt GiftTransaction
		if err := rows.Scan(&gt.ID, &gt.Reference, &gt.SenderID, &gt.RecipientID,
			&gt.ItemID, &gt.AmountKobo, &gt.Currency, &gt.Message, &gt.Status, &gt.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan gift: %w", err)
		}
		s.enrichGiftTransaction(ctx, &gt)
		gifts = append(gifts, gt)
	}

	return gifts, total, rows.Err()
}

// GetReceivedGifts retrieves gifts received by user (paginated).
func (s *GiftingStore) GetReceivedGifts(ctx context.Context, userID string, limit int, offset int) ([]GiftTransaction, int64, error) {
	// Get total count
	var total int64
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gift_transactions WHERE recipient_id = $1
	`, userID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count received: %w", err)
	}

	// Get paginated results
	rows, err := s.db.Query(ctx, `
		SELECT
			id, reference, sender_id, recipient_id, item_id, amount_kobo,
			'NGN' as currency, COALESCE(message, '') as message, status,
			created_at::text
		FROM gift_transactions
		WHERE recipient_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query received: %w", err)
	}
	defer rows.Close()

	var gifts []GiftTransaction
	for rows.Next() {
		var gt GiftTransaction
		if err := rows.Scan(&gt.ID, &gt.Reference, &gt.SenderID, &gt.RecipientID,
			&gt.ItemID, &gt.AmountKobo, &gt.Currency, &gt.Message, &gt.Status, &gt.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan gift: %w", err)
		}
		s.enrichGiftTransaction(ctx, &gt)
		gifts = append(gifts, gt)
	}

	return gifts, total, rows.Err()
}

// GetGiftTransaction retrieves a single gift transaction.
func (s *GiftingStore) GetGiftTransaction(ctx context.Context, userID string, txnID string) (*GiftTransaction, error) {
	row := s.db.QueryRow(ctx, `
		SELECT
			id, reference, sender_id, recipient_id, item_id, amount_kobo,
			'NGN' as currency, COALESCE(message, '') as message, status,
			created_at::text
		FROM gift_transactions
		WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)
	`, txnID, userID)

	var gt GiftTransaction
	err := row.Scan(&gt.ID, &gt.Reference, &gt.SenderID, &gt.RecipientID,
		&gt.ItemID, &gt.AmountKobo, &gt.Currency, &gt.Message, &gt.Status, &gt.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query gift: %w", err)
	}

	s.enrichGiftTransaction(ctx, &gt)
	return &gt, nil
}

// enrichGiftTransaction loads sender/recipient names and item name
func (s *GiftingStore) enrichGiftTransaction(ctx context.Context, gt *GiftTransaction) {
	// Get sender name
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(name, email) FROM auth.users u
		LEFT JOIN profiles p ON u.id = p.user_id
		WHERE u.id = $1
	`, gt.SenderID).Scan(&gt.SenderName)

	// Get recipient name
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(name, email) FROM auth.users u
		LEFT JOIN profiles p ON u.id = p.user_id
		WHERE u.id = $1
	`, gt.RecipientID).Scan(&gt.RecipientName)

	// Get item name
	_ = s.db.QueryRow(ctx, `
		SELECT name FROM gift_catalog WHERE id = $1
	`, gt.ItemID).Scan(&gt.ItemName)
}
