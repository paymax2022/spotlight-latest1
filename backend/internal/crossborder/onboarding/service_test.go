package onboarding

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"spotlight/backend/internal/finance/tiers"
)

type fixedClock struct{}

func (fixedClock) Now() time.Time { return time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC) }

type stubTier struct {
	t   tiers.Tier
	err error
}

func (s stubTier) GetUserTier(context.Context, string) (tiers.Tier, error) { return s.t, s.err }

type stubKYC struct{}

func (stubKYC) GetKYCView(context.Context, string) (KYCView, error) {
	return KYCView{FirstName: "Ada", LastName: "Obi", DateOfBirth: "1990-01-02", Nationality: "NG",
		Address: Address{Line1: "1 Marina", City: "Lagos", Country: "NG"}, HasBVN: true}, nil
}

type stubProfiles struct{ p Profile }

func (s stubProfiles) GetProfile(context.Context, string) (Profile, error) { return s.p, nil }

type fakeProvider struct {
	mu        sync.Mutex
	creates   int
	submits   int
	wallets   map[string]bool
	walletNew int
}

func (f *fakeProvider) CreateSubAccount(context.Context, SubAccountInput) (ProviderAccount, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.creates++
	return ProviderAccount{CompanyID: "co-1"}, nil
}
func (f *fakeProvider) SubmitOnboarding(context.Context, string, OnboardingPayload) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.submits++
	return nil
}
func (f *fakeProvider) GetSubAccount(context.Context, string) (ProviderAccount, error) {
	return ProviderAccount{}, nil
}
func (f *fakeProvider) GenerateUploadLink(context.Context, string, UploadLinkInput) (UploadLink, error) {
	return UploadLink{}, nil
}
func (f *fakeProvider) EnsureWallet(_ context.Context, co, cur string) (ProviderWalletRef, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.wallets == nil {
		f.wallets = map[string]bool{}
	}
	if !f.wallets[co+cur] {
		f.wallets[co+cur] = true
		f.walletNew++
	}
	return ProviderWalletRef{WalletID: "w-" + cur, Currency: cur}, nil
}
func (f *fakeProvider) GetFundingDetails(_ context.Context, _, cur string) (FundingInfo, error) {
	return FundingInfo{AccountNumber: "123" + cur}, nil
}

type memStore struct {
	mu       sync.Mutex
	acct     *GlobalAccount
	wallets  map[string]*ProviderWallet
	fundings int
	consents int
}

func (m *memStore) CreateAccount(_ context.Context, a *GlobalAccount, _ string, _ int) (*GlobalAccount, error) {
	if m.acct != nil {
		return m.acct, nil
	}
	c := *a
	c.ID = "acct-1"
	m.acct = &c
	return m.acct, nil
}
func (m *memStore) GetAccountByUser(context.Context, string, string) (*GlobalAccount, error) {
	if m.acct == nil {
		return nil, nil
	}
	c := *m.acct
	return &c, nil
}
func (m *memStore) UpdateStatus(_ context.Context, _ string, from, to Status, _ StatusUpdate) error {
	if !CanTransition(from, to) {
		return ErrIllegalTransition
	}
	if m.acct.Status != from {
		return ErrStaleStatus
	}
	m.acct.Status = to
	return nil
}
func (m *memStore) UpsertWallet(_ context.Context, w *ProviderWallet) (*ProviderWallet, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.wallets == nil {
		m.wallets = map[string]*ProviderWallet{}
	}
	if e, ok := m.wallets[w.Currency]; ok {
		return e, nil
	}
	c := *w
	c.ID = "wid-" + w.Currency
	m.wallets[w.Currency] = &c
	return &c, nil
}
func (m *memStore) UpsertFundingDetail(_ context.Context, f *FundingDetail) (*FundingDetail, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fundings++
	return f, nil
}
func (m *memStore) RecordSubmission(context.Context, string, int, string, []byte, string) error {
	return nil
}
func (m *memStore) RecordConsent(context.Context, *Consent) error { m.consents++; return nil }

func indivIn() ActivateInput {
	return ActivateInput{SubjectType: SubjectIndividual, Profile: Profile{Email: "a@b.co", Phone: "+2348000000000"}}
}

func bizIn() ActivateInput {
	reg := Address{Line1: "5 Broad St", City: "Lagos", Country: "NG"}
	return ActivateInput{SubjectType: SubjectBusiness, Profile: Profile{Email: "o@acme.ng", Phone: "+2348111111111",
		Business: &BusinessProfile{LegalName: "Acme Ltd", RegistrationNumber: "RC123", CompanyType: "LIMITED_COMPANY",
			Country: "NG", RegisteredAddress: reg, OperatingAddress: reg,
			Shareholders: []ShareholderInput{{Type: ShareholderIndividual, Name: "Bola Ade", Email: "b@acme.ng",
				Phone: "+234", DateOfBirth: "1985-01-01", Nationality: "NG", Address: reg, OwnershipBps: 10000,
				ControllingOfficer: true, Role: RoleDirector}}}}}
}

func newSvc(t tiers.Tier, terr error) (*Service, *fakeProvider, *memStore) {
	fp, ms := &fakeProvider{}, &memStore{}
	return NewService(Deps{
		Store: ms, Accounts: fp, Wallets: fp, KYC: stubKYC{}, Tiers: stubTier{t, terr},
		Profiles: stubProfiles{Profile{Email: "a@b.co", Phone: "+2348000000000"}}, Clock: fixedClock{},
		DocTypeID: map[DocumentKind]string{DocIdentity: "t1", DocAddressProof: "t2", DocIncorporation: "t3"},
	}), fp, ms
}

func TestActivate_RefusesBelowTier2(t *testing.T) {
	for _, tc := range []struct {
		name string
		tier tiers.Tier
		err  error
		want error
	}{{"tier1", 1, nil, ErrTierTooLow}, {"tier error", 3, errors.New("db down"), ErrTierUnavailable}} {
		svc, fp, ms := newSvc(tc.tier, tc.err)
		_, err := svc.Activate(context.Background(), "u1", indivIn())
		if !errors.Is(err, tc.want) {
			t.Fatalf("%s: err=%v", tc.name, err)
		}
		if fp.creates != 0 || ms.acct != nil {
			t.Fatalf("%s: side effects on refusal", tc.name)
		}
	}
}

func TestActivate_Idempotent(t *testing.T) {
	svc, fp, _ := newSvc(2, nil)
	in := indivIn()
	a, err := svc.Activate(context.Background(), "u1", in)
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.Activate(context.Background(), "u1", in)
	if err != nil {
		t.Fatal(err)
	}
	if fp.creates != 1 || a.ID != b.ID {
		t.Fatalf("creates=%d ids %s/%s", fp.creates, a.ID, b.ID)
	}
	if b.Status != StatusSubmitted {
		t.Fatalf("status=%s", b.Status)
	}
}

func TestActivate_IndividualAndBusiness(t *testing.T) {
	svc, fp, _ := newSvc(2, nil)
	a, err := svc.Activate(context.Background(), "u1", indivIn())
	if err != nil || a.SubjectType != SubjectIndividual || fp.submits != 1 {
		t.Fatalf("individual: %v %+v", err, a)
	}
	svcB, fpB, _ := newSvc(2, nil)
	b, err := svcB.Activate(context.Background(), "u3", bizIn())
	if err != nil || b.SubjectType != SubjectBusiness || b.Status != StatusSubmitted || fpB.submits != 1 {
		t.Fatalf("business: %v %+v", err, b)
	}
	// Business without a business profile must fail the mapper before any provider call.
	svc2, fp2, ms2 := newSvc(2, nil)
	if _, err := svc2.Activate(context.Background(), "u2", ActivateInput{SubjectType: SubjectBusiness}); err == nil {
		t.Fatal("business without profile accepted")
	}
	if fp2.creates != 0 || ms2.acct != nil {
		t.Fatal("orphan created on mapping failure")
	}
}

func TestActivate_DocumentGateLeavesNotStarted(t *testing.T) {
	svc, fp, _ := newSvc(2, nil)
	svc.d.RequiredDocs = map[SubjectType][]DocumentKind{SubjectIndividual: {DocIdentity}}
	a, err := svc.Activate(context.Background(), "u1", indivIn())
	if err != nil || a.Status != StatusNotStarted || fp.submits != 0 {
		t.Fatalf("err=%v status=%s submits=%d", err, a.Status, fp.submits)
	}
	if err := svc.SubmitDocuments(context.Background(), "u1", nil); !errors.Is(err, ErrDocumentsIncomplete) {
		t.Fatalf("err=%v", err)
	}
	if err := svc.SubmitDocuments(context.Background(), "u1", []DocumentRef{{Kind: DocIdentity, DocumentID: "d1"}}); err != nil {
		t.Fatal(err)
	}
	st, _ := svc.GetStatus(context.Background(), "u1")
	if st.Status != StatusSubmitted || fp.submits != 1 {
		t.Fatalf("status=%s submits=%d", st.Status, fp.submits)
	}
}

func TestEnsureWallets_ProvisionsOncePerCurrency(t *testing.T) {
	svc, fp, ms := newSvc(2, nil)
	acct := &GlobalAccount{ID: "acct-1", ProviderCompanyID: "co-1"}
	for i := 0; i < 2; i++ {
		if err := svc.ensureWallets(context.Background(), acct); err != nil {
			t.Fatal(err)
		}
	}
	if fp.walletNew != 4 || len(ms.wallets) != 4 {
		t.Fatalf("new=%d stored=%d", fp.walletNew, len(ms.wallets))
	}
	for _, c := range []string{"USD", "EUR", "GBP", "NGN"} {
		if ms.wallets[c] == nil {
			t.Fatalf("missing %s", c)
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _ = svc.ensureWallets(context.Background(), acct) }()
	}
	wg.Wait()
	if fp.walletNew != 4 {
		t.Fatalf("double provisioned: %d", fp.walletNew)
	}
}

func TestRejectedResubmit_ReturnsToSubmitted(t *testing.T) {
	svc, fp, ms := newSvc(2, nil)
	ms.acct = &GlobalAccount{ID: "acct-1", UserID: "u1", SubjectType: SubjectIndividual,
		ProviderCompanyID: "co-1", Status: StatusRejected}
	docs := []DocumentRef{{Kind: DocIdentity, DocumentID: "d1"}}
	if err := svc.SubmitDocuments(context.Background(), "u1", docs); err != nil {
		t.Fatal(err)
	}
	if ms.acct.Status != StatusSubmitted || fp.submits != 1 {
		t.Fatalf("status=%s submits=%d", ms.acct.Status, fp.submits)
	}
	ms.acct.Status = StatusInReview
	if err := svc.SubmitDocuments(context.Background(), "u1", docs); !errors.Is(err, ErrWrongState) {
		t.Fatalf("err=%v", err)
	}
}

func TestAcceptTnC_MovesAwaitingTnCToActive(t *testing.T) {
	svc, fp, ms := newSvc(2, nil)
	ms.acct = &GlobalAccount{ID: "acct-1", UserID: "u1", ProviderCompanyID: "co-1", Status: StatusAwaitingTnC}
	if err := svc.AcceptTnC(context.Background(), "u1", TnCAcceptance{Version: "1"}); err != nil {
		t.Fatal(err)
	}
	if ms.acct.Status != StatusActive || ms.consents != 1 || fp.walletNew != 4 {
		t.Fatalf("status=%s consents=%d wallets=%d", ms.acct.Status, ms.consents, fp.walletNew)
	}
	ms.acct.Status = StatusInReview
	if err := svc.AcceptTnC(context.Background(), "u1", TnCAcceptance{}); !errors.Is(err, ErrWrongState) {
		t.Fatalf("err=%v", err)
	}
}
