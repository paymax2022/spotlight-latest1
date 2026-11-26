package connectvoting

// DB-free tests for the village picker's argument handling.
//
// The rule these pin: a request that named no locality is a 400 that says WHICH
// field it wanted, and a request that named an LGA nobody has curated is a 200
// with mode=free_text. Those are the two cases a picker author can easily invert
// — treating "no curated villages" as an error would turn the deliberate absence
// of a national gazetteer into a red screen, and treating a missing parameter as
// "no filter" would hand back every LGA of that name in the country.
//
// The nil-service handler is the proof that validation happens before the
// database: any query attempt on a zero Service would panic, so a 400 here means
// the bad request never reached SQL.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/config"

	"github.com/gin-gonic/gin"
)

// The route has to be wired into the member group, not just exist as a handler
// method — a handler nobody registers answers 404, and the symptom in the app is
// a village picker that never fills. The repository is built on a nil pool here on
// purpose: a 400 for the missing locality proves the argument check runs before
// any query, and a panic would prove the opposite.
func TestRegisterWiresVillagesRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	Register(e.Group("/api/v1/connect"),
		NewService(NewRepository(nil), nil, nil, nil, nil), config.Config{}, nil)

	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/connect/villages", nil))
	if w.Code == http.StatusNotFound {
		t.Fatalf("GET /api/v1/connect/villages is not registered (%s)", w.Body.String())
	}
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400 naming the missing locality, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "state") {
		t.Errorf("response should name the field, got %s", w.Body.String())
	}
}

func TestVillagesQueryArgs(t *testing.T) {
	cases := []struct {
		name        string
		state, lga  string
		wantState   string
		wantLGA     string
		wantErrFiel string // substring the error must name
	}{
		{name: "both given", state: "Anambra", lga: "Onitsha North", wantState: "Anambra", wantLGA: "Onitsha North"},
		{name: "padded", state: "  Anambra ", lga: "\tOnitsha North\n", wantState: "Anambra", wantLGA: "Onitsha North"},
		{name: "missing state", lga: "Onitsha North", wantErrFiel: "state"},
		{name: "blank state", state: "   ", lga: "Onitsha North", wantErrFiel: "state"},
		{name: "missing lga", state: "Anambra", wantErrFiel: "lga"},
		{name: "blank lga", state: "Anambra", lga: "  ", wantErrFiel: "lga"},
		{name: "neither", wantErrFiel: "state"},
		{name: "state too long", state: strings.Repeat("A", 200), lga: "Onitsha North", wantErrFiel: "state"},
		{name: "lga too long", state: "Anambra", lga: strings.Repeat("B", 200), wantErrFiel: "lga"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotState, gotLGA, err := villagesQueryArgs(tc.state, tc.lga)
			if tc.wantErrFiel != "" {
				if err == nil {
					t.Fatalf("want an error naming %q, got the pair %q/%q", tc.wantErrFiel, gotState, gotLGA)
				}
				if !strings.Contains(err.Message, tc.wantErrFiel) {
					t.Errorf("error should name the field %q, got %q", tc.wantErrFiel, err.Message)
				}
				if err.Field != tc.wantErrFiel {
					t.Errorf("error field = %q, want %q — the response carries it so a caller can highlight the right input",
						err.Field, tc.wantErrFiel)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error %v", err)
			}
			if gotState != tc.wantState || gotLGA != tc.wantLGA {
				t.Errorf("got %q/%q, want %q/%q", gotState, gotLGA, tc.wantState, tc.wantLGA)
			}
		})
	}
}

func TestListVillagesHandler_RejectsMissingLocalityBeforeDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(&Service{})
	r.GET("/villages", h.ListVillages)

	cases := []struct{ query, wantField string }{
		{"", "state"},
		{"?lga=Onitsha+North", "state"},
		{"?state=Anambra", "lga"},
		{"?state=Anambra&lga=", "lga"},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/villages"+tc.query, nil))
		if w.Code != http.StatusBadRequest {
			t.Errorf("%q: want 400, got %d (%s)", tc.query, w.Code, w.Body.String())
			continue
		}
		if !strings.Contains(w.Body.String(), tc.wantField) {
			t.Errorf("%q: error should name %q, got %s", tc.query, tc.wantField, w.Body.String())
		}
	}
}

// An uncurated locality is a 200: the picker switches to a text input. This is
// the shape the whole free-text fallback depends on, and it is decided in the
// service, not by the caller counting rows.
func TestVillageListModeIsFreeTextWhenEmpty(t *testing.T) {
	for _, tc := range []struct {
		name  string
		count int
		want  string
	}{
		{"curated", 3, "curated"},
		{"empty", 0, "free_text"},
	} {
		villages := make([]Village, 0, tc.count)
		for i := 0; i < tc.count; i++ {
			villages = append(villages, Village{Name: "Quarter"})
		}
		list := newVillageList("Anambra", "Onitsha North", villages)
		if list.Mode != tc.want {
			t.Errorf("%s: mode = %q, want %q", tc.name, list.Mode, tc.want)
		}
		if list.Villages == nil {
			t.Errorf("%s: villages must serialise as [], not null, so the picker can map over it", tc.name)
		}
	}
}
