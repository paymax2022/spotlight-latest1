package healthpharmacy

// DB-free coverage for the order-party authorization helpers wired into
// Confirm (pharmacy-owner only) and Complete (patient or pharmacy owner).
// A fake ProviderGate answers VerifiedPharmacyOwner for the owner only, so
// the exercise never touches a database; the nil-gate fallback path
// (provider row owner_user_id) is covered by the live-DB authz tests.

import (
	"context"
	"errors"
	"testing"
)

type authzFakeProv struct {
	ownerID    string
	providerID string
}

func (g authzFakeProv) VerifiedPharmacyOwner(ctx context.Context, userID, providerID string) (bool, error) {
	return userID == g.ownerID && providerID == g.providerID, nil
}

func (g authzFakeProv) IsApprovedPharmacy(ctx context.Context, providerID string) (bool, error) {
	return providerID == g.providerID, nil
}

func authzTestSvc() *Service {
	return NewService(nil, nil, nil, nil, nil,
		authzFakeProv{ownerID: "owner-1", providerID: "prov-1"}, nil, nil)
}

func TestAuthorizeOrderParty(t *testing.T) {
	svc := authzTestSvc()
	ctx := context.Background()
	o := &Order{ID: "order-1", PatientID: "patient-1", PharmacyProviderID: "prov-1"}

	cases := []struct {
		name    string
		actorID string
		wantErr error
	}{
		{"patient may complete", "patient-1", nil},
		{"verified pharmacy owner may complete", "owner-1", nil},
		{"foreign actor denied", "stranger-9", ErrOrderNotFound},
		{"empty actor denied", "", ErrOrderNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := svc.authorizeOrderParty(ctx, tc.actorID, o)
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("authorizeOrderParty(%q) = %v, want nil", tc.actorID, err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("authorizeOrderParty(%q) = %v, want %v", tc.actorID, err, tc.wantErr)
			}
		})
	}

	// The owner of a DIFFERENT pharmacy is a foreign actor for this order.
	other := &Order{ID: "order-2", PatientID: "patient-2", PharmacyProviderID: "prov-2"}
	if err := svc.authorizeOrderParty(ctx, "owner-1", other); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("owner of another pharmacy must be denied ErrOrderNotFound, got %v", err)
	}
}

// Confirm is the pharmacist's acceptance of the order — the patient must NOT
// be able to self-confirm (for an Rx-pending order that would bypass the HL-3
// pharmacist review bound to the verified e-Rx).
func TestAuthorizePharmacyActor_OwnerOnly(t *testing.T) {
	svc := authzTestSvc()
	ctx := context.Background()
	o := &Order{ID: "order-1", PatientID: "patient-1", PharmacyProviderID: "prov-1"}

	if err := svc.authorizePharmacyActor(ctx, "owner-1", o); err != nil {
		t.Fatalf("verified pharmacy owner must confirm: %v", err)
	}
	if err := svc.authorizePharmacyActor(ctx, "patient-1", o); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("patient self-confirm must be denied ErrOrderNotFound, got %v", err)
	}
	if err := svc.authorizePharmacyActor(ctx, "stranger-9", o); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("foreign actor must be denied ErrOrderNotFound, got %v", err)
	}
}
