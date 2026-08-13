package restaurant

import (
	"context"
	"fmt"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/disbursement"
)

// RegistryDisburser wraps a disbursement provider registry and implements
// WithdrawalDisburser, routing withdrawal disbursements through the configured
// provider (e.g., Paystack, Monnify).
type RegistryDisburser struct {
	reg *disbursement.Registry
}

// NewRegistryDisburser creates a disbursement adapter from the provider registry.
func NewRegistryDisburser(reg *disbursement.Registry) *RegistryDisburser {
	return &RegistryDisburser{reg: reg}
}

// Disburse sends merchant withdrawal funds to a saved bank account via the
// configured provider. It:
//   1. looks up the provider's default (or preferred, if available)
//   2. resolves or creates a transfer recipient for the account
//   3. initiates a payout
//   4. returns the provider reference for later webhook reconciliation
//
// On any provider error, Executed=false (the withdrawal stays reserved;
// a webhook will attempt to settle or reverse it).
func (d *RegistryDisburser) Disburse(ctx context.Context, req WithdrawalDisburseRequest) (WithdrawalDisburseResult, error) {
	// Get the default disbursement provider (e.g., "paystack").
	providerName := d.reg.Default()
	if providerName == "" {
		// No provider configured; stay in sandbox (NoopDisburser behavior).
		return WithdrawalDisburseResult{Executed: false}, nil
	}

	prov, ok := d.reg.ByName(providerName)
	if !ok {
		// Provider not found; fall back to sandbox.
		return WithdrawalDisburseResult{Executed: false}, nil
	}

	// ── Step 1: Ensure we have a recipient code for this bank account ──
	// In a real integration, you'd cache recipient codes in a table
	// (restaurant_bank_accounts.provider_recipient_code or similar).
	// For now, create/re-create on each withdrawal attempt.

	recipientReq := provider.RecipientRequest{
		AccountName:   req.AccountName,
		AccountNumber: req.AccountNumber,
		BankCode:      req.BankCode,
		Currency:      "NGN",
	}

	recipient, err := prov.CreateTransferRecipient(ctx, recipientReq)
	if err != nil {
		// Recipient creation failed; withdrawal stays reserved (Executed=false).
		// On retry, the provider may return the cached recipient.
		return WithdrawalDisburseResult{Executed: false}, fmt.Errorf("create recipient: %w", err)
	}

	// ── Step 2: Initiate the payout ──
	payoutReq := provider.PayoutRequest{
		RecipientCode: recipient.Code,
		AmountKobo:    req.AmountKobo,
		Reference:    req.Reference,       // Withdrawal ID or a ledger reference
		Narration:    "Restaurant Withdrawal", // Short memo on the bank statement
		IdempotencyKey: req.IdempotencyKey,
	}

	payout, err := prov.InitiatePayout(ctx, payoutReq)
	if err != nil {
		// Payout initiation failed; withdrawal stays reserved.
		return WithdrawalDisburseResult{Executed: false}, fmt.Errorf("initiate payout: %w", err)
	}

	// ── Step 3: Return success with the provider reference for webhooks ──
	// The MarkWithdrawalPaid/MarkWithdrawalFailed webhooks will use ProviderRef
	// to look up the withdrawal and finalize the ledger entries.
	return WithdrawalDisburseResult{
		Executed:          true,
		ProviderReference: payout.ProviderRef, // e.g., Paystack transfer_code
	}, nil
}
