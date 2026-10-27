package taxonomy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSlugify_MatchesTheSeedGenerator(t *testing.T) {
	cases := map[string]string{
		"Meat, Chicken & Fish":  "meat-chicken-and-fish",
		"Men's Clothing":        "mens-clothing",
		"Home Décor":            "home-decor",
		"Banga/Ofe Akwu":        "banga-ofe-akwu",
		"Tiger Nut (Kunun Aya)": "tiger-nut-kunun-aya",
		"  Fried   Rice  ":      "fried-rice",
		"Corn (Roasted/Boiled)": "corn-roasted-boiled",
		"Low-carb":              "low-carb",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSlugify_EmptyWhenNothingUsable(t *testing.T) {
	if got := Slugify("!!! &&&"); got != "" {
		t.Fatalf("Slugify(symbols only) = %q, want empty", got)
	}
	if got := Slugify("---"); got != "" {
		t.Fatalf("Slugify(\"---\") = %q, want empty", got)
	}
}

func TestSeedFilesParseAndAreUniqueWithinEachLevel(t *testing.T) {
	var menu struct {
		Categories []seedCategory `json:"categories"`
	}
	if err := json.Unmarshal(menuSeedJSON, &menu); err != nil {
		t.Fatalf("menu seed: %v", err)
	}
	seen := map[string]bool{}
	total := 0
	for _, c := range menu.Categories {
		if seen[c.Slug] {
			t.Fatalf("duplicate top-level slug %q", c.Slug)
		}
		seen[c.Slug] = true
		if c.Kind != "FOOD" && c.Kind != "DRINK" && c.Kind != "OTHER" {
			t.Fatalf("%s: bad kind %q", c.Slug, c.Kind)
		}
		for _, s := range c.Children {
			if seen[s.Slug] {
				t.Fatalf("slug %q is not globally unique (sub of %s)", s.Slug, c.Slug)
			}
			seen[s.Slug] = true
			total++
		}
	}
	if len(menu.Categories) != 30 || total != 243 {
		t.Fatalf("seed size = %d top-level / %d sub; want 30 / 243", len(menu.Categories), total)
	}
	// Alcohol ships inactive: the spec's fallback, since there is no age-check column.
	for _, c := range menu.Categories {
		if (c.Name == "Beer & Ciders" || c.Name == "Wine & Champagne" || c.Name == "Spirits & Cocktails") && c.IsActive {
			t.Fatalf("%s must seed inactive", c.Name)
		}
	}
}

func TestForbidOwnerCategoryWrite_Answers403WithTheContractCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/x", ForbidOwnerCategoryWrite)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/x", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["error"] != "CATEGORY_MANAGEMENT_FORBIDDEN" {
		t.Fatalf("error code = %q", body["error"])
	}
}

// The customer browse reads live under their own prefix so they can be switched off
// independently of the merchant /menu-taxonomy reads.
func TestRegisterBrowse_MountsOnlyBrowseReads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterBrowse(r.Group("/api/restaurant"), NewHandler(nil))
	routes := map[string]bool{}
	for _, rt := range r.Routes() {
		routes[rt.Method+" "+rt.Path] = true
	}
	for _, want := range []string{
		"GET /api/restaurant/menu-taxonomy/browse/categories",
		"GET /api/restaurant/menu-taxonomy/browse/cuisines",
	} {
		if !routes[want] {
			t.Errorf("route not mounted: %s", want)
		}
	}
	if len(routes) != 2 {
		t.Errorf("RegisterBrowse mounted %d routes, want exactly 2: %v", len(routes), routes)
	}
}

// The admin group mounts both /categories/reorder (static) and /categories/:id (param)
// under PATCH. Building the router proves gin accepts that pair without a panic.
func TestRegister_MountsWithoutRouteConflicts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	admin := r.Group("/api/restaurant/admin")
	owner := r.Group("/api/restaurant")
	noop := func(string) gin.HandlerFunc { return func(c *gin.Context) { c.Next() } }
	Register(admin, owner, NewHandler(nil), noop)
	routes := map[string]bool{}
	for _, rt := range r.Routes() {
		routes[rt.Method+" "+rt.Path] = true
	}
	for _, want := range []string{
		"PATCH /api/restaurant/admin/menu-taxonomy/categories/reorder",
		"PATCH /api/restaurant/admin/menu-taxonomy/categories/:id",
		"POST /api/restaurant/admin/menu-taxonomy/categories/seed-defaults",
		"GET /api/restaurant/menu-taxonomy/categories",
	} {
		if !routes[want] {
			t.Errorf("route not mounted: %s", want)
		}
	}
}
