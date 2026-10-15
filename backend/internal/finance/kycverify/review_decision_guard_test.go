package kycverify

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestReviewActorGuard(t *testing.T) {
	tests := []struct {
		name    string
		actor   string
		owner   string
		wantErr bool
	}{
		{"different admin may decide", "admin-1", "user-9", false},
		{"admin may not decide their own case", "user-9", "user-9", true},
		{"case-insensitive uuid match is still self", "ABCD-1", "abcd-1", true},
		{"empty actor fails closed", "", "user-9", true},
		{"whitespace actor fails closed", "  ", "user-9", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := reviewActorGuard(tc.actor, tc.owner)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if err != nil && !errors.Is(err, ErrForbidden) {
				t.Fatalf("err = %v, want ErrForbidden (maps to 403)", err)
			}
		})
	}
}

// The handler must refuse a missing/blank reason BEFORE touching the service,
// so a nil service proves no decision was attempted.
func TestDecisionHandlers_RequireReason(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{} // svc nil: any call past validation would panic
	bodies := map[string]string{
		"no body":    ``,
		"empty json": `{}`,
		"blank":      `{"reason":"   "}`,
		"bad json":   `{"reason":`,
		"too long":   `{"reason":"` + strings.Repeat("x", 501) + `"}`,
	}
	for _, route := range []struct {
		name string
		fn   gin.HandlerFunc
	}{{"approve", h.ApproveCase}, {"reject", h.RejectCase}} {
		for name, body := range bodies {
			t.Run(route.name+"/"+name, func(t *testing.T) {
				r := gin.New()
				r.POST("/cases/:id/decide", route.fn)
				w := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodPost, "/cases/s1/decide", bytes.NewBufferString(body))
				req.Header.Set("Content-Type", "application/json")
				r.ServeHTTP(w, req)
				if w.Code != http.StatusBadRequest {
					t.Fatalf("status = %d, want 400 (%s)", w.Code, w.Body.String())
				}
			})
		}
	}
}
