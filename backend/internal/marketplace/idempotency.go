package marketplace

import (
	"context"
	"encoding/json"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// idempotency implements the §5 `idem:{key}` 24h replay cache. On the first
// request for a key we store the serialized response; a replay returns that exact
// original response body (§3: 409 IDEMPOTENCY_KEY_REPLAY returns the original 201,
// not an error).
//
// Redis is the fast path; when Redis is nil (dev/CI) the durable correctness
// backstop is the DB-side natural uniqueness — mkt_orders.idempotency_key UNIQUE
// and the ledger's own unique idempotency_key. So a nil redis never means a double
// money movement, only that we cannot cheaply replay the cached body.

const idemTTL = 24 * time.Hour

// storedResponse is the cached idempotent response envelope.
type storedResponse struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

// idemKeyRedis is the §5 key pattern.
func idemKeyRedis(key string) string { return "idem:" + key }

// checkIdempotent returns (stored, true, nil) when a prior response is cached for
// the key. When nothing is cached (or Redis is nil) it returns (_, false, nil).
func checkIdempotent(ctx context.Context, rdb *goredis.Client, key string) (*storedResponse, bool, error) {
	if rdb == nil || key == "" {
		return nil, false, nil
	}
	raw, err := rdb.Get(ctx, idemKeyRedis(key)).Result()
	if err == goredis.Nil {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, nil // treat cache miss on error; DB unique is the backstop
	}
	var sr storedResponse
	if err := json.Unmarshal([]byte(raw), &sr); err != nil {
		return nil, false, nil
	}
	return &sr, true, nil
}

// saveIdempotent caches a response body under the key for 24h. Best-effort: a
// Redis failure is swallowed (DB-unique remains the correctness backstop).
func saveIdempotent(ctx context.Context, rdb *goredis.Client, key string, status int, body any) {
	if rdb == nil || key == "" {
		return
	}
	b, err := json.Marshal(body)
	if err != nil {
		return
	}
	sr := storedResponse{Status: status, Body: b}
	raw, err := json.Marshal(sr)
	if err != nil {
		return
	}
	// SetNX so a concurrent double-submit does not clobber the first stored body.
	_ = rdb.SetNX(ctx, idemKeyRedis(key), raw, idemTTL).Err()
}

// replayError is returned by the service to signal the handler to replay the cached
// body (HTTP 409 semantics but with the original 2xx payload).
type replayError struct {
	Stored *storedResponse
}

func (replayError) Error() string { return "idempotency replay" }

// asReplay unwraps a replayError, if present.
func asReplay(err error) (*storedResponse, bool) {
	if re, ok := err.(replayError); ok {
		return re.Stored, true
	}
	return nil, false
}
