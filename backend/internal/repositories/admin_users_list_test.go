package repositories_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/repositories"
)

type capturedQuery struct {
	query url.Values
}

func fakePostgREST(t *testing.T, rows []map[string]any, captured *capturedQuery) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.query = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rows)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func repoFor(t *testing.T, rows []map[string]any, captured *capturedQuery) *repositories.RBACSupabaseRepository {
	t.Helper()
	return repositories.NewRBACSupabaseRepository(
		integrations.NewSupabaseRestClient(fakePostgREST(t, rows, captured).URL, "test-key"),
	)
}

func adminRow(id, email, state string) map[string]any {
	return map[string]any{
		"id": id, "first_name": "A", "last_name": "B", "email": email,
		"phone": "", "user_type": "user", "status": "active",
		"profile_completed": true, "created_at": "2026-01-01T00:00:00Z",
		"profiles": []map[string]any{
			{"state": state, "country": "NG", "metadata": map[string]any{}},
		},
	}
}

// AUD-BE-003: the search term was interpolated raw into the or(...) clause,
// letting reserved characters ( ) , break out of the group and inject
// predicates. The pattern must be quoted and quote escapes stripped.
func TestListAdminUsersSearchTermIsQuoted(t *testing.T) {
	var captured capturedQuery
	repo := repoFor(t, nil, &captured)

	_, err := repo.ListAdminUsers(domain.AdminUserFilter{
		Search: `evil"),(status.eq.suspended`,
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("ListAdminUsers: %v", err)
	}

	orParam := captured.query.Get("or")
	want := `(email.ilike."*evil),(status.eq.suspended*",first_name.ilike."*evil),(status.eq.suspended*",last_name.ilike."*evil),(status.eq.suspended*")`
	if orParam != want {
		t.Fatalf("or param = %q, want %q", orParam, want)
	}
}

// AUD-BE-003: a scoped filter must reach PostgREST itself — with a left-join
// embed and caller limit, PostgREST truncates the unfiltered page before Go
// ever sees the matches. The filter is pushed via profiles!inner + ilike, so
// the caller's limit applies to an already-filtered result set. The in-memory
// predicates remain as a second layer; here the fake server ignores the
// pushed filters and returns an unfiltered page, exercising both.
func TestListAdminUsersScopedFilterPushesDown(t *testing.T) {
	rows := make([]map[string]any, 0, 10)
	for i := range 6 {
		rows = append(rows, adminRow(fmt.Sprintf("u-%d", i), fmt.Sprintf("u%d@x.io", i), "Abuja"))
	}
	for i := 6; i < 10; i++ {
		rows = append(rows, adminRow(fmt.Sprintf("u-%d", i), fmt.Sprintf("u%d@x.io", i), "Lagos"))
	}

	var captured capturedQuery
	repo := repoFor(t, rows, &captured)

	users, err := repo.ListAdminUsers(domain.AdminUserFilter{State: "lagos", Limit: 3})
	if err != nil {
		t.Fatalf("ListAdminUsers: %v", err)
	}
	if got := captured.query.Get("profiles.state"); got != "ilike.lagos" {
		t.Fatalf("profiles.state filter = %q, want ilike.lagos (pushed down)", got)
	}
	if got := captured.query.Get("select"); !strings.Contains(got, "profiles!inner") {
		t.Fatalf("select = %q, want profiles!inner embed for scoped filtering", got)
	}
	if got := captured.query.Get("limit"); got != "3" {
		t.Fatalf("fetched limit = %q, want 3 (limit applies to the filtered page)", got)
	}
	if len(users) != 3 {
		t.Fatalf("returned %d users, want 3 (caller limit applied after filtering)", len(users))
	}
	for _, u := range users {
		if u.State != "Lagos" {
			t.Fatalf("unexpected user state %q", u.State)
		}
	}
}

func TestListAdminUsersUnscopedFilterKeepsCallerLimit(t *testing.T) {
	var captured capturedQuery
	repo := repoFor(t, nil, &captured)

	_, err := repo.ListAdminUsers(domain.AdminUserFilter{Status: "active", Limit: 25})
	if err != nil {
		t.Fatalf("ListAdminUsers: %v", err)
	}
	if got := captured.query.Get("limit"); got != "25" {
		t.Fatalf("fetched limit = %q, want 25 (no in-memory filter active)", got)
	}
	if got := captured.query.Get("status"); got != "eq.active" {
		t.Fatalf("status filter = %q, want eq.active", got)
	}
}
