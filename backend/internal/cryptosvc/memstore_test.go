package cryptosvc

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// memStore is an in-memory Store for unit tests.
type memStore struct {
	mu          sync.Mutex
	events      map[string]WebhookEvent
	swaps       map[string]*SwapRecord // by our id
	accounts    map[string]string
	nextID      int
	touchTo     time.Time                      // what TouchSwap writes (tests set it to the fake 'now')
	afterStale  func()                         // runs after StaleSwaps returned its list (simulates a concurrent writer)
	failTo      map[cryptoprov.SwapState]error // fail every transition INTO this state
	failSetPSID error                          // fail SetProviderSwapID
	failInsert  error
	failDelete  error
	transitions []string
	// onTransition lets a test simulate a racing writer just before the update.
	onTransition func(id string, from cryptoprov.SwapState)
}

func newMemStore() *memStore {
	return &memStore{events: map[string]WebhookEvent{}, swaps: map[string]*SwapRecord{}, accounts: map[string]string{}}
}

func (s *memStore) InsertSwap(_ context.Context, n NewSwap) (SwapRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.swaps {
		if r.UserID == n.UserID && r.IdempotencyKey != "" && r.IdempotencyKey == n.IdempotencyKey {
			return *r, false, nil
		}
	}
	s.nextID++
	r := &SwapRecord{
		ID: fmt.Sprintf("swap-%d", s.nextID), UserID: n.UserID, Provider: n.Provider, ProviderAccountID: n.ProviderAccountID,
		State: cryptoprov.SwapStateQuoted, Side: n.Side, NGNKobo: n.NGNKobo, FeeBps: n.FeeBps, FeeKobo: n.FeeKobo,
		ProviderQuoteID: n.ProviderQuoteID, IdempotencyKey: n.IdempotencyKey, UpdatedAt: time.Now(), FromCurrency: n.FromCurrency, ToCurrency: n.ToCurrency,
		FromAmount: n.FromAmount, QuotedToAmount: n.QuotedToAmount, QuotedPrice: n.QuotedPrice, ExpiresAt: n.ExpiresAt,
	}
	s.swaps[r.ID] = r
	return *r, true, nil
}

func (s *memStore) StaleSwaps(_ context.Context, state cryptoprov.SwapState, olderThan time.Time, limit int) ([]SwapRecord, error) {
	out := s.staleLocked(state, olderThan, limit)
	if s.afterStale != nil {
		s.afterStale() // after the lock is released: simulates a concurrent writer
	}
	return out, nil
}

func (s *memStore) staleLocked(state cryptoprov.SwapState, olderThan time.Time, limit int) []SwapRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []SwapRecord
	for _, r := range s.swaps {
		if r.State == state && r.UpdatedAt.Before(olderThan) {
			out = append(out, *r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.Before(out[j].UpdatedAt) }) // oldest first, like the SQL
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// age pretends a swap's last write was d ago relative to now.
func (s *memStore) age(id string, now time.Time, d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.swaps[id].UpdatedAt = now.Add(-d)
}

func (s *memStore) TouchSwap(_ context.Context, id string, state cryptoprov.SwapState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r := s.swaps[id]; r != nil && r.State == state {
		r.UpdatedAt = s.touchTo
	}
	return nil
}

func (s *memStore) SwapByIdempotencyKey(_ context.Context, userID, key string) (SwapRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.swaps {
		if r.UserID == userID && r.IdempotencyKey == key {
			return *r, true, nil
		}
	}
	return SwapRecord{}, false, nil
}

func (s *memStore) SwapByID(_ context.Context, userID, id string) (SwapRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.swaps[id]
	if r == nil || r.UserID != userID {
		return SwapRecord{}, false, nil
	}
	return *r, true, nil
}

func (s *memStore) SetProviderSwapID(_ context.Context, id, psid string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failSetPSID != nil {
		return false, s.failSetPSID
	}
	r := s.swaps[id]
	if r == nil || (r.ProviderSwapID != "" && r.ProviderSwapID != psid) {
		return false, nil
	}
	r.ProviderSwapID = psid
	return true, nil
}

func (s *memStore) ProviderAccount(_ context.Context, userID, provider string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[userID+"|"+provider]
	return a, ok, nil
}

func (s *memStore) SaveProviderAccount(_ context.Context, userID, provider, acct string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.accounts[userID+"|"+provider]; !ok {
		s.accounts[userID+"|"+provider] = acct
	}
	return nil
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

func (s *memStore) MarkExecuteAttempt(_ context.Context, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.swaps[id]
	if r == nil || r.ExecuteAttempted {
		return false, nil
	}
	r.ExecuteAttempted = true
	return true, nil
}

func (s *memStore) TransitionSwap(_ context.Context, id string, from, to cryptoprov.SwapState, received decimal.Decimal, _ string) (bool, error) {
	s.mu.Lock()
	if err, ok := s.failTo[to]; ok { // persistent until the test clears it
		s.mu.Unlock()
		return false, err
	}
	s.mu.Unlock()
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
