package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestStemRateLimit_AllowsWithinLimit(t *testing.T) {
	stemRateMu.Lock()
	stemRateStore = map[string]*stemRateBucket{}
	stemRateMu.Unlock()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(StemRateLimit(2, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d on request %d", w.Code, i+1)
		}
	}
}

func TestStemRateLimit_BlocksWhenExceeded(t *testing.T) {
	stemRateMu.Lock()
	stemRateStore = map[string]*stemRateBucket{}
	stemRateMu.Unlock()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(StemRateLimit(1, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req1 := httptest.NewRequest(http.MethodGet, "/x", nil)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("expected first request 200, got %d", w1.Code)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/x", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second request 429, got %d", w2.Code)
	}
}
