package app

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/crossborder/onboarding"
	"spotlight/backend/internal/crossborder/onboarding/verto"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/transfers"
	"spotlight/backend/internal/orchestration"
	platformCrypto "spotlight/backend/internal/platform/crypto"
)

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now().UTC() }

// pinStepUp adapts the wallet transaction-PIN service as the Global Account
// step-up (the existing money-action second factor).
type pinStepUp struct{ svc *transfers.Service }

func (p pinStepUp) HasPin(ctx context.Context, userID string) (bool, error) {
	return p.svc.HasPin(ctx, userID)
}

func (p pinStepUp) VerifyPin(ctx context.Context, userID, pin string) error {
	err := p.svc.VerifyPin(ctx, userID, pin)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, transfers.ErrPinInvalid), errors.Is(err, transfers.ErrPinLocked), errors.Is(err, transfers.ErrPinNotSet):
		return onboarding.ErrStepUpRejected
	}
	return err
}

// buildGlobalOnboarding assembles the SP-2 onboarding service. It returns nil
// (feature fully inert) when FEATURE_SPOTLIGHT_GLOBAL is off, the pool is
// missing, or the PII key is unusable — it fails closed rather than storing
// funding account numbers unencrypted.
func buildGlobalOnboarding(cfg *config.Config, pool *pgxpool.Pool, tr onboarding.TierReader) (*onboarding.Service, *onboarding.ProfileStore) {
	if !cfg.FeatureSpotlightGlobalEnabled {
		return nil, nil
	}
	if pool == nil {
		log.Println("[global] FEATURE_SPOTLIGHT_GLOBAL is on but there is no database pool — Global Account disabled")
		return nil, nil
	}
	cipher, err := platformCrypto.NewCipherFromBase64Key(cfg.KYCPIIEncKey)
	if err != nil {
		log.Printf("[global] FEATURE_SPOTLIGHT_GLOBAL is on but KYC_PII_ENC_KEY is unusable (%v) — Global Account disabled", err)
		return nil, nil
	}
	if cfg.VertoFXClientID == "" || cfg.VertoFXAPIKey == "" {
		if cfg.VertoFXProd {
			log.Println("[global] FEATURE_SPOTLIGHT_GLOBAL is on but Verto credentials are empty in prod — Global Account disabled")
			return nil, nil
		}
		log.Println("[global] WARNING: Verto credentials are empty; Global Account runs against the offline mock (non-prod only)")
	}
	adapter := verto.New(newVertoClient(cfg))
	profiles := onboarding.NewProfileStore(pool)
	docTypes := map[onboarding.DocumentKind]string{}
	for k, v := range map[onboarding.DocumentKind]string{
		onboarding.DocIdentity:       cfg.GlobalDocTypeIdentity,
		onboarding.DocAddressProof:   cfg.GlobalDocTypeAddressProof,
		onboarding.DocIncorporation:  cfg.GlobalDocTypeIncorporation,
		onboarding.DocOwnershipChart: cfg.GlobalDocTypeOwnershipChart,
	} {
		if v != "" {
			docTypes[k] = v
		}
	}
	svc := onboarding.NewService(onboarding.Deps{
		Store:     onboarding.NewRepository(pool, cipher),
		Accounts:  adapter,
		Wallets:   adapter,
		KYC:       profiles,
		Profiles:  profiles,
		Tiers:     tr,
		Clock:     systemClock{},
		DocTypeID: docTypes,
	})
	log.Println("[global] Global Account onboarding service built")
	return svc, profiles
}

// mountGlobalOnboarding registers /v1/global/* behind FEATURE_SPOTLIGHT_GLOBAL.
// With the flag off (or no service) it mounts NOTHING. auth must be the
// authenticating middleware (RequireAuthContext) — every route is user-scoped.
func mountGlobalOnboarding(r gin.IRouter, cfg *config.Config, svc *onboarding.Service,
	profiles onboarding.ProfileReader, stepUp onboarding.StepUp, auth gin.HandlerFunc) bool {
	if !cfg.FeatureSpotlightGlobalEnabled || svc == nil {
		return false
	}
	h := onboarding.NewHandler(svc, profiles, stepUp, onboarding.HandlerConfig{
		TnCVersion: cfg.GlobalTnCVersion, TnCURL: cfg.GlobalTnCURL,
	})
	g := r.Group("/v1/global")
	g.Use(auth)
	h.Register(g)
	log.Println("[global] Global Account routes registered at /v1/global")
	return true
}

var _ onboarding.TierReader = (*tiers.Service)(nil)

// orchestrationOptions returns the orchestration service options. The account
// lifecycle applier is attached ONLY when the onboarding service exists, so a
// nil *onboarding.Service can never become a non-nil interface (which would
// make account.* webhooks call into a nil service instead of just logging).
func orchestrationOptions(defaultProvider string, global *onboarding.Service) []orchestration.ServiceOption {
	opts := []orchestration.ServiceOption{orchestration.WithDefaultProvider(defaultProvider)}
	if global != nil {
		opts = append(opts, orchestration.WithAccountLifecycle(global))
	}
	return opts
}
