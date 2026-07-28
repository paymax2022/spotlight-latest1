package connectassess

import (
	"context"
	"testing"
	"time"

	"spotlight/backend/internal/arena/quiz"
)

// ── Fakes (no DB, no real quiz engine) ───────────────────────────────────────

type fakeRepo struct {
	assessments map[string]Assessment
	badges      map[string]Badge // key: user|assessment|version
	last        *AttemptMeta
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{assessments: map[string]Assessment{}, badges: map[string]Badge{}}
}

func badgeKey(u, a, v string) string { return u + "|" + a + "|" + v }

func (f *fakeRepo) ListActive(context.Context) ([]Assessment, error) { return nil, nil }
func (f *fakeRepo) ListAll(context.Context) ([]Assessment, error)    { return nil, nil }

func (f *fakeRepo) Get(_ context.Context, id string) (*Assessment, error) {
	a, ok := f.assessments[id]
	if !ok {
		return nil, ErrNotFound
	}
	return &a, nil
}

func (f *fakeRepo) LastAttempt(context.Context, string, string) (*AttemptMeta, error) {
	return f.last, nil
}

func (f *fakeRepo) IssueBadge(_ context.Context, in BadgeInsert) (bool, *Badge, error) {
	k := badgeKey(in.UserID, in.AssessmentID, in.Version)
	if b, ok := f.badges[k]; ok {
		return false, &b, nil // already earned for this version — no re-issue
	}
	b := Badge{
		ID: "badge-" + k, UserID: in.UserID, AssessmentID: in.AssessmentID,
		Domain: in.Domain, Version: in.Version, Score: in.Score, PassedAt: time.Now(),
	}
	f.badges[k] = b
	return true, &b, nil
}

func (f *fakeRepo) ListBadges(_ context.Context, userID string) ([]Badge, error) {
	var out []Badge
	for _, b := range f.badges {
		if b.UserID == userID {
			out = append(out, b)
		}
	}
	return out, nil
}

func (f *fakeRepo) Upsert(context.Context, UpsertInput) (*Assessment, error) { return nil, nil }

// fakeScorer returns canned score/total (the reused engine's marking is not under
// test here — the invariants are about badge issuance + loyalty + versioning).
type fakeScorer struct{ score, total int }

func (fakeScorer) StageView(context.Context, string, string, string, int) (quiz.StageView, error) {
	return quiz.StageView{}, nil
}
func (f fakeScorer) Score(context.Context, string, string, string, string, int, []Answer, string) (int, int, error) {
	return f.score, f.total, nil
}

type fakeLoyalty struct {
	calls   int
	refs    []string
	trigger string
}

func (f *fakeLoyalty) AwardFor(_ context.Context, _, _, trigger, ref string) error {
	f.calls++
	f.trigger = trigger
	f.refs = append(f.refs, ref)
	return nil
}

type fakeAudit struct{}

func (fakeAudit) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	return nil
}

func seed(repo *fakeRepo, id, version string, threshold int) {
	repo.assessments[id] = Assessment{
		ID: id, Domain: "golang", Title: "Go", BankKey: "skill_golang",
		Version: version, PassThreshold: threshold, Active: true,
	}
}

// ── PN-5: a badge is issued ONLY on a passed attempt ─────────────────────────

func TestPN5_BadgeIssuedOnlyOnPass(t *testing.T) {
	ctx := context.Background()

	t.Run("pass issues a badge + one loyalty event", func(t *testing.T) {
		repo := newFakeRepo()
		seed(repo, "a1", "skill_golang_v1", 70)
		loy := &fakeLoyalty{}
		svc := NewService(repo, fakeScorer{score: 8, total: 10}, loy, fakeAudit{}) // 80% ≥ 70%

		res, err := svc.Submit(ctx, "user-1", "a1", "att-1", nil, "idem-1")
		if err != nil {
			t.Fatalf("submit: %v", err)
		}
		if res.State != "PASSED" || !res.Passed {
			t.Fatalf("expected PASSED, got %q passed=%v", res.State, res.Passed)
		}
		if res.Badge == nil {
			t.Fatal("expected a badge on pass")
		}
		if loy.calls != 1 || loy.trigger != "skill_verified" {
			t.Fatalf("expected 1 skill_verified loyalty event, got calls=%d trigger=%q", loy.calls, loy.trigger)
		}
	})

	t.Run("fail issues NO badge and NO loyalty, sets cooldown", func(t *testing.T) {
		repo := newFakeRepo()
		seed(repo, "a1", "skill_golang_v1", 70)
		loy := &fakeLoyalty{}
		svc := NewService(repo, fakeScorer{score: 6, total: 10}, loy, fakeAudit{}) // 60% < 70%

		res, err := svc.Submit(ctx, "user-1", "a1", "att-1", nil, "idem-1")
		if err != nil {
			t.Fatalf("submit: %v", err)
		}
		if res.State != "FAILED" || res.Passed {
			t.Fatalf("expected FAILED, got %q passed=%v", res.State, res.Passed)
		}
		if res.Badge != nil {
			t.Fatal("PN-5 violated: badge issued on a failed attempt")
		}
		if len(repo.badges) != 0 {
			t.Fatalf("PN-5 violated: %d badge rows written on failure", len(repo.badges))
		}
		if loy.calls != 0 {
			t.Fatalf("PN-5 violated: %d loyalty events on failure", loy.calls)
		}
		if res.CooldownUntil == nil {
			t.Fatal("expected a cooldown on failure (SA-04)")
		}
	})
}

// ── PN-12: badge records the exact version; a new version never retro-changes it ─

func TestPN12_BadgeRecordsExactVersion(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	seed(repo, "a1", "skill_golang_v1", 70)
	loy := &fakeLoyalty{}
	svc := NewService(repo, fakeScorer{score: 9, total: 10}, loy, fakeAudit{})

	res1, err := svc.Submit(ctx, "user-1", "a1", "att-1", nil, "idem-v1")
	if err != nil {
		t.Fatalf("submit v1: %v", err)
	}
	if res1.Badge.Version != "skill_golang_v1" {
		t.Fatalf("expected badge version skill_golang_v1, got %q", res1.Badge.Version)
	}
	v1BadgeID := res1.Badge.ID

	// A NEW question-bank version is a NEW assessment row (new rubric_version).
	seed(repo, "a2", "skill_golang_v2", 70)
	res2, err := svc.Submit(ctx, "user-1", "a2", "att-2", nil, "idem-v2")
	if err != nil {
		t.Fatalf("submit v2: %v", err)
	}
	if res2.Badge.Version != "skill_golang_v2" {
		t.Fatalf("expected badge version skill_golang_v2, got %q", res2.Badge.Version)
	}

	// The original v1 badge is untouched — its version still reads v1 (PN-12).
	old := repo.badges[badgeKey("user-1", "a1", "skill_golang_v1")]
	if old.ID != v1BadgeID || old.Version != "skill_golang_v1" {
		t.Fatalf("PN-12 violated: old badge mutated -> id=%q version=%q", old.ID, old.Version)
	}
	if len(repo.badges) != 2 {
		t.Fatalf("expected 2 distinct badges, got %d", len(repo.badges))
	}
}

// ── Loyalty emitted once per (user, assessment, version), not per attempt ────

func TestLoyalty_OncePerUserAssessmentVersion(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	seed(repo, "a1", "skill_golang_v1", 70)
	loy := &fakeLoyalty{}
	svc := NewService(repo, fakeScorer{score: 10, total: 10}, loy, fakeAudit{})

	// Same user passes the same assessment/version twice (two attempts).
	if _, err := svc.Submit(ctx, "user-1", "a1", "att-1", nil, "idem-1"); err != nil {
		t.Fatalf("submit 1: %v", err)
	}
	if _, err := svc.Submit(ctx, "user-1", "a1", "att-2", nil, "idem-2"); err != nil {
		t.Fatalf("submit 2: %v", err)
	}

	if loy.calls != 1 {
		t.Fatalf("expected exactly 1 loyalty event across two passing attempts, got %d", loy.calls)
	}
	if len(repo.badges) != 1 {
		t.Fatalf("expected 1 badge (append-only, once per version), got %d", len(repo.badges))
	}
}

// ── SA-04: a recent FAILED attempt blocks Start with a cooldown ──────────────

func TestSA04_CooldownBlocksStart(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	seed(repo, "a1", "skill_golang_v1", 70)
	repo.last = &AttemptMeta{Passed: false, CreatedAt: time.Now().Add(-1 * time.Hour)} // within 24h

	svc := NewService(repo, fakeScorer{}, &fakeLoyalty{}, fakeAudit{})
	_, err := svc.Start(ctx, "user-1", "a1")
	var cool *CooldownError
	if err == nil || !asCooldown(err, &cool) {
		t.Fatalf("expected CooldownError, got %v", err)
	}
}

func asCooldown(err error, target **CooldownError) bool {
	if ce, ok := err.(*CooldownError); ok {
		*target = ce
		return true
	}
	return false
}
