package kyc_test

import (
	"context"
	"testing"

	"spotlight/backend/internal/finance/kyc"
)

// SaveVerifiedIdentity persists a provider-verified legal identity onto the
// user's profile. An empty user id is a programming error on the money/identity
// path: it must fail fast WITHOUT touching the DB (the pool is nil here, so a
// deref would panic) rather than issuing a WHERE id='' UPDATE.
func TestSaveVerifiedIdentity_EmptyUserRejected(t *testing.T) {
	svc := kyc.NewService(nil)
	if err := svc.SaveVerifiedIdentity(context.Background(), "", "JOHN DOE", "JOHN", "DOE", "1990-05-02"); err == nil {
		t.Fatal("empty user id must be rejected before any DB access")
	}
}

// Nothing to persist (every field empty) is a no-op that returns nil WITHOUT
// touching the DB — we never issue an UPDATE that would blank a profile's name,
// and the nil pool must not be dereferenced on this path.
func TestSaveVerifiedIdentity_NothingToPersistIsNoop(t *testing.T) {
	svc := kyc.NewService(nil)
	if err := svc.SaveVerifiedIdentity(context.Background(), "user-1", "", "", "", ""); err != nil {
		t.Fatalf("all-empty identity should be a silent no-op, got %v", err)
	}
}
