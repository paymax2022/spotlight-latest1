package social

// Object-level authZ on pool/split reads (w9 prod probe F2 + residual sweep).
//
// F2 (already fixed upstream in b729606f): PoolBalance took NO caller id —
// any authenticated user could read any pool's contribution sum, a balance
// oracle that also confirmed pool-id existence (random uuid → 200 balance:0).
//
// Residuals fixed in this lane:
//   - GetSplit answered 403 "not a participant" for an EXISTING foreign bill
//     vs 404 for a nonexistent one — an existence oracle on the same class
//     of object (share rosters reveal who owes whom how much). The check is
//     now in the service and answers uniform ErrNotFound, identical to the
//     PoolBalance doctrine.
//   - Service.GetPool was exported with no caller scoping at all; it now
//     goes through callerPool so any future route mount inherits the gate.
//
// The DB-free errMap pin runs always; the end-to-end proofs are gated on
// TEST_DATABASE_URL like the rest of this package's live suite.

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestErrMap_AuthZSentinels(t *testing.T) {
	// The uniform-404 doctrine only works if ErrNotFound maps to 404 — a
	// non-stakeholder must receive the SAME response shape a random uuid
	// gets, so the route cannot distinguish "exists but not yours" from
	// "does not exist".
	if got := errMap.Code(ErrNotFound); got != http.StatusNotFound {
		t.Errorf("errMap.Code(ErrNotFound) = %d, want 404 (uniform refusal, no oracle)", got)
	}
	if got := errMap.Code(ErrForbidden); got != http.StatusForbidden {
		t.Errorf("errMap.Code(ErrForbidden) = %d, want 403", got)
	}
}

// PoolBalance + GetPool must refuse a caller with no stake in the pool —
// organiser, beneficiary, or contributor only — with the SAME ErrNotFound a
// nonexistent pool returns.
func TestLiveDB_SocialPoolReads_NonStakeholder_NotFound(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	beneficiary := socialTestUser(t, pool)
	outsider := socialTestUser(t, pool)

	p, err := svc.CreatePool(ctx, organiser, "authz-pool", &beneficiary)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}

	// Non-stakeholder: balance and pool reads answer ErrNotFound — identical
	// to a pool that never existed.
	if _, err := svc.PoolBalance(ctx, outsider, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider PoolBalance err = %v, want ErrNotFound", err)
	}
	if _, err := svc.GetPool(ctx, outsider, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider GetPool err = %v, want ErrNotFound", err)
	}
	// Same refusal for an id that does not exist — the two must be
	// indistinguishable at the route.
	randomID := uuid.NewString()
	if _, err := svc.PoolBalance(ctx, outsider, randomID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id PoolBalance err = %v, want ErrNotFound", err)
	}
	if _, err := svc.GetPool(ctx, outsider, randomID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id GetPool err = %v, want ErrNotFound", err)
	}

	// Stakeholders still read fine: organiser and beneficiary.
	if _, err := svc.PoolBalance(ctx, organiser, p.ID); err != nil {
		t.Fatalf("organiser PoolBalance err = %v, want nil", err)
	}
	if _, err := svc.PoolBalance(ctx, beneficiary, p.ID); err != nil {
		t.Fatalf("beneficiary PoolBalance err = %v, want nil", err)
	}
	if got, err := svc.GetPool(ctx, beneficiary, p.ID); err != nil || got.ID != p.ID {
		t.Fatalf("beneficiary GetPool = %+v err=%v, want the pool", got, err)
	}
}

// GetSplit must refuse a non-participant with ErrNotFound — the shares list
// reveals who owes whom, so even confirming existence is a leak.
func TestLiveDB_SocialGetSplit_NonParticipant_NotFound(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	participant := socialTestUser(t, pool)
	outsider := socialTestUser(t, pool)

	// Participants are resolved by cashtag, so both the organiser and the
	// participant need claimed handles before the split can be created.
	handle := "az" + shortTag()
	if _, err := svc.tags.Claim(ctx, participant, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	orgHandle := "oz" + shortTag()
	if _, err := svc.tags.Claim(ctx, organiser, orgHandle); err != nil {
		t.Fatalf("claim organiser handle: %v", err)
	}
	bill, shares, err := svc.CreateSplit(ctx, organiser, "authz-split", 500_00, SplitEqual,
		[]ShareInput{{Handle: orgHandle}, {Handle: handle}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}
	if len(shares) != 2 {
		t.Fatalf("want 2 shares, got %d", len(shares))
	}

	// Outsider: uniform ErrNotFound, same as a nonexistent split id.
	if _, _, err := svc.GetSplit(ctx, outsider, bill.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider GetSplit err = %v, want ErrNotFound", err)
	}
	if _, _, err := svc.GetSplit(ctx, outsider, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id GetSplit err = %v, want ErrNotFound", err)
	}

	// Organiser and participant still read the bill + shares.
	if got, gotShares, err := svc.GetSplit(ctx, organiser, bill.ID); err != nil || got.ID != bill.ID || len(gotShares) != 2 {
		t.Fatalf("organiser GetSplit = %+v shares=%d err=%v", got, len(gotShares), err)
	}
	if got, _, err := svc.GetSplit(ctx, participant, bill.ID); err != nil || got.ID != bill.ID {
		t.Fatalf("participant GetSplit = %+v err=%v", got, err)
	}
}
