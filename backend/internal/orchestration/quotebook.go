package orchestration

import (
	"sync"
	"time"
)

// QuoteStore is the quote lifecycle persistence boundary (quote -> lock ->
// execute). Implemented by the in-memory QuoteBook and the Redis-backed
// RedisQuoteBook (multi-instance safe).
type QuoteStore interface {
	Put(q *Quote)
	Get(id, customerID string) *Quote
	Lock(id, customerID string, now time.Time) *Quote
	Consume(id, customerID string, now time.Time) (*Quote, *APIError)
	LockWindow() time.Duration
}

// QuoteBook stores time-boxed quotes for the quote -> lock -> execute lifecycle.
// In-memory with a mutex; production: back with Redis (keyed by quote id, TTL =
// lock window) so the lifecycle survives across stateless API instances.
type QuoteBook struct {
	mu     sync.Mutex
	quotes map[string]*Quote
	ttl    time.Duration
}

// NewQuoteBook builds a quote book with the given lock window.
func NewQuoteBook(lockWindow time.Duration) *QuoteBook {
	return &QuoteBook{quotes: map[string]*Quote{}, ttl: lockWindow}
}

// LockWindow returns the configured lock TTL.
func (b *QuoteBook) LockWindow() time.Duration { return b.ttl }

// Put stores a quote.
func (b *QuoteBook) Put(q *Quote) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.quotes[q.ID] = q
}

// Get returns a quote by id, scoped to a customer (nil if missing/foreign).
func (b *QuoteBook) Get(id, customerID string) *Quote {
	b.mu.Lock()
	defer b.mu.Unlock()
	q, ok := b.quotes[id]
	if !ok || (customerID != "" && q.CustomerID != customerID) {
		return nil
	}
	return q
}

// Lock marks a quote locked (extends its window from now) and returns it.
func (b *QuoteBook) Lock(id, customerID string, now time.Time) *Quote {
	b.mu.Lock()
	defer b.mu.Unlock()
	q, ok := b.quotes[id]
	if !ok || (customerID != "" && q.CustomerID != customerID) {
		return nil
	}
	q.Locked = true
	q.Status = QuoteLocked
	q.ExpiresAt = now.Add(b.ttl)
	return q
}

// Consume atomically validates a quote for execution and marks it consumed.
// Returns an APIError if missing, foreign, already consumed, or expired.
func (b *QuoteBook) Consume(id, customerID string, now time.Time) (*Quote, *APIError) {
	b.mu.Lock()
	defer b.mu.Unlock()
	q, ok := b.quotes[id]
	if !ok || (customerID != "" && q.CustomerID != customerID) {
		return nil, NewError(ErrInvalidRequest, "quote_not_found", "Quote not found.").WithParam("quote_id")
	}
	if q.Status == QuoteConsumed {
		return nil, NewError(ErrConflict, "quote_consumed", "This quote has already been executed.").WithParam("quote_id")
	}
	if q.Expired(now) {
		q.Status = QuoteExpired
		return nil, NewError(ErrRateExpired, "quote_expired", "The quote "+id+" has expired. Request a new quote.").WithParam("quote_id")
	}
	q.Status = QuoteConsumed
	return q, nil
}

// Reap removes expired quotes (call periodically; safe to skip with Redis TTL).
func (b *QuoteBook) Reap(now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, q := range b.quotes {
		if q.Status == QuoteConsumed || q.Expired(now) {
			if now.Sub(q.ExpiresAt) > time.Hour {
				delete(b.quotes, id)
			}
		}
	}
}
