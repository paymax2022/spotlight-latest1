package handlers

// Guards for the admin overview registry (overviewSpecs).
//
// The registry is hand-written SQL plus hand-written links, and both fail
// SILENTLY: a status string that no row can ever hold counts 0 forever ("all
// clear" while the queue fills), and a link to a route with no page lands on the
// "Module In Transition" catch-all instead of somewhere an admin can act. Each
// test below pins one of those ways the dashboard can lie.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Must match GROUP_ORDER in frontend-admin/src/features/dashboard/AdminDashboard.tsx;
// a group outside it sorts to the bottom of the page.
var overviewGroups = map[string]bool{
	"Money": true, "Commerce": true, "Travel": true, "Health": true, "Community": true, "Programs": true,
}

var countSQL = regexp.MustCompile(`(?is)^\s*SELECT\s+count\(\*\)\s+FROM\s+public\.([a-z_][a-z0-9_]*)(\s+WHERE\s+.+)?$`)

func TestOverviewSpecs_Structure(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range overviewSpecs {
		if s.Key == "" || seen[s.Key] {
			t.Errorf("registry key %q is empty or duplicated", s.Key)
		}
		seen[s.Key] = true

		if s.Label == "" || s.Volume == "" || s.Attn == "" {
			t.Errorf("%s: label, volume label and attention label are all required", s.Key)
		}
		if !overviewGroups[s.Group] {
			t.Errorf("%s: group %q is not one the dashboard orders", s.Key, s.Group)
		}
		if s.Severity != "critical" && s.Severity != "warn" {
			t.Errorf("%s: severity %q must be critical|warn", s.Key, s.Severity)
		}
		// A queue with nowhere to resolve it must SAY so; a link and a "no screen"
		// note together (or neither) would contradict each other.
		if (s.AttnHref == "") == (s.AttnNote == "") {
			t.Errorf("%s: set exactly one of AttnHref (a screen resolves it) or AttnNote (none does)", s.Key)
		}
		for name, q := range map[string]string{"volume": s.VolSQL, "attention": s.AttnSQL} {
			if !countSQL.MatchString(q) {
				t.Errorf("%s: %s SQL must be a single `SELECT count(*) FROM public.<table> [WHERE ...]`: %s", s.Key, name, q)
			}
			if strings.ContainsAny(q, ";") {
				t.Errorf("%s: %s SQL must be one statement", s.Key, name)
			}
		}
	}
}

// A link to a route with no page.tsx falls into app/admin/[...slug] — the legacy
// bridge — so the admin is told there is work and sent somewhere they cannot do it.
func TestOverviewSpecs_LinksResolveToRealAdminPages(t *testing.T) {
	root := filepath.Join("..", "..", "..", "frontend-admin", "app")
	if _, err := os.Stat(root); err != nil {
		t.Skip("frontend-admin not in this checkout — cannot resolve dashboard links")
	}
	check := func(key, field, href string) {
		if !strings.HasPrefix(href, "/admin/") {
			t.Errorf("%s: %s %q must start with /admin/", key, field, href)
			return
		}
		path := href
		if i := strings.IndexAny(path, "?#"); i >= 0 {
			path = path[:i]
		}
		page := filepath.Join(root, filepath.FromSlash(path), "page.tsx")
		if _, err := os.Stat(page); err != nil {
			t.Errorf("%s: %s %q has no page (%s) — it would open the legacy bridge, not the queue", key, field, href, page)
		}
	}
	for _, s := range overviewSpecs {
		check(s.Key, "href", s.Href)
		if s.AttnHref != "" { // "" is the explicit no-screen case, covered by the Structure test
			check(s.Key, "attention href", s.AttnHref)
		}
	}
}

// FX KYC is an approval queue with a working review screen. Without a registry
// row its pending/review submissions exist only on /admin/fx/kyc, so the
// dashboard reports an all-clear while the queue fills.
func TestOverviewSpecs_FxKycQueueIsRegistered(t *testing.T) {
	var spec *moduleSpec
	for i := range overviewSpecs {
		if overviewSpecs[i].Key == "fx-kyc" {
			spec = &overviewSpecs[i]
			break
		}
	}
	if spec == nil {
		t.Fatal("fx-kyc is not registered — FX KYC submissions never reach Needs attention")
	}
	if spec.AttnHref != "/admin/fx/kyc" {
		t.Errorf("attention href %q, want /admin/fx/kyc", spec.AttnHref)
	}
	if spec.Severity != "critical" {
		t.Errorf("severity %q, want critical — FX tier access is blocked until reviewed", spec.Severity)
	}
	for _, status := range []string{"'pending'", "'review'"} {
		if !strings.Contains(spec.AttnSQL, status) {
			t.Errorf("attention SQL %q omits %s, a status the KYC page can decide", spec.AttnSQL, status)
		}
	}
	if !strings.Contains(spec.AttnSQL, "orch_fx_customer_verifications") {
		t.Errorf("attention SQL %q does not read the FX KYC queue", spec.AttnSQL)
	}
}

// THE STANDARD, ENFORCED. Every queue where the platform waits on a human admin
// is a registry row, and this ledger is the list a reviewer cannot forget.
//
// It exists because the Programs group used to be invisible: the console appended
// its own rows with attention hardcoded to 0, so Open Mic songs, Open Mic
// applications, audition registrations and contest approvals reported "cleared"
// forever while they filled. Adding a review screen, a decide endpoint, or a new
// module with a decision state therefore requires a row here; the doc test below
// additionally requires the rule to be written down.
// See docs/ops/admin-needs-attention-standard.md.
func TestOverviewSpecs_DecisionQueuesAreRegistered(t *testing.T) {
	byKey := map[string]moduleSpec{}
	for _, s := range overviewSpecs {
		byKey[s.Key] = s
	}

	// key, the screen that resolves it, and how the attention SQL must express the queue.
	//   contains  — fragments that must appear anywhere in AttnSQL
	//   absent    — status literals that must not appear at all (the queue is a
	//               whitelist, so a decided state must never be matched)
	//   excluded  — status literals that must sit INSIDE the `NOT IN (...)` list
	//               (the queue is a blacklist, so anything not excluded — including
	//               a status invented next quarter — counts as outstanding)
	ledger := []struct {
		key, href, severity string
		contains            []string
		absent              []string
		excluded            []string
	}{
		// An Open Mic edition is identified three ways, exactly as the app does
		// (frontend-web/src/features/openmic/edition-identity.ts).
		{key: "open-mic-submissions", href: "/admin/open-mic", severity: "warn",
			contains: []string{"competition_entries", "one_beat_one_verse", "open_mic"},
			excluded: []string{"'draft'", "'awaiting_payment'", "'correction_requested'",
				"'clean_version_requested'", "'published_for_voting'", "'rejected'", "'disqualified'", "'winner'"}},
		// The Applications review endpoint writes 'approved' | 'rejected';
		// 'pending' is therefore the only state left that is the admin's to clear.
		{key: "open-mic-applications", href: "/admin/open-mic", severity: "warn",
			contains: []string{"competition_enrollments", "status='pending'"},
			absent:   []string{"'approved'", "'rejected'"}},
		// PATCH /api/admin/academy/applications/[id] writes approved|rejected and,
		// on approval, creates the instalment plan and enrols the learner.
		{key: "academy-applications", href: "/admin/academy/film", severity: "warn",
			contains: []string{"academy_applications", "status='pending'"},
			absent:   []string{"'approved'", "'rejected'"}},
		// registration_status is an enum: pending|confirmed|cancelled|attended. No
		// console page reads the table, so this row must carry a note, not a link.
		{key: "auditions", href: "", severity: "warn",
			contains: []string{"audition_registrations", "status='pending'"},
			absent:   []string{"'confirmed'", "'attended'", "'cancelled'"}},
		// Maker-checker: held until a second admin signs, so a published result is
		// not yet one person's word. Critical, not warn.
		{key: "contest-approvals", href: "/admin/voting/approvals", severity: "critical",
			contains: []string{"contest_admin_approvals", "status='pending_approval'"},
			absent:   []string{"'executed'", "'rejected'", "'cancelled'"}},
		// Regression pins for queues that were already here.
		{key: "registration", href: "/admin/registration", severity: "warn",
			contains: []string{"'submitted'", "'under_review'"}},
		{key: "sme-pitch", href: "/admin/sme-pitch", severity: "warn",
			contains: []string{"'submitted'", "'under_review'"}},
		{key: "academy-tutors", href: "/admin/academy/tutors", severity: "warn",
			contains: []string{"status='pending'"}},
		{key: "academy-questions", href: "/admin/academy/question-bank", severity: "warn",
			contains: []string{"status='review'"}},
		{key: "stem-schools", href: "/admin/schools", severity: "warn",
			contains: []string{"'PENDING'", "'UNDER_REVIEW'"}},
	}

	for _, want := range ledger {
		s, ok := byKey[want.key]
		if !ok {
			t.Errorf("%s is missing from overviewSpecs — the dashboard cannot report a queue it does not read", want.key)
			continue
		}
		if s.Severity != want.severity {
			t.Errorf("%s: severity %q, want %q", want.key, s.Severity, want.severity)
		}
		if want.href == "" {
			if s.AttnHref != "" {
				t.Errorf("%s: has no working screen but links %q — send the admin somewhere they can act", want.key, s.AttnHref)
			}
			if s.AttnNote == "" {
				t.Errorf("%s: a queue with no screen must say so in AttnNote", want.key)
			}
		} else if s.AttnHref != want.href {
			t.Errorf("%s: attention href %q, want %q", want.key, s.AttnHref, want.href)
		}
		for _, frag := range want.contains {
			if !strings.Contains(s.AttnSQL, frag) {
				t.Errorf("%s: attention SQL omits %s — the screen acts on it, so the queue would never match:\n  %s", want.key, frag, s.AttnSQL)
			}
		}
		for _, lit := range want.absent {
			if strings.Contains(s.AttnSQL, lit) {
				t.Errorf("%s: attention SQL counts %s, a state that is not the admin's to wait on:\n  %s", want.key, lit, s.AttnSQL)
			}
		}
		for _, lit := range want.excluded {
			if !excludedByNotIn(s.AttnSQL, lit) {
				t.Errorf("%s: attention SQL must exclude %s inside its `NOT IN (...)` blacklist — leaving it out of a whitelist would silently stop counting work:\n  %s", want.key, lit, s.AttnSQL)
			}
		}
	}
}

// excludedByNotIn reports whether the literal sits inside the attention SQL's
// `NOT IN (...)` list — the blacklist holding drafts, artist-side states and
// finished decisions out of the queue.
func excludedByNotIn(sql, lit string) bool {
	for _, part := range strings.Split(sql, "NOT IN (")[1:] {
		end := strings.Index(part, ")")
		if end < 0 {
			continue
		}
		if strings.Contains(part[:end], lit) {
			return true
		}
	}
	return false
}

// The written rule is part of the guard: a registry row that is not in the
// standard's ledger means the doc has fallen behind the code, and the doc is what
// tells the next contributor a queue belongs here at all.
func TestOverviewSpecs_AreLedgedInTheStandardDoc(t *testing.T) {
	path := filepath.Join("..", "..", "..", "docs", "ops", "admin-needs-attention-standard.md")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the standard (%s): every admin decision queue must be documented there: %v", path, err)
	}
	doc := string(data)
	for _, s := range overviewSpecs {
		if !strings.Contains(doc, "`"+s.Key+"`") {
			t.Errorf("%s (%s) is not ledged in docs/ops/admin-needs-attention-standard.md", s.Key, s.Label)
		}
	}
}

// ---- live-DB: the predicates against the real, migrated schema ----------------
// Skipped unless TEST_DATABASE_URL is set (never falls back to DATABASE_URL).
// A table that does not exist FAILS here: CI replays every migration, so an absent
// table is a real defect. For a developer database that lags the newest
// migrations, OVERVIEW_GUARD_ALLOW_MISSING=1 downgrades it to a log line.

var (
	eqLiteral = regexp.MustCompile(`(?i)\b([a-z_][a-z0-9_]*)\s*=\s*'([^']*)'`)
	inList    = regexp.MustCompile(`(?is)\b([a-z_][a-z0-9_]*)\s+IN\s*\(([^)]*)\)`)
	quoted    = regexp.MustCompile(`'([^']*)'`)
)

type colLiteral struct{ col, lit string }

func literalsIn(sql string) []colLiteral {
	var out []colLiteral
	for _, m := range eqLiteral.FindAllStringSubmatch(sql, -1) {
		out = append(out, colLiteral{strings.ToLower(m[1]), m[2]})
	}
	for _, m := range inList.FindAllStringSubmatch(sql, -1) {
		for _, q := range quoted.FindAllStringSubmatch(m[2], -1) {
			out = append(out, colLiteral{strings.ToLower(m[1]), q[1]})
		}
	}
	return out
}

func overviewLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB overview predicate check")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// allowedValues returns the values a column may hold according to its CHECK
// constraints or enum type. known=false means the column is unconstrained, so the
// literal cannot be verified.
func allowedValues(ctx context.Context, pool *pgxpool.Pool, table, col string) (defs []string, enum []string, err error) {
	rows, err := pool.Query(ctx, `
		SELECT pg_get_constraintdef(oid) FROM pg_constraint
		WHERE conrelid = to_regclass('public.' || $1) AND contype = 'c'
		  AND pg_get_constraintdef(oid) ~* ('\m' || $2 || '\M')`, table, col)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			rows.Close()
			return nil, nil, err
		}
		defs = append(defs, d)
	}
	rows.Close()

	erows, err := pool.Query(ctx, `
		SELECT e.enumlabel FROM information_schema.columns c
		JOIN pg_type t ON t.typname = c.udt_name
		JOIN pg_enum e ON e.enumtypid = t.oid
		WHERE c.table_schema='public' AND c.table_name=$1 AND c.column_name=$2`, table, col)
	if err != nil {
		return nil, nil, err
	}
	defer erows.Close()
	for erows.Next() {
		var l string
		if err := erows.Scan(&l); err != nil {
			return nil, nil, err
		}
		enum = append(enum, l)
	}
	return defs, enum, nil
}

func TestOverviewSpecs_PredicatesMatchTheRealSchema(t *testing.T) {
	pool := overviewLivePool(t)
	allowMissing := os.Getenv("OVERVIEW_GUARD_ALLOW_MISSING") == "1"
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	for _, s := range overviewSpecs {
		for name, q := range map[string]string{"volume": s.VolSQL, "attention": s.AttnSQL} {
			m := countSQL.FindStringSubmatch(q)
			if m == nil {
				continue // reported by TestOverviewSpecs_Structure
			}
			table := m[1]

			var n int64
			if err := pool.QueryRow(ctx, q).Scan(&n); err != nil {
				if allowMissing && strings.Contains(err.Error(), "42P01") {
					t.Logf("%s/%s: table %s absent on this database (allowed)", s.Key, name, table)
					continue
				}
				t.Errorf("%s/%s: query fails — it would render as \"—\" forever: %v\n  %s", s.Key, name, err, q)
				continue
			}

			for _, cl := range literalsIn(q) {
				defs, enum, err := allowedValues(ctx, pool, table, cl.col)
				if err != nil {
					t.Errorf("%s/%s: reading constraints for %s.%s: %v", s.Key, name, table, cl.col, err)
					continue
				}
				switch {
				case len(enum) > 0:
					ok := false
					for _, l := range enum {
						ok = ok || l == cl.lit
					}
					if !ok {
						t.Errorf("%s/%s: %s.%s = %q is not in enum %v — this queue can never be non-zero", s.Key, name, table, cl.col, cl.lit, enum)
					}
				case len(defs) > 0:
					ok := false
					for _, d := range defs {
						ok = ok || strings.Contains(d, "'"+cl.lit+"'")
					}
					if !ok {
						t.Errorf("%s/%s: %s.%s = %q is not allowed by its CHECK (%s) — this queue can never be non-zero", s.Key, name, table, cl.col, cl.lit, strings.Join(defs, " | "))
					}
				default:
					t.Logf("%s/%s: %s.%s has no CHECK/enum — %q is unverifiable", s.Key, name, table, cl.col, cl.lit)
				}
			}
		}
	}
}

// The wire format the dashboard reads: every registry row is served, a queue with
// no screen carries its note and an empty href, and one with a screen carries no note.
func TestAdminOverview_Handler_ServesTheRegistry(t *testing.T) {
	pool := overviewLivePool(t)
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/overview", nil)

	NewAdminOverviewHandler(pool).Overview(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Success bool `json:"success"`
		Modules []struct {
			Key       string `json:"key"`
			Attention struct {
				Value *int64 `json:"value"`
				Href  string `json:"href"`
				Note  string `json:"note"`
			} `json:"attention"`
		} `json:"modules"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Success || len(body.Modules) != len(overviewSpecs) {
		t.Fatalf("want %d modules, got success=%v len=%d", len(overviewSpecs), body.Success, len(body.Modules))
	}
	for i, m := range body.Modules {
		spec := overviewSpecs[i]
		if m.Key != spec.Key {
			t.Fatalf("row %d: key %q, want %q (order must follow the registry)", i, m.Key, spec.Key)
		}
		if (m.Attention.Href == "") != (spec.AttnNote != "") || m.Attention.Note != spec.AttnNote {
			t.Errorf("%s: href=%q note=%q does not match the registry", m.Key, m.Attention.Href, m.Attention.Note)
		}
	}
}
