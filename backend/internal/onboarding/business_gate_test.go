package onboarding

import (
	"context"
	"errors"
	"testing"
)

// fakeGate is a test double for BusinessGate. It records the userID it was asked
// about so we can assert the gate is consulted with the applicant's id (not the
// reviewer's) and returns a canned verified/unverified answer.
type fakeGate struct {
	verified   bool
	calledWith string
}

func (f *fakeGate) HasVerifiedBusiness(_ context.Context, userID string) bool {
	f.calledWith = userID
	return f.verified
}

// TestBusinessGateBlocks covers the merchant-upgrade gate decision in isolation
// (no database): the predicate that Submit and Approve share.
func TestBusinessGateBlocks(t *testing.T) {
	cases := []struct {
		name             string
		requiresBusiness bool
		gate             *fakeGate // nil → no gate configured
		wantBlocked      bool
	}{
		{
			name:             "no gate configured never blocks (feature off)",
			requiresBusiness: true,
			gate:             nil,
			wantBlocked:      false,
		},
		{
			name:             "type not flagged is never blocked even with a gate",
			requiresBusiness: false,
			gate:             &fakeGate{verified: false},
			wantBlocked:      false,
		},
		{
			name:             "flagged type with a verified business is allowed",
			requiresBusiness: true,
			gate:             &fakeGate{verified: true},
			wantBlocked:      false,
		},
		{
			name:             "flagged type without a verified business is blocked",
			requiresBusiness: true,
			gate:             &fakeGate{verified: false},
			wantBlocked:      true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &Service{}
			if tc.gate != nil {
				s.SetBusinessGate(tc.gate)
			}
			mt := &MerchantType{RequiresBusiness: tc.requiresBusiness}
			got := s.businessGateBlocks(context.Background(), mt, "user-123")
			if got != tc.wantBlocked {
				t.Fatalf("businessGateBlocks = %v, want %v", got, tc.wantBlocked)
			}
			// When a flagged type consults the gate, it must ask about the id passed in.
			if tc.gate != nil && tc.requiresBusiness && tc.gate.calledWith != "user-123" {
				t.Fatalf("gate consulted for %q, want %q", tc.gate.calledWith, "user-123")
			}
		})
	}
}

// TestSetBusinessGateNilLeavesDisabled confirms passing nil is a no-op that keeps
// the gate disabled rather than panicking or forcing a block.
func TestSetBusinessGateNilLeavesDisabled(t *testing.T) {
	s := &Service{}
	s.SetBusinessGate(nil)
	mt := &MerchantType{RequiresBusiness: true}
	if s.businessGateBlocks(context.Background(), mt, "user-1") {
		t.Fatal("nil gate must not block")
	}
}

// TestErrBusinessRequiredShape asserts the blocked path returns a field-scoped
// ValidationError (mapped to 422 by the handler), not an opaque error.
func TestErrBusinessRequiredShape(t *testing.T) {
	err := errBusinessRequired()
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want *ValidationError, got %T", err)
	}
	if _, ok := ve.Fields["business"]; !ok {
		t.Fatalf("want a 'business' field message, got %v", ve.Fields)
	}
}
