package notifications

// E2E-FR-051 — enqueue failure observability. A dead Redis address makes every
// EnqueueContext fail fast (connection refused), no live infra needed.

import (
	"context"
	"strings"
	"testing"

	"github.com/hibiken/asynq"

	"spotlight/backend/internal/platform/queue"
)

// A nil asynq client is a reportable failure, never a panic.
func TestSend_NilClientReturnsError(t *testing.T) {
	s := NewService(nil)
	err := s.Send(context.Background(), Notification{
		UserID:   "u1",
		Event:    EventWalletCredit,
		Channels: []Channel{ChannelPush},
	})
	if err == nil {
		t.Fatal("Send with nil client returned nil error — the failure must be observable")
	}
}

// All channels are attempted before the aggregate error is returned — one bad
// channel must not starve the others, and every failure is in the error.
func TestSend_AttemptsAllChannelsOnFailure(t *testing.T) {
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "127.0.0.1:1"})
	defer func() { _ = client.Close() }()
	s := NewService(client)

	err := s.Send(context.Background(), Notification{
		UserID:   "u1",
		Event:    EventWalletCredit,
		Channels: []Channel{ChannelPush, ChannelEmail, ChannelSMS},
	})
	if err == nil {
		t.Fatal("Send against dead Redis returned nil error")
	}
	for _, taskType := range []string{
		queue.TypeNotificationPush,
		queue.TypeNotificationEmail,
		queue.TypeNotificationSMS,
	} {
		if !strings.Contains(err.Error(), taskType) {
			t.Errorf("aggregate error missing channel task %q — it was never attempted: %v", taskType, err)
		}
	}
}

// Channels with no task type (in_app — a feed row, not a queue task) are
// skipped silently; a pure in_app send reports success with nothing enqueued.
func TestSend_InAppOnlyIsNoop(t *testing.T) {
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "127.0.0.1:1"})
	defer func() { _ = client.Close() }()
	s := NewService(client)

	if err := s.Send(context.Background(), Notification{
		UserID:   "u1",
		Event:    EventWalletCredit,
		Channels: []Channel{ChannelInApp},
	}); err != nil {
		t.Errorf("in_app-only Send = %v, want nil (nothing to enqueue)", err)
	}
}
