package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCreatePermission_InvalidPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewRBACHandler(nil, nil)
	r := gin.New()
	r.POST("/permissions", h.CreatePermission)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/permissions", bytes.NewBufferString(`{"name":123}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreatePermission_MissingFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewRBACHandler(nil, nil)
	r := gin.New()
	r.POST("/permissions", h.CreatePermission)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/permissions", bytes.NewBufferString(`{"name":"X","slug":"x.y.z"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdatePermission_InvalidPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewRBACHandler(nil, nil)
	r := gin.New()
	r.PATCH("/permissions/:permissionId", h.UpdatePermission)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/permissions/p1", bytes.NewBufferString(`{"name":false}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
