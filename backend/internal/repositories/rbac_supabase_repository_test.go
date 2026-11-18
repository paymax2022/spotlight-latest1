package repositories

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
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

	if sel := q.Get("select"); !strings.Contains(sel, "profiles(") || strings.Contains(sel, "profiles!inner") {
		t.Fatalf("unscoped listing must keep default left join profiles embed, select=%q", sel)
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

// enrichColumns is the allow-list of columns that really exist on each table
// (verified against supabase/migrations). The fake rejects any other column in
// `select` with HTTP 400, as PostgREST does, so a select of a missing column
// (user_profiles.profile_photo_url once did) fails the tests instead of
// silently dropping the whole read in production.
var enrichColumns = map[string]map[string]bool{
	"platform_users": {"id": true, "last_login_at": true, "email_verified_at": true,
		"phone_verified_at": true, "referral_code": true, "referred_by": true},
	"user_profiles": {"id": true, "avatar_url": true, "metadata": true},
}

// enrichRepo fakes PostgREST for EnrichAdminUser: one handler per table,
// each returning (status, body), with strict select validation.
func enrichRepo(t *testing.T, platform, profile func() (int, string)) *RBACSupabaseRepository {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fn, table := platform, "platform_users"
		if strings.HasSuffix(r.URL.Path, "/user_profiles") {
			fn, table = profile, "user_profiles"
		}
		for _, col := range strings.Split(r.URL.Query().Get("select"), ",") {
			if !enrichColumns[table][col] {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = fmt.Fprintf(w, `{"code":"42703","message":"column %s.%s does not exist"}`, table, col)
				return
			}
		}
		code, body := fn()
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return NewRBACSupabaseRepository(integrations.NewSupabaseRestClient(srv.URL, "test-key"))
}

func rows(body string) func() (int, string) { return func() (int, string) { return 200, body } }

const enrichPlatformRow = `[{"last_login_at":"2026-10-01T10:00:00Z","email_verified_at":"2026-09-01T10:00:00Z","phone_verified_at":"2026-09-02T10:00:00Z","referral_code":"ABC123","referred_by":"ref-user"}]`

func TestEnrichAdminUser_FillsExtrasAndAvatar(t *testing.T) {
	repo := enrichRepo(t, rows(enrichPlatformRow), rows(`[{"avatar_url":"https://img/a.png"}]`))
	got := repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u1", Email: "e@x.com"})
	if got.Email != "e@x.com" || got.ID != "u1" {
		t.Fatalf("base fields clobbered: %+v", got)
	}
	if got.LastLoginAt != "2026-10-01T10:00:00Z" || got.EmailVerifiedAt != "2026-09-01T10:00:00Z" ||
		got.PhoneVerifiedAt != "2026-09-02T10:00:00Z" || got.ReferralCode != "ABC123" || got.ReferredBy != "ref-user" {
		t.Fatalf("extras not filled: %+v", got)
	}
	if got.AvatarURL != "https://img/a.png" {
		t.Fatalf("AvatarURL=%q, want avatar_url", got.AvatarURL)
	}
}

func TestEnrichAdminUser_AvatarPrecedence(t *testing.T) {
	repo := enrichRepo(t, rows(`[]`), rows(`[{"avatar_url":"https://img/a.png","metadata":{"profilePhotoUrl":"https://img/m.png"}}]`))
	if got := repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u1"}); got.AvatarURL != "https://img/a.png" {
		t.Fatalf("AvatarURL=%q, want avatar_url", got.AvatarURL)
	}
	repo = enrichRepo(t, rows(`[]`), rows(`[{"avatar_url":"","metadata":{"profilePhotoUrl":"https://img/m.png"}}]`))
	if got := repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u1"}); got.AvatarURL != "https://img/m.png" {
		t.Fatalf("AvatarURL=%q, want metadata.profilePhotoUrl", got.AvatarURL)
	}
}

func TestEnrichAdminUser_ProfileReadFails_ReturnsUserUnchangedNoPanic(t *testing.T) {
	repo := enrichRepo(t, rows(enrichPlatformRow), func() (int, string) { return 500, `{"message":"boom"}` })
	got := repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u1"})
	if got.AvatarURL != "" {
		t.Fatalf("AvatarURL=%q, want empty", got.AvatarURL)
	}
	if got.ReferralCode != "ABC123" || got.LastLoginAt == "" {
		t.Fatalf("platform extras should still be set: %+v", got)
	}
}

func TestEnrichAdminUser_PlatformReadFails_ReturnsInputUnchanged(t *testing.T) {
	repo := enrichRepo(t, func() (int, string) { return 500, `{"message":"boom"}` }, rows(`[]`))
	in := domain.AdminUser{ID: "u1", Email: "e@x.com"}
	if got := repo.EnrichAdminUser(t.Context(), in); got != in {
		t.Fatalf("got %+v, want unchanged %+v", got, in)
	}
}

func TestEnrichAdminUser_SelectRequestsOnlyExistingColumns(t *testing.T) {
	repo := enrichRepo(t, rows(enrichPlatformRow), rows(`[{"avatar_url":"https://img/a.png","metadata":{}}]`))
	got := repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u1"})
	if got.AvatarURL != "https://img/a.png" {
		t.Fatalf("AvatarURL=%q, want avatar_url (a 400 from the strict fake drops the profile read)", got.AvatarURL)
	}
	if got.ReferralCode != "ABC123" {
		t.Fatalf("platform extras missing: %+v", got)
	}
}

func TestEnrichAdminUser_AvatarFallsBackToMetadata(t *testing.T) {
	repo := enrichRepo(t, rows(`[]`), rows(`[{"avatar_url":"  ","metadata":{"profilePhotoUrl":" https://img/m.png "}}]`))
	if got := repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u1"}); got.AvatarURL != "https://img/m.png" {
		t.Fatalf("AvatarURL=%q, want trimmed metadata.profilePhotoUrl", got.AvatarURL)
	}
}

func TestEnrichAdminUser_ProfileReadFailureIsLogged(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	repo := enrichRepo(t, rows(enrichPlatformRow), func() (int, string) { return 500, `{"message":"boom"}` })
	repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u-123", Email: "secret@x.com", Phone: "+2348000000000"})
	out := buf.String()
	if !strings.Contains(out, "user_profiles") || !strings.Contains(out, "u-123") {
		t.Fatalf("log should name table and user id, got %q", out)
	}
	if strings.Contains(out, "secret@x.com") || strings.Contains(out, "+2348000000000") {
		t.Fatalf("log leaked personal data: %q", out)
	}
}
