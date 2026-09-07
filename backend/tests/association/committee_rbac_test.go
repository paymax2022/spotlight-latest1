package association_test

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/association"
)

// Committee RBAC has two tiers, and the split is the whole point:
//
//	LIFECYCLE (create / rename / delete)          -> ManageCommittees -> owner
//	ROSTER    (add / approve / remove / set role) -> ManageMembers
//
// All six used to sit behind ManageMembers, so a CHAPTER_ADMIN could delete any
// committee in the organisation — and DeleteCommittee drops every
// assoc_committee_members row with it.
//
// These call the real service against a live database rather than transcribing
// capabilitiesFor(), so they fail if the gate drifts rather than agreeing with a
// stale copy of it. Gated on TEST_DATABASE_URL like the rest of the suite.

func TestCommitteeLifecycle_OwnerOnly_LiveDB(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "cmtercb")
	defer done()
	pool := liveDBPool(t)
	defer pool.Close()

	purpose := "Reviews the annual audit"
	req := association.CommitteeRequest{Name: "Audit Committee", Description: &purpose}

	// The owner (founder holds SUPER_ADMIN — see PublishOrganisation) may create.
	committeeID, err := svc.CreateCommittee(ctx, founder, orgID, req)
	if err != nil {
		t.Fatalf("owner CreateCommittee: %v", err)
	}

	for _, tc := range []struct{ role, who string }{
		{"CHAPTER_ADMIN", "a chapter admin"},
		{"FINANCE_ADMIN", "a finance admin"},
		{"SECRETARY", "a secretary"},
	} {
		t.Run(tc.role, func(t *testing.T) {
			actor := seedAdminRole(t, ctx, pool, orgID, tc.role)

			if _, err := svc.CreateCommittee(ctx, actor, orgID, req); !errors.Is(err, association.ErrForbidden) {
				t.Errorf("%s CreateCommittee err = %v, want ErrForbidden", tc.who, err)
			}
			if err := svc.UpdateCommittee(ctx, actor, committeeID, req); !errors.Is(err, association.ErrForbidden) {
				t.Errorf("%s UpdateCommittee err = %v, want ErrForbidden", tc.who, err)
			}
			// The one that mattered most: delete cascades the roster away.
			if err := svc.DeleteCommittee(ctx, actor, committeeID); !errors.Is(err, association.ErrForbidden) {
				t.Errorf("%s DeleteCommittee err = %v, want ErrForbidden", tc.who, err)
			}
		})
	}

	// A plain member — an ACTIVE membership holding no role row at all.
	t.Run("plain member", func(t *testing.T) {
		member, _ := seedActiveMembership(t, ctx, pool, orgID)
		if _, err := svc.CreateCommittee(ctx, member, orgID, req); !errors.Is(err, association.ErrForbidden) {
			t.Errorf("member CreateCommittee err = %v, want ErrForbidden", err)
		}
		if err := svc.DeleteCommittee(ctx, member, committeeID); !errors.Is(err, association.ErrForbidden) {
			t.Errorf("member DeleteCommittee err = %v, want ErrForbidden", err)
		}
	})

	// Still standing after every refusal above.
	if err := svc.DeleteCommittee(ctx, founder, committeeID); err != nil {
		t.Fatalf("owner DeleteCommittee: %v", err)
	}
}

// Tightening the lifecycle must not take day-to-day roster work away from the
// chapter admins who actually do it.
func TestCommitteeRoster_ChapterAdminKeepsIt_LiveDB(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "cmterost")
	defer done()
	pool := liveDBPool(t)
	defer pool.Close()

	committeeID, err := svc.CreateCommittee(ctx, founder, orgID,
		association.CommitteeRequest{Name: "Welfare Committee"})
	if err != nil {
		t.Fatalf("create committee: %v", err)
	}
	t.Cleanup(func() { _ = svc.DeleteCommittee(context.Background(), founder, committeeID) })

	chapterAdmin := seedAdminRole(t, ctx, pool, orgID, "CHAPTER_ADMIN")
	_, membershipID := seedActiveMembership(t, ctx, pool, orgID)

	// Runs the roster...
	if _, err := svc.AddCommitteeMembers(ctx, chapterAdmin, committeeID, []string{membershipID}); err != nil {
		t.Fatalf("chapter admin AddCommitteeMembers: %v", err)
	}
	if err := svc.RemoveCommitteeMember(ctx, chapterAdmin, committeeID, membershipID); err != nil {
		t.Fatalf("chapter admin RemoveCommitteeMember: %v", err)
	}
	// ...but does not own the committee itself.
	if err := svc.DeleteCommittee(ctx, chapterAdmin, committeeID); !errors.Is(err, association.ErrForbidden) {
		t.Fatalf("chapter admin DeleteCommittee err = %v, want ErrForbidden", err)
	}
}
