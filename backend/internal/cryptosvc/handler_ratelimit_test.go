package cryptosvc

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
)

func deny429(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "rate limit exceeded", "code": "rate_limited"})
}

// The limiter must run BEFORE the handler body. A request that carries no
// Idempotency-Key (quote) or no PIN (confirm) would be a 400 from the handler, so
// a 429 proves the limiter sat in front and the handler never ran.
func TestLimitersRunBeforeTheHandlers(t *testing.T) {
	h := newHTTPRigWith(t, "u1", func(d *HandlerDeps) { d.QuoteLimit, d.ConfirmLimit = deny429, deny429 })
	for _, p := range []string{"POST /api/v1/crypto/swaps/quote", "POST /api/v1/crypto/swaps/x/confirm"} {
		m, path, _ := strings.Cut(p, " ")
		w := h.do(m, path, `{}`, nil)
		if w.Code != http.StatusTooManyRequests {
			t.Errorf("%s -> %d, want 429 (limiter must precede the handler)", p, w.Code)
		}
	}
	if h.su.calls != 0 {
		t.Fatalf("a rate-limited confirm reached the PIN check %d time(s)", h.su.calls)
	}
}

// Polling a swap and the provider webhook are not user-initiated money steps and must
// never be throttled by the quote/confirm budgets.
func TestLimitersDoNotTouchReadsOrTheWebhook(t *testing.T) {
	h := newHTTPRigWith(t, "u1", func(d *HandlerDeps) { d.QuoteLimit, d.ConfirmLimit = deny429, deny429 })
	if w := h.do("GET", "/api/v1/crypto/swaps/not-a-uuid", nil, nil); w.Code != http.StatusNotFound {
		t.Errorf("GET swap -> %d, want 404 (not throttled)", w.Code)
	}
	if w := h.do("POST", "/api/v1/webhooks/crypto/mock", `x|1`, map[string]string{"x-sig": "bad"}); w.Code == http.StatusTooManyRequests {
		t.Errorf("webhook was rate limited")
	}
}

// End to end with the real per-user limiter: the budget is per user and per route.
func TestQuoteAndConfirmBudgetsAreIndependentAndPerUser(t *testing.T) {
	quoteLimit := middleware.PerUserRateLimit(nil, "t-quote", 2)
	confirmLimit := middleware.PerUserRateLimit(nil, "t-confirm", 2)
	with := func(d *HandlerDeps) { d.QuoteLimit, d.ConfirmLimit = quoteLimit, confirmLimit }
	alice := newHTTPRigWith(t, "alice", with)
	bob := newHTTPRigWith(t, "bob", with)

	quote := func(h *httpRig) int { return h.do("POST", "/api/v1/crypto/swaps/quote", `{}`, nil).Code }
	confirm := func(h *httpRig) int { return h.do("POST", "/api/v1/crypto/swaps/x/confirm", `{}`, nil).Code }

	for i := 1; i <= 2; i++ {
		if c := quote(alice); c == http.StatusTooManyRequests {
			t.Fatalf("alice quote %d throttled early", i)
		}
	}
	if c := quote(alice); c != http.StatusTooManyRequests {
		t.Fatalf("alice 3rd quote -> %d, want 429", c)
	}
	if c := confirm(alice); c == http.StatusTooManyRequests {
		t.Fatalf("alice confirm throttled by the QUOTE budget")
	}
	if c := quote(bob); c == http.StatusTooManyRequests {
		t.Fatalf("bob throttled by alice's budget")
	}
	for i := 0; i < 2; i++ {
		confirm(alice)
	}
	if c := confirm(alice); c != http.StatusTooManyRequests {
		t.Fatalf("alice 3rd confirm -> %d, want 429", c)
	}
}
