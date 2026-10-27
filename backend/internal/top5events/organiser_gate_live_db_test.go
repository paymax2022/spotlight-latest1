package top5events_test

// Live-DB tests for the organiser-upgrade gate (EVTA-D001): the RBAC
// events.manage check on create/duplicate/submit/go-live, driven by the real
// onboarding apply → submit → approve pipeline. Skips unless TEST_DATABASE_URL
// is set (via ticketTokenPool).

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/onboarding"
	"spotlight/backend/internal/top5events"
)

// organiserApplicationData satisfies every required field of the seeded
// fs-event-organiser-v1 form schema (20271068004000).
func organiserApplicationData() map[string]any {
	return map[string]any{
		"organiser_name":   "UAT Test Organiser",
		"event_categories": []any{"music", "tech"},
		"owner_id_doc":     "https://example.com/owner-id.pdf",
		"contact_email":    "organiser@example.com",
		"contact_phone":    "+2348012345678",
	}
}

// applyForOrganiser runs the real onboarding pipeline: create application →
// submit (validates against the published schema) → return the application.
func applyForOrganiser(t *testing.T, ctx context.Context, ob *onboarding.Service, userID string) *onboarding.Application {
	t.Helper()
	app, err := ob.CreateApplication(ctx, userID, onboarding.CreateApplicationRequest{
		MerchantTypeID: top5events.OrganiserMerchantTypeID,
		Data:           organiserApplicationData(),
	})
	if err != nil {
		t.Fatalf("CreateApplication: %v", err)
	}
	app, err = ob.Submit(ctx, userID, app.ID, "idem-"+uuid.New().String())
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if app.Status != "SUBMITTED" {
		t.Fatalf("application status = %q, want SUBMITTED", app.Status)
	}
	return app
}

func validEvent() top5events.Event {
	return top5events.Event{
		Title:    "Gate Test Event",
		StartsAt: time.Now().Add(24 * time.Hour),
		EndsAt:   time.Now().Add(30 * time.Hour),
	}
}

// Plain authenticated customer, gate on: create (and every other capability
// transition) is denied before any object-level check.
func TestLiveDB_OrganiserGate_PlainCustomerDenied(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	svc.SetOrganiserGate(true)
	user := seedTicketTokenUser(t, ctx, pool)

	if _, err := svc.CreateEvent(ctx, user, validEvent()); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("CreateEvent as plain customer = %v, want ErrForbidden", err)
	}
	el, err := svc.Eligibility(ctx, user)
	if err != nil {
		t.Fatalf("Eligibility: %v", err)
	}
	if !el.GateEnabled || el.CanOrganise {
		t.Fatalf("eligibility = %+v, want gate_enabled=true, can_organise=false", el)
	}
}

// The full defect flow: apply → submit → (still denied while pending) →
// admin approve → role grant → create succeeds.
func TestLiveDB_OrganiserGate_ApplyApproveCreate(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	svc.SetOrganiserGate(true)
	ob := onboarding.NewService(pool)
	user := seedTicketTokenUser(t, ctx, pool)
	reviewer := seedTicketTokenUser(t, ctx, pool)

	app := applyForOrganiser(t, ctx, ob, user)

	// Pending approval: still denied (RTM: block pending organiser event creation).
	if _, err := svc.CreateEvent(ctx, user, validEvent()); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("CreateEvent while pending = %v, want ErrForbidden", err)
	}

	app, err := ob.Approve(ctx, reviewer, app.ID)
	if err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if app.Status != "APPROVED" {
		t.Fatalf("application status = %q, want APPROVED", app.Status)
	}

	ev, err := svc.CreateEvent(ctx, user, validEvent())
	if err != nil {
		t.Fatalf("CreateEvent after approval: %v", err)
	}
	if ev.State != top5events.EventDraft || ev.OrganiserID != user {
		t.Fatalf("created event = %+v", ev)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM events WHERE id=$1`, ev.ID) })

	// The downstream capability transitions open too.
	if err := svc.Submit(ctx, user, ev.ID); err != nil {
		t.Fatalf("Submit after approval: %v", err)
	}
}

// An organiser who already owns an event (seeded directly, as a pre-gate row
// would exist) is grandfathered by the boot sweep and keeps working. A revoked
// organiser is NOT resurrected by a re-run.
func TestLiveDB_OrganiserGate_GrandfatheredOrganiser(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	svc.SetOrganiserGate(true)
	owner := seedTicketTokenUser(t, ctx, pool)

	// Legacy-shaped row: organiser_id NULL, ownership carried by organizer_id —
	// the drift-reconciled schema has both spellings (20270228000000).
	legacyID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, state, starts_at, ends_at)
		 VALUES ($1,$2,NULL,'Legacy Owner Event','LIVE',$3,$4)`,
		legacyID, owner, time.Now().Add(-48*time.Hour), time.Now().Add(-24*time.Hour)); err != nil {
		t.Fatalf("seed legacy event: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM events WHERE id=$1`, legacyID) })

	if _, err := svc.CreateEvent(ctx, owner, validEvent()); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("pre-sweep CreateEvent = %v, want ErrForbidden", err)
	}

	n, err := svc.GrandfatherOrganisers(ctx)
	if err != nil {
		t.Fatalf("GrandfatherOrganisers: %v", err)
	}
	if n < 1 {
		t.Fatalf("GrandfatherOrganisers granted %d roles, want >= 1", n)
	}

	ev, err := svc.CreateEvent(ctx, owner, validEvent())
	if err != nil {
		t.Fatalf("CreateEvent after grandfathering: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM events WHERE id=$1`, ev.ID) })

	// Idempotent: a second sweep grants nothing more.
	if n2, err := svc.GrandfatherOrganisers(ctx); err != nil || n2 != 0 {
		t.Fatalf("second sweep = %d, %v — want 0, nil", n2, err)
	}

	// Revocation-safe: deactivate the grant, re-run — it must NOT come back.
	if _, err := pool.Exec(ctx, `
		UPDATE public.user_roles SET is_active = false
		 WHERE user_id = $1
		   AND role_id = (SELECT id FROM public.roles WHERE slug = 'event_organiser')`,
		owner); err != nil {
		t.Fatalf("revoke role: %v", err)
	}
	if _, err := svc.GrandfatherOrganisers(ctx); err != nil {
		t.Fatalf("post-revoke sweep: %v", err)
	}
	if _, err := svc.CreateEvent(ctx, owner, validEvent()); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("post-revoke CreateEvent = %v, want ErrForbidden", err)
	}
}

// Flag off preserves the pre-gate behaviour exactly: any authenticated user can
// create, and Eligibility reports the gate as off.
func TestLiveDB_OrganiserGate_FlagOffLegacyBehaviour(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool) // gate defaults to off
	user := seedTicketTokenUser(t, ctx, pool)

	ev, err := svc.CreateEvent(ctx, user, validEvent())
	if err != nil {
		t.Fatalf("CreateEvent with gate off: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM events WHERE id=$1`, ev.ID) })

	el, err := svc.Eligibility(ctx, user)
	if err != nil {
		t.Fatalf("Eligibility: %v", err)
	}
	if el.GateEnabled || !el.CanOrganise {
		t.Fatalf("eligibility = %+v, want gate_enabled=false, can_organise=true", el)
	}
}
