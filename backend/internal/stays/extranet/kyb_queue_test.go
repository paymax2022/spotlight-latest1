package extranet

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRegisterAdmin_KYBListRouteIsGuarded(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	h := NewHandler(NewService(NewRepository(nil), NewAuthZ(nil), nil, noopStaffInviteMailer{}, ""))
	r := gin.New()
	var guarded []string
	h.RegisterAdmin(r.Group("/api/stays/admin"), func(permission string) gin.HandlerFunc {
		return func(c *gin.Context) { guarded = append(guarded, permission); c.Next() }
	})
	found := false
	for _, rt := range r.Routes() {
		if rt.Method == http.MethodGet && rt.Path == "/api/stays/admin/kyb" {
			found = true
		}
	}
	if !found {
		t.Fatal("GET /api/stays/admin/kyb is not registered")
	}
	// The guard must be the same permission as the decision route.
	req := httptest.NewRequest(http.MethodGet, "/api/stays/admin/kyb?status=bogus", nil)
	r.ServeHTTP(httptest.NewRecorder(), req)
	if len(guarded) != 1 || guarded[0] != "stays.admin.hotelier" {
		t.Fatalf("list route guard = %v, want [stays.admin.hotelier]", guarded)
	}
}

func TestAdminListKYB_RejectsUnknownStatus(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	h := NewHandler(NewService(NewRepository(nil), NewAuthZ(nil), nil, noopStaffInviteMailer{}, ""))
	r := gin.New()
	r.GET("/kyb", h.AdminListKYB)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/kyb?status=approved%27%3B--", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestToKYBQueueItem_MasksSensitiveFields(t *testing.T) {
	item := toKYBQueueItem(kyb{
		PropertyID:   "p1",
		LegalName:    "Nordic Hospitality Ltd",
		RCNumber:     "RC4421",
		TIN:          "12345678-0001",
		DirectorName: "Femi Okoro",
		DirectorBVN:  "12345678901",
		Status:       VerifSubmitted,
	}, "Nordic Hotel", "Lagos")
	b, _ := json.Marshal(item)
	s := string(b)
	for _, leak := range []string{"12345678901", "12345678-0001", "RC4421", "Femi Okoro"} {
		if strings.Contains(s, leak) {
			t.Errorf("queue item leaks %q: %s", leak, s)
		}
	}
	if item.DirectorBVNLast4 != "8901" || item.RCNumberMasked != "RC ••••4421" {
		t.Errorf("unexpected masks: %+v", item)
	}
	if item.DirectorMasked != "Femi O••••" {
		t.Errorf("director mask = %q", item.DirectorMasked)
	}
	if !item.HasTIN {
		t.Error("has_tin should be true when a TIN is on file")
	}
}

func TestValidKYBListStatus(t *testing.T) {
	for _, s := range []string{"", "pending", "in_progress", "submitted", "approved", "rejected", "needs_changes"} {
		if !validKYBListStatus(s) {
			t.Errorf("%q should be valid", s)
		}
	}
	if validKYBListStatus("PENDING") || validKYBListStatus("x") {
		t.Error("unknown statuses must be rejected")
	}
}
