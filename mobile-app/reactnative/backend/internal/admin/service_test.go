package admin

import (
	"testing"

	"paymax/crypto-backend/internal/stocks"
	"paymax/crypto-backend/internal/store"
)

func newSvc() *Service {
	return NewService(store.New(), stocks.NewService())
}

// firstAssetID returns a seeded asset control id to mutate in tests.
func firstAssetID(t *testing.T, s *Service) string {
	t.Helper()
	a := s.Assets()
	if len(a) == 0 {
		t.Fatal("expected seeded asset controls")
	}
	return a[0].ID
}

func TestRBACDeniesSupportFromAssetConfig(t *testing.T) {
	if Can(RoleSupportAdmin, PermAssetConfig) {
		t.Fatal("SupportAdmin must NOT hold PermAssetConfig")
	}
	if !Can(RoleSuperAdmin, PermAssetConfig) {
		t.Fatal("SuperAdmin must hold every permission")
	}
	if !Can(RoleProductAdmin, PermAssetConfig) {
		t.Fatal("ProductAdmin should hold PermAssetConfig")
	}

	s := newSvc()
	id := firstAssetID(t, s)
	pause := "paused"
	err := s.UpdateAssetControl(id, AssetControlPatch{Status: &pause}, RoleSupportAdmin, "test")
	if err == nil || err.Type != "forbidden" {
		t.Fatalf("expected forbidden error, got %+v", err)
	}
}

func TestUpdateAssetControlOpensApprovalAndApplies(t *testing.T) {
	s := newSvc()
	id := firstAssetID(t, s)

	// Sensitive change (disable buy) by ProductAdmin → should open a PENDING approval, not apply.
	off := false
	if err := s.UpdateAssetControl(id, AssetControlPatch{BuyEnabled: &off}, RoleProductAdmin, "compliance hold"); err != nil {
		t.Fatalf("unexpected error opening approval: %+v", err)
	}
	// Not applied yet.
	for _, a := range s.Assets() {
		if a.ID == id && a.BuyEnabled == false {
			t.Fatal("change must not apply before approval")
		}
	}
	pend := pendingApprovals(s)
	if len(pend) != 1 {
		t.Fatalf("expected 1 pending approval, got %d", len(pend))
	}
	aprID := pend[0].ID

	// Same maker cannot approve own request.
	if _, err := s.Approve(aprID, RoleProductAdmin); err == nil {
		t.Fatal("maker must not approve own request (needs PermApprovalAct + differ)")
	}

	// A different SuperAdmin (has PermApprovalAct) approves → applies.
	if _, err := s.Approve(aprID, RoleSuperAdmin); err != nil {
		t.Fatalf("approve by SuperAdmin failed: %+v", err)
	}
	applied := false
	for _, a := range s.Assets() {
		if a.ID == id && a.BuyEnabled == false {
			applied = true
		}
	}
	if !applied {
		t.Fatal("approved change should be applied")
	}

	// Double-approve is rejected (no longer pending).
	if _, err := s.Approve(aprID, RoleSuperAdmin); err == nil || err.Type != "conflict" {
		t.Fatalf("re-approving a settled approval should conflict, got %+v", err)
	}

	// Audit log written (request + applied entries at minimum).
	if len(s.Audit()) < 2 {
		t.Fatalf("expected audit entries for request + apply, got %d", len(s.Audit()))
	}
}

func TestSameActorApproveRejected(t *testing.T) {
	s := newSvc()
	// FinanceAdmin opens a fee approval (has PermFeeConfig + PermApprovalAct).
	if err := s.UpdateFee("fee_crypto_paymax", 75, RoleFinanceAdmin, "promo"); err != nil {
		t.Fatalf("UpdateFee failed: %+v", err)
	}
	pend := pendingApprovals(s)
	if len(pend) != 1 {
		t.Fatalf("expected 1 pending approval, got %d", len(pend))
	}
	if _, err := s.Approve(pend[0].ID, RoleFinanceAdmin); err == nil || err.Type != "forbidden" {
		t.Fatalf("same-actor approve must be forbidden, got %+v", err)
	}
	// Different checker applies the fee change.
	if _, err := s.Approve(pend[0].ID, RoleSuperAdmin); err != nil {
		t.Fatalf("checker approve failed: %+v", err)
	}
	for _, f := range s.Fees() {
		if f.ID == "fee_crypto_paymax" && f.Bps != 75 {
			t.Fatalf("fee should be 75 bps after apply, got %d", f.Bps)
		}
	}
}

func TestSetFlagTogglesAndAudits(t *testing.T) {
	s := newSvc()
	before := len(s.Audit())
	if err := s.SetFlag("invest_stocks", false, RoleProductAdmin, "incident"); err != nil {
		t.Fatalf("SetFlag failed: %+v", err)
	}
	got := false
	for _, f := range s.FeatureFlags() {
		if f.Key == "invest_stocks" {
			got = true
			if f.Enabled {
				t.Fatal("flag should be disabled")
			}
		}
	}
	if !got {
		t.Fatal("invest_stocks flag not found")
	}
	if len(s.Audit()) != before+1 {
		t.Fatalf("expected one new audit entry, got %d", len(s.Audit())-before)
	}
	// Support role may not toggle flags.
	if err := s.SetFlag("invest_stocks", true, RoleSupportAdmin, "x"); err == nil || err.Type != "forbidden" {
		t.Fatalf("SupportAdmin must not toggle flags, got %+v", err)
	}
}

func TestDashboardReturnsCounts(t *testing.T) {
	s := newSvc()
	d := s.Dashboard()
	if d.GeneratedAt == "" {
		t.Fatal("dashboard generatedAt should be set")
	}
	if d.Counts.Users < 1 {
		t.Fatal("expected at least one user")
	}
	if d.Counts.OpenKyc < 1 {
		t.Fatal("expected seeded open KYC cases")
	}
	if d.Counts.ActiveAssets < 1 {
		t.Fatal("expected active assets in dashboard")
	}
	if d.Providers.Up < 1 {
		t.Fatal("expected at least one provider up")
	}
}

func TestReconciliationReturnsReport(t *testing.T) {
	s := newSvc()
	rep := s.Reconciliation()
	if rep.GeneratedAt == "" {
		t.Fatal("recon report should have a timestamp")
	}
	if rep.Assets == nil {
		t.Fatal("recon report should list assets")
	}
}

// pendingApprovals returns only the PENDING approvals.
func pendingApprovals(s *Service) []Approval {
	out := []Approval{}
	for _, a := range s.Approvals() {
		if a.Status == "PENDING" {
			out = append(out, a)
		}
	}
	return out
}
