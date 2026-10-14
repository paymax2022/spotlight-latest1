package repositories

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

// enrichServer fakes PostgREST for EnrichAdminUser: one handler per table,
// each returning (status, body).
func enrichRepo(t *testing.T, platform, profile func() (int, string)) *RBACSupabaseRepository {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fn := platform
		if strings.HasSuffix(r.URL.Path, "/user_profiles") {
			fn = profile
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
	repo := enrichRepo(t, rows(enrichPlatformRow), rows(`[{"profile_photo_url":"https://img/p.png","avatar_url":"https://img/a.png"}]`))
	got := repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u1", Email: "e@x.com"})
	if got.Email != "e@x.com" || got.ID != "u1" {
		t.Fatalf("base fields clobbered: %+v", got)
	}
	if got.LastLoginAt != "2026-10-01T10:00:00Z" || got.EmailVerifiedAt != "2026-09-01T10:00:00Z" ||
		got.PhoneVerifiedAt != "2026-09-02T10:00:00Z" || got.ReferralCode != "ABC123" || got.ReferredBy != "ref-user" {
		t.Fatalf("extras not filled: %+v", got)
	}
	if got.AvatarURL != "https://img/p.png" {
		t.Fatalf("AvatarURL=%q, want profile_photo_url", got.AvatarURL)
	}
}

func TestEnrichAdminUser_AvatarPrecedence(t *testing.T) {
	repo := enrichRepo(t, rows(`[]`), rows(`[{"profile_photo_url":"","avatar_url":"https://img/a.png","metadata":{"profilePhotoUrl":"https://img/m.png"}}]`))
	if got := repo.EnrichAdminUser(t.Context(), domain.AdminUser{ID: "u1"}); got.AvatarURL != "https://img/a.png" {
		t.Fatalf("AvatarURL=%q, want avatar_url", got.AvatarURL)
	}
	repo = enrichRepo(t, rows(`[]`), rows(`[{"profile_photo_url":"","avatar_url":"","metadata":{"profilePhotoUrl":"https://img/m.png"}}]`))
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
