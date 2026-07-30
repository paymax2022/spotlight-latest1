package connectchat

import (
	"context"
	"errors"
	"testing"

	connecttrust "spotlight/backend/internal/connect/trust"
)

// failingLoader always errors, standing in for an unreachable connect_config.
type failingLoader struct{}

func (failingLoader) Load(context.Context) (connecttrust.Thresholds, error) {
	return connecttrust.Thresholds{}, errors.New("db down")
}

// TestSendMessageFailsClosedOnConfigError pins TS-013 / invariant 12: if the safety
// config cannot be loaded, SendMessage must NOT deliver the message unscanned — it
// fails closed with ErrSafetyUnavailable before any DB write. Runs with a nil pool
// to prove the guard returns before the transaction begins.
func TestSendMessageFailsClosedOnConfigError(t *testing.T) {
	s := &Service{db: nil, cfg: failingLoader{}}
	_, err := s.SendMessage(context.Background(), "conv-id", "user-id", SendMessageRequest{Body: "hello"})
	if !errors.Is(err, ErrSafetyUnavailable) {
		t.Fatalf("want ErrSafetyUnavailable when safety config load fails, got %v", err)
	}
}
