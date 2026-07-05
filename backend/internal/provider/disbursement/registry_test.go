package disbursement

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/provider"
)

// TestFailoverOrder locks the pure provider-selection logic: default first, then
// the rest in registration order when failover is on; preferred overrides default;
// failover off yields a single provider.
func TestFailoverOrder(t *testing.T) {
	names := []string{"paystack", "monnify"}
	cases := []struct {
		name      string
		def       string
		preferred string
		failover  bool
		want      []string
	}{
		{"default first, failover on", "paystack", "", true, []string{"paystack", "monnify"}},
		{"default monnify, failover on", "monnify", "", true, []string{"monnify", "paystack"}},
		{"preferred overrides default", "paystack", "monnify", true, []string{"monnify", "paystack"}},
		{"failover off → single", "paystack", "", false, []string{"paystack"}},
		{"unknown preferred falls back to default", "paystack", "wema", true, []string{"paystack", "monnify"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := failoverOrder(names, tc.def, tc.preferred, tc.failover)
			if len(got) != len(tc.want) {
				t.Fatalf("len=%d (%v), want %d (%v)", len(got), got, len(tc.want), tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("order[%d]=%q, want %q (full %v)", i, got[i], tc.want[i], got)
				}
			}
		})
	}
}

// erroringProvider always errors on the money path (recipient + payout).
type erroringProvider struct{ name string }

func (e *erroringProvider) Name() string { return e.name }
func (e *erroringProvider) ListBanks(ctx context.Context) ([]provider.Bank, error) {
	return nil, errors.New("down")
}
func (e *erroringProvider) ResolveAccount(ctx context.Context, b, a string) (*provider.AccountResolution, error) {
	return nil, errors.New("down")
}
func (e *erroringProvider) CreateTransferRecipient(ctx context.Context, r provider.RecipientRequest) (*provider.Recipient, error) {
	return nil, errors.New("down")
}
func (e *erroringProvider) InitiatePayout(ctx context.Context, r provider.PayoutRequest) (*provider.PayoutResponse, error) {
	return nil, errors.New("down")
}
func (e *erroringProvider) GetTransferStatus(ctx context.Context, ref string) (*provider.PayoutStatus, error) {
	return nil, errors.New("down")
}
func (e *erroringProvider) VerifyWebhookSignature(p []byte, s string) bool { return false }
func (e *erroringProvider) ParseWebhook(p []byte) (*provider.WebhookEvent, error) {
	return nil, errors.New("down")
}

// TestInitiatePayoutFailover_DefaultErrorsThenNext verifies the default erroring
// provider fails over to a healthy next, and the succeeding provider is recorded
// with FailoverFrom set.
func TestInitiatePayoutFailover_DefaultErrorsThenNext(t *testing.T) {
	reg := NewRegistry(
		Config{DefaultProvider: "paystack", FailoverEnabled: true},
		&erroringProvider{name: "paystack"},
		NewMock("monnify"),
	)
	res, err := reg.InitiatePayoutFailover(context.Background(), "",
		provider.RecipientRequest{AccountName: "Ada", AccountNumber: "0123456789", BankCode: "058"},
		nil, 500_000, "bt-ref-1", "test")
	if err != nil {
		t.Fatalf("expected failover success, got %v", err)
	}
	if res.Provider != "monnify" {
		t.Fatalf("chosen provider=%q, want monnify", res.Provider)
	}
	if res.FailoverFrom != "paystack" {
		t.Fatalf("failover_from=%q, want paystack", res.FailoverFrom)
	}
}

// TestInitiatePayoutFailover_BothFail verifies an error when every provider fails.
func TestInitiatePayoutFailover_BothFail(t *testing.T) {
	reg := NewRegistry(
		Config{DefaultProvider: "paystack", FailoverEnabled: true},
		&erroringProvider{name: "paystack"},
		&erroringProvider{name: "monnify"},
	)
	_, err := reg.InitiatePayoutFailover(context.Background(), "",
		provider.RecipientRequest{AccountNumber: "0123456789", BankCode: "058"},
		nil, 500_000, "bt-ref-2", "test")
	if err == nil {
		t.Fatal("expected error when all providers fail")
	}
}

// TestInitiatePayoutFailover_NoFailoverStopsAtDefault verifies that with failover
// off, a failing default does NOT try the next provider.
func TestInitiatePayoutFailover_NoFailoverStopsAtDefault(t *testing.T) {
	reg := NewRegistry(
		Config{DefaultProvider: "paystack", FailoverEnabled: false},
		&erroringProvider{name: "paystack"},
		NewMock("monnify"),
	)
	_, err := reg.InitiatePayoutFailover(context.Background(), "",
		provider.RecipientRequest{AccountNumber: "0123456789", BankCode: "058"},
		nil, 500_000, "bt-ref-3", "test")
	if err == nil {
		t.Fatal("expected error: failover disabled, default failed, must not try monnify")
	}
}

// TestMockChosenProviderRecorded verifies a healthy default records itself with no
// failover.
func TestMockChosenProviderRecorded(t *testing.T) {
	reg := NewRegistry(
		Config{DefaultProvider: "paystack", FailoverEnabled: true},
		NewMock("paystack"),
		NewMock("monnify"),
	)
	res, err := reg.InitiatePayoutFailover(context.Background(), "",
		provider.RecipientRequest{AccountNumber: "0123456789", BankCode: "058"},
		nil, 500_000, "bt-ref-4", "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Provider != "paystack" || res.FailoverFrom != "" {
		t.Fatalf("got provider=%q failover=%q, want paystack/empty", res.Provider, res.FailoverFrom)
	}
}
