package app

import (
	"log"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/orchestration/adapters"
	"spotlight/backend/internal/provider/eversend"
	"spotlight/backend/internal/provider/maplerad"
	"spotlight/backend/internal/provider/vertofx"
)

// buildFXProviders assembles the FX orchestration provider set. Eversend and
// Maplerad are always present (live adapter when credentials are configured,
// deterministic otherwise). VertoFX is appended only when FEATURE_VERTOFX is on.
func buildFXProviders(cfg *config.Config) []orchestration.Provider {
	// Maplerad: live HTTP adapter when a secret key is configured, else the
	// deterministic adapter (keeps the corridor routable in dev/CI).
	var mplProvider orchestration.Provider
	if cfg.MapleradSecretKey != "" {
		mplProvider = adapters.NewMapleradLive(
			maplerad.New(cfg.MapleradSecretKey, cfg.MapleradProd).WithBaseURL(cfg.MapleradBaseURL),
			cfg.MapleradWebhookSecret, cfg.MapleradProd,
		)
		log.Println("[finance] FX orchestration: Maplerad LIVE adapter enabled")
	} else {
		mplProvider = adapters.NewMapleradFX(cfg.MapleradProd)
	}
	// Eversend: live HTTP adapter when client credentials are configured.
	var evsProvider orchestration.Provider
	if cfg.EversendClientID != "" && cfg.EversendClientSecret != "" {
		evsProvider = adapters.NewEversendLive(
			eversend.New(cfg.EversendClientID, cfg.EversendClientSecret, cfg.EversendProd),
			cfg.EversendWebhookSecret, cfg.EversendProd,
		)
		log.Println("[finance] FX orchestration: Eversend LIVE adapter enabled")
	} else {
		evsProvider = adapters.NewEversend(cfg.EversendProd)
	}
	providers := []orchestration.Provider{
		evsProvider,
		mplProvider,
	}
	if cfg.FeatureVertoFXEnabled {
		vc := vertofx.New(cfg.VertoFXClientID, cfg.VertoFXAPIKey, cfg.VertoFXProd)
		if cfg.VertoFXBaseURL != "" {
			vc = vc.WithBaseURL(cfg.VertoFXBaseURL)
		}
		vc = vc.WithWebhookSecret(cfg.VertoFXWebhookSecret)
		providers = append(providers, adapters.NewVertoFXLive(vc, cfg.VertoFXWebhookSecret, cfg.VertoFXProd))
		log.Println("[finance] FX orchestration: VertoFX adapter enabled")
	}
	return providers
}
