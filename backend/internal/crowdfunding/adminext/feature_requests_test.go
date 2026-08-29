package adminext

// PURE tests for the owner feature-request queue: every function under test is
// the decision logic that runs before any database access, so they need no pool
// and no TEST_DATABASE_URL and therefore actually RUN in CI. (A package whose
// tests all skip still prints "ok", which is how a dead suite hides.)

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// mustJSON renders a value exactly as the handler would write it to the wire, so
// the field-name assertions below test the real contract rather than the Go
// struct field names.
func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// ─── The decision guard ──────────────────────────────────────────────────────

// Only a PENDING request may be decided. Deciding twice is refused rather than
// silently re-applied: a second approve on an already-APPROVED request would
// re-set featured on a campaign an operator may since have deliberately pulled
// off the rail.
func TestGuardFeatureDecision_OnlyPending(t *testing.T) {
	for _, status := range []string{"APPROVED", "REJECTED", "WITHDRAWN", "", "pending"} {
		for _, approve := range []bool{true, false} {
			err := guardFeatureDecision(status, reviewStatusActive, approve)
			if !errors.Is(err, ErrFeatureRequestNotPending) {
				t.Errorf("status %q approve=%v: want ErrFeatureRequestNotPending, got %v", status, approve, err)
			}
		}
	}
	if err := guardFeatureDecision("PENDING", reviewStatusActive, true); err != nil {
		t.Fatalf("a PENDING request on an ACTIVE campaign must be approvable, got %v", err)
	}
}

// The rule that matters most: a request can sit in the queue for days. If the
// campaign was frozen or rejected in the meantime, approving the stale request
// would publish unreviewed content onto the app's most prominent public rail.
func TestGuardFeatureDecision_ApprovalRequiresStillActive(t *testing.T) {
	for _, cs := range []string{"PENDING_REVIEW", "CHANGES_REQUESTED", "FROZEN", "REJECTED", "COMPLETED", "DRAFT"} {
		if err := guardFeatureDecision("PENDING", cs, true); !errors.Is(err, ErrCampaignNotActive) {
			t.Errorf("approving a %s campaign must be refused, got %v", cs, err)
		}
	}
}

// Rejection is deliberately NOT status-gated — refusing a placement publishes
// nothing, and a request on a frozen campaign is exactly the one an operator
// most needs to be able to clear out of the queue.
func TestGuardFeatureDecision_RejectionIsNotStatusGated(t *testing.T) {
	for _, cs := range []string{"ACTIVE", "FROZEN", "REJECTED", "COMPLETED", "PENDING_REVIEW"} {
		if err := guardFeatureDecision("PENDING", cs, false); err != nil {
			t.Errorf("rejecting a pending request on a %s campaign must be allowed, got %v", cs, err)
		}
	}
}

// This is the same ACTIVE-only promotion rule the direct flags PATCH enforces,
// applied at the other entry point. If the two ever disagree, the queue becomes
// a way around the flags guard.
func TestFeatureApproval_MatchesDirectFlagsPromotionRule(t *testing.T) {
	for _, cs := range []string{"ACTIVE", "PENDING_REVIEW", "FROZEN", "REJECTED", "COMPLETED", "DRAFT"} {
		viaFlags := guardFlagPromotion(cs, CampaignFlagsRequest{Featured: boolPtr(true)})
		viaQueue := guardFeatureDecision("PENDING", cs, true)

		if (viaFlags == nil) != (viaQueue == nil) {
			t.Errorf("campaign %s: flags PATCH allows=%v but queue approval allows=%v — "+
				"the queue must not be a way around the flags guard",
				cs, viaFlags == nil, viaQueue == nil)
		}
	}
}

// ─── Decision mapping ────────────────────────────────────────────────────────

func TestDecisionStatusAndAction(t *testing.T) {
	if decisionStatus(true) != "APPROVED" || decisionStatus(false) != "REJECTED" {
		t.Fatalf("decisionStatus wrong: %q / %q", decisionStatus(true), decisionStatus(false))
	}
	// The statuses written must be values the cf_feature_requests CHECK accepts.
	allowed := map[string]bool{"PENDING": true, "APPROVED": true, "REJECTED": true, "WITHDRAWN": true}
	for _, approve := range []bool{true, false} {
		if !allowed[decisionStatus(approve)] {
			t.Errorf("decisionStatus(%v)=%q violates the table CHECK constraint", approve, decisionStatus(approve))
		}
	}
	if !strings.HasPrefix(decisionAction(true), "campaign.feature_request.") ||
		!strings.HasPrefix(decisionAction(false), "campaign.feature_request.") {
		t.Error("audit actions should share the campaign.feature_request.* prefix")
	}
	if decisionAction(true) == decisionAction(false) {
		t.Error("approve and reject must be distinguishable in the audit log")
	}
}

// An empty admin id must become SQL NULL, not the empty string — decided_by is
// a uuid column and '' aborts the statement on the cast, which would turn a
// missing user_id into a 500 on every decision.
func TestNullableActor(t *testing.T) {
	if nullableActor("") != nil {
		t.Error("an empty admin id must become NULL")
	}
	if nullableActor("   ") != nil {
		t.Error("a whitespace-only admin id must become NULL")
	}
	if got := nullableActor("11111111-1111-1111-1111-111111111111"); got != "11111111-1111-1111-1111-111111111111" {
		t.Errorf("a real admin id must be passed through, got %#v", got)
	}
}

// ─── Response shape ──────────────────────────────────────────────────────────

// The console renders note and decidedAt directly and distinguishes null from
// empty, so an undecided request must emit explicit nulls rather than omitting
// the keys or sending "" / a zero date.
func TestAdminFeatureRequest_UndecidedEmitsNulls(t *testing.T) {
	f := AdminFeatureRequest{ID: "r1", CampaignID: "c1", Status: "PENDING"}
	if f.Note != nil {
		t.Error("an undecided request must have a nil note")
	}
	if f.DecidedAt != nil {
		t.Error("an undecided request must have a nil decidedAt")
	}
	// Pointer fields with no omitempty must still appear in the JSON as null.
	for _, key := range []string{`"note":null`, `"decidedAt":null`} {
		if !strings.Contains(mustJSON(t, f), key) {
			t.Errorf("expected %s in payload: %s", key, mustJSON(t, f))
		}
	}
}

// The console keys off these exact field names; a rename is a silent break.
func TestAdminFeatureRequest_JSONContract(t *testing.T) {
	f := AdminFeatureRequest{
		ID: "r1", CampaignID: "c1", CampaignTitle: "T", Status: "PENDING",
		CampaignStatus: "ACTIVE", RaisedKobo: 1000, GoalKobo: 5000,
		ContributorCount: 3, RequestedBy: "u1", RequestedAt: "2026-08-29T12:00:00Z",
	}
	payload := mustJSON(t, f)
	for _, key := range []string{
		`"id"`, `"campaignId"`, `"campaignTitle"`, `"status"`, `"campaignStatus"`,
		`"raisedKobo"`, `"goalKobo"`, `"contributorCount"`, `"requestedBy"`,
		`"requestedAt"`, `"note"`, `"decidedAt"`,
	} {
		if !strings.Contains(payload, key) {
			t.Errorf("missing %s in payload: %s", key, payload)
		}
	}
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// The console 404'd on these three paths before this change; pin them so a
// rename cannot silently break it again. Gin also panics at boot on a wildcard
// conflict, which a route test catches at build time rather than at deploy.
func TestRegisterAdmin_FeatureRequestRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("admin route registration panicked: %v", r)
		}
	}()

	r := gin.New()
	RegisterAdmin(r.Group("/api/crowdfunding/admin"), nil, nil, nil)

	want := map[string]string{
		"GET /api/crowdfunding/admin/feature-requests":              "queue list",
		"POST /api/crowdfunding/admin/feature-requests/:id/approve": "approve",
		"POST /api/crowdfunding/admin/feature-requests/:id/reject":  "reject",
	}
	got := map[string]bool{}
	for _, ri := range r.Routes() {
		got[ri.Method+" "+ri.Path] = true
	}
	for route, what := range want {
		if !got[route] {
			t.Errorf("missing feature-request route (%s): %s", what, route)
		}
	}
}
