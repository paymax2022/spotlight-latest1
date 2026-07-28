package disbursement

import (
	"context"

	"spotlight/backend/internal/provider"
)

// liveWrap wraps a real DisbursementProvider with a deterministic mock fallback.
// Read paths (ListBanks/ResolveAccount/GetTransferStatus) degrade to the mock on
// transport error so the corridor stays usable in dev/CI; the MONEY path
// (CreateTransferRecipient/InitiatePayout) does NOT silently fall back — its error
// is surfaced so the registry's cross-provider failover (and the service's
// funds_reserved hold) can decide, never double-spending. Webhook verification
// and parsing always use the real client (the mock is only reached when no real
// client is configured, via NewMock directly).
type liveWrap struct {
	real provider.DisbursementProvider
	mock provider.DisbursementProvider
}

// NewLive wraps a real client (mock-first when real is nil). name tags the mock.
func NewLive(name string, real provider.DisbursementProvider) provider.DisbursementProvider {
	if real == nil {
		return NewMock(name)
	}
	return &liveWrap{real: real, mock: NewMock(name)}
}

func (w *liveWrap) Name() string { return w.real.Name() }

func (w *liveWrap) ListBanks(ctx context.Context) ([]provider.Bank, error) {
	banks, err := w.real.ListBanks(ctx)
	if err != nil || len(banks) == 0 {
		return w.mock.ListBanks(ctx)
	}
	return banks, nil
}

func (w *liveWrap) ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*provider.AccountResolution, error) {
	res, err := w.real.ResolveAccount(ctx, bankCode, accountNumber)
	if err != nil || res == nil {
		return w.mock.ResolveAccount(ctx, bankCode, accountNumber)
	}
	return res, nil
}

func (w *liveWrap) CreateTransferRecipient(ctx context.Context, req provider.RecipientRequest) (*provider.Recipient, error) {
	// Money-adjacent: surface the real error so failover can act.
	return w.real.CreateTransferRecipient(ctx, req)
}

func (w *liveWrap) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	// Money path: never silently mock — the registry handles failover.
	return w.real.InitiatePayout(ctx, req)
}

func (w *liveWrap) GetTransferStatus(ctx context.Context, providerRef string) (*provider.PayoutStatus, error) {
	res, err := w.real.GetTransferStatus(ctx, providerRef)
	if err != nil || res == nil {
		return w.mock.GetTransferStatus(ctx, providerRef)
	}
	return res, nil
}

func (w *liveWrap) VerifyWebhookSignature(payload []byte, signature string) bool {
	return w.real.VerifyWebhookSignature(payload, signature)
}

func (w *liveWrap) ParseWebhook(payload []byte) (*provider.WebhookEvent, error) {
	return w.real.ParseWebhook(payload)
}
