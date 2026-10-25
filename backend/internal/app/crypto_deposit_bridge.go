package app

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/crypto/deposit"
	"spotlight/backend/internal/cryptoprov"
	"spotlight/backend/internal/cryptosvc"
)

// cryptoDepositBridge adapts the deposit settlement engine (money-IN) to the cryptosvc
// webhook seam. It lives in the app wiring layer so the webhook package never imports the
// deposit engine's types; the engine's decision is mapped onto the webhook outcome
// vocabulary here. The credit it produces comes only from the re-queried deposit — a
// webhook payload names the transfer, never sets its value.
type cryptoDepositBridge struct{ settler *deposit.Settler }

// newCryptoDepositSettler builds the bridge over the live pool. Sub-accounts resolve
// through crypto_accounts, assets through crypto_assets, and each credit is one once-only
// crypto_deposits journal row plus a crypto_holdings upsert, in a single transaction.
// requiredConfs is the platform's confirmation floor; a re-query below it parks as awaiting
// and credits nothing.
func newCryptoDepositSettler(pool *pgxpool.Pool, requiredConfs int) *cryptoDepositBridge {
	resolver := deposit.NewDBResolver(pool, deposit.StaticPolicy{Default: requiredConfs})
	return &cryptoDepositBridge{settler: deposit.NewSettler(resolver, deposit.NewPGStore(pool))}
}

// SettleDeposit implements cryptosvc.DepositSettler.
func (b *cryptoDepositBridge) SettleDeposit(ctx context.Context, provider string, d cryptoprov.Deposit) (cryptosvc.Outcome, error) {
	res, err := b.settler.SettleDeposit(ctx, provider, d)
	if err != nil {
		// A resolver/engine failure must surface as 5xx so the dedupe row is released and
		// the provider redelivers; a real deposit is never dropped on a transient outage.
		return "", err
	}
	switch res.Outcome {
	case deposit.OutcomeSettled:
		return cryptosvc.OutcomeApplied, nil
	case deposit.OutcomeDuplicate:
		return cryptosvc.OutcomeDuplicate, nil
	case deposit.OutcomeAwaiting:
		return cryptosvc.OutcomePending, nil
	default: // unmapped or rejected: recorded, but this delivery credits nobody
		return cryptosvc.OutcomeIgnored, nil
	}
}
