package transfers_test

// resolve-account must distinguish a malformed request (400) from a
// well-formed lookup miss (404). DB-free: the malformed branch returns before
// the registry is touched.

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"spotlight/backend/internal/finance/transfers"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/disbursement"
)

// missingAccountProvider answers every name enquiry with an error — the
// registry's failover then exhausts and ResolveAccount surfaces the
// lookup-miss sentinel.
type missingAccountProvider struct{}

func (missingAccountProvider) Name() string { return "missing" }
func (missingAccountProvider) ListBanks(context.Context) ([]provider.Bank, error) {
	return nil, errors.New("missing: no banks")
}
func (missingAccountProvider) ResolveAccount(context.Context, string, string) (*provider.AccountResolution, error) {
	return nil, errors.New("missing: account not resolvable")
}
func (missingAccountProvider) CreateTransferRecipient(context.Context, provider.RecipientRequest) (*provider.Recipient, error) {
	return nil, errors.New("missing")
}
func (missingAccountProvider) InitiatePayout(context.Context, provider.PayoutRequest) (*provider.PayoutResponse, error) {
	return nil, errors.New("missing")
}
func (missingAccountProvider) GetTransferStatus(context.Context, string) (*provider.PayoutStatus, error) {
	return nil, errors.New("missing")
}
func (missingAccountProvider) VerifyWebhookSignature([]byte, string) bool { return false }
func (missingAccountProvider) ParseWebhook([]byte) (*provider.WebhookEvent, error) {
	return nil, errors.New("missing")
}

func TestResolveAccount_MalformedInputIs400(t *testing.T) {
	// Nil registry: the malformed branch must return BEFORE the registry is
	// consulted, so a nil-registry panic would fail this test too.
	svc := transfers.NewService(nil, nil, nil, nil, nil)

	bad := []transfers.ResolveAccountRequest{
		{AccountNumber: "123", BankCode: "058"},         // too short
		{AccountNumber: "abcdefghij", BankCode: "058"},  // non-numeric
		{AccountNumber: "0123456789", BankCode: ""},     // missing bank code
		{AccountNumber: "0123456789", BankCode: "   "},  // blank bank code
		{AccountNumber: "01234567890", BankCode: "058"}, // 11 digits
	}
	for _, req := range bad {
		_, err := svc.ResolveAccount(context.Background(), req)
		if !errors.Is(err, transfers.ErrInvalidAccountNumber) {
			t.Fatalf("ResolveAccount(%+v) = %v, want ErrInvalidAccountNumber", req, err)
		}
		if got := transfers.HTTPStatusForError(err); got != http.StatusBadRequest {
			t.Fatalf("ResolveAccount(%+v): status = %d, want 400", req, got)
		}
		if got := transfers.ErrorCode(err); got != "invalid_account_number" {
			t.Fatalf("ResolveAccount(%+v): code = %q, want invalid_account_number", req, got)
		}
	}
}

func TestResolveAccount_LookupMissStays404(t *testing.T) {
	reg := disbursement.NewRegistry(
		disbursement.Config{DefaultProvider: "missing", FailoverEnabled: false},
		missingAccountProvider{},
	)
	svc := transfers.NewService(nil, nil, nil, nil, reg)

	_, err := svc.ResolveAccount(context.Background(), transfers.ResolveAccountRequest{
		AccountNumber: "0123456789", BankCode: "058",
	})
	if !errors.Is(err, transfers.ErrInvalidAccount) {
		t.Fatalf("lookup miss = %v, want ErrInvalidAccount", err)
	}
	if got := transfers.HTTPStatusForError(err); got != http.StatusNotFound {
		t.Fatalf("lookup miss: status = %d, want 404", got)
	}
	if got := transfers.ErrorCode(err); got != "invalid_account" {
		t.Fatalf("lookup miss: code = %q, want invalid_account", got)
	}
}

// The same split applies to SaveBeneficiary: malformed destination is a 400;
// a well-formed destination that resolves to nothing stays the 404 sentinel.
func TestSaveBeneficiary_MalformedDestinationIs400(t *testing.T) {
	svc := transfers.NewService(nil, nil, nil, nil, nil)

	_, err := svc.SaveBeneficiary(context.Background(), "user-1", transfers.SaveBeneficiaryRequest{
		AccountNumber: "123", BankCode: "058",
	})
	if !errors.Is(err, transfers.ErrInvalidAccountNumber) {
		t.Fatalf("SaveBeneficiary malformed = %v, want ErrInvalidAccountNumber", err)
	}
	if got := transfers.HTTPStatusForError(err); got != http.StatusBadRequest {
		t.Fatalf("SaveBeneficiary malformed: status = %d, want 400", got)
	}
}
