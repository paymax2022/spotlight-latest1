package ginutil_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

func ctxWith(setters ...func(*gin.Context)) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	for _, set := range setters {
		set(c)
	}
	return c, w
}

func TestUserID_ContextKey(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) { c.Set("user_id", "u-123") })
	if got := ginutil.UserID(c); got != "u-123" {
		t.Fatalf("UserID = %q, want u-123", got)
	}
}

func TestUserID_TrimsAndEmpty(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) { c.Set("user_id", "  ") })
	if got := ginutil.UserID(c); got != "" {
		t.Fatalf("UserID = %q, want empty", got)
	}
}

func TestUserID_FallbackChain(t *testing.T) {
	c, _ := ctxWith()
	got := ginutil.UserID(c, func(*gin.Context) string { return "" }, func(*gin.Context) string { return " fb-1 " })
	if got != "fb-1" {
		t.Fatalf("UserID fallback = %q, want fb-1", got)
	}
}

func TestUserID_ContextKeyBeatsFallback(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) { c.Set("user_id", "primary") })
	got := ginutil.UserID(c, func(*gin.Context) string { return "fb" })
	if got != "primary" {
		t.Fatalf("UserID = %q, want primary", got)
	}
}

func TestRequireUser_Writes401(t *testing.T) {
	c, w := ctxWith()
	u, ok := ginutil.RequireUser(c)
	if ok || u != "" {
		t.Fatalf("RequireUser = (%q,%v), want (\"\",false)", u, ok)
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestRequireUser_OK(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) { c.Set("user_id", "u-9") })
	u, ok := ginutil.RequireUser(c)
	if !ok || u != "u-9" {
		t.Fatalf("RequireUser = (%q,%v), want (u-9,true)", u, ok)
	}
}

func TestIdempotencyKey_PrimaryHeader(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) { c.Request.Header.Set("Idempotency-Key", "k-1") })
	if got := ginutil.IdempotencyKey(c); got != "k-1" {
		t.Fatalf("IdempotencyKey = %q, want k-1", got)
	}
}

func TestIdempotencyKey_LegacyHeader(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) { c.Request.Header.Set("X-Idempotency-Key", "k-2") })
	if got := ginutil.IdempotencyKey(c); got != "k-2" {
		t.Fatalf("IdempotencyKey = %q, want k-2", got)
	}
}

func TestIdempotencyKey_PrimaryWins(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) {
		c.Request.Header.Set("Idempotency-Key", "k-1")
		c.Request.Header.Set("X-Idempotency-Key", "k-2")
	})
	if got := ginutil.IdempotencyKey(c); got != "k-1" {
		t.Fatalf("IdempotencyKey = %q, want k-1", got)
	}
}

func TestRequireIdempotencyKey_Missing(t *testing.T) {
	c, w := ctxWith()
	k, ok := ginutil.RequireIdempotencyKey(c)
	if ok || k != "" {
		t.Fatalf("RequireIdempotencyKey = (%q,%v)", k, ok)
	}
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestPageParams(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) {
		c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x?limit=30&offset=60", nil)
	})
	l, o := ginutil.PageParams(c, 20, 100)
	if l != 30 || o != 60 {
		t.Fatalf("PageParams = (%d,%d), want (30,60)", l, o)
	}
}

func TestPageParams_DefaultsAndCap(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) {
		c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x?limit=500&offset=-5", nil)
	})
	l, o := ginutil.PageParams(c, 20, 100)
	if l != 20 || o != 0 {
		t.Fatalf("PageParams = (%d,%d), want (20,0)", l, o)
	}
}

func TestLimitOffset(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) {
		c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x?limit=bad&offset=7", nil)
	})
	l, o := ginutil.LimitOffset(c)
	if l != 0 || o != 7 {
		t.Fatalf("LimitOffset = (%d,%d), want (0,7)", l, o)
	}
}

func TestBoolParam(t *testing.T) {
	for _, tc := range []struct {
		q    string
		want *bool
	}{
		{"/x", nil},
		{"/x?active=true", new(true)},
		{"/x?active=false", new(false)},
		{"/x?active=maybe", nil},
	} {
		c, _ := ctxWith(func(c *gin.Context) {
			c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, tc.q, nil)
		})
		got := ginutil.BoolParam(c, "active")
		if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) {
			t.Fatalf("BoolParam(%q) = %v, want %v", tc.q, got, tc.want)
		}
	}
}

func TestBearerToken(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) {
		c.Request.Header.Set("Authorization", "Bearer tok-abc")
	})
	if got := ginutil.BearerToken(c); got != "tok-abc" {
		t.Fatalf("BearerToken = %q, want tok-abc", got)
	}
	c2, _ := ctxWith(func(c *gin.Context) {
		c.Request.Header.Set("Authorization", "Basic dXNlcg==")
	})
	if got := ginutil.BearerToken(c2); got != "" {
		t.Fatalf("BearerToken(basic) = %q, want empty", got)
	}
}

func TestFailAndOKEnvelopes(t *testing.T) {
	c, w := ctxWith()
	ginutil.Fail(c, http.StatusTeapot, "nope")
	if w.Code != http.StatusTeapot {
		t.Fatalf("Fail status = %d", w.Code)
	}
	c2, w2 := ctxWith()
	ginutil.OK(c2, http.StatusCreated, gin.H{"id": 1})
	if w2.Code != http.StatusCreated {
		t.Fatalf("OK status = %d", w2.Code)
	}
	if body := w2.Body.String(); body == "" || body == "{}" {
		t.Fatalf("OK body = %q", body)
	}
}

func TestSortDirAndSearch(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) {
		c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x?dir=asc&q=%20%20hello%20%20", nil)
	})
	if got := ginutil.SortDir(c); got != "ASC" {
		t.Fatalf("SortDir = %q, want ASC", got)
	}
	if got := ginutil.Search(c); got != "hello" {
		t.Fatalf("Search = %q, want hello", got)
	}
	c2, _ := ctxWith(func(c *gin.Context) {
		c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x?sort=weird", nil)
	})
	if got := ginutil.SortDir(c2); got != "DESC" {
		t.Fatalf("SortDir default = %q, want DESC", got)
	}
}

func TestAdminID(t *testing.T) {
	c, _ := ctxWith(func(c *gin.Context) { c.Set("admin_id", "adm-1") })
	if got := ginutil.AdminID(c); got != "adm-1" {
		t.Fatalf("AdminID = %q, want adm-1", got)
	}
	c2, _ := ctxWith(func(c *gin.Context) { c.Set("user_id", "u-1") })
	if got := ginutil.AdminID(c2); got != "u-1" {
		t.Fatalf("AdminID fallback = %q, want u-1", got)
	}
}
