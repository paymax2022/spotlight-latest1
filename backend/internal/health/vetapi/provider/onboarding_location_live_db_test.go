package provider

// LIVE-DB: the onboarding clinic-location step. A vet has no health_providers row
// until admin approval, so the location is saved on the application and approval
// copies it onto health_providers.geo. Skips unless TEST_DATABASE_URL is set; all
// fixtures hang off throwaway auth.users rows that are deleted on cleanup.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	healthproviders "spotlight/backend/internal/health/providers"
	healthvet "spotlight/backend/internal/health/vet"
	"spotlight/backend/internal/testsupport"
)

func (f *liveFx) newUser() string {
	f.t.Helper()
	u := uuid.NewString()
	if _, err := f.pool.Exec(f.t.Context(), `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		f.t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(f.t, f.pool, u)
	return u
}

func TestLive_OnboardingLocationFlow(t *testing.T) {
	f := newLiveFx(t)
	ctx := t.Context()
	svc := healthproviders.NewService(f.pool, nil, nil)
	ph := healthproviders.NewHandler(svc)
	f.engine.PUT("/v/providers/applications/:id/location", func(c *gin.Context) {
		if u := c.GetHeader("X-Test-User"); u != "" {
			c.Set("user_id", u)
		}
		ph.SetLocation(c)
	})
	f.engine.GET("/v/providers/applications/:id", func(c *gin.Context) {
		if u := c.GetHeader("X-Test-User"); u != "" {
			c.Set("user_id", u)
		}
		ph.Get(c)
	})

	withLoc := f.newUser()
	noLoc := f.newUser()
	stranger := f.newUser()
	admin := f.newUser()

	appA, err := svc.CreateApplication(ctx, withLoc, "VET", "vet", "Dr Located")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	appB, err := svc.CreateApplication(ctx, noLoc, "VET", "vet", "Dr Unlocated")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	path := "/providers/applications/" + appA.ID + "/location"
	good := map[string]any{"address": "5 Awolowo Rd, Ikoyi", "city": "Lagos", "state": "Lagos", "lat": 6.4503, "lng": 3.4316}

	// Validation: coordinates are required, pairs/ranges are enforced, nothing is written.
	for name, body := range map[string]map[string]any{
		"no coordinates": {"address": "x"},
		"lat only":       {"lat": 6.45},
		"out of range":   {"lat": 95.0, "lng": 3.4},
		"null island":    {"lat": 0.0, "lng": 0.0},
		"address long":   {"address": strings.Repeat("a", 201), "lat": 6.45, "lng": 3.43},
	} {
		if code, _ := f.do(withLoc, "PUT", path, body); code != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", name, code)
		}
	}
	var gotLat *float64
	_ = f.pool.QueryRow(ctx, `SELECT geo_lat FROM health_provider_applications WHERE id=$1`, appA.ID).Scan(&gotLat)
	if gotLat != nil {
		t.Fatal("a rejected save must not write coordinates")
	}

	// A stranger gets the uniform not-found and writes nothing.
	if code, _ := f.do(stranger, "PUT", path, good); code != http.StatusNotFound {
		t.Errorf("foreign owner = %d, want 404", code)
	}
	if code, _ := f.do("", "PUT", path, good); code != http.StatusUnauthorized {
		t.Errorf("no user = %d, want 401", code)
	}

	// The owner saves it; the draft keeps its other keys and the GET returns the point.
	if _, err := f.pool.Exec(ctx, `INSERT INTO doctor_vet_profiles (user_id, profile_draft)
		VALUES ($1, '{"draft":{"bio":"keep me","personalInfo":{"firstName":"Ade"}}}'::jsonb)`, withLoc); err != nil {
		t.Fatal(err)
	}
	if code, raw := f.do(withLoc, "PUT", path, good); code != http.StatusOK {
		t.Fatalf("put = %d %s", code, raw)
	}
	var draft string
	_ = f.pool.QueryRow(ctx, `SELECT profile_draft::text FROM doctor_vet_profiles WHERE user_id=$1`, withLoc).Scan(&draft)
	for _, want := range []string{"keep me", `"firstName"`, "5 Awolowo Rd, Ikoyi", `"state"`} {
		if !strings.Contains(draft, want) {
			t.Errorf("draft lost %q: %s", want, draft)
		}
	}
	code, raw := f.do(withLoc, "GET", "/providers/applications/"+appA.ID, nil)
	var got struct {
		Application struct {
			GeoLat *float64 `json:"geo_lat"`
			GeoLng *float64 `json:"geo_lng"`
		} `json:"application"`
	}
	_ = json.Unmarshal(raw, &got)
	if code != 200 || got.Application.GeoLat == nil || *got.Application.GeoLat < 6.4502 || *got.Application.GeoLng > 3.4317 {
		t.Errorf("GET application did not return the saved location: %d %s", code, raw)
	}

	// Once submitted the location is locked; NEEDS_INFO reopens it.
	if _, err := svc.Submit(ctx, withLoc, appA.ID); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if code, _ := f.do(withLoc, "PUT", path, good); code != http.StatusConflict {
		t.Errorf("save after submit = %d, want 409", code)
	}
	if _, err := svc.Decision(ctx, admin, appA.ID, "start_review", ""); err != nil {
		t.Fatalf("start_review before need_info: %v", err)
	}
	if _, err := svc.Decision(ctx, admin, appA.ID, "need_info", "pin your clinic"); err != nil {
		t.Fatalf("need_info: %v", err)
	}
	moved := map[string]any{"address": "7 Awolowo Rd, Ikoyi", "city": "Lagos", "state": "Lagos", "lat": 6.4510, "lng": 3.4320}
	if code, raw := f.do(withLoc, "PUT", path, moved); code != http.StatusOK {
		t.Fatalf("save while NEEDS_INFO = %d %s", code, raw)
	}
	if _, err := svc.Submit(ctx, withLoc, appA.ID); err != nil {
		t.Fatalf("resubmit: %v", err)
	}

	// Admin approval copies the point onto health_providers.geo.
	// A NEEDS_INFO resubmit goes straight back to UNDER_REVIEW, so approval can follow.
	approvedA, err := svc.Decision(ctx, admin, appA.ID, "approve", "ok")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	var lat, lng float64
	if err := f.pool.QueryRow(ctx, `SELECT ST_Y(geo::geometry), ST_X(geo::geometry) FROM health_providers WHERE id=$1 AND geo IS NOT NULL`,
		*approvedA.ProviderID).Scan(&lat, &lng); err != nil {
		t.Fatalf("approved vet has no geo: %v", err)
	}
	if lat < 6.4509 || lat > 6.4511 || lng < 3.4319 || lng > 3.4321 {
		t.Errorf("geo = (%v,%v), want the latest saved point (6.4510, 3.4320)", lat, lng)
	}

	// The vet shows up in near-me discovery with those coordinates.
	dh := healthvet.NewHandler(f.h.vet, nil)
	f.engine.GET("/v/vets", func(c *gin.Context) { c.Set("user_id", f.ownerID); dh.DiscoverVets(c) })
	req := httptest.NewRequest("GET", "/v/vets?lat=6.451&lng=3.432&radiusKm=20", nil)
	w := httptest.NewRecorder()
	f.engine.ServeHTTP(w, req)
	var disc struct {
		Vets []struct {
			ID  string  `json:"id"`
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		} `json:"vets"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &disc)
	found := false
	for _, v := range disc.Vets {
		if v.ID == *approvedA.ProviderID {
			found = true
			if v.Lat < 6.4509 || v.Lat > 6.4511 || v.Lng < 3.4319 || v.Lng > 3.4321 {
				t.Errorf("discovery coordinates = (%v,%v)", v.Lat, v.Lng)
			}
		}
	}
	if !found {
		t.Errorf("approved vet missing from near-me discovery: %d %s", w.Code, w.Body.String())
	}

	// A vet approved WITHOUT a location still approves; geo stays NULL.
	if _, err := svc.Submit(ctx, noLoc, appB.ID); err != nil {
		t.Fatalf("submit B: %v", err)
	}
	if _, err := svc.Decision(ctx, admin, appB.ID, "start_review", ""); err != nil {
		t.Fatalf("start_review B: %v", err)
	}
	approvedB, err := svc.Decision(ctx, admin, appB.ID, "approve", "ok")
	if err != nil {
		t.Fatalf("approve without location: %v", err)
	}
	var hasGeo bool
	if err := f.pool.QueryRow(ctx, `SELECT geo IS NOT NULL FROM health_providers WHERE id=$1`, *approvedB.ProviderID).Scan(&hasGeo); err != nil {
		t.Fatal(err)
	}
	if hasGeo {
		t.Error("approval without a location must leave geo NULL")
	}

	// A re-approve of a vet whose application has no point never wipes an existing geo.
	if _, err := f.pool.Exec(ctx, `UPDATE health_providers SET geo = ST_SetSRID(ST_MakePoint(3.5, 6.5), 4326)::geography WHERE id=$1`, *approvedB.ProviderID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE health_provider_applications SET state='UNDER_REVIEW' WHERE id=$1`, appB.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Decision(ctx, admin, appB.ID, "approve", "again"); err != nil {
		t.Fatalf("re-approve: %v", err)
	}
	if err := f.pool.QueryRow(ctx, `SELECT geo IS NOT NULL FROM health_providers WHERE id=$1`, *approvedB.ProviderID).Scan(&hasGeo); err != nil {
		t.Fatal(err)
	}
	if !hasGeo {
		t.Error("re-approval with no application point must not overwrite an existing geo with NULL")
	}
}
