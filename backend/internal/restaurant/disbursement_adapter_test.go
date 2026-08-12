package restaurant

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/disbursement"
)

// mockDisbursementProvider is a test stub for DisbursementProvider.
type mockDisbursementProvider struct {
	name              string
	createRecipErr    error
	initiatePayoutErr error
	payout            *provider.PayoutResponse
}

func (m *mockDisbursementProvider) ListBanks(ctx context.Context) ([]provider.Bank, error) {
	return nil, nil
}

func (m *mockDisbursementProvider) ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*provider.AccountResolution, error) {
	return nil, nil
}

func (m *mockDisbursementProvider) CreateTransferRecipient(ctx context.Context, req provider.RecipientRequest) (*provider.Recipient, error) {
	if m.createRecipErr != nil {
		return nil, m.createRecipErr
	}
	return &provider.Recipient{Code: "test_recipient_code"}, nil
}

func (m *mockDisbursementProvider) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	if m.initiatePayoutErr != nil {
		return nil, m.initiatePayoutErr
	}
	if m.payout != nil {
		return m.payout, nil
	}
	return &provider.PayoutResponse{
		TransferCode: "test_transfer_123",
		Status:       "success",
		Reference:    req.Reference,
		ProviderRef:  "test_transfer_123",
	}, nil
}

func (m *mockDisbursementProvider) GetTransferStatus(ctx context.Context, providerRef string) (*provider.PayoutStatus, error) {
	return nil, nil
}

func (m *mockDisbursementProvider) VerifyWebhookSignature(payload []byte, signature string) bool {
	return true
}

func (m *mockDisbursementProvider) ParseWebhook(payload []byte) (*provider.WebhookEvent, error) {
	return nil, nil
}

func (m *mockDisbursementProvider) Name() string {
	return m.name
}

// TestRegistryDisburser_Success verifies the happy path: recipient created and
// payout initiated successfully.
func TestRegistryDisburser_Success(t *testing.T) {
	ctx := context.Background()
	mock := &mockDisbursementProvider{name: "test_provider"}

	reg := disbursement.NewRegistry(
		disbursement.Config{DefaultProvider: "test_provider"},
		mock,
	)

	disburser := NewRegistryDisburser(reg)

	req := WithdrawalDisburseRequest{
		WithdrawalID:   "w123",
		AmountKobo:     50000,
		BankCode:       "050",
		AccountNumber:  "1234567890",
		AccountName:    "John Doe",
		Reference:      "withdrawal_ref_123",
		IdempotencyKey: "idem_key_123",
	}

	result, err := disburser.Disburse(ctx, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.Executed {
		t.Error("expected Executed=true")
	}

	if result.ProviderReference != "test_transfer_123" {
		t.Errorf("expected ProviderReference='test_transfer_123', got '%s'", result.ProviderReference)
	}
}

// TestRegistryDisburser_RecipientCreationFails verifies that creation errors
// result in Executed=false (funds stay reserved).
func TestRegistryDisburser_RecipientCreationFails(t *testing.T) {
	ctx := context.Background()
	mock := &mockDisbursementProvider{
		name:           "test_provider",
		createRecipErr: errors.New("network error"),
	}

	reg := disbursement.NewRegistry(
		disbursement.Config{DefaultProvider: "test_provider"},
		mock,
	)

	disburser := NewRegistryDisburser(reg)

	req := WithdrawalDisburseRequest{
		WithdrawalID:   "w123",
		AmountKobo:     50000,
		BankCode:       "050",
		AccountNumber:  "1234567890",
		AccountName:    "John Doe",
		Reference:      "withdrawal_ref_123",
		IdempotencyKey: "idem_key_123",
	}

	result, err := disburser.Disburse(ctx, req)
	if err == nil {
		t.Error("expected error for recipient creation failure")
	}

	if result.Executed {
		t.Error("expected Executed=false when recipient creation fails")
	}
}

// TestRegistryDisburser_PayoutInitiationFails verifies that payout errors
// result in Executed=false (funds stay reserved).
func TestRegistryDisburser_PayoutInitiationFails(t *testing.T) {
	ctx := context.Background()
	mock := &mockDisbursementProvider{
		name:                "test_provider",
		initiatePayoutErr:   errors.New("insufficient balance"),
	}

	reg := disbursement.NewRegistry(
		disbursement.Config{DefaultProvider: "test_provider"},
		mock,
	)

	disburser := NewRegistryDisburser(reg)

	req := WithdrawalDisburseRequest{
		WithdrawalID:   "w123",
		AmountKobo:     50000,
		BankCode:       "050",
		AccountNumber:  "1234567890",
		AccountName:    "John Doe",
		Reference:      "withdrawal_ref_123",
		IdempotencyKey: "idem_key_123",
	}

	result, err := disburser.Disburse(ctx, req)
	if err == nil {
		t.Error("expected error for payout initiation failure")
	}

	if result.Executed {
		t.Error("expected Executed=false when payout initiation fails")
	}
}

// TestRegistryDisburser_NoProviderConfigured verifies graceful fallback to
// NoopDisburser behavior (Executed=false) when no provider is configured.
func TestRegistryDisburser_NoProviderConfigured(t *testing.T) {
	ctx := context.Background()

	// Empty registry (no providers)
	reg := disbursement.NewRegistry(
		disbursement.Config{DefaultProvider: ""},
	)

	disburser := NewRegistryDisburser(reg)

	req := WithdrawalDisburseRequest{
		WithdrawalID:   "w123",
		AmountKobo:     50000,
		BankCode:       "050",
		AccountNumber:  "1234567890",
		AccountName:    "John Doe",
		Reference:      "withdrawal_ref_123",
		IdempotencyKey: "idem_key_123",
	}

	result, err := disburser.Disburse(ctx, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Executed {
		t.Error("expected Executed=false when no provider is configured")
	}
}
