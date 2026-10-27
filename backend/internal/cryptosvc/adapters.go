package cryptosvc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cryptoprov"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/transfers"
)

// TierTradeGate allows trading only for an active, non-deleted account at or above MinTier.
// It fails closed: an unknown user, a lookup error or a low tier all refuse.
type TierTradeGate struct {
	Pool    *pgxpool.Pool
	Tiers   *tiers.Service
	MinTier tiers.Tier
}

var _ TradeGate = (*TierTradeGate)(nil)

// CanTrade implements TradeGate.
func (g *TierTradeGate) CanTrade(ctx context.Context, userID string) error {
	if g == nil || g.Pool == nil || g.Tiers == nil || userID == "" {
		return fmt.Errorf("%w: gate not configured", ErrTradeNotAllowed)
	}
	var status string
	var deleted bool
	err := g.Pool.QueryRow(ctx, `SELECT status, deleted_at IS NOT NULL FROM public.platform_users WHERE id = $1::uuid`, userID).Scan(&status, &deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: unknown account", ErrTradeNotAllowed)
	}
	if err != nil {
		return fmt.Errorf("cryptosvc: trade gate lookup: %w", err)
	}
	if deleted || !strings.EqualFold(status, "active") {
		return fmt.Errorf("%w: account is %s", ErrTradeNotAllowed, status)
	}
	tier, err := g.Tiers.GetUserTier(ctx, userID)
	if err != nil {
		return fmt.Errorf("cryptosvc: trade gate tier lookup: %w", err)
	}
	if tier < g.MinTier {
		return fmt.Errorf("%w: KYC tier %d is below the required tier %d", ErrTradeNotAllowed, tier, g.MinTier)
	}
	return nil
}

// PGUserDirectory reads the identity fields a provider account needs from platform_users.
type PGUserDirectory struct{ Pool *pgxpool.Pool }

var _ UserDirectory = (*PGUserDirectory)(nil)

// UserRef implements UserDirectory. It never returns KYC documents, only name and email.
func (d *PGUserDirectory) UserRef(ctx context.Context, userID string) (cryptoprov.UserRef, error) {
	var email, first, last *string
	err := d.Pool.QueryRow(ctx, `SELECT email, first_name, last_name FROM public.platform_users WHERE id = $1::uuid`, userID).Scan(&email, &first, &last)
	if err != nil {
		return cryptoprov.UserRef{}, fmt.Errorf("cryptosvc: user lookup: %w", err)
	}
	ref := cryptoprov.UserRef{UserID: userID}
	if email != nil {
		ref.Email = *email
	}
	if first != nil {
		ref.FirstName = *first
	}
	if last != nil {
		ref.LastName = *last
	}
	if ref.Email == "" {
		return cryptoprov.UserRef{}, errors.New("cryptosvc: the account has no email; a provider account cannot be created")
	}
	return ref, nil
}

// PgDepositAccountSource lists the provider sub-accounts the platform holds crypto for, so
// the deposit reconciler knows whose deposit list to poll. It reads the same crypto_accounts
// rows the deposit resolver maps a sub-account back to an owner from. The DISTINCT keeps the
// sweep to one visit per sub-account even if history ever held duplicates.
type PgDepositAccountSource struct{ Pool *pgxpool.Pool }

var _ DepositAccountSource = (*PgDepositAccountSource)(nil)

// ListProviderAccounts implements DepositAccountSource.
func (s *PgDepositAccountSource) ListProviderAccounts(ctx context.Context, provider string) ([]string, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT DISTINCT provider_account_id FROM public.crypto_accounts WHERE provider = $1 AND provider_account_id <> '' ORDER BY provider_account_id`,
		provider)
	if err != nil {
		return nil, fmt.Errorf("cryptosvc: list provider accounts: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("cryptosvc: scan provider account: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// TransfersStepUp adapts the wallet's transaction-PIN service as the swap confirm second factor.
type TransfersStepUp struct{ Svc *transfers.Service }

var _ StepUp = (*TransfersStepUp)(nil)

// HasPin implements StepUp.
func (s *TransfersStepUp) HasPin(ctx context.Context, userID string) (bool, error) {
	return s.Svc.HasPin(ctx, userID)
}

// VerifyPin implements StepUp, translating the PIN service's refusals.
func (s *TransfersStepUp) VerifyPin(ctx context.Context, userID, pin string) error {
	if strings.TrimSpace(pin) == "" {
		return ErrStepUpRejected // defence in depth: never score an empty guess
	}
	err := s.Svc.VerifyPin(ctx, userID, pin)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, transfers.ErrPinInvalid), errors.Is(err, transfers.ErrPinLocked), errors.Is(err, transfers.ErrPinNotSet):
		return fmt.Errorf("%w: %v", ErrStepUpRejected, err)
	}
	return err
}
