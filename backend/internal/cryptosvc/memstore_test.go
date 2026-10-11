package cryptosvc

import (
	"context"
	"sync"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// memStore is an in-memory Store for unit tests.
type memStore struct {
	mu          sync.Mutex
	events      map[string]WebhookEvent
	swaps       map[string]*SwapRecord // by our id
	failInsert  error
	failDelete  error
	transitions []string
	// onTransition lets a test simulate a racing writer just before the update.
	onTransition func(id string, from cryptoprov.SwapState)
}

func newMemStore() *memStore {
	return &memStore{events: map[string]WebhookEvent{}, swaps: map[string]*SwapRecord{}}
}

func (s *memStore) addSwap(r SwapRecord) { s.swaps[r.ID] = &r }

func (s *memStore) InsertWebhookEvent(_ context.Context, ev WebhookEvent) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failInsert != nil {
		return false, s.failInsert
	}
	if _, dup := s.events[ev.Key]; dup {
		return false, nil
	}
	s.events[ev.Key] = ev
	return true, nil
}

func (s *memStore) DeleteWebhookEvent(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err // a real database refuses work on a cancelled context
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failDelete != nil {
		return s.failDelete
	}
	delete(s.events, key)
	return nil
}

func (s *memStore) SwapByProviderID(_ context.Context, provider, id string) (SwapRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.swaps {
		if r.Provider == provider && r.ProviderSwapID == id {
			return *r, true, nil
		}
	}
	return SwapRecord{}, false, nil
}

func (s *memStore) TransitionSwap(_ context.Context, id string, from, to cryptoprov.SwapState, received decimal.Decimal, _ string) (bool, error) {
	if s.onTransition != nil {
		s.onTransition(id, from)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.swaps[id]
	if r == nil || r.State != from {
		return false, nil
	}
	r.State = to
	if received.IsPositive() {
		r.ReceivedAmount = received
	}
	s.transitions = append(s.transitions, string(from)+">"+string(to))
	return true, nil
}
