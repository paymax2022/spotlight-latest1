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
	var ue *UnauthorizedPrescriberError
	if !errors.As(err, &ue) {
		t.Fatalf("Issue must reject an unauthorized prescriber at the boundary, got %v", err)
	}
}
