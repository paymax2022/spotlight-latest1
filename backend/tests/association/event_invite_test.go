package association_test

// ---------------------------------------------------------------------------
// Event invitations.
//
// WHY THIS EXISTS
// ---------------
// Events could be created and responded to, but nobody could be INVITED to one
// — the only way a member learned about an event was finding it in the list.
//
// An invitation is a REGISTRATION ROW with invited_at set, not a separate
// table, because assoc_event_registrations already holds the (event, membership)
// relationship along with the RSVP, ticket and check-in. The tests below pin the
// consequence that design is for: inviting somebody who has already responded
// must not disturb their response.
//
// Live-DB, same harness as founder_and_scoping_test.go.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestInviteToEvent_InvitesMembersAndIsAdminOnly pins who may invite and that
// the invitation reaches the member's own list.
func TestInviteToEvent_InvitesMembersAndIsAdminOnly(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)

	var eventID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO assoc_events (organisation_id, title, starts_at, location)
		VALUES ($1, 'Annual dinner', now() + interval '30 days', 'Ikeja')
		RETURNING id::text`, orgID).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_event_registrations WHERE event_id=$1`, eventID)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_events WHERE id=$1`, eventID)
	})

	var memberMembership string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM assoc_memberships WHERE user_id=$1 AND organisation_id=$2`,
		memberID, orgID).Scan(&memberMembership); err != nil {
		t.Fatalf("member membership: %v", err)
	}

	// A plain member cannot invite: putting an event in front of the whole
	// organisation is an organiser's job.
	if _, err := svc.InviteToEvent(ctx, memberID, eventID, []string{memberMembership}); err == nil {
		t.Error("a non-admin must not be able to invite members to an event")
	}

	n, err := svc.InviteToEvent(ctx, adminID, eventID, []string{memberMembership})
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	if n != 1 {
		t.Fatalf("invited = %d, want 1", n)
	}

	events, err := svc.GetEvents(ctx, memberID)
	if err != nil {
		t.Fatalf("GetEvents: %v", err)
	}
	found := false
	for _, e := range events {
		if e.ID == eventID {
			found = true
			if !e.Invited {
				t.Error("an invited member must see the event flagged as an invitation")
			}
		}
	}
	if !found {
		t.Fatal("the event is missing from the invited member's list")
	}
}

// TestInviteToEvent_DoesNotDisturbAnExistingResponse is the property the
// one-row design exists for: re-inviting must not reset an RSVP.
func TestInviteToEvent_DoesNotDisturbAnExistingResponse(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)

	var eventID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO assoc_events (organisation_id, title, starts_at)
		VALUES ($1, 'Workshop', now() + interval '14 days') RETURNING id::text`, orgID).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_event_registrations WHERE event_id=$1`, eventID)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_events WHERE id=$1`, eventID)
	})

	var membership string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM assoc_memberships WHERE user_id=$1 AND organisation_id=$2`,
		memberID, orgID).Scan(&membership); err != nil {
		t.Fatalf("membership: %v", err)
	}

	// The member has already said they are going and holds a ticket.
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_event_registrations (event_id, membership_id, rsvp, registered, ticket_code, registered_at)
		VALUES ($1,$2,'GOING',true,'TKT-123', now())`, eventID, membership); err != nil {
		t.Fatalf("seed registration: %v", err)
	}

	if _, err := svc.InviteToEvent(ctx, adminID, eventID, []string{membership}); err != nil {
		t.Fatalf("invite: %v", err)
	}

	var rsvp, ticket *string
	var registered bool
	var invitedAt *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT rsvp, ticket_code, registered, invited_at FROM assoc_event_registrations
		WHERE event_id=$1 AND membership_id=$2`, eventID, membership).Scan(&rsvp, &ticket, &registered, &invitedAt); err != nil {
		t.Fatalf("read registration: %v", err)
	}
	if rsvp == nil || *rsvp != "GOING" {
		t.Errorf("rsvp = %v, want GOING — an invitation must not reset a response already given", rsvp)
	}
	if !registered || ticket == nil || *ticket != "TKT-123" {
		t.Errorf("registration lost: registered=%v ticket=%v", registered, ticket)
	}
	if invitedAt == nil {
		t.Error("invited_at was not recorded on the existing row")
	}
}

// TestInviteToEvent_DropsForeignMemberships closes the cross-org write: ids
// from another organisation must write nothing.
func TestInviteToEvent_DropsForeignMemberships(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgA, adminA, _ := orgWithAdminAndMember(t, ctx, pool, svc)

	otherFounder := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		otherFounder, otherFounder+"@otherorg.test"); err != nil {
		t.Fatalf("seed other founder: %v", err)
	}
	resB, err := svc.PublishOrganisation(ctx, otherFounder, newTestDraft("Other "+uuid.NewString()[:8]))
	if err != nil {
		t.Fatalf("publish other org: %v", err)
	}
	_, foreignMembership := seedMember(t, ctx, pool, resB.OrganisationID, "@foreign.test")

	var eventID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO assoc_events (organisation_id, title, starts_at)
		VALUES ($1, 'Members only', now() + interval '10 days') RETURNING id::text`, orgA).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_event_registrations WHERE event_id=$1`, eventID)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_events WHERE id=$1`, eventID)
	})

	n, err := svc.InviteToEvent(ctx, adminA, eventID, []string{foreignMembership})
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	if n != 0 {
		t.Errorf("invited = %d, want 0 — a membership from another organisation must not be added", n)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_event_registrations WHERE event_id=$1`, eventID).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 0 {
		t.Errorf("registration rows = %d, want 0", rows)
	}
}
