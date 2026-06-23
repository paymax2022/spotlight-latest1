package notifications

import (
	"context"
	"fmt"

	"spotlight/backend/internal/platform/queue"

	"github.com/hibiken/asynq"
)

// Channel represents a notification delivery channel.
type Channel string

const (
	ChannelPush    Channel = "push"
	ChannelEmail   Channel = "email"
	ChannelSMS     Channel = "sms"
	ChannelInApp   Channel = "in_app"
)

// Event is the domain event that triggered the notification.
type Event string

const (
	EventWalletCredit        Event = "wallet.credit"
	EventWalletDebit         Event = "wallet.debit"
	EventTransferSuccess     Event = "transfer.success"
	EventTransferFailed      Event = "transfer.failed"
	EventKYCApproved         Event = "kyc.approved"
	EventKYCFailed           Event = "kyc.failed"
	EventReferralReward      Event = "referral.reward"
	EventVAProvisioned       Event = "va.provisioned"
	EventFXConverted         Event = "fx.converted"
	EventOrderStatusUpdate   Event = "order.status_update"
	EventDisputeOpened       Event = "dispute.opened"
	EventDisputeResolved     Event = "dispute.resolved"
)

// Notification is the payload enqueued for delivery.
type Notification struct {
	UserID  string         `json:"user_id"`
	Event   Event          `json:"event"`
	Title   string         `json:"title"`
	Body    string         `json:"body"`
	Data    map[string]any `json:"data,omitempty"`
	Channels []Channel     `json:"channels"`
}

// Service enqueues notifications via asynq.
// Actual delivery workers (push, email, SMS) consume from the queue.
type Service struct {
	client *asynq.Client
}

func NewService(client *asynq.Client) *Service {
	return &Service{client: client}
}

// Send enqueues a notification for async delivery on the specified channels.
func (s *Service) Send(ctx context.Context, n Notification) error {
	if len(n.Channels) == 0 {
		n.Channels = []Channel{ChannelPush, ChannelInApp}
	}
	for _, ch := range n.Channels {
		taskType := taskTypeForChannel(ch)
		task, err := queue.NewTask(taskType, n, asynq.MaxRetry(3))
		if err != nil {
			return fmt.Errorf("notifications: create task %s: %w", taskType, err)
		}
		if _, err := s.client.EnqueueContext(ctx, task); err != nil {
			return fmt.Errorf("notifications: enqueue %s: %w", taskType, err)
		}
	}
	return nil
}

// Predefined helpers for common events.

func (s *Service) WalletCredit(ctx context.Context, userID string, amountKobo int64, reference string) error {
	return s.Send(ctx, Notification{
		UserID: userID,
		Event:  EventWalletCredit,
		Title:  "Wallet Credited",
		Body:   fmt.Sprintf("Your wallet has been credited with ₦%.2f", float64(amountKobo)/100),
		Data:   map[string]any{"amount_kobo": amountKobo, "reference": reference},
	})
}

func (s *Service) WalletDebit(ctx context.Context, userID string, amountKobo int64, reference string) error {
	return s.Send(ctx, Notification{
		UserID: userID,
		Event:  EventWalletDebit,
		Title:  "Wallet Debited",
		Body:   fmt.Sprintf("₦%.2f has been debited from your wallet", float64(amountKobo)/100),
		Data:   map[string]any{"amount_kobo": amountKobo, "reference": reference},
	})
}

func (s *Service) KYCApproved(ctx context.Context, userID string, newTier int) error {
	return s.Send(ctx, Notification{
		UserID: userID,
		Event:  EventKYCApproved,
		Title:  "KYC Verified",
		Body:   fmt.Sprintf("Your identity has been verified. You are now on Tier %d.", newTier),
		Data:   map[string]any{"new_tier": newTier},
	})
}

func (s *Service) ReferralReward(ctx context.Context, referrerID string, amountKobo int64) error {
	return s.Send(ctx, Notification{
		UserID: referrerID,
		Event:  EventReferralReward,
		Title:  "Referral Reward",
		Body:   fmt.Sprintf("You earned ₦%.2f for referring a friend!", float64(amountKobo)/100),
		Data:   map[string]any{"amount_kobo": amountKobo},
	})
}

func taskTypeForChannel(ch Channel) string {
	switch ch {
	case ChannelPush:
		return queue.TypeNotificationPush
	case ChannelEmail:
		return queue.TypeNotificationEmail
	case ChannelSMS:
		return queue.TypeNotificationSMS
	default:
		return queue.TypeNotificationPush
	}
}
