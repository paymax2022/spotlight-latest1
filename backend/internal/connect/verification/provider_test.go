package connectverification_test

import (
	"context"
	"testing"

	connectverification "spotlight/backend/internal/connect/verification"
)

func newStub(t *testing.T) *connectverification.StubProvider {
	t.Helper()
	h, err := connectverification.NewHasher("test-pepper")
	if err != nil {
		t.Fatalf("hasher: %v", err)
	}
	p, err := connectverification.NewStubProvider(h)
	if err != nil {
		t.Fatalf("stub: %v", err)
	}
	return p
}

func TestStubProviderRequiresHasher(t *testing.T) {
	if _, err := connectverification.NewStubProvider(nil); err == nil {
		t.Fatal("stub must fail closed without a hasher/pepper")
	}
}

func TestStubProviderRejectsEmptyEvidence(t *testing.T) {
	p := newStub(t)
	res, err := p.Check(context.Background(), connectverification.LivenessRequest{
		UserID: "u1", RequestedLevel: connectverification.LevelL1,
	})
	if err == nil {
		t.Fatal("empty selfie ref must error")
	}
	if res.Passed {
		t.Fatal("must not pass without evidence")
	}
}

func TestStubProviderPassesAndIsOpaque(t *testing.T) {
	p := newStub(t)
	res, err := p.Check(context.Background(), connectverification.LivenessRequest{
		UserID:         "u1",
		RequestedLevel: connectverification.LevelL1,
		SelfieRef:      "r2://selfie/raw-secret-key",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Passed || res.Level != connectverification.LevelL1 {
		t.Fatalf("expected L1 pass, got passed=%v level=%s", res.Passed, res.Level)
	}
	// Evidence reference must be opaque — the raw selfie ref must never leak through.
	if res.EvidenceRef == "" {
		t.Fatal("expected an opaque evidence reference")
	}
	if contains(res.EvidenceRef, "raw-secret-key") {
		t.Fatal("evidence reference leaked the raw selfie key")
	}
}

func TestVerificationTransitionGuard(t *testing.T) {
	// Valid level helper.
	if !connectverification.ValidLevel(connectverification.LevelL0) ||
		!connectverification.ValidLevel(connectverification.LevelL1) {
		t.Fatal("l0/l1 must be valid levels")
	}
	if connectverification.ValidLevel("l2") {
		t.Fatal("l2 must be invalid")
	}
}
