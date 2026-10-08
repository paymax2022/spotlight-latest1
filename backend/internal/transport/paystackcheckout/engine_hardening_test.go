package paystackcheckout

// H7 (initiate flag decoupled from confirm/status/refund) and the L3 hardening
// items: callback_url allowlist, verify-reference assertion, per-user initiate
// rate limit, recoverable authorization persistence.

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/transport"
)

// ── H7 ──────────────────────────────────────────────────────────────────────

func TestInitiateDisabled_KeepsStatusConfirmerAndRefunderLive(t *testing.T) {
	r2 := newRig()
	gin.SetMode(gin.TestMode)
	g2 := gin.New()
	g2.Use(func(c *gin.Context) {
		if u := c.GetHeader("X-Test-User"); u != "" {
			c.Set("user_id", u)
		}
	})
	r2.e.SetInitiateEnabled("fake", false)
	r2.e.RegisterRoutes(g2.Group("/m"))

	// money already collected earlier, while the flag was still on
	r2.e.SetInitiateEnabled("fake", true)
	ref := paid(t, r2)
	r2.e.SetInitiateEnabled("fake", false)
	// new checkouts are refused ...
	if w := do(g2, "POST", "/m/fakes/paystack/initiate", "u1", "key-0000002", `{}`); w.Code != http.StatusNotFound {
		t.Errorf("initiate with the service flag off: %d, want 404 (route unmounted)", w.Code)
	}
	if _, err := r2.e.Initiate(context.Background(), "fake", "u1", []byte(`{}`), "key-0000003", "", ""); !errors.Is(err, ErrServiceDisabled) {
		t.Errorf("engine-level initiate must refuse too (defence in depth): %v", err)
	}
	// ... but the status route still self-heals the paid charge,
	path := "/m/fakes/paystack/" + ref + "/status"
	if w := do(g2, "GET", path, "u1", "", ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"confirmed"`) {
		t.Errorf("status with flag off: %d %s", w.Code, w.Body.String())
	}
	// ... the webhook confirmer still works ...
	if out, err := r2.e.Confirmer().OnChargeSuccess(context.Background(), ref, ref); err != nil || out.(*Result).Status != StatusConfirmed {
		t.Errorf("confirmer with flag off: %v %v", out, err)
	}
	// ... and the refunder still refunds.
	if err := r2.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "cancel"); err != nil {
		t.Errorf("refunder with flag off: %v", err)
	}
}

func TestInitiateDisabled_ReplayOfExistingIntentStillServed(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.e.SetInitiateEnabled("fake", false)
	out, err := r.initiate(t, "u1", key1, `{}`)
	if err != nil || out.Reference != ref {
		t.Fatalf("a replay of an existing checkout must not 404 mid-payment: %+v %v", out, err)
	}
}

// ── L3: callback allowlist ──────────────────────────────────────────────────

func TestCallbackURL_AllowlistedHTTPSOnly_ElseDropped(t *testing.T) {
	cases := []struct {
		name, hosts, in, want string
	}{
		{"allowed", "app.paymax.test", "https://app.paymax.test/pay/done?x=1", "https://app.paymax.test/pay/done?x=1"},
		{"case-insensitive host", "App.Paymax.test", "https://APP.paymax.test/done", "https://APP.paymax.test/done"},
		{"http dropped", "app.paymax.test", "http://app.paymax.test/done", ""},
		{"other host dropped", "app.paymax.test", "https://evil.test/done", ""},
		{"suffix trick dropped", "app.paymax.test", "https://app.paymax.test.evil.test/done", ""},
		{"userinfo trick dropped", "app.paymax.test", "https://app.paymax.test@evil.test/done", ""},
		{"scheme-relative dropped", "app.paymax.test", "//evil.test/done", ""},
		{"javascript dropped", "app.paymax.test", "javascript:alert(1)", ""},
		{"no hosts configured: everything dropped", "", "https://app.paymax.test/done", ""},
		{"garbage dropped", "app.paymax.test", "ht!tp://%%", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newRig()
			if tc.hosts != "" {
				r.e.SetCallbackHosts(tc.hosts)
			}
			if _, err := r.e.Initiate(context.Background(), "fake", "u1", []byte(`{}`), key1, "a@b.test", tc.in); err != nil {
				t.Fatal(err)
			}
			if got := r.gw.initCalls[0].CallbackURL; got != tc.want {
				t.Errorf("callback forwarded to the gateway = %q, want %q", got, tc.want)
			}
		})
	}
}

// ── L3: verify must answer for the reference we asked about ────────────────

func TestVerify_ForADifferentReference_IsRefused_NothingClaimedOrBooked(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.gw.verify = &provider.PaymentStatus{Reference: "fakeorder:somebody-elses", Status: "success", AmountKobo: 250_000, Currency: "NGN"}
	_, err := r.e.OnChargeSuccess(context.Background(), ref, ref)
	if err == nil {
		t.Fatal("a verify response for another transaction must not confirm this intent")
	}
	if r.d.books != 0 || status(t, r, ref).Status != StatusPending {
		t.Errorf("books=%d status=%q: nothing may be claimed/booked off another transaction's verify", r.d.books, status(t, r, ref).Status)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Errorf("must not refund on a verify we cannot attribute")
	}
}

// ── L3: per-user initiate rate limit (status route is NOT limited) ─────────

func TestInitiate_PerUserRateLimited_StatusRouteIsNot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := newRig()
	g := gin.New()
	g.Use(func(c *gin.Context) {
		if u := c.GetHeader("X-Test-User"); u != "" {
			c.Set("user_id", u)
		}
	})
	r.e.RegisterRoutes(g.Group("/m"), WithInitiateMiddleware(middleware.PerUserRateLimit(nil, "test-carddirect", 2)))
	for i, want := range []int{http.StatusCreated, http.StatusCreated, http.StatusTooManyRequests} {
		key := "key-000000" + string(rune('1'+i))
		if w := do(g, "POST", "/m/fakes/paystack/initiate", "u1", key, `{}`); w.Code != want {
			t.Errorf("initiate #%d: %d, want %d", i+1, w.Code, want)
		}
	}
	if w := do(g, "POST", "/m/fakes/paystack/initiate", "u2", "key-0000009", `{}`); w.Code != http.StatusCreated {
		t.Errorf("another user shares no budget: %d", w.Code)
	}
	for i := 0; i < 5; i++ {
		if w := do(g, "GET", "/m/fakes/paystack/fakeorder:key-0000001/status", "u1", "", ""); w.Code == http.StatusTooManyRequests {
			t.Fatalf("status polling must never be rate limited (the poll IS the self-heal)")
		}
	}
}

// ── L3: authorization persistence ───────────────────────────────────────────

func TestInitiate_SaveAuthorizationTransientFailure_IsRetried(t *testing.T) {
	r := newRig()
	r.st.saveFailFirstN = 2
	out, err := r.initiate(t, "u1", key1, `{}`)
	if err != nil {
		t.Fatal(err)
	}
	rec := status(t, r, out.Reference)
	if rec.AuthorizationURL == "" {
		t.Fatal("a transient store blip must not lose the authorization URL: it is the only way to re-serve this checkout")
	}
}

func TestInitiate_SaveAuthorizationPersistentFailure_ReplayIsRecoverable(t *testing.T) {
	r := newRig()
	r.st.saveErr = errors.New("db down")
	r.gw.initErr, r.gw.initErrAfter = errors.New("paystack: Duplicate Transaction Reference"), 2
	out, err := r.initiate(t, "u1", key1, `{}`)
	if err != nil || out.AuthorizationURL == "" {
		t.Fatalf("the first response must still carry the URL so the customer can pay: %+v %v", out, err)
	}
	// The replay cannot re-initialize (Paystack: duplicate reference) and no URL
	// was stored. It must fail with a RECOVERABLE, machine-readable answer rather
	// than a 500 loop ...
	_, err = r.initiate(t, "u1", key1, `{}`)
	ce, ok := errors.AsType[*transport.CodedError](err)
	if !ok || ce.Code != "authorization_unavailable" || ce.Status != http.StatusConflict {
		t.Fatalf("replay error %v, want 409 authorization_unavailable (start a new checkout)", err)
	}
	// ... and the charge the customer DID pay still confirms by reference.
	if res, err := r.e.OnChargeSuccess(context.Background(), out.Reference, out.Reference); err != nil || res.Status != StatusConfirmed {
		t.Errorf("paid charge must still confirm: %+v %v", res, err)
	}
}
