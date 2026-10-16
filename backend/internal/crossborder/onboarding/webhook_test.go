package onboarding

import (
	"context"
	"testing"

	"spotlight/backend/internal/finance/tiers"
)

// whStore wraps memStore with company lookup and records the last StatusUpdate.
type whStore struct {
	*memStore
	last StatusUpdate
}

func (w *whStore) GetAccountByCompanyID(_ context.Context, _, co string) (*GlobalAccount, error) {
	if w.acct == nil || w.acct.ProviderCompanyID != co {
		return nil, nil
	}
	c := *w.acct
	return &c, nil
}

func (w *whStore) UpdateStatus(ctx context.Context, id string, from, to Status, u StatusUpdate) error {
	if err := w.memStore.UpdateStatus(ctx, id, from, to, u); err != nil {
		return err
	}
	w.last = u
	if u.PriorStatus != "" {
		w.acct.PriorStatus = u.PriorStatus
	}
	if u.RejectionReason != "" {
		w.acct.RejectionReason = u.RejectionReason
	}
	return nil
}

// confirmProvider returns a configurable status from GetSubAccount.
type confirmProvider struct {
	*fakeProvider
	status string
}

func (c *confirmProvider) GetSubAccount(context.Context, string) (ProviderAccount, error) {
	return ProviderAccount{CompanyID: "co-1", Status: c.status}, nil
}

func whSvc(status Status, confirm string) (*Service, *confirmProvider, *whStore) {
	fp := &confirmProvider{fakeProvider: &fakeProvider{}, status: confirm}
	st := &whStore{memStore: &memStore{acct: &GlobalAccount{ID: "acct-1", UserID: "u1", Provider: ProviderName,
		ProviderCompanyID: "co-1", Status: status}}}
	return NewService(Deps{Store: st, Accounts: fp, Wallets: fp, KYC: stubKYC{}, Tiers: stubTier{tiers.Tier2, nil},
		Profiles: stubProfiles{}, Clock: fixedClock{}}), fp, st
}

func TestHandleProviderStatus_ApprovalProvisionsOnce(t *testing.T) {
	s, fp, st := whSvc(StatusInReview, "APPROVED")
	ev := NormalizedAccountEvent{Name: "account.approved", ProviderStatus: "APPROVED"}
	for i := 0; i < 2; i++ { // second is a redelivery
		if err := s.HandleProviderStatus(context.Background(), "co-1", ev); err != nil {
			t.Fatal(err)
		}
	}
	if st.acct.Status != StatusActive {
		t.Fatalf("status %s", st.acct.Status)
	}
	if fp.walletNew != 4 || len(st.wallets) != 4 {
		t.Fatalf("wallets provisioned %d stored %d, want 4/4", fp.walletNew, len(st.wallets))
	}
}

func TestHandleProviderStatus_Monotonic(t *testing.T) {
	s, _, st := whSvc(StatusActive, "PENDING") // stale event: provider reports older state
	if err := s.HandleProviderStatus(context.Background(), "co-1", NormalizedAccountEvent{Name: "account.approved"}); err != nil {
		t.Fatal(err)
	}
	if st.acct.Status != StatusActive {
		t.Fatalf("regressed to %s", st.acct.Status)
	}
}

func TestHandleProviderStatus_RejectedSetsReason(t *testing.T) {
	s, fp, st := whSvc(StatusInReview, "REJECTED")
	ev := NormalizedAccountEvent{Name: "account.rejected", Reason: "document unreadable"}
	if err := s.HandleProviderStatus(context.Background(), "co-1", ev); err != nil {
		t.Fatal(err)
	}
	if st.acct.Status != StatusRejected || st.last.RejectionReason != "document unreadable" {
		t.Fatalf("status %s reason %q", st.acct.Status, st.last.RejectionReason)
	}
	if fp.walletNew != 0 {
		t.Fatal("wallets provisioned on rejection")
	}
}

func TestHandleProviderStatus_GetConfirmBeforeApply(t *testing.T) {
	// Raw event claims approval; the provider GET says still pending. Apply the GET.
	s, fp, st := whSvc(StatusSubmitted, "PENDING")
	ev := NormalizedAccountEvent{Name: "account.approved", ProviderStatus: "APPROVED"}
	if err := s.HandleProviderStatus(context.Background(), "co-1", ev); err != nil {
		t.Fatal(err)
	}
	if st.acct.Status != StatusInReview || fp.walletNew != 0 {
		t.Fatalf("status %s wallets %d; raw event was trusted", st.acct.Status, fp.walletNew)
	}
}

func TestHandleProviderStatus_UnknownNoop(t *testing.T) {
	s, _, st := whSvc(StatusInReview, "WHATEVER")
	if err := s.HandleProviderStatus(context.Background(), "co-1", NormalizedAccountEvent{Name: "account.weird"}); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderStatus(context.Background(), "unknown-co", NormalizedAccountEvent{}); err != nil {
		t.Fatal(err)
	}
	if st.acct.Status != StatusInReview {
		t.Fatalf("status changed to %s", st.acct.Status)
	}
}

func TestHandleProviderStatus_SuspendAndReinstateToPrior(t *testing.T) {
	s, fp, st := whSvc(StatusAwaitingTnC, "SUSPENDED")
	ctx := context.Background()
	if err := s.HandleProviderStatus(ctx, "co-1", NormalizedAccountEvent{Name: "account.suspended"}); err != nil {
		t.Fatal(err)
	}
	if st.acct.Status != StatusSuspended || st.acct.PriorStatus != StatusAwaitingTnC {
		t.Fatalf("status %s prior %s", st.acct.Status, st.acct.PriorStatus)
	}
	fp.status = "ACTIVE" // un-suspended at provider; we were awaiting T&C, so go back there
	if err := s.HandleProviderStatus(ctx, "co-1", NormalizedAccountEvent{Name: "account.approved"}); err != nil {
		t.Fatal(err)
	}
	if st.acct.Status != StatusAwaitingTnC || fp.walletNew != 0 {
		t.Fatalf("status %s wallets %d", st.acct.Status, fp.walletNew)
	}
}

func TestHandleProviderStatus_SuspendedWhileNotStartedIsRefused(t *testing.T) {
	s, _, st := whSvc(StatusNotStarted, "SUSPENDED")
	if err := s.HandleProviderStatus(context.Background(), "co-1", NormalizedAccountEvent{Name: "account.suspended"}); err != nil {
		t.Fatal(err)
	}
	if st.acct.Status != StatusNotStarted {
		t.Fatalf("status %s", st.acct.Status)
	}
}
