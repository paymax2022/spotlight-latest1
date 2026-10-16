package navigation

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type fakeInserter struct{ got []Event }

func (f *fakeInserter) Insert(_ context.Context, ev []Event) (int, error) {
	f.got = append(f.got, ev...)
	return len(ev), nil
}

func post(t *testing.T, body string) (*httptest.ResponseRecorder, *fakeInserter) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	f := &fakeInserter{}
	h := NewHandler(f)
	r := gin.New()
	r.POST("/t", func(c *gin.Context) { c.Set("user_id", "token-user"); h.Ingest(c) })
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/t", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w, f
}

func ev(surface, route string, at time.Time) string {
	return fmt.Sprintf(`{"surface":%q,"route":%q,"occurred_at":%q}`, surface, route, at.Format(time.RFC3339))
}

func accepted(t *testing.T, w *httptest.ResponseRecorder) int {
	t.Helper()
	var out struct {
		Accepted int `json:"accepted"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Accepted
}

func TestIngest_UserFromTokenNotBody(t *testing.T) {
	body := fmt.Sprintf(`{"events":[{"user_id":"attacker","surface":"mobile","route":"home","occurred_at":%q}]}`, time.Now().Format(time.RFC3339))
	w, f := post(t, body)
	if w.Code != 202 || len(f.got) != 1 || f.got[0].UserID != "token-user" {
		t.Fatalf("code=%d got=%+v", w.Code, f.got)
	}
}

func TestIngest_BatchCap(t *testing.T) {
	parts := make([]string, 51)
	for i := range parts {
		parts[i] = ev("web", "home", time.Now())
	}
	w, f := post(t, `{"events":[`+strings.Join(parts, ",")+`]}`)
	if w.Code != 400 || len(f.got) != 0 {
		t.Fatalf("code=%d", w.Code)
	}
}

func TestIngest_DropsInvalid(t *testing.T) {
	now := time.Now()
	body := `{"events":[` + strings.Join([]string{
		ev("desktop", "home", now),
		ev("web", "pay?amount=5", now),
		ev("web", "home", now.Add(48*time.Hour)),
		ev("web", "home", now.Add(-120*24*time.Hour)),
		ev("web", "wallet", now),
	}, ",") + `]}`
	w, f := post(t, body)
	if w.Code != 202 || accepted(t, w) != 1 || len(f.got) != 1 || f.got[0].Route != "wallet" {
		t.Fatalf("code=%d body=%s got=%+v", w.Code, w.Body.String(), f.got)
	}
}

func TestIngest_ValidBatch(t *testing.T) {
	now := time.Now()
	w, f := post(t, `{"events":[`+ev("mobile", "home", now)+","+ev("web", "crypto/assets", now)+`]}`)
	if w.Code != 202 || accepted(t, w) != 2 || len(f.got) != 2 {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestIngest_BadJSON(t *testing.T) {
	w, _ := post(t, `{nope`)
	if w.Code != 400 {
		t.Fatalf("code=%d", w.Code)
	}
}
