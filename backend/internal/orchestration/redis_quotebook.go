package orchestration

import (
	"context"
	"encoding/json"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// RedisQuoteBook is a multi-instance-safe QuoteStore. Quotes are stored as JSON
// at fx:quote:<id> with a TTL equal to the lock window; single-consumption is
// guaranteed by a SETNX consumed-marker (no double execution across instances).
type RedisQuoteBook struct {
	rdb *goredis.Client
	ttl time.Duration
}

// NewRedisQuoteBook builds a Redis-backed quote book.
func NewRedisQuoteBook(rdb *goredis.Client, lockWindow time.Duration) *RedisQuoteBook {
	return &RedisQuoteBook{rdb: rdb, ttl: lockWindow}
}

func (b *RedisQuoteBook) LockWindow() time.Duration { return b.ttl }

// quoteEnvelope carries the fields Quote marks json:"-" so they survive Redis.
type quoteEnvelope struct {
	Quote      *Quote    `json:"quote"`
	CustomerID string    `json:"customer_id"`
	Intent     Intent    `json:"intent"`
	CreatedAt  time.Time `json:"created_at"`
}

func quoteKey(id string) string    { return "fx:quote:" + id }
func consumedKey(id string) string { return "fx:quote:" + id + ":consumed" }

func (b *RedisQuoteBook) save(ctx context.Context, q *Quote, ttl time.Duration) {
	env := quoteEnvelope{Quote: q, CustomerID: q.CustomerID, Intent: q.Intent, CreatedAt: q.CreatedAt}
	data, err := json.Marshal(env)
	if err != nil {
		return
	}
	_ = b.rdb.Set(ctx, quoteKey(q.ID), data, ttl).Err()
}

func (b *RedisQuoteBook) load(ctx context.Context, id, customerID string) *Quote {
	data, err := b.rdb.Get(ctx, quoteKey(id)).Bytes()
	if err != nil {
		return nil
	}
	var env quoteEnvelope
	if json.Unmarshal(data, &env) != nil || env.Quote == nil {
		return nil
	}
	q := env.Quote
	q.CustomerID, q.Intent, q.CreatedAt = env.CustomerID, env.Intent, env.CreatedAt
	if customerID != "" && q.CustomerID != customerID {
		return nil
	}
	return q
}

func (b *RedisQuoteBook) Put(q *Quote) {
	b.save(context.Background(), q, b.ttl)
}

func (b *RedisQuoteBook) Get(id, customerID string) *Quote {
	return b.load(context.Background(), id, customerID)
}

func (b *RedisQuoteBook) Lock(id, customerID string, now time.Time) *Quote {
	ctx := context.Background()
	q := b.load(ctx, id, customerID)
	if q == nil {
		return nil
	}
	q.Locked = true
	q.Status = QuoteLocked
	q.ExpiresAt = now.Add(b.ttl)
	b.save(ctx, q, b.ttl)
	return q
}

func (b *RedisQuoteBook) Consume(id, customerID string, now time.Time) (*Quote, *APIError) {
	ctx := context.Background()
	q := b.load(ctx, id, customerID)
	if q == nil {
		return nil, NewError(ErrInvalidRequest, "quote_not_found", "Quote not found.").WithParam("quote_id")
	}
	if q.Expired(now) {
		return nil, NewError(ErrRateExpired, "quote_expired", "The quote "+id+" has expired. Request a new quote.").WithParam("quote_id")
	}
	// Single-consumption guard: only the first SETNX winner may execute.
	ok, err := b.rdb.SetNX(ctx, consumedKey(id), 1, b.ttl).Result()
	if err != nil {
		return nil, NewError(ErrInternal, "quote_consume_failed", err.Error())
	}
	if !ok {
		return nil, NewError(ErrConflict, "quote_consumed", "This quote has already been executed.").WithParam("quote_id")
	}
	q.Status = QuoteConsumed
	b.save(ctx, q, b.ttl)
	return q, nil
}
