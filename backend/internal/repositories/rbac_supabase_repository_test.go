package repositories //nolint:testpackage // asserts on PostgREST query construction via the real client

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

// AUD-BE-003: scoped filters must reach PostgREST (previously applied
// in-memory AFTER limit → under-fetching), and the search term must not be
// able to alter or(...) grouping (raw interpolation → DSL injection).

func listAdminUsersQuery(t *testing.T, filter domain.AdminUserFilter) url.Values {
	t.Helper()
	var captured url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	repo := NewRBACSupabaseRepository(integrations.NewSupabaseRestClient(srv.URL, "test-key"))
	if _, err := repo.ListAdminUsers(filter); err != nil {
		t.Fatalf("ListAdminUsers: %v", err)
	}
	return captured
}

func TestListAdminUsers_ScopedFiltersPushedDown(t *testing.T) {
	q := listAdminUsersQuery(t, domain.AdminUserFilter{State: "Lagos", Limit: 50})

	if sel := q.Get("select"); !strings.Contains(sel, "profiles!inner") {
		t.Fatalf("scoped filter must switch embed to !inner, select=%q", sel)
	}
	if got := q.Get("profiles.state"); got != "ilike.Lagos" {
		t.Fatalf("profiles.state=%q, want ilike.Lagos", got)
	}
	if q.Get("limit") != "50" {
		t.Fatalf("limit=%q, want 50", q.Get("limit"))
	}
}

func TestListAdminUsers_NoScopedFilterKeepsLeftEmbed(t *testing.T) {
	q := listAdminUsersQuery(t, domain.AdminUserFilter{Status: "active"})

	if sel := q.Get("select"); !strings.Contains(sel, "profiles!left") {
		t.Fatalf("unscoped listing must keep !left embed, select=%q", sel)
	}
	if q.Get("profiles.state") != "" {
		t.Fatalf("no scoped filter expected, got profiles.state=%q", q.Get("profiles.state"))
	}
}

func TestListAdminUsers_MetadataFiltersUseJSONBPath(t *testing.T) {
	q := listAdminUsersQuery(t, domain.AdminUserFilter{Program: "prog-1"})

	if got := q.Get("profiles.metadata->>program_id"); got != "ilike.prog-1" {
		t.Fatalf("program filter=%q, want ilike.prog-1", got)
	}
	if sel := q.Get("select"); !strings.Contains(sel, "metadata") {
		t.Fatalf("embed must select metadata for program/contest/school extraction, select=%q", sel)
	}
}

func TestListAdminUsers_SearchTermSanitized(t *testing.T) {
	q := listAdminUsersQuery(t, domain.AdminUserFilter{Search: `x"),(id.eq.`})

	// `"` is stripped; the remainder lands inside double quotes where `)` `(` `,`
	// and `.` are all literal — the or(...) grouping cannot be altered.
	want := `(email.ilike."*x),(id.eq.*",first_name.ilike."*x),(id.eq.*",last_name.ilike."*x),(id.eq.*")`
	if or := q.Get("or"); or != want {
		t.Fatalf("or=%q, want %q", or, want)
	}
}
