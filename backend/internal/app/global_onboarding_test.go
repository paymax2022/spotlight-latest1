package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/crossborder/onboarding"
)

func globalRoutes() []string {
	return []string{
		"GET /v1/global/status",
		"POST /v1/global/activate",
		"PUT /v1/global/onboarding/documents",
		"POST /v1/global/onboarding/tnc",
		"GET /v1/global/wallets",
		"GET /v1/global/wallets/USD/funding-details",
	}
}

func denyAll(c *gin.Context) { c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "auth"}) }

func hit(r *gin.Engine, spec string) int {
	var m, p string
	for i := range spec {
		if spec[i] == ' ' {
			m, p = spec[:i], spec[i+1:]
			break
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(m, p, nil))
	return w.Code
}

func TestRoutes_UnmountedWhenFlagOff(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	svc := onboarding.NewService(onboarding.Deps{})
	if mountGlobalOnboarding(r, &config.Config{FeatureSpotlightGlobalEnabled: false}, svc, nil, nil, denyAll) {
		t.Fatal("flag off must mount nothing")
	}
	for _, spec := range globalRoutes() {
		if code := hit(r, spec); code != http.StatusNotFound {
			t.Fatalf("%s: got %d, want 404 (unmounted)", spec, code)
		}
	}
}

func TestRoutes_NotMountedWithoutService(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if mountGlobalOnboarding(r, &config.Config{FeatureSpotlightGlobalEnabled: true}, nil, nil, nil, denyAll) {
		t.Fatal("no service must mount nothing")
	}
	if code := hit(r, "GET /v1/global/status"); code != http.StatusNotFound {
		t.Fatalf("got %d, want 404", code)
	}
}

func TestRoutes_MountedBehindAuthWhenFlagOn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	svc := onboarding.NewService(onboarding.Deps{})
	if !mountGlobalOnboarding(r, &config.Config{FeatureSpotlightGlobalEnabled: true}, svc, nil, nil, denyAll) {
		t.Fatal("flag on must mount")
	}
	for _, spec := range globalRoutes() {
		if code := hit(r, spec); code != http.StatusUnauthorized {
			t.Fatalf("%s: got %d, want 401 from the auth middleware", spec, code)
		}
	}
}

func TestBuildGlobalOnboarding_InertWhenFlagOffOrKeyBad(t *testing.T) {
	if s, p := buildGlobalOnboarding(&config.Config{}, nil, nil); s != nil || p != nil {
		t.Fatal("flag off must build nothing")
	}
	// Flag on without a DB pool must fail closed, not panic.
	if s, _ := buildGlobalOnboarding(&config.Config{FeatureSpotlightGlobalEnabled: true}, nil, nil); s != nil {
		t.Fatal("no pool must build nothing")
	}
}

func TestOrchestrationOptions_AccountLifecycleOnlyWhenServiceExists(t *testing.T) {
	if got := len(orchestrationOptions("vertofx", nil)); got != 1 {
		t.Fatalf("flag off: want only the default-provider option, got %d", got)
	}
	if got := len(orchestrationOptions("vertofx", onboarding.NewService(onboarding.Deps{}))); got != 2 {
		t.Fatalf("flag on: want lifecycle option attached, got %d", got)
	}
}
