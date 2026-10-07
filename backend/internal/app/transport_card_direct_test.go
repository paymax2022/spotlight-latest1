package app

// H7 wiring: the per-service flag gates ONLY new checkouts. The webhook
// confirmer, status route and refunder (everything protecting money already
// collected) are wired whenever the master flag is on, whatever any service
// flag says. Pure — no DB/Redis/Paystack: the Gin route table and the engine's
// own registries are inspected.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/transport"
	"spotlight/backend/internal/webhooks"
)

func wireCardDirectForTest(t *testing.T, cfg config.Config) (*gin.Engine, *webhooks.PaystackHandler, []string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	g := gin.New()
	g.Use(func(c *gin.Context) {
		if u := c.GetHeader("X-Test-User"); u != "" {
			c.Set("user_id", u)
		}
	})
	wh := webhooks.NewPaystackHandler(nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // no sweeper goroutine in a unit test
	eng := wireTransportCardDirect(ctx, cfg, g.Group("/m"), transport.NewService(nil, nil), nil, nil, nil, wh, nil)
	return g, wh, eng.Prefixes()
}

func hasRoute(g *gin.Engine, method, path string) bool {
	for _, r := range g.Routes() {
		if r.Method == method && r.Path == path {
			return true
		}
	}
	return false
}

const (
	initiatePath = "/m/parcels/paystack/initiate"
	statusPath   = "/m/parcels/paystack/:reference/status"
)

var cardDirectPrefixes = []string{"parcelorder:", "towingorder:", "moversorder:"}

// every card-direct service: its initiate + status routes.
var cardDirectServices = map[string][2]string{
	"parcel": {"/m/parcels/paystack/initiate", "/m/parcels/paystack/:reference/status"},
	"towing": {"/m/towing/paystack/initiate", "/m/towing/paystack/:reference/status"},
	"movers": {"/m/movers/paystack/initiate", "/m/movers/paystack/:reference/status"},
}

func samePrefixes(got []string) bool {
	if len(got) != len(cardDirectPrefixes) {
		return false
	}
	seen := map[string]bool{}
	for _, g := range got {
		seen[g] = true
	}
	for _, w := range cardDirectPrefixes {
		if !seen[w] {
			return false
		}
	}
	return true
}

// With every service flag off (modes on or off) NO card-direct initiate route is
// mounted for ANY service, while every status route and confirmer stays live.
func TestCardDirectWiring_AllServiceFlagsOff_NoInitiateRouteMounted(t *testing.T) {
	for name, cfg := range map[string]config.Config{
		"zero config":                    {},
		"modes on, flags off":            {FeatureTransportModesEnabled: true},
		"towing/movers on but modes off": {FeatureTransportPaystackTowingEnabled: true, FeatureTransportPaystackMoversEnabled: true, FeatureTransportPaystackParcelEnabled: true},
	} {
		t.Run(name, func(t *testing.T) {
			g, _, prefixes := wireCardDirectForTest(t, cfg)
			for svc, paths := range cardDirectServices {
				if hasRoute(g, http.MethodPost, paths[0]) {
					t.Errorf("%s: initiate must not be mounted", svc)
				}
				if !hasRoute(g, http.MethodGet, paths[1]) {
					t.Errorf("%s: status route must stay live", svc)
				}
			}
			if !samePrefixes(prefixes) {
				t.Errorf("prefixes %v", prefixes)
			}
		})
	}
}

// Each service flag mounts ONLY its own initiate route.
func TestCardDirectWiring_ServiceFlagsAreIndependent(t *testing.T) {
	for svc, cfg := range map[string]config.Config{
		"parcel": {FeatureTransportModesEnabled: true, FeatureTransportPaystackParcelEnabled: true},
		"towing": {FeatureTransportModesEnabled: true, FeatureTransportPaystackTowingEnabled: true},
		"movers": {FeatureTransportModesEnabled: true, FeatureTransportPaystackMoversEnabled: true},
	} {
		t.Run(svc, func(t *testing.T) {
			g, _, _ := wireCardDirectForTest(t, cfg)
			for other, paths := range cardDirectServices {
				if got := hasRoute(g, http.MethodPost, paths[0]); got != (other == svc) {
					t.Errorf("initiate for %s mounted=%v with only %s on", other, got, svc)
				}
			}
		})
	}
}

func TestCardDirectWiring_ServiceFlagOff_KeepsConfirmerStatusRefunderLive_UnmountsInitiateOnly(t *testing.T) {
	for name, cfg := range map[string]config.Config{
		"parcel flag off":                   {FeatureTransportModesEnabled: true, FeatureTransportPaystackParcelEnabled: false},
		"parcel flag on but modes flag off": {FeatureTransportModesEnabled: false, FeatureTransportPaystackParcelEnabled: true},
		"everything off but the master":     {},
	} {
		t.Run(name, func(t *testing.T) {
			g, wh, prefixes := wireCardDirectForTest(t, cfg)
			if hasRoute(g, http.MethodPost, initiatePath) {
				t.Error("initiate must be unmounted when the service flag is off")
			}
			if !hasRoute(g, http.MethodGet, statusPath) {
				t.Error("the status route must stay live: a customer who already paid still needs the self-heal poll")
			}
			if !samePrefixes(prefixes) {
				t.Errorf("engine prefixes %v", prefixes)
			}
			if got := wh.PrefixConfirmerPrefixes(); !samePrefixes(got) {
				t.Errorf("webhook confirmer prefixes %v: a paid charge's webhook must still be routed", got)
			}
		})
	}
}

func TestCardDirectWiring_ServiceFlagOn_MountsInitiateToo(t *testing.T) {
	g, wh, _ := wireCardDirectForTest(t, config.Config{FeatureTransportModesEnabled: true, FeatureTransportPaystackParcelEnabled: true})
	if !hasRoute(g, http.MethodPost, initiatePath) || !hasRoute(g, http.MethodGet, statusPath) {
		t.Error("both routes expected when the service flag is on")
	}
	if !samePrefixes(wh.PrefixConfirmerPrefixes()) {
		t.Error("confirmer expected")
	}
}

func TestCardDirectWiring_InitiateIsPerUserRateLimited(t *testing.T) {
	t.Setenv("TRANSPORT_CARD_DIRECT_INITIATE_RATE_PER_MIN", "1")
	g, _, _ := wireCardDirectForTest(t, config.Config{FeatureTransportModesEnabled: true, FeatureTransportPaystackParcelEnabled: true})
	do := func(user string) int {
		req := httptest.NewRequest(http.MethodPost, initiatePath, strings.NewReader("not json")) // 400s before any I/O
		req.Header.Set("X-Test-User", user)
		req.Header.Set("Idempotency-Key", "key-00000001")
		w := httptest.NewRecorder()
		g.ServeHTTP(w, req)
		return w.Code
	}
	if c := do("u1"); c != http.StatusBadRequest {
		t.Fatalf("first request reaches the handler: %d", c)
	}
	if c := do("u1"); c != http.StatusTooManyRequests {
		t.Errorf("second request from the same user: %d, want 429", c)
	}
	if c := do("u2"); c != http.StatusBadRequest {
		t.Errorf("another user has their own budget: %d", c)
	}
}

// L-f: transport files refunds under transport.RefundDomain* strings; the engine
// registers each adapter's refunder under that adapter's Name(). If the two ever
// differ, a card-funded cancel fails closed ("no refunder wired") — or reaches the
// wrong adapter. Pin them together through the REAL wiring.
func TestCardDirectWiring_EveryRefundDomainTransportUsesHasARegisteredAdapterAndRefunder(t *testing.T) {
	gin.SetMode(gin.TestMode)
	wh := webhooks.NewPaystackHandler(nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	svc := transport.NewService(nil, nil)
	eng := wireTransportCardDirect(ctx, config.Config{}, gin.New().Group("/m"), svc, nil, nil, nil, wh, nil)
	for _, d := range []string{transport.RefundDomainParcel, transport.RefundDomainTowing, transport.RefundDomainMovers} {
		if !eng.HasDomain(d) {
			t.Errorf("transport files %q refunds but no card-direct adapter is registered under that name", d)
		}
		if !svc.HasDomainExternalRefunder(d) {
			t.Errorf("no external refunder wired for %q: a card-funded cancel would fail closed", d)
		}
	}
}
