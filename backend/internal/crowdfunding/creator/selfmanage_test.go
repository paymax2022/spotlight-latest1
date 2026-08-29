package creator

// Pure decision-logic tests for campaign owner self-management. No database:
// every guard and every SQL builder here is a pure function precisely so the
// rules that matter (ownership, the delete-with-funds refusal, partial-update
// semantics, pause/resume transitions) are provable without TEST_DATABASE_URL.
//
// This matters beyond convenience: a Go package whose live-DB tests all SKIP
// still prints "ok", so a guard covered only by a gated integration test is a
// guard nothing actually verifies in CI.

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func strp(s string) *string { return &s }
func i64p(i int64) *int64   { return &i }

func tsp() *time.Time {
	t := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	return &t
}

// ─── Ownership ───────────────────────────────────────────────────────────────

// The single most important test in this file. A campaign id arrives from the
// client on every one of these routes; if guardOwned ever stops refusing a
// non-owner, any authenticated user can edit or delete any campaign on the
// platform. This repo has shipped an IDOR of exactly this shape before.
func TestGuardOwned_RefusesNonOwner(t *testing.T) {
	st := campaignState{CreatorID: "owner-1", ReviewStatus: "ACTIVE"}

	if err := guardOwned(st, "attacker-2"); !errors.Is(err, ErrNotOwner) {
		t.Fatalf("a non-owner must be refused with ErrNotOwner, got %v", err)
	}
	if err := guardOwned(st, "owner-1"); err != nil {
		t.Fatalf("the owner must be allowed, got %v", err)
	}
	if err := guardOwned(st, ""); !errors.Is(err, ErrNotOwner) {
		t.Fatalf("an empty caller id must not own a real campaign, got %v", err)
	}
}

// Fail closed when the auth middleware did not run: an empty caller id must not
// match an empty creator_id and hand a mutation to an unauthenticated request.
func TestGuardOwned_EmptyCallerFailsClosed(t *testing.T) {
	for _, caller := range []string{"", "   "} {
		if err := guardOwned(campaignState{CreatorID: ""}, caller); !errors.Is(err, ErrNotOwner) {
			t.Fatalf("caller %q against an empty creator_id must be refused, got %v", caller, err)
		}
	}
}

func TestGuardOwned_RefusesDeletedCampaign(t *testing.T) {
	st := campaignState{CreatorID: "owner-1", ReviewStatus: "ACTIVE", DeletedAt: tsp()}
	if err := guardOwned(st, "owner-1"); !errors.Is(err, ErrCampaignDeleted) {
		t.Fatalf("a soft-deleted campaign must be inert for its owner too, got %v", err)
	}
}

// Ownership is checked BEFORE deletion state, so a non-owner probing a deleted
// campaign learns nothing about whether it exists.
func TestGuardOwned_OwnershipBeatsDeletion(t *testing.T) {
	st := campaignState{CreatorID: "owner-1", DeletedAt: tsp()}
	if err := guardOwned(st, "attacker-2"); !errors.Is(err, ErrNotOwner) {
		t.Fatalf("non-owner must get ErrNotOwner regardless of deletion, got %v", err)
	}
}

// ─── Delete guard ────────────────────────────────────────────────────────────

// A campaign that has EVER held money must never be deletable.
func TestGuardDelete_RefusesWithContributions(t *testing.T) {
	st := campaignState{CreatorID: "owner-1", ReviewStatus: "ACTIVE"}

	if err := guardDelete(st, true); !errors.Is(err, ErrCampaignHasFunds) {
		t.Fatalf("a campaign with contributions must not be deletable, got %v", err)
	}
	if err := guardDelete(st, false); err != nil {
		t.Fatalf("a campaign with no contributions must be deletable, got %v", err)
	}
}

// The guard's input is "a contributions row exists in ANY status" — including
// 'refunded'. A refunded contribution proves the campaign DID receive money and
// sent it back; scoring that as never-funded would let the creator delete the
// refund trail. This test pins the semantics the caller must supply.
func TestGuardDelete_RefundedStillCountsAsFunded(t *testing.T) {
	st := campaignState{CreatorID: "owner-1"}
	// hasContributions is computed by the caller as EXISTS(... WHERE campaign_id)
	// with NO status filter — so a refunded-only campaign arrives as true.
	if err := guardDelete(st, true); !errors.Is(err, ErrCampaignHasFunds) {
		t.Fatal("a campaign whose only contribution was refunded must not be deletable")
	}
}

// ─── Partial update ──────────────────────────────────────────────────────────

// The whole point of the pointer fields: patching ONE key must not touch the
// others. A plain-bool/plain-string struct would emit writes for every column
// and blank the caller's title and story.
func TestUpdateAssignments_PartialDoesNotClobberSiblings(t *testing.T) {
	req := CampaignUpdateRequest{CoverImage: strp("https://cdn/x.png")}
	as := updateAssignments(req)

	if len(as) != 1 {
		t.Fatalf("a one-key body must produce exactly one assignment, got %d: %#v", len(as), as)
	}
	if as[0].Column != "cover_url" {
		t.Fatalf("expected cover_url, got %q", as[0].Column)
	}

	sql, args, ok := buildCampaignUpdate("camp-1", "owner-1", req)
	if !ok {
		t.Fatal("expected a buildable update")
	}
	for _, forbidden := range []string{"title=", "summary=", "story=", "category=", "goal_kobo="} {
		if strings.Contains(sql, forbidden) {
			t.Errorf("partial update must not write %s: %q", forbidden, sql)
		}
	}
	// cover value, then campaign id, then owner id.
	if len(args) != 3 || args[0] != "https://cdn/x.png" || args[1] != "camp-1" || args[2] != "owner-1" {
		t.Errorf("args mismatch: %#v", args)
	}
}

// An explicit empty string is NOT the same as an absent key: clearing a summary
// on purpose must still be possible.
func TestUpdateAssignments_ExplicitEmptyStringIsAWrite(t *testing.T) {
	as := updateAssignments(CampaignUpdateRequest{Summary: strp("")})
	if len(as) != 1 || as[0].Column != "summary" || as[0].Value != "" {
		t.Fatalf("an explicit empty summary must still be written: %#v", as)
	}
}

func TestUpdateAssignments_AllFields(t *testing.T) {
	as := updateAssignments(CampaignUpdateRequest{
		Title: strp("T"), Summary: strp("S"), Story: strp("St"),
		Category: strp("medical"), CoverImage: strp("c"), GoalKobo: i64p(500),
	})
	want := []string{"title", "summary", "story", "category", "cover_url", "goal_kobo"}
	if len(as) != len(want) {
		t.Fatalf("want %d assignments, got %d", len(want), len(as))
	}
	for i, w := range want {
		if as[i].Column != w {
			t.Errorf("assignment %d: want %q, got %q", i, w, as[i].Column)
		}
	}
}

// An empty body is refused rather than silently succeeding — otherwise a typo'd
// field name reads to the client as a saved edit.
func TestBuildCampaignUpdate_EmptyBodyRefused(t *testing.T) {
	if _, _, ok := buildCampaignUpdate("camp-1", "owner-1", CampaignUpdateRequest{}); ok {
		t.Fatal("an empty patch body must not be buildable")
	}
}

// Defence in depth: the UPDATE's own WHERE must re-assert ownership, so even a
// refactor that drops the explicit guard cannot produce a cross-tenant write.
func TestBuildCampaignUpdate_WhereCarriesOwnerAndDeletedGuard(t *testing.T) {
	sql, _, ok := buildCampaignUpdate("camp-1", "owner-1", CampaignUpdateRequest{Title: strp("New")})
	if !ok {
		t.Fatal("expected a buildable update")
	}
	if !strings.Contains(sql, "creator_id=$") {
		t.Errorf("UPDATE must re-assert ownership in its WHERE clause: %q", sql)
	}
	if !strings.Contains(sql, "deleted_at IS NULL") {
		t.Errorf("UPDATE must refuse a soft-deleted row: %q", sql)
	}
	if !strings.Contains(sql, "updated_at=NOW()") {
		t.Errorf("UPDATE must stamp updated_at: %q", sql)
	}
}

// Column names must be fixed literals, never interpolated caller input.
func TestBuildCampaignUpdate_ValuesAreBoundNotInlined(t *testing.T) {
	evil := "x'; DROP TABLE campaigns; --"
	sql, args, ok := buildCampaignUpdate("camp-1", "owner-1", CampaignUpdateRequest{Title: strp(evil)})
	if !ok {
		t.Fatal("expected a buildable update")
	}
	if strings.Contains(sql, "DROP TABLE") {
		t.Fatalf("caller input must never reach the SQL text: %q", sql)
	}
	if args[0] != evil {
		t.Fatalf("caller input must be bound as a parameter, got %#v", args[0])
	}
}

// ─── Update validation ───────────────────────────────────────────────────────

func TestValidateUpdate(t *testing.T) {
	cases := []struct {
		name string
		req  CampaignUpdateRequest
		want error
	}{
		{"empty body is valid (emptiness is caught by the builder)", CampaignUpdateRequest{}, nil},
		{"title too short", CampaignUpdateRequest{Title: strp("a")}, ErrInvalidTitle},
		{"title whitespace-only", CampaignUpdateRequest{Title: strp("   ")}, ErrInvalidTitle},
		{"title too long", CampaignUpdateRequest{Title: strp(strings.Repeat("x", 201))}, ErrInvalidTitle},
		{"title at max is fine", CampaignUpdateRequest{Title: strp(strings.Repeat("x", 200))}, nil},
		{"title at min is fine", CampaignUpdateRequest{Title: strp("ab")}, nil},
		{"goal below the 100 kobo floor", CampaignUpdateRequest{GoalKobo: i64p(99)}, ErrInvalidGoal},
		{"goal of zero", CampaignUpdateRequest{GoalKobo: i64p(0)}, ErrInvalidGoal},
		{"negative goal", CampaignUpdateRequest{GoalKobo: i64p(-1)}, ErrInvalidGoal},
		{"goal at the floor is fine", CampaignUpdateRequest{GoalKobo: i64p(100)}, nil},
		{"blank category", CampaignUpdateRequest{Category: strp("  ")}, ErrUnknownCategory},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateUpdate(c.req)
			if c.want == nil && err != nil {
				t.Fatalf("want nil, got %v", err)
			}
			if c.want != nil && !errors.Is(err, c.want) {
				t.Fatalf("want %v, got %v", c.want, err)
			}
		})
	}
}

// Lowering the goal below what has already been raised would render the
// campaign permanently over 100% funded — how a stalled campaign is dressed up
// as a successful one. All comparisons are integer kobo.
func TestGuardGoalNotBelowRaised(t *testing.T) {
	if err := guardGoalNotBelowRaised(CampaignUpdateRequest{GoalKobo: i64p(500_00)}, 900_00); !errors.Is(err, ErrGoalBelowRaised) {
		t.Fatalf("lowering the goal under the raised total must be refused, got %v", err)
	}
	if err := guardGoalNotBelowRaised(CampaignUpdateRequest{GoalKobo: i64p(900_00)}, 900_00); err != nil {
		t.Fatalf("a goal exactly equal to raised is legal, got %v", err)
	}
	if err := guardGoalNotBelowRaised(CampaignUpdateRequest{GoalKobo: i64p(1_000_00)}, 900_00); err != nil {
		t.Fatalf("raising the goal is always legal, got %v", err)
	}
	// Absent goal key: the raised total is irrelevant.
	if err := guardGoalNotBelowRaised(CampaignUpdateRequest{Title: strp("x")}, 900_00); err != nil {
		t.Fatalf("a body with no goalKobo must not be goal-checked, got %v", err)
	}
}

// ─── Pause / resume transitions ──────────────────────────────────────────────

func TestGuardPause(t *testing.T) {
	cases := []struct {
		name string
		st   campaignState
		want error
	}{
		{"ACTIVE and unpaused pauses", campaignState{ReviewStatus: "ACTIVE"}, nil},
		{"already paused", campaignState{ReviewStatus: "ACTIVE", PausedAt: tsp()}, ErrAlreadyPaused},
		{"DRAFT cannot be paused", campaignState{ReviewStatus: "DRAFT"}, ErrNotActive},
		{"PENDING_REVIEW cannot be paused", campaignState{ReviewStatus: "PENDING_REVIEW"}, ErrNotActive},
		{"FROZEN cannot be paused", campaignState{ReviewStatus: "FROZEN"}, ErrNotActive},
		{"COMPLETED cannot be paused", campaignState{ReviewStatus: "COMPLETED"}, ErrNotActive},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := guardPause(c.st)
			if c.want == nil && err != nil {
				t.Fatalf("want nil, got %v", err)
			}
			if c.want != nil && !errors.Is(err, c.want) {
				t.Fatalf("want %v, got %v", c.want, err)
			}
		})
	}
}

func TestGuardResume(t *testing.T) {
	cases := []struct {
		name string
		st   campaignState
		want error
	}{
		{"paused and still ACTIVE resumes", campaignState{ReviewStatus: "ACTIVE", PausedAt: tsp()}, nil},
		{"not paused", campaignState{ReviewStatus: "ACTIVE"}, ErrNotPaused},
		// The one that matters: resume must not be a creator's route back onto a
		// public rail after a moderator froze or rejected the campaign.
		{"frozen while paused stays off the rail", campaignState{ReviewStatus: "FROZEN", PausedAt: tsp()}, ErrNotActive},
		{"rejected while paused stays off the rail", campaignState{ReviewStatus: "REJECTED", PausedAt: tsp()}, ErrNotActive},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := guardResume(c.st)
			if c.want == nil && err != nil {
				t.Fatalf("want nil, got %v", err)
			}
			if c.want != nil && !errors.Is(err, c.want) {
				t.Fatalf("want %v, got %v", c.want, err)
			}
		})
	}
}

// pause → resume → pause is a legal cycle.
func TestPauseResumeCycle(t *testing.T) {
	st := campaignState{CreatorID: "owner-1", ReviewStatus: "ACTIVE"}

	if err := guardPause(st); err != nil {
		t.Fatalf("initial pause: %v", err)
	}
	st.PausedAt = tsp() // simulate the write

	if err := guardPause(st); !errors.Is(err, ErrAlreadyPaused) {
		t.Fatalf("double pause must be refused, got %v", err)
	}
	if err := guardResume(st); err != nil {
		t.Fatalf("resume: %v", err)
	}
	st.PausedAt = nil // simulate the write

	if err := guardResume(st); !errors.Is(err, ErrNotPaused) {
		t.Fatalf("double resume must be refused, got %v", err)
	}
	if err := guardPause(st); err != nil {
		t.Fatalf("re-pause after resume: %v", err)
	}
}

// ─── Feature request ─────────────────────────────────────────────────────────

// Mirrors the ADMIN promotion guard in adminext/featured.go: only an ACTIVE
// campaign may be promoted, so only an ACTIVE campaign may ask to be.
func TestGuardFeatureRequest(t *testing.T) {
	cases := []struct {
		name string
		st   campaignState
		want error
	}{
		{"ACTIVE may ask", campaignState{ReviewStatus: "ACTIVE"}, nil},
		{"PENDING_REVIEW may not ask", campaignState{ReviewStatus: "PENDING_REVIEW"}, ErrNotActive},
		{"DRAFT may not ask", campaignState{ReviewStatus: "DRAFT"}, ErrNotActive},
		{"REJECTED may not ask", campaignState{ReviewStatus: "REJECTED"}, ErrNotActive},
		{"FROZEN may not ask", campaignState{ReviewStatus: "FROZEN"}, ErrNotActive},
		{"paused may not ask", campaignState{ReviewStatus: "ACTIVE", PausedAt: tsp()}, ErrAlreadyPaused},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := guardFeatureRequest(c.st)
			if c.want == nil && err != nil {
				t.Fatalf("want nil, got %v", err)
			}
			if c.want != nil && !errors.Is(err, c.want) {
				t.Fatalf("want %v, got %v", c.want, err)
			}
		})
	}
}

// ─── Audit ───────────────────────────────────────────────────────────────────

// The audit target names the campaign and the columns that moved, so a
// suspicious edit is greppable — but never mirrors free-text user content.
func TestAuditUpdateTarget(t *testing.T) {
	got := auditUpdateTarget("camp-1", CampaignUpdateRequest{
		Title: strp("New title"), GoalKobo: i64p(100),
	})
	if !strings.Contains(got, "camp-1") {
		t.Errorf("audit target must name the campaign: %q", got)
	}
	if !strings.Contains(got, "title") || !strings.Contains(got, "goal_kobo") {
		t.Errorf("audit target must name the changed columns: %q", got)
	}
	if strings.Contains(got, "New title") {
		t.Errorf("audit target must not mirror user content: %q", got)
	}
}
