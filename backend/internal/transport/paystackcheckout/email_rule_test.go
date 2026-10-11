package paystackcheckout

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// emailRig is httpRig with the signed-in account's email taken from a header,
// so each case can model a registered user, a fixture account or none.
func emailRig(t *testing.T) (*rig, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := newRig()
	g := gin.New()
	g.Use(func(c *gin.Context) {
		c.Set("user_id", "u1")
		if e := c.GetHeader("X-Test-Email"); e != "" {
			c.Set("user_email", e)
		}
	})
	r.e.RegisterRoutes(g.Group("/m"))
	return r, g
}

func initiateWith(g *gin.Engine, accountEmail, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/m/fakes/paystack/initiate", strings.NewReader(body))
	req.Header.Set("Idempotency-Key", key1)
	if accountEmail != "" {
		req.Header.Set("X-Test-Email", accountEmail)
	}
	w := httptest.NewRecorder()
	g.ServeHTTP(w, req)
	return w
}

// Registered email is used; the checkout never invents a placeholder.
func TestInitiate_UsesTheRegisteredEmail(t *testing.T) {
	r, g := emailRig(t)
	if w := initiateWith(g, "me@gmail.com", `{"email":"someone-else@gmail.com"}`); w.Code != http.StatusCreated {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	if len(r.gw.initCalls) != 1 || r.gw.initCalls[0].Email != "me@gmail.com" {
		t.Fatalf("Paystack got %+v, want the registered email", r.gw.initCalls)
	}
}

// A fixture/placeholder account email is not billable, so the email typed at
// checkout is used instead.
func TestInitiate_FallsBackToTheEmailTypedAtCheckout(t *testing.T) {
	r, g := emailRig(t)
	if w := initiateWith(g, "u@spotlight.internal", `{"email":"typed@gmail.com"}`); w.Code != http.StatusCreated {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	if len(r.gw.initCalls) != 1 || r.gw.initCalls[0].Email != "typed@gmail.com" {
		t.Fatalf("Paystack got %+v, want the typed email", r.gw.initCalls)
	}
}

// No usable email anywhere: 422 email_required so the app can ask, and nothing
// is quoted, stored or sent to Paystack.
func TestInitiate_AsksForAnEmailWhenNoneIsUsable(t *testing.T) {
	for name, tc := range map[string]struct{ account, body string }{
		"fixture account, nothing typed":  {"u@spotlight.internal", `{}`},
		"no account email, nothing typed": {"", `{}`},
		"typed email is not billable":     {"", `{"email":"nope"}`},
	} {
		t.Run(name, func(t *testing.T) {
			r, g := emailRig(t)
			w := initiateWith(g, tc.account, tc.body)
			if w.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status %d %s, want 422", w.Code, w.Body.String())
			}
			var body map[string]string
			_ = json.Unmarshal(w.Body.Bytes(), &body)
			if body["error"] != "email_required" {
				t.Fatalf("body %v", body)
			}
			if len(r.gw.initCalls) != 0 || len(r.d.quotes) != 0 {
				t.Fatalf("nothing may be quoted or sent to Paystack before an email exists (init=%d)", len(r.gw.initCalls))
			}
		})
	}
}
