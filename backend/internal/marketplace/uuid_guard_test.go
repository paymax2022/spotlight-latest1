package marketplace

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// uuidParamNames mirrors the whitelist inside UUIDParams — the complete set of
// param names that are uuid columns across /v1/marketplace routes today.
var uuidParamNames = []string{"id", "mediaId", "categoryId"}

// TestUUIDParamsRejectsMalformed asserts the group-wide guard turns a malformed
// uuid path param into 404 NOT_FOUND (never the driver's
// "invalid input syntax for type uuid" → 500). Reproduces the live probe:
// GET /v1/marketplace/listings/not-a-uuid → 500 INTERNAL_ERROR.
func TestUUIDParamsRejectsMalformed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, name := range uuidParamNames {
		r := gin.New()
		r.Use(UUIDParams())
		reached := false
		r.GET("/x/:"+name, func(c *gin.Context) {
			reached = true
			c.Status(http.StatusOK)
		})
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/x/not-a-uuid", nil)
		r.ServeHTTP(rec, req)

		if reached {
			t.Fatalf("param %q: handler ran despite malformed uuid", name)
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("param %q: got %d, want 404 (body %s)", name, rec.Code, rec.Body.String())
		}
		var body struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("param %q: unmarshal error body: %v", name, err)
		}
		if body.Error.Code != CodeNotFound {
			t.Fatalf("param %q: got code %q, want %q", name, body.Error.Code, CodeNotFound)
		}
		// No driver/SQL detail may leak into the client-facing message.
		if strings.Contains(body.Error.Message, "uuid") || strings.Contains(body.Error.Message, "syntax") {
			t.Fatalf("param %q: message leaks driver detail: %q", name, body.Error.Message)
		}
	}
}

// TestUUIDParamsPassesWellFormed asserts a well-formed uuid reaches the handler.
func TestUUIDParamsPassesWellFormed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(UUIDParams())
	reached := false
	r.GET("/x/:id/y/:mediaId", func(c *gin.Context) {
		reached = true
		c.Status(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/x/86ce4f76-38de-4e29-b7b4-b565946443ff/y/9f928ee8-3978-483f-a3eb-127fbc1625f6", nil)
	r.ServeHTTP(rec, req)
	if !reached || rec.Code != http.StatusOK {
		t.Fatalf("well-formed uuids blocked: reached=%v code=%d", reached, rec.Code)
	}
}

// TestUUIDParamsIgnoresOtherParamNames guards forward-compat: a param outside
// the uuid set (e.g. :token) must pass through untouched even when malformed.
func TestUUIDParamsIgnoresOtherParamNames(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(UUIDParams())
	reached := false
	r.GET("/x/:token", func(c *gin.Context) {
		reached = true
		c.Status(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x/not-a-uuid", nil)
	r.ServeHTTP(rec, req)
	if !reached || rec.Code != http.StatusOK {
		t.Fatalf("non-uuid param was gated: reached=%v code=%d", reached, rec.Code)
	}
}

var bareIdent = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

// TestListingColsPrefixSafe is the regression test for the live
// GET /saved-items 500: listingCols is concatenated through prefixCols, which
// splits on commas to alias each column — an expression containing a comma
// (COALESCE(lga, ”) AS lga) was mangled into `l.COALESCE(lga, l.”) AS lga`
// and Postgres rejected the query unconditionally. Lock the invariant: every
// entry in listingCols is a bare column identifier, so prefixCols output is
// always valid SQL.
func TestListingColsPrefixSafe(t *testing.T) {
	for _, col := range strings.Split(listingCols, ",") {
		col = strings.TrimSpace(col)
		if col == "" {
			continue
		}
		if !bareIdent.MatchString(col) {
			t.Fatalf("listingCols entry %q is an expression — prefixCols would mangle it (see listingCols doc comment)", col)
		}
	}
	// And prefixCols must produce only "alias.<ident>" tokens — the exact
	// shape ListSavedItems embeds in its join SELECT.
	for _, col := range strings.Split(prefixCols("l", listingCols), ",") {
		col = strings.TrimSpace(col)
		if col == "" {
			continue
		}
		if !strings.HasPrefix(col, "l.") || !bareIdent.MatchString(strings.TrimPrefix(col, "l.")) {
			t.Fatalf("prefixCols produced non-column token %q", col)
		}
	}
}
