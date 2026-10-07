package app

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/middleware"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/provider/paystack"
	"spotlight/backend/internal/transport"
	transportpaystackcheckout "spotlight/backend/internal/transport/paystackcheckout"
	"spotlight/backend/internal/webhooks"
)

// wireTransportCardDirect mounts the SHARED Mobility card-direct engine and
// every per-service domain (ADR-PRTBD-mobility-card-direct). Called from the
// existing master-flag block in finance_routes.go, i.e. only when
// FEATURE_TRANSPORT_PAYSTACK_CHECKOUT_ENABLED is on and a Paystack client
// exists. A new service adds ONE entry to the domains table below (plus its
// own flag in config.go) — nothing else in the composition root changes.
//
// The per-service flag gates ONLY new checkouts (the initiate route and the
// engine's own Initiate). Everything that protects money already collected —
// the webhook confirmer, the status/self-heal route, the cancel-refund refunder
// and the reconciliation sweeper — is registered for every domain whenever the
// master flag is on, so switching a service off (kill switch) can never strand
// a customer who has already paid.
func wireTransportCardDirect(
	ctx context.Context,
	cfg config.Config,
	mob *gin.RouterGroup,
	transportSvc *transport.Service,
	pool *pgxpool.Pool,
	paystackClient *paystack.Client,
	settlementSvc *settlement.Service,
	webhookHandler *webhooks.PaystackHandler,
	redisClient *platformRedis.Client,
) *transportpaystackcheckout.Engine {
	cardStore := transportpaystackcheckout.NewPGStore(pool)
	engine := transportpaystackcheckout.NewEngine(paystackClient, cardStore, settlementSvc)
	// Piece (partial) refunds for a charge that funds several settlements (car
	// hire fare + deposit). Inert for parcel/towing/movers, which never produce a
	// settlement keyed "<reference>:<suffix>"; without this such a refund fails closed.
	engine.EnablePartialRefunds(paystackClient, cardStore)
	// How long after a refund POST was started an EMPTY gateway lookup is still not
	// trusted to mean "no refund exists" (Paystack's list can lag). Default 10 min.
	engine.SetPartialLagBound(time.Duration(envInt("TRANSPORT_CARD_DIRECT_REFUND_LAG_MINUTES", 10)) * time.Minute)

	// callback_url allowlist: https hosts only; empty ⇒ every client-supplied
	// callback is dropped (Paystack then uses the dashboard default).
	var hosts []string
	for _, h := range strings.Split(os.Getenv("TRANSPORT_CARD_DIRECT_CALLBACK_HOSTS"), ",") {
		if h = strings.TrimSpace(h); h != "" {
			hosts = append(hosts, h)
		}
	}
	engine.SetCallbackHosts(hosts...)

	// Domains table: adapter + the flag that lets it take NEW checkouts. Initiate
	// routes live beside the wallet routes in the transport-modes block, so a
	// service also needs that flag to take new checkouts.
	domains := []struct {
		initiateEnabled bool
		domain          transportpaystackcheckout.Domain
	}{
		{cfg.FeatureTransportModesEnabled && cfg.FeatureTransportPaystackParcelEnabled, transportpaystackcheckout.NewParcelDomain(transportSvc)},
		{cfg.FeatureTransportModesEnabled && cfg.FeatureTransportPaystackTowingEnabled, transportpaystackcheckout.NewTowingDomain(transportSvc)},
		{cfg.FeatureTransportModesEnabled && cfg.FeatureTransportPaystackMoversEnabled, transportpaystackcheckout.NewMoversDomain(transportSvc)},
		{cfg.FeatureTransportModesEnabled && cfg.FeatureTransportPaystackCarHireEnabled, transportpaystackcheckout.NewCarHireDomain(transportSvc)},
	}
	for _, d := range domains {
		engine.Register(d.domain)
		engine.SetInitiateEnabled(d.domain.Name(), d.initiateEnabled)
		transportSvc.SetDomainExternalRefunder(d.domain.Name(), engine.RefunderFor(d.domain.Name()))
		if webhookHandler != nil {
			webhookHandler.RegisterPrefixConfirmer(d.domain.ReferencePrefix(), engine.Confirmer())
		}
		log.Printf("[transport] card-direct %q wired (prefix %s, initiate=%t)", d.domain.Name(), d.domain.ReferencePrefix(), d.initiateEnabled)
	}

	// Per-user cap on checkout creation (every initiate is a server quote + a
	// Paystack API call). The status route is deliberately NOT limited: the poll
	// is the self-heal.
	initiateLimit := middleware.PerUserRateLimit(redisClient, "mobility-carddirect-initiate",
		envInt("TRANSPORT_CARD_DIRECT_INITIATE_RATE_PER_MIN", 20))
	engine.RegisterRoutes(mob, transportpaystackcheckout.WithInitiateMiddleware(initiateLimit))

	// Reconciliation sweeper: drives paid-but-unconfirmed charges and stranded
	// refunds to a terminal state. Runs under the master flag (this function's
	// precondition) regardless of any per-service flag.
	transportpaystackcheckout.StartReconciler(ctx, engine,
		time.Duration(envInt("TRANSPORT_CARD_DIRECT_RECONCILE_INTERVAL_MINUTES", 5))*time.Minute,
		time.Duration(envInt("TRANSPORT_CARD_DIRECT_RECONCILE_MIN_AGE_MINUTES", 5))*time.Minute)
	return engine
}
