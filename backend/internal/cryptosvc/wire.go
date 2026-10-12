package cryptosvc

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cryptoprov"
	"spotlight/backend/internal/cryptoprov/quidax"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/transfers"
)

// WireConfig is everything Wire needs from configuration.
type WireConfig struct {
	// Provider must be "quidax": the swap pipeline refuses to run on a mock.
	Provider      string
	QuidaxKey     string
	QuidaxBaseURL string
	WebhookSecret string
	// DatabaseURL opens the dedicated lock pool (a direct or session-mode connection).
	DatabaseURL       string
	LockPoolConns     int
	ReconcileInterval time.Duration
	Fees              FeeSchedule
	MinTier           tiers.Tier
}

// WireDeps are the already-built collaborators.
type WireDeps struct {
	Pool      *pgxpool.Pool
	Ledger    *ledger.Service
	Tiers     *tiers.Service
	Transfers *transfers.Service
}

// Wired is the assembled swap module.
type Wired struct {
	Deps  HandlerDeps
	Close func()
}

// Wire assembles the swap module and starts the reconciler. It fails closed: any missing
// piece returns an error and the caller must NOT mount routes.
func Wire(ctx context.Context, cfg WireConfig, d WireDeps) (*Wired, error) {
	switch {
	case !strings.EqualFold(strings.TrimSpace(cfg.Provider), "quidax"):
		return nil, errors.New("cryptosvc: CRYPTO_PROVIDER must be quidax to run the swap pipeline")
	case strings.TrimSpace(cfg.QuidaxKey) == "":
		return nil, errors.New("cryptosvc: Quidax API key is not configured")
	case strings.TrimSpace(cfg.WebhookSecret) == "":
		return nil, errors.New("cryptosvc: Quidax webhook secret is not configured (webhooks would all be rejected)")
	case d.Pool == nil || d.Ledger == nil || d.Tiers == nil || d.Transfers == nil:
		return nil, errors.New("cryptosvc: pool, ledger, tiers and transfers services are required")
	case strings.TrimSpace(cfg.DatabaseURL) == "":
		return nil, errors.New("cryptosvc: DATABASE_URL is required for the dedicated lock pool")
	}
	if err := cfg.Fees.Validate(); err != nil {
		return nil, err
	}
	if cfg.MinTier < tiers.Tier1 {
		cfg.MinTier = tiers.Tier1
	}
	if cfg.LockPoolConns <= 0 {
		cfg.LockPoolConns = 40
	}
	if cfg.ReconcileInterval <= 0 {
		cfg.ReconcileInterval = 30 * time.Second
	}

	client, err := quidax.New(quidax.Config{BaseURL: cfg.QuidaxBaseURL, SecretKey: cfg.QuidaxKey, WebhookSecret: cfg.WebhookSecret})
	if err != nil {
		return nil, fmt.Errorf("cryptosvc: quidax client: %w", err)
	}
	reg := cryptoprov.NewRegistry(client.Name())
	if err := reg.Register(client); err != nil {
		return nil, err
	}

	locker, closeLocks, err := NewPGSwapLockerPool(ctx, cfg.DatabaseURL, cfg.LockPoolConns)
	if err != nil {
		return nil, err
	}
	store := NewPGStore(d.Pool)
	settler := NewSettler(d.Ledger).WithLocker(locker)
	auditor := &PGAuditor{Pool: d.Pool}
	ingest := NewIngest(reg, store).WithSettler(settler).WithAuditor(auditor)
	svc := NewService(ServiceConfig{
		Registry: reg, Provider: client.Name(), Store: store, Settler: settler, Ingest: ingest,
		Fees: cfg.Fees, Users: &PGUserDirectory{Pool: d.Pool},
		Gate:   &TierTradeGate{Pool: d.Pool, Tiers: d.Tiers, MinTier: cfg.MinTier},
		Locker: locker, Audit: auditor,
	})

	// The reconciler's leader lock lives on its OWN tiny pool: a flood of confirms can then never
	// starve leader election or the reconciler's own lock connection.
	leaderLocker, closeLeader, err := NewPGSwapLockerPool(ctx, cfg.DatabaseURL, 4)
	if err != nil {
		closeLocks()
		return nil, err
	}

	rctx, cancel := context.WithCancel(ctx)
	rec := NewReconciler(ReconcilerConfig{
		Service: svc, Leader: NewPGLeader(leaderLocker.pool),
		Alert: func(kind, msg string) { log.Printf("[crypto][ALERT] %s: %s", kind, msg) },
		ClearingBalance: func(c context.Context) (int64, error) {
			acct, err := d.Ledger.GetOrCreateStandingAccount(c, ledger.AccountCryptoClearing)
			if err != nil {
				return 0, err
			}
			return d.Ledger.GetAccountBalance(c, acct.ID)
		},
	})
	go rec.Run(rctx, cfg.ReconcileInterval)

	return &Wired{
		Deps:  HandlerDeps{Service: svc, Ingest: ingest, StepUp: &TransfersStepUp{Svc: d.Transfers}},
		Close: func() { cancel(); closeLeader(); closeLocks() },
	}, nil
}
