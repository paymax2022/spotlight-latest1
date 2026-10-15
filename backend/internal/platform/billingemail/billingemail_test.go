package billingemail

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestIsBillable(t *testing.T) {
	good := []string{"a@b.com", "first.last+tag@sub.example.org", "x@y.ng", "A@B.COM"}
	bad := []string{
		"", "   ", "plain", "a@b", "a@@b.com", "a b@c.com", "a@b c.com", "a@.com", "a@b..com", "@b.com", "a@b.",
		// Fixture / placeholder domains Paystack refuses with a generic 400.
		"u@spotlight.internal", "u@x.local", "u@x.localhost", "u@x.test", "u@x.invalid", "u@x.example", "U@X.INTERNAL",
	}
	for _, e := range good {
		if !IsBillable(e) {
			t.Errorf("IsBillable(%q) = false, want true", e)
		}
	}
	for _, e := range bad {
		if IsBillable(e) {
			t.Errorf("IsBillable(%q) = true, want false", e)
		}
	}
}

func TestResolve_AccountEmailWinsThenSuppliedThenRequired(t *testing.T) {
	cases := []struct {
		name, account, supplied, want string
		wantErr                       bool
	}{
		{"registered email is used", "me@gmail.com", "", "me@gmail.com", false},
		{"registered email beats a different supplied one", "me@gmail.com", "other@gmail.com", "me@gmail.com", false},
		{"registered email is trimmed", "  me@gmail.com ", "", "me@gmail.com", false},
		{"fixture account falls back to the supplied email", "u@spotlight.internal", "real@gmail.com", "real@gmail.com", false},
		{"no account email uses the supplied one", "", " real@gmail.com ", "real@gmail.com", false},
		{"fixture account and nothing supplied asks for one", "u@spotlight.internal", "", "", true},
		{"nothing at all asks for one", "", "", "", true},
		{"supplied email must be valid too", "", "not-an-email", "", true},
		{"both invalid", "bad", "worse@x.test", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Resolve(tc.account, tc.supplied)
			if tc.wantErr {
				if err != ErrEmailRequired {
					t.Fatalf("err = %v, want ErrEmailRequired (got %q)", err, got)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("Resolve = %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}

func run(t *testing.T, accountEmail, supplied string) (email string, ok bool, w *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w = httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/x", nil)
	if accountEmail != "" {
		c.Set("user_email", accountEmail)
	}
	email, ok = Require(c, supplied)
	return
}

func TestRequire_ReturnsTheEmailWithoutWriting(t *testing.T) {
	email, ok, w := run(t, "me@gmail.com", "")
	if !ok || email != "me@gmail.com" || w.Body.Len() != 0 {
		t.Fatalf("ok=%v email=%q body=%q", ok, email, w.Body.String())
	}
}

// The mobile app keys its "ask for an email" prompt off this exact status+code.
func TestRequire_AnswersEmailRequiredWith422(t *testing.T) {
	_, ok, w := run(t, "u@spotlight.internal", "")
	if ok {
		t.Fatal("ok = true, want false")
	}
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", w.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "email_required" || body["message"] == "" {
		t.Fatalf("body = %v", body)
	}
}
