package association_test

// ---------------------------------------------------------------------------
// Every published organisation has at least one chapter.
//
// WHY THIS EXISTS
// ---------------
// Chapters were created only from the wizard's state multi-select, so a founder
// who did not pick states published an organisation with ZERO chapters. That was
// not a harmless empty list: members had no chapter to be filed under, the join
// screen's chapter picker had nothing to offer (it had to be special-cased to
// hide itself), and chapter-scoped admin views had nothing to scope to.
//
// PublishOrganisation now defaults a single chapter named "Home" when the draft
// names none, and skips blank names — the wizard's chapter field is optional
// free text, so a whitespace-only entry arrives as a real slice element and
// would otherwise create a nameless chapter that renders as an empty row.
//
// Live-DB, same harness as founder_and_scoping_test.go: skipped without
// TEST_DATABASE_URL.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/association"
)

// chapterNames returns the chapters of an organisation, for assertions.
func chapterNames(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID string) []string {
	t.Helper()
	rows, err := pool.Query(ctx, `SELECT name FROM assoc_chapters WHERE organisation_id=$1 ORDER BY name`, orgID)
	if err != nil {
		t.Fatalf("read chapters: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatalf("scan chapter: %v", err)
		}
		out = append(out, n)
	}
	return out
}

// TestPublishOrganisation_DefaultsAChapterWhenNoneNamed is the regression: a
// draft with no chapters must still yield exactly one, named "Home".
func TestPublishOrganisation_DefaultsAChapterWhenNoneNamed(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@chapter.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	draft := newTestDraft("No Chapters " + uuid.New().String()[:8])
	draft.Chapters = nil
	draft.StateLeaders = nil
	draft.StructureType = "SINGLE"

	res, err := svc.PublishOrganisation(ctx, userID, draft)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	got := chapterNames(t, ctx, pool, res.OrganisationID)
	if len(got) != 1 {
		t.Fatalf("chapters = %v (%d); want exactly one default chapter", got, len(got))
	}
	if got[0] != association.DefaultChapterName {
		t.Errorf("default chapter = %q, want %q", got[0], association.DefaultChapterName)
	}
}

// TestPublishOrganisation_KeepsNamedChaptersAndSkipsBlanks proves the default
// only fills a genuine absence: named chapters are kept as given, and a blank
// entry neither creates a nameless chapter nor suppresses the default.
func TestPublishOrganisation_KeepsNamedChaptersAndSkipsBlanks(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@chapter2.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	t.Run("a named chapter is kept and not joined by a default", func(t *testing.T) {
		draft := newTestDraft("Named Chapter " + uuid.New().String()[:8])
		draft.StateLeaders = nil
		draft.StructureType = "SINGLE"
		draft.Chapters = []association.OrgDraftChapter{{Name: "Ikeja Branch", Level: "LOCAL"}}

		res, err := svc.PublishOrganisation(ctx, userID, draft)
		if err != nil {
			t.Fatalf("publish: %v", err)
		}
		got := chapterNames(t, ctx, pool, res.OrganisationID)
		if len(got) != 1 || got[0] != "Ikeja Branch" {
			t.Errorf("chapters = %v; want exactly [Ikeja Branch] — a named chapter must not also get a default", got)
		}
	})

	t.Run("a blank name creates nothing and still defaults", func(t *testing.T) {
		draft := newTestDraft("Blank Chapter " + uuid.New().String()[:8])
		draft.StateLeaders = nil
		draft.StructureType = "SINGLE"
		draft.Chapters = []association.OrgDraftChapter{{Name: "   ", Level: "LOCAL"}}

		res, err := svc.PublishOrganisation(ctx, userID, draft)
		if err != nil {
			t.Fatalf("publish: %v", err)
		}
		got := chapterNames(t, ctx, pool, res.OrganisationID)
		if len(got) != 1 || got[0] != association.DefaultChapterName {
			t.Errorf("chapters = %v; want exactly [%s] — a blank name is not a chapter", got, association.DefaultChapterName)
		}
	})

	t.Run("the chapter name is trimmed", func(t *testing.T) {
		draft := newTestDraft("Padded Chapter " + uuid.New().String()[:8])
		draft.StateLeaders = nil
		draft.StructureType = "SINGLE"
		draft.Chapters = []association.OrgDraftChapter{{Name: "  Yaba  ", Level: "LOCAL"}}

		res, err := svc.PublishOrganisation(ctx, userID, draft)
		if err != nil {
			t.Fatalf("publish: %v", err)
		}
		got := chapterNames(t, ctx, pool, res.OrganisationID)
		if len(got) != 1 || got[0] != "Yaba" {
			t.Errorf("chapters = %v; want exactly [Yaba] — surrounding whitespace must not reach the row", got)
		}
	})
}
