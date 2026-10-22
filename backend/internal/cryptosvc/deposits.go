package cryptosvc

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// Deposits on the provider rail. The provider credits crypto to the user's own
// sub-account, so there is NO platform ledger movement: the holding shows up in
// GET /swaps/balances. What the platform owns is (1) a per-user deposit address, cached
// once issued, and (2) a deposit record, written only from a provider RE-QUERY (a webhook
// payload is a hint, never the truth), for history and notification. ADR-PR855.

// DepositRecord is one inbound deposit as last confirmed by the provider.
type DepositRecord struct {
	Provider              string
	ProviderDepositID     string
	UserID                string
	Currency              string
	Network               string
	Address               string
	Amount                decimal.Decimal
	Fee                   decimal.Decimal
	TxID                  string
	Status                cryptoprov.DepositStatus
	Confirmations         int
	RequiredConfirmations int
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// DepositStore persists deposit addresses and deposit records.
type DepositStore interface {
	// UserByProviderAccount maps a provider sub-account back to its platform user.
	UserByProviderAccount(ctx context.Context, provider, accountID string) (string, bool, error)
	SavedDepositAddress(ctx context.Context, userID, provider, currency, network string) (cryptoprov.DepositAddress, bool, error)
	// SaveDepositAddress keeps the FIRST address saved for (user, provider, currency, network).
	SaveDepositAddress(ctx context.Context, userID, provider string, a cryptoprov.DepositAddress) error
	// UpsertDeposit records a deposit. Status only moves forward (pending -> accepted or
	// rejected; a terminal status never changes); confirmations only increase. changed
	// reports whether anything was written.
	UpsertDeposit(ctx context.Context, d DepositRecord) (changed bool, err error)
	ListDeposits(ctx context.Context, userID string, limit int) ([]DepositRecord, error)
}

// depositAdvances reports whether next is a forward move from prev.
func depositAdvances(prev, next cryptoprov.DepositStatus) bool {
	return prev == cryptoprov.DepositPending && next != cryptoprov.DepositPending
}

var (
	depositAssetRe = regexp.MustCompile(`^[A-Z0-9]{2,10}$`)
	networkRe      = regexp.MustCompile(`^[a-z0-9_-]{0,20}$`)
	// ErrDepositsUnavailable means the deposit store is not wired.
	ErrDepositsUnavailable = errors.New("cryptosvc: deposits are not configured")
	// ErrInvalidDepositRequest is a malformed asset or network.
	ErrInvalidDepositRequest = errors.New("cryptosvc: invalid asset or network")
)

// DepositAddress returns the user's address for asset on network, provisioning the provider
// account and address on first use and caching it after. It returns
// cryptoprov.ErrAddressPending while the provider is still generating the address.
func (s *Service) DepositAddress(ctx context.Context, userID, asset, network string) (cryptoprov.DepositAddress, error) {
	asset = normAsset(asset)
	network = strings.ToLower(strings.TrimSpace(network))
	switch {
	case s.cfg.Deposits == nil:
		return cryptoprov.DepositAddress{}, ErrDepositsUnavailable
	case userID == "":
		return cryptoprov.DepositAddress{}, errors.New("cryptosvc: user id is required")
	case !depositAssetRe.MatchString(asset) || asset == "NGN" || !networkRe.MatchString(network):
		return cryptoprov.DepositAddress{}, ErrInvalidDepositRequest
	}
	if err := s.gate(ctx, userID); err != nil { // same KYC gate as trading, fail-closed
		return cryptoprov.DepositAddress{}, err
	}
	if a, ok, err := s.cfg.Deposits.SavedDepositAddress(ctx, userID, s.cfg.Provider, asset, network); err != nil {
		return cryptoprov.DepositAddress{}, err
	} else if ok {
		return a, nil
	}
	var out cryptoprov.DepositAddress
	err := s.locked(ctx, "addr:"+userID+":"+asset+":"+network, func(ctx context.Context) error {
		if a, ok, err := s.cfg.Deposits.SavedDepositAddress(ctx, userID, s.cfg.Provider, asset, network); err != nil {
			return err
		} else if ok {
			out = a
			return nil
		}
		p, err := s.provider()
		if err != nil {
			return err
		}
		wp, err := cryptoprov.As[cryptoprov.WalletProvider](p)
		if err != nil {
			return err
		}
		acct, err := s.ensureAccount(ctx, p, userID)
		if err != nil {
			return err
		}
		// Read first: asking to create again can mint a second address on some networks.
		a, err := wp.DepositAddress(ctx, acct, asset, network)
		if errors.Is(err, cryptoprov.ErrAddressPending) {
			a, err = wp.CreateDepositAddress(ctx, acct, asset, network)
		}
		if err != nil {
			return err
		}
		a.Currency, a.Network = asset, network
		if err := s.cfg.Deposits.SaveDepositAddress(ctx, userID, s.cfg.Provider, a); err != nil {
			return err
		}
		saved, ok, err := s.cfg.Deposits.SavedDepositAddress(ctx, userID, s.cfg.Provider, asset, network)
		if err != nil {
			return err
		}
		if !ok {
			return errors.New("cryptosvc: deposit address was not saved")
		}
		out = saved // a concurrent writer's address wins: one address per user and network
		s.audit(ctx, userID, "crypto.deposit.address_issued", "", "", map[string]any{"asset": asset, "network": network})
		return nil
	})
	return out, err
}

// Deposits lists the user's recorded deposits, newest first.
func (s *Service) Deposits(ctx context.Context, userID string, limit int) ([]DepositRecord, error) {
	if s.cfg.Deposits == nil {
		return nil, ErrDepositsUnavailable
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.cfg.Deposits.ListDeposits(ctx, userID, limit)
}

// WithDeposits enables deposit webhooks (re-queried and recorded).
func (i *Ingest) WithDeposits(d DepositStore) *Ingest { i.deposits = d; return i }

func isDepositEvent(t string) bool { return strings.HasPrefix(t, "deposit.") }

// processDeposit re-reads the deposit from the provider and records it. Errors the
// provider can fix by redelivering (a failed re-query, a store error) are returned; an
// event we can never act on (no account named, an account that isn't ours) is ignored.
func (i *Ingest) processDeposit(ctx context.Context, p cryptoprov.Provider, providerName string, ev cryptoprov.Event) (Outcome, error) {
	if ev.Account == "" || ev.Ref == "" {
		log.Printf("[crypto] deposit event %s names no account or id; ignored", ev.Key)
		return OutcomeIgnored, nil
	}
	userID, ok, err := i.deposits.UserByProviderAccount(ctx, providerName, ev.Account)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: look up deposit account: %w", err)
	}
	if !ok {
		log.Printf("[crypto] deposit %s is for an account we did not create; ignored", ev.Ref)
		return OutcomeIgnored, nil
	}
	dp, err := cryptoprov.As[cryptoprov.DepositProvider](p)
	if err != nil {
		return "", err
	}
	d, err := dp.GetDeposit(ctx, ev.Account, ev.Ref)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: re-query deposit: %w", err)
	}
	if d.AccountID != "" && d.AccountID != ev.Account {
		return "", fmt.Errorf("cryptosvc: deposit %s belongs to account %s, not %s", d.ID, d.AccountID, ev.Account)
	}
	changed, err := i.deposits.UpsertDeposit(ctx, DepositRecord{
		Provider: providerName, ProviderDepositID: d.ID, UserID: userID, Currency: d.Currency, Network: d.Network,
		Address: d.Address, Amount: d.Amount, Fee: d.Fee, TxID: d.TxID, Status: d.Status,
		Confirmations: d.Confirmations, RequiredConfirmations: d.RequiredConfirmations,
	})
	if err != nil {
		return "", fmt.Errorf("cryptosvc: record deposit: %w", err)
	}
	if changed && i.audit != nil {
		i.audit.Audit(ctx, AuditEvent{Actor: "system:provider", Action: "crypto.deposit." + string(d.Status), EntityID: d.ID,
			Detail: map[string]any{"user_id": userID, "asset": d.Currency, "amount": d.Amount.String(), "confirmations": d.Confirmations}})
	}
	return OutcomeApplied, nil
}
