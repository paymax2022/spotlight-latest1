package orchestration

import (
	"context"
	"encoding/json"
	"errors"
	goredis "github.com/redis/go-redis/v9"
	"strings"
	"sync"
	"time"
)

// Rate-integrity errors (spec §2 RT-002/RT-006, §17 EC-002/EC-011). Returned by
// the feed on ingestion so a bad/stale/wild rate never reaches the quote engine.
var (
	ErrRateNonPositive = errors.New("rate_non_positive")
	ErrRateSpike       = errors.New("rate_spike")          // deviation beyond the sanity band
	ErrRateCrossed     = errors.New("rate_crossed_market") // bid > ask (negative spread)
)

// RateSnapshot is one immutable, versioned, timestamped rate for a corridor
// (spec §2 RT-001/RT-005). Amounts are decimals only at the display/pricing
// boundary; money is still converted in integer minor units downstream.
type RateSnapshot struct {
	Pair    string    `json:"pair"`
	From    string    `json:"from"`
	To      string    `json:"to"`
	Mid     float64   `json:"mid"`
	Bid     float64   `json:"bid"`
	Ask     float64   `json:"ask"`
	Source  string    `json:"source"`
	Version int       `json:"version"`
	At      time.Time `json:"at"`
}

// RateFeedConfig tunes the staleness and sanity guards.
type RateFeedConfig struct {
	TTL             time.Duration // max age before a rate is stale and non-quotable (RT-002)
	MaxDeviationPct float64       // reject a new mid deviating > this % from the prior good mid (RT-006)
	Source          string        // provenance label recorded on each snapshot
}

// RateFeed is the authoritative, versioned rate store with staleness and sanity
// guards. It is the ingestion boundary between provider feeds and the quote
// engine: every mid is version-stamped and retained immutably (audit, RT-005),
// wild/crossed rates are rejected at the door (RT-006/EC-002/EC-011), and stale
// rates are reported non-fresh so nothing is priced on them (RT-002).
type RateFeed struct {
	mu      sync.RWMutex
	cfg     RateFeedConfig
	current map[string]RateSnapshot   // pair -> latest good snapshot
	history map[string][]RateSnapshot // pair -> immutable version history
}

// NewRateFeed builds an empty feed with the given guards.
func NewRateFeed(cfg RateFeedConfig) *RateFeed {
	return &RateFeed{
		cfg:     cfg,
		current: map[string]RateSnapshot{},
		history: map[string][]RateSnapshot{},
	}
}

// Publish ingests a new mid rate for a corridor, applying sanity (positive) and
// spike (deviation-band) guards. On success it stores a new immutable, versioned,
// timestamped snapshot and returns it; on rejection the prior good rate is
// retained and an error (ErrRateNonPositive / ErrRateSpike) is returned.
func (f *RateFeed) Publish(from, to string, mid float64, at time.Time) (RateSnapshot, error) {
	return f.publish(from, to, mid, 0, 0, at)
}

// PublishQuote ingests a bid/ask book, rejecting a crossed market (bid > ask,
// i.e. negative spread — EC-011) and non-positive quotes. The mid is derived as
// (bid+ask)/2 and then passes the same spike guard as Publish.
func (f *RateFeed) PublishQuote(from, to string, bid, ask float64, at time.Time) (RateSnapshot, error) {
	if bid <= 0 || ask <= 0 {
		return RateSnapshot{}, ErrRateNonPositive
	}
	if bid > ask {
		return RateSnapshot{}, ErrRateCrossed
	}
	return f.publish(from, to, (bid+ask)/2, bid, ask, at)
}

func (f *RateFeed) publish(from, to string, mid, bid, ask float64, at time.Time) (RateSnapshot, error) {
	if mid <= 0 {
		return RateSnapshot{}, ErrRateNonPositive
	}
	pair := Corridor(from, to)
	f.mu.Lock()
	defer f.mu.Unlock()
	prev, had := f.current[pair]
	if had && f.cfg.MaxDeviationPct > 0 && prev.Mid > 0 {
		dev := (mid - prev.Mid) / prev.Mid
		if dev < 0 {
			dev = -dev
		}
		if dev*100 > f.cfg.MaxDeviationPct {
			return RateSnapshot{}, ErrRateSpike
		}
	}
	version := 1
	if had {
		version = prev.Version + 1
	}
	snap := RateSnapshot{
		Pair: pair, From: from, To: to, Mid: mid, Bid: bid, Ask: ask,
		Source: f.cfg.Source, Version: version, At: at,
	}
	f.current[pair] = snap
	f.history[pair] = append(f.history[pair], snap)
	return snap, nil
}

// Rate returns the current snapshot for a corridor, whether one exists, and
// whether it is stale at `now` (age > TTL). A stale rate is still returned so ops
// can see the last-known value, but Fresh/quote-gating treat it as non-quotable.
func (f *RateFeed) Rate(from, to string, now time.Time) (RateSnapshot, bool, bool) {
	var stale bool
	var ok bool

	var snap RateSnapshot

	f.mu.RLock()
	defer f.mu.RUnlock()
	snap, ok = f.current[Corridor(from, to)]
	if !ok {
		return RateSnapshot{}, false, false
	}
	if f.cfg.TTL > 0 && now.Sub(snap.At) > f.cfg.TTL {
		stale = true
	}
	return snap, true, stale
}

// Fresh reports whether the corridor has a non-stale rate at `now`. An untracked
// corridor returns true (defer to live provider freshness) so the gate only
// blocks corridors the feed actually governs and finds stale.
func (f *RateFeed) Fresh(from, to string, now time.Time) bool {
	_, ok, stale := f.Rate(from, to, now)
	if !ok {
		return true
	}
	return !stale
}

// History returns an immutable copy of every stored version for a corridor
// (audit, RT-005). Mutating the returned slice/elements cannot affect the store.
func (f *RateFeed) History(from, to string) []RateSnapshot {
	f.mu.RLock()
	defer f.mu.RUnlock()
	src := f.history[Corridor(from, to)]
	out := make([]RateSnapshot, len(src))
	copy(out, src)
	return out
}

// SeedFromBaseRates stamps the deterministic base table into the feed at `at`, so
// the common corridors have a versioned, fresh baseline. Production replaces this
// with live provider ticks calling Publish; the guards still apply.
func (f *RateFeed) SeedFromBaseRates(at time.Time) {
	pairs := [][2]string{
		{"USD", "NGN"}, {"EUR", "NGN"}, {"GBP", "NGN"}, {"USD", "GHS"},
		{"USD", "KES"}, {"USD", "XAF"}, {"USD", "ZAR"}, {"USD", "EUR"}, {"USD", "GBP"},
	}
	for _, p := range pairs {
		if mid := MidRate(p[0], p[1]); mid > 0 {
			_, _ = f.Publish(p[0], p[1], mid, at)
		}
	}
}

// StartRateFeedRefresher keeps the deterministic baseline fresh by re-seeding the
// feed on an interval, so the staleness gate stays operational (and would surface
// a genuinely frozen feed) until live provider ticks call Publish directly. It
// seeds once immediately, then ticks until ctx is cancelled.
func StartRateFeedRefresher(ctx context.Context, f *RateFeed, interval time.Duration) {
	if f == nil || interval <= 0 {
		return
	}
	f.SeedFromBaseRates(time.Now())
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				f.SeedFromBaseRates(now)
			}
		}
	}()
}

// baseUSDRates expresses 1 USD = N units of the currency (indicative mid-market).
// In production these are sourced live from provider quote aggregation; the table
// is the deterministic fallback used for indicative display and tests.
var baseUSDRates = map[string]float64{
	"USD":  1,
	"NGN":  1598.20,
	"EUR":  0.92,
	"GBP":  0.79,
	"GHS":  14.80,
	"KES":  129.50,
	"XAF":  602.50,
	"ZAR":  18.40,
	"JPY":  157.00,
	"KWD":  0.307,
	"BHD":  0.376,
	"USDC": 1,
	"USDT": 1,
	"BTC":  1.0 / 64000.0, // ~$64,000 / BTC
	"ETH":  1.0 / 3200.0,  // ~$3,200 / ETH
}

// MidRate returns the indicative mid-market rate: units of `to` per 1 unit of
// `from`, triangulated via USD. Returns 0 if either currency is unknown.
func MidRate(from, to string) float64 {
	from, to = strings.ToUpper(from), strings.ToUpper(to)
	if from == to {
		return 1
	}
	f, okF := baseUSDRates[from]
	t, okT := baseUSDRates[to]
	if !okF || !okT || f == 0 {
		return 0
	}
	return t / f
}

// Corridor renders the canonical corridor label, e.g. "USD-NGN".
func Corridor(from, to string) string {
	return strings.ToUpper(from) + "-" + strings.ToUpper(to)
}

// SupportedCurrency reports whether a currency is in the rate table.
func SupportedCurrency(c string) bool {
	_, ok := baseUSDRates[strings.ToUpper(c)]
	return ok
}

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
