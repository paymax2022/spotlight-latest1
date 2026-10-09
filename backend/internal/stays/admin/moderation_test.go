package admin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestModerationStatusMapping(t *testing.T) {
	cases := []struct{ ui, db string }{
		{"pending_review", "PENDING_REVIEW"}, {"approved", "ACTIVE"},
		{"rejected", "SUSPENDED"}, {"needs_changes", "DRAFT"},
		// raw DB vocabulary is still accepted so existing callers keep working
		{"ACTIVE", "ACTIVE"}, {"SUSPENDED", "SUSPENDED"}, {"PENDING_REVIEW", "PENDING_REVIEW"}, {"DRAFT", "DRAFT"},
	}
	for _, c := range cases {
		got, ok := moderationDBStatus(c.ui)
		if !ok || got != c.db {
			t.Errorf("moderationDBStatus(%q) = (%q,%v), want %q", c.ui, got, ok, c.db)
		}
	}
	if _, ok := moderationDBStatus("bogus"); ok {
		t.Error("unknown status must be rejected")
	}
	for db, ui := range map[string]string{"PENDING_REVIEW": "pending_review", "ACTIVE": "approved", "SUSPENDED": "rejected", "DRAFT": "needs_changes"} {
		if got := moderationUIStatus(db); got != ui {
			t.Errorf("moderationUIStatus(%q) = %q, want %q", db, got, ui)
		}
	}
}

func TestModerationRoutes_RejectUnknownStatusBeforeTouchingDB(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	h := NewHandler(nil) // a DB touch would nil-panic: validation must come first
	r := gin.New()
	r.GET("/properties", h.ListModeration)
	r.POST("/properties/:id/status", h.ModerateProperty)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/properties?status=bogus", nil))
	if w.Code != http.StatusBadRequest {
		t.Errorf("list: status = %d, want 400", w.Code)
	}

	w = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/properties/abc/status", strings.NewReader(`{"status":"bogus"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("decide: status = %d, want 400", w.Code)
	}
}
