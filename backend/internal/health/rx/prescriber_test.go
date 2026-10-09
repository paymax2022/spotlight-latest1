package healthrx

import (
	"context"
	"errors"
	"testing"
)

type fakePrescriberAuth struct {
	ok  bool
	err error
}

func (f fakePrescriberAuth) IsAuthorizedPrescriber(context.Context, string) (bool, error) {
	return f.ok, f.err
}

// CR-004: the scope-of-practice gate fail-closed — an unauthorized prescriber, or a
// lookup error, blocks issuance; a nil authorizer is a no-op; an authorized
// prescriber passes.
func TestAuthorizePrescriberGate(t *testing.T) {
	ctx := context.Background()

	// Unauthorized → blocked with the typed error.
	if err := authorizePrescriber(ctx, fakePrescriberAuth{ok: false}, "dr1"); err == nil {
		t.Fatal("unauthorized prescriber must be blocked")
	} else {
		var ue *UnauthorizedPrescriberError
		if !errors.As(err, &ue) || ue.PrescriberID != "dr1" {
			t.Fatalf("expected UnauthorizedPrescriberError for dr1, got %v", err)
		}
	}
	// Lookup error → fail-closed (blocked), error wrapped.
	sentinel := errors.New("boom")
	if err := authorizePrescriber(ctx, fakePrescriberAuth{err: sentinel}, "dr1"); err == nil || !errors.Is(err, sentinel) {
		t.Fatalf("a lookup error must fail closed, got %v", err)
	}
	// Authorized → allowed.
	if err := authorizePrescriber(ctx, fakePrescriberAuth{ok: true}, "dr1"); err != nil {
		t.Fatalf("authorized prescriber must pass, got %v", err)
	}
	// Nil authorizer → no-op (route RBAC + caller gates apply).
	if err := authorizePrescriber(ctx, nil, "dr1"); err != nil {
		t.Fatalf("nil authorizer must be a no-op, got %v", err)
	}
}

// End-to-end at the Issue boundary: an unauthorized prescriber is rejected BEFORE
// any DB work (the gate runs before the transaction), so a nil-DB service suffices.
func TestIssueBlocksUnauthorizedPrescriber(t *testing.T) {
	svc := NewService(nil, nil).WithPrescriberAuthorizer(fakePrescriberAuth{ok: false})
	_, err := svc.Issue(context.Background(), "dr1", "patient", nil, []Item{{DrugName: "Amoxicillin", Quantity: 1}})
	if _, ok := errors.AsType[*UnauthorizedPrescriberError](err); !ok {
		t.Fatalf("Issue must reject an unauthorized prescriber at the boundary, got %v", err)
	}
}

type fakePharmacyGate struct {
	ok  bool
	err error
}

func (f fakePharmacyGate) VerifiedPharmacyOwner(context.Context, string, string) (bool, error) {
	return f.ok, f.err
}

func strptr(s string) *string { return &s }

// HL-3 object authz on transitions: send is prescriber-or-patient only;
// pharmacist-side edges require ownership of the pinned pharmacy when a gate is
// wired and fail closed on a missing pin or lookup error.
func TestAuthorizeActorGate(t *testing.T) {
	ctx := context.Background()
	rx := &prescriptionRow{Prescription: Prescription{
		PrescriberID:       "dr1",
		PatientID:          "pat1",
		PharmacyProviderID: strptr("prov1"),
	}}

	svc := NewService(nil, nil).WithPharmacyOwnerGate(fakePharmacyGate{ok: true})

	// Send: prescriber and patient pass; a third party is denied.
	if err := svc.authorizeActor(ctx, "dr1", rx, StateSent); err != nil {
		t.Fatalf("prescriber may send, got %v", err)
	}
	if err := svc.authorizeActor(ctx, "pat1", rx, StateSent); err != nil {
		t.Fatalf("patient may send, got %v", err)
	}
	if err := svc.authorizeActor(ctx, "mallory", rx, StateSent); err == nil {
		t.Fatal("a third party must not send the prescription")
	}

	// Pharmacist-side: owner passes, non-owner denied.
	if err := svc.authorizeActor(ctx, "pharmacist", rx, StateDispensed); err != nil {
		t.Fatalf("pinned pharmacy owner may dispense, got %v", err)
	}
	deny := NewService(nil, nil).WithPharmacyOwnerGate(fakePharmacyGate{ok: false})
	if err := deny.authorizeActor(ctx, "mallory", rx, StateDispensed); err == nil {
		t.Fatal("non-owner must not dispense")
	}
	if err := deny.authorizeActor(ctx, "mallory", rx, StateVerified); err == nil {
		t.Fatal("non-owner must not verify")
	}

	// Fail closed: no pinned pharmacy or a lookup error denies.
	unpinned := &prescriptionRow{Prescription: Prescription{PrescriberID: "dr1", PatientID: "pat1"}}
	if err := svc.authorizeActor(ctx, "pharmacist", unpinned, StateDispensed); err == nil {
		t.Fatal("unpinned prescription must deny pharmacist-side transitions")
	}
	broken := NewService(nil, nil).WithPharmacyOwnerGate(fakePharmacyGate{err: errors.New("boom")})
	if err := broken.authorizeActor(ctx, "pharmacist", rx, StateDispensed); err == nil {
		t.Fatal("a lookup error must fail closed")
	}

	// Nil gate: legacy behaviour (route RBAC / caller gates apply).
	legacy := NewService(nil, nil)
	if err := legacy.authorizeActor(ctx, "anyone", rx, StateDispensed); err != nil {
		t.Fatalf("nil gate must be a no-op, got %v", err)
	}
}
