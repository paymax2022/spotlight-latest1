package notifications_test

import (
	"testing"

	"spotlight/backend/internal/notifications"
)

// TestChannelConstants verifies 4 distinct delivery channels.
func TestChannelConstants(t *testing.T) {
	channels := []notifications.Channel{
		notifications.ChannelPush,
		notifications.ChannelEmail,
		notifications.ChannelSMS,
		notifications.ChannelInApp,
	}
	seen := map[notifications.Channel]bool{}
	for _, ch := range channels {
		if ch == "" {
			t.Error("Channel must not be empty string")
		}
		if seen[ch] {
			t.Errorf("duplicate Channel: %q", ch)
		}
		seen[ch] = true
	}
}

// TestEventConstants verifies all domain events are distinct and non-empty.
func TestEventConstants(t *testing.T) {
	events := []notifications.Event{
		notifications.EventWalletCredit,
		notifications.EventWalletDebit,
		notifications.EventTransferSuccess,
		notifications.EventTransferFailed,
		notifications.EventKYCApproved,
		notifications.EventKYCFailed,
		notifications.EventReferralReward,
		notifications.EventVAProvisioned,
		notifications.EventFXConverted,
		notifications.EventOrderStatusUpdate,
		notifications.EventDisputeOpened,
		notifications.EventDisputeResolved,
	}
	seen := map[notifications.Event]bool{}
	for _, e := range events {
		if e == "" {
			t.Error("Event must not be empty string")
		}
		if seen[e] {
			t.Errorf("duplicate Event: %q", e)
		}
		seen[e] = true
	}
	if len(seen) < 12 {
		t.Errorf("expected at least 12 distinct events, got %d", len(seen))
	}
}

// TestNotificationRequiredFields verifies a well-formed notification payload.
func TestNotificationRequiredFields(t *testing.T) {
	n := notifications.Notification{
		UserID:   "user-abc",
		Event:    notifications.EventWalletCredit,
		Title:    "Wallet Credited",
		Body:     "₦5,000 has been added to your wallet",
		Channels: []notifications.Channel{notifications.ChannelPush, notifications.ChannelInApp},
	}
	if n.UserID == "" {
		t.Error("Notification.UserID must not be empty")
	}
	if n.Event == "" {
		t.Error("Notification.Event must not be empty")
	}
	if n.Title == "" {
		t.Error("Notification.Title must not be empty")
	}
	if n.Body == "" {
		t.Error("Notification.Body must not be empty")
	}
	if len(n.Channels) == 0 {
		t.Error("Notification.Channels must have at least one channel")
	}
}

// TestKycEventsDistinct verifies KYC approved vs failed are separate events.
// Mixing these would cause wrong notifications on KYC state transitions.
func TestKycEventsDistinct(t *testing.T) {
	if notifications.EventKYCApproved == notifications.EventKYCFailed {
		t.Error("EventKYCApproved and EventKYCFailed must be distinct")
	}
}

// TestWalletEventsDistinct verifies credit and debit events are separate.
func TestWalletEventsDistinct(t *testing.T) {
	if notifications.EventWalletCredit == notifications.EventWalletDebit {
		t.Error("EventWalletCredit and EventWalletDebit must be distinct")
	}
}
