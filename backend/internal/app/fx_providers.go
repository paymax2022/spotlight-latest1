package app

import (
	"errors"
	"log"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/orchestration/adapters"
	"spotlight/backend/internal/provider/eversend"
	"spotlight/backend/internal/provider/vertofx"
)

// buildFXProviders assembles the FX orchestration provider set. Eversend is
// always present (live adapter when credentials are configured, deterministic
// otherwise). VertoFX is appended only when FEATURE_VERTOFX is on.
// ErrEversendCredentialsMissing: production refuses the deterministic Eversend
// adapter; it would price and "settle" real money with synthetic data.
var ErrEversendCredentialsMissing = errors.New("fx: Eversend credentials required in production")

func buildFXProviders(cfg *config.Config) ([]orchestration.Provider, error) {
	// Eversend: live HTTP adapter when client credentials are configured.
	var evsProvider orchestration.Provider
	if cfg.EversendClientID != "" && cfg.EversendClientSecret != "" {
		evsProvider = adapters.NewEversendLive(
			eversend.New(cfg.EversendClientID, cfg.EversendClientSecret, cfg.EversendProd),
			cfg.EversendWebhookSecret, cfg.EversendProd,
		)
		log.Println("[finance] FX orchestration: Eversend LIVE adapter enabled")
	} else {
		if cfg.IsProd() {
			return nil, ErrEversendCredentialsMissing
		}
		evsProvider = adapters.NewEversend(cfg.EversendProd)
	}
	providers := []orchestration.Provider{
		evsProvider,
	}
	if cfg.FeatureVertoFXEnabled {
		vc := vertofx.New(cfg.VertoFXClientID, cfg.VertoFXAPIKey, cfg.VertoFXProd)
		if cfg.VertoFXBaseURL != "" {
			vc = vc.WithBaseURL(cfg.VertoFXBaseURL)
		}
		vc = vc.WithWebhookSecret(cfg.VertoFXWebhookSecret)
		providers = append(providers, adapters.NewVertoFXLive(vc, cfg.VertoFXWebhookSecret, cfg.VertoFXProd))
		log.Println("[finance] FX orchestration: VertoFX adapter enabled")
		if cfg.VertoFXClientID == "" || cfg.VertoFXAPIKey == "" {
			log.Println("[finance] WARNING: FEATURE_VERTOFX is on but VertoFX credentials are empty; it will run in offline-mock mode and could win default routing in non-prod")
		}
	}
	return providers, nil
}
