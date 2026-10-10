package savings

// LIVE-DB tests for the wave-12 admin-oversight residual — the savings twin
// of the social #625 fix.
//
// Residual: the admin route /api/savings/admin/circles/:id pointed at the
// MEMBER GetCircle handler, which is member-scoped — an ops admin holding
// savings.admin.view who was not a circle member was denied exactly like an
// outsider and lost oversight. Dedicated oversight reads (GetCircleOversight /
// GetCircleMembersOversight, RBAC-gated at the route) restore it WITHOUT
// reopening the member oracle: member reads still answer a non-member the
// same 404 a nonexistent circle returns.
//
// ⚠️ GATED ON TEST_DATABASE_URL — these seed users and circles. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/savings/ -run 'TestLiveDB_SavingsAdmin' -v

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// recordingAuditor captures audit actions so the oversight reads can prove
// they are audited (NL-12) without a real audit sink.
type recordingAuditor struct {
	actors  []string
	actions []string
}

func (r *recordingAuditor) LogAction(actorUserID, _targetUserID, action, _module, _resourceType, _resourceID string, _oldValues, _newValues map[string]any, _ipAddress, _userAgent, _severity string) {
	r.actors = append(r.actors, actorUserID)
	r.actions = append(r.actions, action)
}

func (r *recordingAuditor) saw(action string) bool {
	for _, a := range r.actions {
		if a == action {
			return true
		}
	}
	return false
}

// An ops admin is just another user id to the service — the RBAC guard at the
// route is the gate. The oversight read must return the circle + the FULL
// member roster + the cycle contribution state for a circle the caller does
// NOT belong to, while the member route stays uniform-404 for the very same
// caller.
func TestLiveDB_SavingsAdminCircleOversight_NonMemberReads(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	rec := &recordingAuditor{}
	ajo := NewAjoService(pool, nil, nil, rec)

	creator := newTestOwner(t, pool)
	joiner := newTestOwner(t, pool)
	admin := newTestOwner(t, pool) // ops identity — NOT a circle member

	circle, err := ajo.CreateCircle(ctx, creator, "oversight-circle", 500_00, 86400)
	if err != nil {
		t.Fatalf("create circle: %v", err)
	}
	if _, err := ajo.Join(ctx, circle.ID, joiner); err != nil {
		t.Fatalf("join circle: %v", err)
	}

	// Oversight read: circle + full member roster + cycle contribution state.
	got, members, cycles, err := ajo.GetCircleOversight(ctx, admin, circle.ID)
	if err != nil {
		t.Fatalf("admin GetCircleOversight err = %v, want nil", err)
	}
	if got.ID != circle.ID || got.ContributionKobo != 500_00 || got.State != CircleForming {
		t.Fatalf("oversight circle = %+v, want %s contributing 50000 FORMING", got, circle.ID)
	}
	if len(members) != 2 {
		t.Fatalf("oversight roster = %d members, want 2 (creator + joiner)", len(members))
	}
	if members[0].UserID != creator || members[1].UserID != joiner {
		t.Fatalf("roster order = %s,%s — want rotation order creator,joiner", members[0].UserID, members[1].UserID)
	}
	// A FORMING circle has no cycles yet — the read still returns (empty
	// slice), never an error: oversight must see "nothing collected yet".
	if cycles == nil {
		t.Fatal("cycles projection must serialise as [], not null")
	}

	// The roster twin read returns the same full roster.
	roster, err := ajo.GetCircleMembersOversight(ctx, admin, circle.ID)
	if err != nil {
		t.Fatalf("admin GetCircleMembersOversight err = %v, want nil", err)
	}
	if len(roster) != 2 {
		t.Fatalf("members oversight = %d, want 2", len(roster))
	}

	// Nonexistent id → ErrNotFound on the oversight reads (identical shape
	// to the member denial — existence is never confirmed either way).
	if _, _, _, err := ajo.GetCircleOversight(ctx, admin, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id GetCircleOversight err = %v, want ErrNotFound", err)
	}
	if _, err := ajo.GetCircleMembersOversight(ctx, admin, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id GetCircleMembersOversight err = %v, want ErrNotFound", err)
	}

	// The member ORACLE stays closed for the same caller id — exercised
	// through the real handler path (the member scoping lives in the
	// handler): a non-member gets the same 404 a nonexistent circle returns.
	gin.SetMode(gin.TestMode)
	r := gin.New()
	member := r.Group("/api/finance")
	member.Use(func(c *gin.Context) { c.Set("user_id", admin) })
	adminGrp := r.Group("/api/savings/admin")
	adminGrp.Use(func(c *gin.Context) { c.Set("user_id", admin) })
	h := NewHandler(nil, ajo, nil)
	h.Register(member, adminGrp, func(string) gin.HandlerFunc {
		return func(c *gin.Context) { c.Next() } // permission granted
	})

	for _, path := range []string{
		"/api/finance/savings/circles/" + circle.ID,
		"/api/finance/savings/circles/" + uuid.NewString(),
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("member read %s for non-member = %d, want uniform 404", path, w.Code)
		}
	}

	// The dedicated admin route serves the same caller the detail + roster.
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/savings/admin/circles/"+circle.ID, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("admin circle read = %d, want 200", w.Code)
	}
	var body struct {
		Success bool `json:"success"`
		Circle  struct {
			ID               string `json:"id"`
			ContributionKobo int64  `json:"contribution_kobo"`
		} `json:"circle"`
		Members []struct {
			UserID string `json:"user_id"`
			State  string `json:"state"`
		} `json:"members"`
		Cycles []json.RawMessage `json:"cycles"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode admin response: %v", err)
	}
	if !body.Success || body.Circle.ID != circle.ID || body.Circle.ContributionKobo != 500_00 {
		t.Fatalf("admin response circle = %+v, want %s at 50000", body.Circle, circle.ID)
	}
	if len(body.Members) != 2 {
		t.Fatalf("admin response members = %d, want 2", len(body.Members))
	}
	if body.Cycles == nil {
		t.Fatal("admin response cycles must serialise as [], not null")
	}

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/savings/admin/circles/"+circle.ID+"/members", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("admin members read = %d, want 200", w.Code)
	}

	// Both oversight accesses are audited.
	if !rec.saw("savings.admin.circle.view") {
		t.Errorf("oversight read emitted no savings.admin.circle.view audit event; got %v", rec.actions)
	}
	if !rec.saw("savings.admin.circle.members.view") {
		t.Errorf("roster read emitted no savings.admin.circle.members.view audit event; got %v", rec.actions)
	}
}
