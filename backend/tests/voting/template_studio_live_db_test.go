package voting_test

// P3 Task 7 — the template lifecycle executed against a real Postgres.
//
// Migration 20272300000000 was replayed once and read back in Task 6, which proves the
// DDL parses. It proves nothing about the four bodies: plpgsql compiles a function at
// first call, and every rule this suite checks — D1's "publish activates the row it is
// handed, duplicate is the only id-minting path", D2's "exactly one active row per
// contest, swapped inside one transaction", the two 22023 refusals, the copied authoring
// columns, the archive idempotency — is behaviour that only a live call can show. The
// unit lane asserts the sentences are present in the file; this lane asserts they are
// present in the database.
//
// Fixture rule: rows are named with studioFixtureTitle / studioFixtureURL so a killed
// run leaves something identifiable, and every seeding helper registers its own teardown
// AFTER votingPool's, so LIFO ordering deletes templates before pool.Close. Teardown
// errors are swallowed, as in the rest of the package — a cascade after a real failure
// would bury it.

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	studioFixtureTitle = "ZZ Go Studio Fixture Template"
	studioFixtureURL   = "https://fixtures.invalid/zz-go-template.png"
)

// studioRPC runs one of the four lifecycle functions and returns its jsonb answer.
// No route exists yet (Task 11 wires them), so this is the first caller anywhere in the
// repo — which is the point of running it against a live database rather than a mock.
func studioRPC(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fn string, args ...any) map[string]any {
	t.Helper()
	var raw []byte
	q := "select " + fn + "(" + studioArgs(len(args)) + ")::text"
	err := pool.QueryRow(ctx, q, args...).Scan(&raw)
	if err != nil {
		t.Fatalf("%s: %v", fn, err)
	}
	var out map[string]any
	if e := json.Unmarshal(raw, &out); e != nil {
		t.Fatalf("%s returned non-jsonb %q: %v", fn, string(raw), e)
	}
	return out
}

// studioArgs builds "$1,$2,…" — parameterised, because a uuid literal in the query text
// would stop proving that the argument reaches the function as a uuid.
func studioArgs(n int) string {
	var b strings.Builder
	for i := 1; i <= n; i++ {
		if i > 1 {
			b.WriteByte(',')
		}
		b.WriteByte('$')
		b.WriteString(strconv.Itoa(i))
	}
	return b.String()
}

// newStudioTemplate seeds a draft template on a fixture contest, optionally with the
// contestant slot publish requires, and returns its id.
func newStudioTemplate(t *testing.T, ctx context.Context, pool *pgxpool.Pool, connectContestID string, contestantSlot bool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.contest_templates (
			id, name, connect_contest_id, template_url, status, version, photo_mode, blend_preset)
		VALUES ($1, $2, $3, $4, 'draft', 1, 'auto', 'natural')`,
		id, studioFixtureTitle, nullable(connectContestID), studioFixtureURL); err != nil {
		t.Fatalf("seed template: %v", err)
	}
	if contestantSlot {
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.template_slots (template_id, slot_name, slot_type, slot_order, x, y, width, height)
			VALUES ($1, 'Main Contestant', 'contestant', 0, 10, 20, 300, 400)`, id); err != nil {
			t.Fatalf("seed contestant slot: %v", err)
		}
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(context.Background())
		// Slots and overlays cascade off the template, so deleting the row is enough —
		// and template_slots has no standalone FK path that could block it.
		_, _ = pool.Exec(c, `DELETE FROM public.contest_templates WHERE id = $1`, id)
	})
	return id
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// countActive is the assertion D2 exists for: one contest, one active template.
func countActive(t *testing.T, ctx context.Context, pool *pgxpool.Pool, connectContestID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`select count(*) from public.contest_templates
		  where connect_contest_id = $1 and status = 'active'`, connectContestID).Scan(&n); err != nil {
		t.Fatalf("count active: %v", err)
	}
	return n
}

// ---------------------------------------------------------------------------

// D1: publishing does not copy. The draft row ITSELF becomes the live one, which is what
// keeps its id inside P1's job idempotency key honest — the pixels behind that id never
// change once it is active.
func TestLiveDB_TemplateStudio_PublishActivatesTheDraftInPlace(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	actor := anyVoter(t, ctx, pool)
	contest := newContest(t, ctx, pool, contestOpts{status: "open"})
	draft := newStudioTemplate(t, ctx, pool, contest, true)

	got := studioRPC(t, ctx, pool, "publish_contest_template", draft, actor)
	if got["template_id"] != draft {
		t.Fatalf("publish returned template_id %v, want the draft's own id %s (D1: no new row)", got["template_id"], draft)
	}
	if got["version"] != float64(1) {
		t.Fatalf("version = %v, want 1 — publish must not bump the version, duplicate does that", got["version"])
	}
	if ids, _ := got["archived_ids"].([]any); len(ids) != 0 {
		t.Fatalf("archived_ids = %v, want [] for a contest with no other active row", got["archived_ids"])
	}

	var status string
	var publishedBy *string
	var publishedAtSet bool
	err := pool.QueryRow(ctx, `
		select status, published_by::text, published_at is not null
		  from public.contest_templates where id = $1`, draft).
		Scan(&status, &publishedBy, &publishedAtSet)
	if err != nil {
		t.Fatalf("read published row: %v", err)
	}
	if status != "active" {
		t.Fatalf("status = %q, want active", status)
	}
	if !publishedAtSet {
		t.Fatal("published_at is NULL after publish — §4 makes it the fact that this row was live")
	}
	if publishedBy == nil || *publishedBy != actor {
		t.Fatalf("published_by = %v, want the p_actor we passed (%s)", publishedBy, actor)
	}
}

// D2, the observable half: the swap is one transaction, so the contest never ends up with
// two active templates, and the row it retires keeps its publication history.
func TestLiveDB_TemplateStudio_SecondPublishArchivesTheFirst(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	actor := anyVoter(t, ctx, pool)
	contest := newContest(t, ctx, pool, contestOpts{status: "open"})
	first := newStudioTemplate(t, ctx, pool, contest, true)
	second := newStudioTemplate(t, ctx, pool, contest, true)

	studioRPC(t, ctx, pool, "publish_contest_template", first, actor)
	if n := countActive(t, ctx, pool, contest); n != 1 {
		t.Fatalf("active count after the first publish = %d, want 1", n)
	}

	got := studioRPC(t, ctx, pool, "publish_contest_template", second, actor)
	archived, _ := got["archived_ids"].([]any)
	if len(archived) != 1 || archived[0] != first {
		t.Fatalf("archived_ids = %v, want exactly the first template %s", got["archived_ids"], first)
	}
	if n := countActive(t, ctx, pool, contest); n != 1 {
		t.Fatalf("active count after the second publish = %d, want 1 — D2 is exactly-one, not at-most-one", n)
	}

	var status string
	var publishedAtSet bool
	if err := pool.QueryRow(ctx,
		`select status, published_at is not null from public.contest_templates where id = $1`, first).
		Scan(&status, &publishedAtSet); err != nil {
		t.Fatalf("read archived row: %v", err)
	}
	if status != "archived" {
		t.Fatalf("first template status = %q, want archived", status)
	}
	// History, not a flag: "when was this the live frame" is a question the versions panel
	// asks, so archiving must not clear it.
	if !publishedAtSet {
		t.Fatal("archived row lost published_at — archive must keep the publication record")
	}
}

// Re-publishing the row that is ALREADY live is the case the `id <> p_template_id` guard
// exists for, and a mutant proved this test was needed: deleting that clause leaves the
// two-draft test above green, because a draft is never in the `status = 'active'` set the
// CTE sweeps. Here it is: without the guard the row would archive itself and the answer
// would report its own id in archived_ids — the final status would still come out 'active'
// (the update below the CTE re-activates it), so the lie would be only in what the admin is
// told. "Published again" must not read as "retired then shipped".
func TestLiveDB_TemplateStudio_RepublishingTheLiveRowArchivesNothing(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	actor := anyVoter(t, ctx, pool)
	contest := newContest(t, ctx, pool, contestOpts{status: "open"})
	tpl := newStudioTemplate(t, ctx, pool, contest, true)
	studioRPC(t, ctx, pool, "publish_contest_template", tpl, actor)
	firstSeen := publishedAt(t, ctx, pool, tpl)

	got := studioRPC(t, ctx, pool, "publish_contest_template", tpl, actor)
	if ids, _ := got["archived_ids"].([]any); len(ids) != 0 {
		t.Fatalf("re-publishing the live row reported archived_ids = %v, want [] — it is still the live row",
			got["archived_ids"])
	}
	if s := statusOf(t, ctx, pool, tpl); s != "active" {
		t.Fatalf("status after re-publish = %q, want active", s)
	}
	if n := countActive(t, ctx, pool, contest); n != 1 {
		t.Fatalf("active count = %d, want 1", n)
	}
	// The migration documents re-publishing as "how an admin re-times a publication", so
	// published_at has to move. now() is the transaction timestamp and these are two
	// transactions, so the values differ at microsecond granularity.
	secondSeen := publishedAt(t, ctx, pool, tpl)
	if !secondSeen.After(firstSeen) {
		t.Fatalf("published_at did not move on re-publish: %v then %v", firstSeen, secondSeen)
	}
}

func publishedAt(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) time.Time {
	t.Helper()
	var v time.Time
	if err := pool.QueryRow(ctx, `select published_at from public.contest_templates where id = $1`, id).Scan(&v); err != nil {
		t.Fatalf("read published_at: %v", err)
	}
	return v
}

// The two refusals share a SQLSTATE so the route can map them to one 400 shape, and each
// sentence names the fix, because an admin — not a developer — reads it in the console.
func TestLiveDB_TemplateStudio_PublishRefusesAMissingContestantSlot(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{status: "open"})
	bare := newStudioTemplate(t, ctx, pool, contest, false)

	_, err := execStudio(ctx, pool, "publish_contest_template", bare, nil)
	require22023(t, err, "contestant slot")

	if s := statusOf(t, ctx, pool, bare); s != "draft" {
		t.Fatalf("a refused publish left status %q, want draft", s)
	}
	if n := countActive(t, ctx, pool, contest); n != 0 {
		t.Fatalf("a refused publish activated something: active count = %d, want 0", n)
	}
}

func TestLiveDB_TemplateStudio_PublishRefusesAnUnlinkedTemplate(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	unlinked := newStudioTemplate(t, ctx, pool, "", true)

	_, err := execStudio(ctx, pool, "publish_contest_template", unlinked, nil)
	require22023(t, err, "connect contest")
}

func execStudio(ctx context.Context, pool *pgxpool.Pool, fn string, args ...any) (string, error) {
	var raw string
	err := pool.QueryRow(ctx, "select "+fn+"("+studioArgs(len(args))+")::text", args...).Scan(&raw)
	return raw, err
}

func require22023(t *testing.T, err error, wantFragment string) {
	t.Helper()
	if err == nil {
		t.Fatalf("the refusal did not happen; want SQLSTATE 22023 mentioning %q", wantFragment)
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("error = %v (%T), want *pgconn.PgError", err, err)
	}
	if pgErr.Code != "22023" {
		t.Fatalf("sqlstate = %s, want 22023 (the code Task 8 maps to a 400)", pgErr.Code)
	}
	if !strings.Contains(pgErr.Message, wantFragment) {
		t.Fatalf("message = %q, want it to name %q", pgErr.Message, wantFragment)
	}
}

func statusOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(ctx, `select status::text from public.contest_templates where id = $1`, id).Scan(&s); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("template %s vanished", id)
		}
		t.Fatalf("read status: %v", err)
	}
	return s
}

// D1's other half: duplicate is the ONLY path to a new version id, and it must carry the
// authoring across — including P2's four blend columns, because a duplicated template that
// silently fell back to `auto`/`face_protect = true` would re-render differently from the
// row the admin was looking at.
func TestLiveDB_TemplateStudio_DuplicateMintsTheNextVersionAndCopiesAuthoring(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	actor := anyVoter(t, ctx, pool)
	contest := newContest(t, ctx, pool, contestOpts{status: "open"})
	source := newStudioTemplate(t, ctx, pool, contest, true)

	if _, err := pool.Exec(ctx, `
		update public.template_slots
		   set image_url = 'https://fixtures.invalid/zz-go-slot.png',
		       anchor = 'top', bleed = true, face_protect = false
		 where template_id = $1`, source); err != nil {
		t.Fatalf("set the P2 slot columns: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.template_text_overlays (template_id, label, field_type, content, x, y, font_size)
		values ($1, 'Name', 'contestant_name', 'Ada', 12, 34, 48)`, source); err != nil {
		t.Fatalf("seed overlay: %v", err)
	}

	got := studioRPC(t, ctx, pool, "duplicate_contest_template", source, actor)
	fresh, _ := got["template_id"].(string)
	if fresh == "" || fresh == source {
		t.Fatalf("duplicate returned template_id %v, want a new id distinct from %s", got["template_id"], source)
	}
	if got["version"] != float64(2) {
		t.Fatalf("version = %v, want the source version + 1", got["version"])
	}
	if got["slot_count"] != float64(1) || got["overlay_count"] != float64(1) {
		t.Fatalf("copy counts = %v slots / %v overlays, want 1 / 1", got["slot_count"], got["overlay_count"])
	}

	var status string
	var parent *string
	var created *string
	var publishedAtSet bool
	if err := pool.QueryRow(ctx, `
		select status, parent_template_id::text, created_by::text, published_at is not null
		  from public.contest_templates where id = $1`, fresh).
		Scan(&status, &parent, &created, &publishedAtSet); err != nil {
		t.Fatalf("read duplicated row: %v", err)
	}
	if status != "draft" {
		t.Fatalf("duplicated status = %q, want draft — a duplicate is an edit, never a release", status)
	}
	if parent == nil || *parent != source {
		t.Fatalf("parent_template_id = %v, want %s", parent, source)
	}
	if created == nil || *created != actor {
		t.Fatalf("created_by = %v, want p_actor %s", created, actor)
	}
	if publishedAtSet {
		t.Fatal("the new draft has published_at — it has never been live")
	}

	var imageURL string
	var anchor string
	var bleed, faceProtect bool
	if err := pool.QueryRow(ctx, `
		select image_url, anchor, bleed, face_protect from public.template_slots where template_id = $1`, fresh).
		Scan(&imageURL, &anchor, &bleed, &faceProtect); err != nil {
		t.Fatalf("read copied slot: %v", err)
	}
	if imageURL != "https://fixtures.invalid/zz-go-slot.png" || anchor != "top" || !bleed || faceProtect {
		t.Fatalf("copied slot = (%q,%q,%v,%v), want the source's (url,top,true,false)",
			imageURL, anchor, bleed, faceProtect)
	}

	// And the source is untouched: duplicate reads it `for share` and writes nothing back.
	if s := statusOf(t, ctx, pool, source); s != "draft" {
		t.Fatalf("source status = %q after duplicate, want draft", s)
	}
}

// The lineage walk: up to the root and back down, newest version first, because the studio
// shows "v3 (draft) / v2 (archived) / v1 (active)" and a caller that had to sort that
// itself would be a second ordering rule.
func TestLiveDB_TemplateStudio_VersionsReturnsTheLineageNewestFirst(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	actor := anyVoter(t, ctx, pool)
	contest := newContest(t, ctx, pool, contestOpts{status: "open"})
	v1 := newStudioTemplate(t, ctx, pool, contest, true)
	studioRPC(t, ctx, pool, "publish_contest_template", v1, actor)

	v2 := studioRPC(t, ctx, pool, "duplicate_contest_template", v1, actor)["template_id"].(string)
	if _, err := pool.Exec(ctx, `update public.contest_templates set name = $2 where id = $1`,
		v2, studioFixtureTitle+" v2"); err != nil {
		t.Fatalf("rename the draft: %v", err)
	}
	studioRPC(t, ctx, pool, "publish_contest_template", v2, actor)

	// Asking from the ORIGINAL row still yields the whole chain, which is the reason the
	// function walks up before it walks down.
	chain := studioChain(t, ctx, pool, v1)
	if len(chain) != 2 {
		t.Fatalf("chain length = %d, want 2: %v", len(chain), chain)
	}
	if chain[0]["version"] != float64(2) || chain[1]["version"] != float64(1) {
		t.Fatalf("versions = %v then %v, want 2 then 1 (newest first)", chain[0]["version"], chain[1]["version"])
	}
	if chain[0]["status"] != "active" || chain[1]["status"] != "archived" {
		t.Fatalf("statuses = %v / %v, want active / archived", chain[0]["status"], chain[1]["status"])
	}
	if _, ok := chain[0]["published_at"]; !ok {
		t.Fatal("the live entry has no published_at key — the versions panel reads it")
	}
}

func studioChain(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) []map[string]any {
	t.Helper()
	got := studioRPC(t, ctx, pool, "contest_template_versions", id)
	raw, ok := got["chain"].([]any)
	if !ok {
		t.Fatalf("chain = %#v, want a jsonb array", got["chain"])
	}
	out := make([]map[string]any, 0, len(raw))
	for _, e := range raw {
		m, ok := e.(map[string]any)
		if !ok {
			t.Fatalf("chain entry %#v is not an object", e)
		}
		out = append(out, m)
	}
	return out
}

// Archive is the button an admin can press twice. The second press reports
// changed:false rather than minting a second event, and it must not clear the publication
// history — that is the only record the versions panel has of a row that used to be live.
func TestLiveDB_TemplateStudio_ArchiveIsIdempotent(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	actor := anyVoter(t, ctx, pool)
	contest := newContest(t, ctx, pool, contestOpts{status: "open"})
	tpl := newStudioTemplate(t, ctx, pool, contest, true)
	studioRPC(t, ctx, pool, "publish_contest_template", tpl, actor)

	first := studioRPC(t, ctx, pool, "archive_contest_template", tpl, actor)
	if first["changed"] != true {
		t.Fatalf("first archive reported changed=%v, want true", first["changed"])
	}
	if first["status"] != "archived" {
		t.Fatalf("first archive reported status=%v, want archived", first["status"])
	}

	second := studioRPC(t, ctx, pool, "archive_contest_template", tpl, actor)
	if second["changed"] != false {
		t.Fatalf("second archive reported changed=%v, want false", second["changed"])
	}

	var publishedAtSet bool
	var publishedBy *string
	if err := pool.QueryRow(ctx,
		`select published_at is not null, published_by::text from public.contest_templates where id = $1`, tpl).
		Scan(&publishedAtSet, &publishedBy); err != nil {
		t.Fatalf("read archived row: %v", err)
	}
	if !publishedAtSet || publishedBy == nil {
		t.Fatalf("archiving erased the publication record (published_at=%v published_by=%v)", publishedAtSet, publishedBy)
	}
	if n := countActive(t, ctx, pool, contest); n != 0 {
		t.Fatalf("active count after archiving the only live template = %d, want 0", n)
	}
}
