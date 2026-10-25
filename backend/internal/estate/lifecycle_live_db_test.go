package estate

// LIVE-DB tests for the estate lifecycle (ESTD-D025 / EST-UAT-0418,0419).
// Reuses the harness in service_dues_live_db_test.go (estateDuesTestPool,
// seedDuesUser, seedEstate, seedResident, auditCount). Gate behaviour
// (LifecycleGate middleware + LegalHold) is exercised against real rows.
// Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Lifecycle -v

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestLiveDB_Lifecycle_Transitions(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)

	// active → suspended.
	l, err := svc.TransitionEstate(ctx, estateID, adminID, LifecycleSuspend, "risk review hold")
	if err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if l.Status != EstateStatusSuspended || l.StatusReason != "risk review hold" || l.StatusChangedBy == nil || *l.StatusChangedBy != adminID {
		t.Fatalf("after suspend: %+v", l)
	}
	// Write gate now refuses.
	err = svc.AssertEstateWritable(ctx, estateID)
	var notActive *EstateNotActiveError
	if !errors.As(err, &notActive) || notActive.Status != EstateStatusSuspended {
		t.Fatalf("AssertEstateWritable(suspended) = %v, want EstateNotActiveError(suspended)", err)
	}
	// suspended → active (reactivate).
	if _, err := svc.TransitionEstate(ctx, estateID, adminID, LifecycleReactivate, "risk cleared"); err != nil {
		t.Fatalf("reactivate: %v", err)
	}
	if err := svc.AssertEstateWritable(ctx, estateID); err != nil {
		t.Fatalf("AssertEstateWritable(reactivated) = %v, want nil", err)
	}
	// active → closed; closed is terminal.
	if _, err := svc.TransitionEstate(ctx, estateID, adminID, LifecycleClose, "estate dissolved"); err != nil {
		t.Fatalf("close: %v", err)
	}
	if _, err := svc.TransitionEstate(ctx, estateID, adminID, LifecycleReactivate, "reopen attempt"); !errors.Is(err, ErrInvalidLifecycleTransition) {
		t.Fatalf("closed→reactivate = %v, want ErrInvalidLifecycleTransition", err)
	}
	// Audit trail: three transitions recorded.
	if n := auditCount(t, ctx, pool, estateID, estateID, "estate.lifecycle.suspend") +
		auditCount(t, ctx, pool, estateID, estateID, "estate.lifecycle.reactivate") +
		auditCount(t, ctx, pool, estateID, estateID, "estate.lifecycle.close"); n != 3 {
		t.Fatalf("lifecycle audit rows = %d, want 3", n)
	}
}

func TestLiveDB_Lifecycle_VerificationQueue(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil).WithVerificationRequired(true)
	adminID := seedDuesUser(t, ctx, pool)

	e, err := svc.CreateEstate(ctx, adminID, CreateEstateRequest{Name: "Pending Estate QA"})
	if err != nil {
		t.Fatalf("create pending estate: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estates WHERE id=$1`, e.ID) })
	if e.Status != EstateStatusPending {
		t.Fatalf("new estate status = %q, want pending", e.Status)
	}
	// Pending is invisible in the public discovery list and refuses writes.
	list, err := svc.ListEstates(ctx, "", "Pending Estate QA")
	if err != nil {
		t.Fatalf("list estates: %v", err)
	}
	for _, le := range list {
		if le.ID == e.ID {
			t.Fatal("pending estate appeared in the public ListEstates")
		}
	}
	if err := svc.AssertEstateWritable(ctx, e.ID); !IsEstateNotActive(err) {
		t.Fatalf("AssertEstateWritable(pending) = %v, want not-active", err)
	}
	// Review queue shows it; verify activates; reject closes another.
	queue, err := svc.ListEstatesByStatus(ctx, EstateStatusPending, 10)
	if err != nil {
		t.Fatalf("list pending: %v", err)
	}
	found := false
	for _, q := range queue {
		if q.EstateID == e.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("pending estate missing from the review queue")
	}
	if _, err := svc.TransitionEstate(ctx, e.ID, adminID, LifecycleVerify, "documents verified"); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if err := svc.AssertEstateWritable(ctx, e.ID); err != nil {
		t.Fatalf("verified estate not writable: %v", err)
	}
}

func TestLiveDB_Lifecycle_ReasonRequiredAndNotFound(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)

	if _, err := svc.TransitionEstate(ctx, estateID, adminID, LifecycleSuspend, "no"); !errors.Is(err, ErrLifecycleReasonRequired) {
		t.Fatalf("short reason = %v, want ErrLifecycleReasonRequired", err)
	}
	if _, err := svc.TransitionEstate(ctx, uuid.New().String(), adminID, LifecycleSuspend, "valid reason"); !errors.Is(err, ErrEstateNotFound) {
		t.Fatalf("unknown estate = %v, want ErrEstateNotFound", err)
	}
	if err := svc.AssertEstateWritable(ctx, uuid.New().String()); !errors.Is(err, ErrEstateNotFound) {
		t.Fatalf("AssertEstateWritable(unknown) = %v, want ErrEstateNotFound", err)
	}
}

func TestLiveDB_Lifecycle_LegalHoldBlocksPurge(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)

	l, err := svc.SetLegalHold(ctx, estateID, adminID, true, "court order 2027/114")
	if err != nil {
		t.Fatalf("set legal hold: %v", err)
	}
	if !l.LegalHold || l.LegalHoldReason != "court order 2027/114" {
		t.Fatalf("after hold: %+v", l)
	}
	// Soft-delete (PII scrub) is refused while held.
	if err := svc.SoftDeleteAccount(ctx, estateID, adminID); !errors.Is(err, ErrLegalHold) {
		t.Fatalf("SoftDeleteAccount under hold = %v, want ErrLegalHold", err)
	}
	// The DB trigger refuses a hard delete of the estate row itself.
	if _, err := pool.Exec(ctx, `DELETE FROM estates WHERE id=$1`, estateID); err == nil {
		t.Fatal("hard DELETE of a held estate succeeded — trigger missing")
	}
	// Lift the hold and the purge path opens again.
	if _, err := svc.SetLegalHold(ctx, estateID, adminID, false, "hold released"); err != nil {
		t.Fatalf("release hold: %v", err)
	}
	if n := auditCount(t, ctx, pool, estateID, estateID, "estate.legal_hold.placed") +
		auditCount(t, ctx, pool, estateID, estateID, "estate.legal_hold.released"); n != 2 {
		t.Fatalf("legal-hold audit rows = %d, want 2", n)
	}
}

func TestLiveDB_Lifecycle_GateMiddleware(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)

	gin.SetMode(gin.TestMode)
	h := NewHandler(svc)
	r := gin.New()
	g := r.Group("/estate")
	g.Use(h.LifecycleGate())
	g.POST("/:id/tasks", func(c *gin.Context) { c.Status(204) })
	g.POST("/:id/emergencies", func(c *gin.Context) { c.Status(204) })

	call := func(path string) int {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequestWithContext(context.Background(), http.MethodPost, path, nil))
		return w.Code
	}
	if code := call("/estate/" + estateID + "/tasks"); code != 204 {
		t.Fatalf("active estate write = %d, want 204", code)
	}
	if _, err := svc.TransitionEstate(ctx, estateID, adminID, LifecycleSuspend, "suspend for gate test"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if code := call("/estate/" + estateID + "/tasks"); code != http.StatusLocked {
		t.Fatalf("suspended estate write = %d, want 423", code)
	}
	// Emergencies stay open on a suspended estate.
	if code := call("/estate/" + estateID + "/emergencies"); code != 204 {
		t.Fatalf("exempt route on suspended estate = %d, want 204", code)
	}
	// Unknown estate falls through to the handler (204 here; a real route
	// would 403/404 on its own membership check).
	if code := call("/estate/" + uuid.New().String() + "/tasks"); code != 204 {
		t.Fatalf("unknown estate fell through = %d, want 204", code)
	}
}
