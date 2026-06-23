package notifications

import (
	"context"
	"fmt"
	"log"

	"github.com/hibiken/asynq"
	"spotlight/backend/internal/platform/queue"
)

// Workers registers all notification task handlers on an asynq ServeMux.
func Workers(mux *asynq.ServeMux) {
	mux.HandleFunc(queue.TypeNotificationPush, handlePush)
	mux.HandleFunc(queue.TypeNotificationEmail, handleEmail)
	mux.HandleFunc(queue.TypeNotificationSMS, handleSMS)
}

func handlePush(ctx context.Context, t *asynq.Task) error {
	var n Notification
	if err := queue.DecodePayload(t, &n); err != nil {
		return fmt.Errorf("push worker: decode: %w", err)
	}
	// TODO: integrate Firebase FCM / Expo push.
	// For MVP: log and no-op — push tokens are stored in user_profiles.push_token.
	log.Printf("[push] user=%s event=%s title=%q", n.UserID, n.Event, n.Title)
	return nil
}

func handleEmail(ctx context.Context, t *asynq.Task) error {
	var n Notification
	if err := queue.DecodePayload(t, &n); err != nil {
		return fmt.Errorf("email worker: decode: %w", err)
	}
	// TODO: integrate Resend API (currently used in Next.js).
	log.Printf("[email] user=%s event=%s", n.UserID, n.Event)
	return nil
}

func handleSMS(ctx context.Context, t *asynq.Task) error {
	var n Notification
	if err := queue.DecodePayload(t, &n); err != nil {
		return fmt.Errorf("sms worker: decode: %w", err)
	}
	// TODO: integrate Termii / Twilio.
	log.Printf("[sms] user=%s event=%s", n.UserID, n.Event)
	return nil
}
