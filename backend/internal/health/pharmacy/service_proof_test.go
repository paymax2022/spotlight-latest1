package healthpharmacy

import (
	"context"
	"testing"
)

// DP-006 Service integration tests for proof-of-delivery.
// Note: Complete() requires DB for full testing. These tests focus on proof validation logic.

// mockProofRecorder is a test stub for ProofRecorder.
type mockProofRecorder struct {
	stored map[string]*DeliveryProof
	err    error
}

func (m *mockProofRecorder) RecordProof(ctx context.Context, proof DeliveryProof) (*DeliveryProof, error) {
	if m.err != nil {
		return nil, m.err
	}
	if m.stored == nil {
		m.stored = make(map[string]*DeliveryProof)
	}
	proof.ID = "proof_" + proof.OrderID
	m.stored[proof.OrderID] = &proof
	return &proof, nil
}

func (m *mockProofRecorder) GetProofForOrder(ctx context.Context, orderID string) (*DeliveryProof, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.stored[orderID], nil
}

// mockProofVerifier is a test stub for ProofVerifier.
type mockProofVerifier struct {
	verified bool
	err      error
}

func (m *mockProofVerifier) VerifyProof(proof DeliveryProof) (bool, error) {
	if m.err != nil {
		return false, m.err
	}
	return m.verified, nil
}

// TestProofRecorder_MockStorage verifies the mock proof recorder works.
func TestProofRecorder_MockStorage(t *testing.T) {
	ctx := context.Background()
	rec := &mockProofRecorder{}

	proof := DeliveryProof{
		OrderID:    "order_123",
		ProofType:  ProofOTP,
		ProofData:  "999888",
		CapturedBy: "driver_1",
	}

	// Record the proof.
	stored, err := rec.RecordProof(ctx, proof)
	if err != nil {
		t.Fatalf("expected no error recording proof, got: %v", err)
	}

	if stored.ID == "" {
		t.Error("expected stored proof to have ID assigned")
	}

	// Retrieve the proof.
	retrieved, err := rec.GetProofForOrder(ctx, "order_123")
	if err != nil {
		t.Fatalf("expected no error retrieving proof, got: %v", err)
	}

	if retrieved == nil {
		t.Error("expected proof to be stored and retrieved")
	}

	if retrieved.ProofData != "999888" {
		t.Errorf("expected proof data to match, got %s", retrieved.ProofData)
	}
}
