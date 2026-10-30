package healthpharmacy

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestNormaliseConsultBody(t *testing.T) {
	if _, err := normaliseConsultBody("   "); !errors.Is(err, ErrConsultBody) {
		t.Fatal("blank body must be rejected")
	}
	if _, err := normaliseConsultBody(strings.Repeat("é", MaxConsultMessageLen+1)); !errors.Is(err, ErrConsultBody) {
		t.Fatal("over-long body must be rejected (counted in runes)")
	}
	if b, err := normaliseConsultBody("  is this safe with ibuprofen?  "); err != nil || b != "is this safe with ibuprofen?" {
		t.Fatalf("got %q %v", b, err)
	}
}

func TestConsultMessages_Guards(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(&Service{}, nil)
	anon := gin.New()
	anon.GET("/consult/messages", h.ConsultMessages)
	anon.POST("/consult/messages", h.SendConsultMessage)
	for _, m := range []string{http.MethodGet, http.MethodPost} {
		w := httptest.NewRecorder()
		anon.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), m, "/consult/messages", nil))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s: status = %d, want 401", m, w.Code)
		}
	}
	r, h2 := uuidGuardRouter()
	r.POST("/consult/messages", h2.SendConsultMessage)
	if w := postJSON(t, r, "/consult/messages", `{"body":"  "}`); w.Code != http.StatusBadRequest {
		t.Fatalf("blank message: status = %d, want 400", w.Code)
	}
}
