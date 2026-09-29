package app

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/referral/commissionsplit"
)

// withReferralSplit wires the referral purchase-commission-split hook (20% of
// Spotlight's realized commission to the payer's referrer, capped per referral
// code — see referral/commissionsplit) onto a freshly constructed
// commission.Service, and returns the SAME instance so every one of this
// package's ~18 `commission.NewService(commission.NewRepository(pool), X)`
// call sites gets it by wrapping the constructor call, with no change to any
// function signature.
//
// Constructs its OWN throwaway ledger.Service (nil Redis — Credit falls back
// to the DB's unique idempotency_key constraint, which is the durable
// mechanism anyway; Redis is only ever a fast-path there) rather than reusing
// whatever ledger a given call site passed to commission.NewService itself
// (many pass nil there deliberately, because THAT module posts its own ledger
// entries elsewhere and doesn't want commission.go's internal revenue-post).
// The referral credit is a DIFFERENT ledger leg (paying the referrer) that must
// happen regardless of that choice.
func withReferralSplit(svc *commission.Service, pool *pgxpool.Pool, cfg config.Config) *commission.Service {
	referralLedger := ledger.NewService(ledger.NewRepository(pool), nil)
	svc.SetReferralHook(commissionsplit.NewService(pool, referralLedger, cfg.FeatureReferralCommissionSplitEnabled))
	return svc
}
