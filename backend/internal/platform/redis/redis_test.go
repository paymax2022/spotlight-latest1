package redis_test

import (
	"testing"

	"spotlight/backend/internal/platform/redis"
)

func TestNew_InvalidURL_Rejects(t *testing.T) {
	_, err := redis.New("not-a-redis-url")
	if err == nil {
		t.Fatal("expected error for invalid URL, got nil")
	}
}

func TestNew_ValidURL_ReturnsClient(t *testing.T) {
	// Client construction is lazy — a valid URL format should succeed even if Redis is unreachable.
	c, err := redis.New("redis://localhost:6379/0")
	if err != nil {
		t.Fatalf("expected no error for well-formed URL, got: %v", err)
	}
	c.Close()
}

func TestNew_WithPassword_ReturnsClient(t *testing.T) {
	c, err := redis.New("redis://:secret@localhost:6379/1")
	if err != nil {
		t.Fatalf("expected no error for URL with password, got: %v", err)
	}
	c.Close()
}
