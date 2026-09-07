package policy

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/insurance/gateway"
)

// stubValidation is any adapter's per-field rejection. The handler must not know
// which provider produced it — it keys off the gateway interface, so Octamile or
// a future aggregator gets the same treatment for free.
type stubValidation struct {
	msgs []string
}

func (s *stubValidation) Error() string                { return "stub: " + fmt.Sprint(s.msgs) }
func (s *stubValidation) Unwrap() error                { return gateway.ErrProviderRejected }
func (s *stubValidation) Validation() bool             { return true }
func (s *stubValidation) ValidationMessages() []string { return s.msgs }

func run(err error) (int, map[string]any) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	mapErr(c, err)
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body
}

// A provider rejecting the applicant's ANSWERS is the applicant's problem to fix,
// not a server fault. Returning 500 tells the client nothing is actionable, so
// the form shows a generic failure and the person cannot see which field is
// wrong — they retype the whole application and get the same wall.
func TestMapErr_ProviderValidationIsNotAServerError(t *testing.T) {
	err := &stubValidation{msgs: []string{
		"first_name must be longer than or equal to 2 characters",
		"email must be an email",
	}}

	code, body := run(err)

	if code == http.StatusInternalServerError {
		t.Fatalf("provider validation returned 500 — the client cannot act on that")
	}
	if code < 400 || code >= 500 {
		t.Fatalf("status = %d, want a 4xx", code)
	}

	// The messages have to survive: the client attributes each one back to the
	// field named in its leading token. Dropping them loses the whole point.
	env, _ := body["error"].(map[string]any)
	if env == nil {
		t.Fatalf("no error envelope in %v", body)
	}
	raw, ok := env["message"].([]any)
	if !ok || len(raw) != 2 {
		t.Fatalf("message should be the list of provider messages, got %#v", env["message"])
	}
	if raw[0] != "first_name must be longer than or equal to 2 characters" {
		t.Errorf("first message altered: %v", raw[0])
	}
}

// The code has to be stable and specific, so the client can tell a rejected
// application apart from an outage and choose different copy.
func TestMapErr_ValidationCarriesAStableCode(t *testing.T) {
	_, body := run(&stubValidation{msgs: []string{"nin should not be empty"}})
	env, _ := body["error"].(map[string]any)
	if env["code"] != "provider_validation" {
		t.Errorf("code = %v, want provider_validation", env["code"])
	}
}

// A provider failure that is NOT a validation rejection — an outage, a scope
// problem, a transport error — must stay a 5xx. Those are ours to fix and
// retrying the same form will not help, so they must not read as "your answers
// are wrong".
func TestMapErr_NonValidationProviderFailureStays5xx(t *testing.T) {
	notValidation := fmt.Errorf("%w: mycover endpoint forbidden for this API key", gateway.ErrProviderRejected)
	code, _ := run(notValidation)
	if code < 500 {
		t.Errorf("a non-validation provider failure returned %d — it is not the applicant's fault", code)
	}
}

// The existing sentinels must keep their statuses. Consent especially: 428 is
// what the client keys on to show the consent ask.
func TestMapErr_ExistingSentinelsUnchanged(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{ErrForbidden, http.StatusForbidden},
		{ErrConsentRequired, http.StatusPreconditionRequired},
		{ErrBadState, http.StatusConflict},
		{errors.New("something else"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		if code, _ := run(tc.err); code != tc.want {
			t.Errorf("mapErr(%v) = %d, want %d", tc.err, code, tc.want)
		}
	}
}

// MyCover produces validation failures in TWO shapes, and only one of them can
// be attributed to a field by the client's leading-token rule:
//
//	per-field : "email must be an email"                       -> attributable
//	summary   : "missing required fields: email, phone_number" -> NOT attributable
//
// The summary shape starts with prose, so the client highlights nothing and the
// applicant is told something is wrong without being told what. Expanding it
// server-side is what turns a visible error into a fixable one.
func TestValidationFields_ExpandsTheSummaryShape(t *testing.T) {
	got := validationFields([]string{
		"The payload is missing required fields: last_name, email, bought_for_self",
	})

	for _, f := range []string{"last_name", "email", "bought_for_self"} {
		if got[f] == "" {
			t.Errorf("field %q was not extracted from the summary message: %#v", f, got)
		}
	}
	if len(got) != 3 {
		t.Errorf("expected exactly the 3 named fields, got %#v", got)
	}
}

func TestValidationFields_KeepsPerFieldMessagesVerbatim(t *testing.T) {
	got := validationFields([]string{
		"email must be an email",
		"nin must be longer than or equal to 11 characters",
	})
	if got["email"] == "" || got["nin"] == "" {
		t.Fatalf("per-field messages were not attributed: %#v", got)
	}
	// The insurer's wording is what the applicant must satisfy, so it is not
	// reworded — only the field name is stripped off the front.
	if got["nin"] != "Must be longer than or equal to 11 characters" {
		t.Errorf("nin message = %q, want the provider wording with the field removed", got["nin"])
	}
}

// Prose that names no field must not invent one. A wrong highlight is worse than
// none: it sends the applicant to edit an input that was already correct.
func TestValidationFields_IgnoresUnattributableProse(t *testing.T) {
	got := validationFields([]string{
		"Something went wrong, please try again",
		"Insufficient wallet fund for purchase",
	})
	if len(got) != 0 {
		t.Errorf("prose was attributed to fields: %#v", got)
	}
}
