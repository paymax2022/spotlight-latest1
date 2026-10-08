package kycverify

import (
	"context"
	"errors"
	"testing"
)

// GetSession must reject a malformed (non-UUID) session id BEFORE the query —
// verification_session.id is uuid, so a bad shape used to hit Postgres
// "invalid input syntax" and surface as a 500 on every caller (member
// GET /session/:id, POST /checks/* session_id, admin case resolve). The guard
// runs before the pool is touched, so a nil-pool repo exercises it directly.
func TestGetSessionMalformedIDReturnsInvalidRequest(t *testing.T) {
	repo := NewRepository(nil) // guard must fire before any DB access
	for _, id := range []string{"not-a-uuid", "1234", "", "zzzzzzzz-0000-0000-0000-000000000000"} {
		if _, err := repo.GetSession(context.Background(), id); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("id=%q: want ErrInvalidRequest (→400), got %v", id, err)
		}
	}
}
