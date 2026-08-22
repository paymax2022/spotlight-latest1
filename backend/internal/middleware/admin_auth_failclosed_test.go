package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// The gate used to FAIL OPEN: an empty ADMIN_API_KEY called c.Next() and allowed
// every admin request, so the protection vanished precisely when it was
// misconfigured. These pin the corrected behaviour, including that an
// unrecognised environment is treated as not-development.
func TestRequireAdmin_UnconfiguredKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name   string
		appEnv string
		want   int
	}{
		{"production refuses", "production", http.StatusServiceUnavailable},
		{"staging refuses", "staging", http.StatusServiceUnavailable},
		{"empty APP_ENV refuses", "", http.StatusServiceUnavailable},
		{"typo refuses", "prod", http.StatusServiceUnavailable},
		{"development allows", "development", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.Use(RequireAdmin("", tc.appEnv))
			r.GET("/admin/x", func(c *gin.Context) { c.Status(http.StatusOK) })

			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/x", nil))
			if w.Code != tc.want {
				t.Fatalf("APP_ENV=%q with no key: got %d, want %d", tc.appEnv, w.Code, tc.want)
			}
		})
	}
}

// A configured key must still be enforced regardless of environment - development
// is an exception for an ABSENT key, never a bypass for a wrong one.
func TestRequireAdmin_ConfiguredKeyEnforcedEvenInDevelopment(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, env := range []string{"development", "production"} {
		r := gin.New()
		r.Use(RequireAdmin("real-key", env))
		r.GET("/admin/x", func(c *gin.Context) { c.Status(http.StatusOK) })

		wrong := httptest.NewRequest(http.MethodGet, "/admin/x", nil)
		wrong.Header.Set("x-admin-api-key", "guess")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, wrong)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("APP_ENV=%s wrong key: got %d, want 401", env, w.Code)
		}

		right := httptest.NewRequest(http.MethodGet, "/admin/x", nil)
		right.Header.Set("x-admin-api-key", "real-key")
		w = httptest.NewRecorder()
		r.ServeHTTP(w, right)
		if w.Code != http.StatusOK {
			t.Fatalf("APP_ENV=%s correct key: got %d, want 200", env, w.Code)
		}
	}
}
