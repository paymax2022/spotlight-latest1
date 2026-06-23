package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Client is an alias so callers use this package uniformly.
type Client = redis.Client

// New creates a Redis client from the given URL (redis://:password@host:port/db).
func New(url string) (*redis.Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("redis: parse url: %w", err)
	}
	return redis.NewClient(opts), nil
}

// Ping verifies connectivity.
func Ping(ctx context.Context, c *redis.Client) error {
	return c.Ping(ctx).Err()
}

// SetNX stores key→value with TTL only if the key does not exist.
// Returns (true, nil) if the key was set, (false, nil) if it already existed.
func SetNX(ctx context.Context, c *redis.Client, key string, value any, ttl time.Duration) (bool, error) {
	return c.SetNX(ctx, key, value, ttl).Result()
}

// Get retrieves a string value; returns ("", redis.Nil) when not found.
func Get(ctx context.Context, c *redis.Client, key string) (string, error) {
	return c.Get(ctx, key).Result()
}

// Del removes one or more keys.
func Del(ctx context.Context, c *redis.Client, keys ...string) error {
	return c.Del(ctx, keys...).Err()
}

// --- Redlock (single-node advisory lock) ---
// For true distributed Redlock across multiple Redis nodes, use a dedicated
// library. This single-node implementation covers the MVP where one Redis
// instance is used.

const lockTTL = 10 * time.Second

// AcquireLock attempts to acquire a distributed lock for the given key.
// Returns (true, lockValue, nil) on success; (false, "", nil) if already held.
func AcquireLock(ctx context.Context, c *redis.Client, key string, ttl time.Duration) (bool, string, error) {
	val := fmt.Sprintf("%d", time.Now().UnixNano())
	if ttl == 0 {
		ttl = lockTTL
	}
	ok, err := c.SetNX(ctx, "lock:"+key, val, ttl).Result()
	return ok, val, err
}

// ReleaseLock releases a lock only if its value matches (i.e. we hold it).
func ReleaseLock(ctx context.Context, c *redis.Client, key, val string) error {
	const script = `
		if redis.call("get", KEYS[1]) == ARGV[1] then
			return redis.call("del", KEYS[1])
		else
			return 0
		end`
	return c.Eval(ctx, script, []string{"lock:" + key}, val).Err()
}
