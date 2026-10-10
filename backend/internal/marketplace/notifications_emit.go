package marketplace

import (
	"context"
	"fmt"
	"log"
)

// Producers for the in-app notifications inbox (mkt_notifications). Until these
// existed nothing wrote to that table, so GET /notifications was always empty.
//
// Every emit is BEST-EFFORT: the offer, message or price edit has already
// succeeded by the time we get here, and an inbox row is never worth failing it.

// emitNotification inserts one inbox row for userID. Failures are logged, never
// returned.
func (s *Service) emitNotification(ctx context.Context, userID, notifType, title, body string, data map[string]any, relatedID string) {
	if userID == "" {
		return
	}
	if _, err := s.CreateNotification(ctx, userID, notifType, title, body, data, relatedID); err != nil {
		log.Printf("[marketplace] notification %s for %s failed: %v", notifType, userID, err)
	}
}

// emitMessageNotification tells the other party about a new chat message. A
// thread with an unread message_new already waiting does not get a second row,
// so a fast back-and-forth is one inbox entry rather than dozens.
func (s *Service) emitMessageNotification(ctx context.Context, senderID, threadID string) {
	t, ok, err := s.repo.GetThread(ctx, senderID, threadID)
	if err != nil || !ok || t.CounterpartyID == "" {
		return
	}
	if err := s.insertMessageNotification(ctx, t.CounterpartyID, threadID); err != nil {
		log.Printf("[marketplace] message notification for thread %s failed: %v", threadID, err)
	}
}

// insertMessageNotification writes the message_new row unless the recipient
// already has an unread one for this thread.
func (s *Service) insertMessageNotification(ctx context.Context, recipientID, threadID string) error {
	_, err := s.repo.db.Exec(ctx, `
		INSERT INTO mkt_notifications (user_id, type, title, body, data, related_id)
		SELECT $1::uuid, 'message_new', 'New message', 'You have a new message in a deal chat.',
		       jsonb_build_object('thread_id', $2::uuid::text), $2::uuid
		WHERE NOT EXISTS (
			SELECT 1 FROM mkt_notifications
			WHERE user_id = $1::uuid AND type = 'message_new'
			  AND related_id = $2::uuid AND is_read = false
		)`, recipientID, threadID)
	return err
}

// emitPriceDropNotifications alerts everyone who saved listing that its price
// fell. Only a strict decrease counts.
func (s *Service) emitPriceDropNotifications(ctx context.Context, l *Listing, oldKobo, newKobo int64) {
	if newKobo >= oldKobo {
		return
	}
	rows, err := s.repo.db.Query(ctx, `SELECT user_id::text FROM mkt_saved_items WHERE listing_id = $1`, l.ID)
	if err != nil {
		log.Printf("[marketplace] price-drop lookup for %s failed: %v", l.ID, err)
		return
	}
	defer rows.Close()
	var users []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			log.Printf("[marketplace] price-drop scan for %s failed: %v", l.ID, err)
			return
		}
		if uid != l.SellerID {
			users = append(users, uid)
		}
	}
	if rows.Err() != nil || len(users) == 0 {
		return
	}
	body := fmt.Sprintf("“%s” dropped from %s to %s.", l.Title, nairaFromKobo(oldKobo), nairaFromKobo(newKobo))
	if err := s.BroadcastNotification(ctx, users, "price_dropped", "Price drop on a saved item", body,
		map[string]any{"listing_id": l.ID}, l.ID); err != nil {
		log.Printf("[marketplace] price-drop broadcast for %s failed: %v", l.ID, err)
	}
}

func nairaFromKobo(kobo int64) string {
	return fmt.Sprintf("₦%d", kobo/100)
}
