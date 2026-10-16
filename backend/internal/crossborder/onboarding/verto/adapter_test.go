package verto

import (
	"context"
	"strings"
	"testing"

	"spotlight/backend/internal/crossborder/onboarding"
	"spotlight/backend/internal/provider/vertofx"
)

// The offline-mock vertofx client (empty credentials) exercises the adapter
// end to end without network access.
func TestAdapter_MockClientRoundTrip(t *testing.T) {
	a := New(vertofx.New("", "", false))
	ctx := context.Background()
	pa, err := a.CreateSubAccount(ctx, onboarding.SubAccountInput{Name: "Ada Obi", Country: "NG", IdentificationNumber: "u1", SubjectType: onboarding.SubjectIndividual})
	if err != nil || pa.CompanyID == "" {
		t.Fatalf("create: %+v %v", pa, err)
	}
	if err := a.SubmitOnboarding(ctx, pa.CompanyID, onboarding.OnboardingPayload{}); err != nil {
		t.Fatal(err)
	}
	w, err := a.EnsureWallet(ctx, pa.CompanyID, "USD")
	if err != nil || w.WalletID == "" || w.Currency != "USD" {
		t.Fatalf("wallet: %+v %v", w, err)
	}
	f, err := a.GetFundingDetails(ctx, pa.CompanyID, "USD")
	if err != nil || f.AccountNumber == "" {
		t.Fatalf("funding: %+v %v", f, err)
	}
	l, err := a.GenerateUploadLink(ctx, pa.CompanyID, onboarding.UploadLinkInput{DocumentTypeID: "t1", FileName: "id.png"})
	if err != nil || l.DocumentID == "" {
		t.Fatalf("upload: %+v %v", l, err)
	}
}

func TestToWire_CarriesEverythingNothingDropped(t *testing.T) {
	addr := onboarding.Address{Line1: "1 Marina", City: "Lagos", Country: "NG"}
	w := toWire(onboarding.OnboardingPayload{
		SubjectType:      onboarding.SubjectIndividual,
		SelectedProducts: []string{"Collect"},
		Company:          onboarding.PayloadCompany{LegalName: "Ada Obi", Type: "SOLE_TRADER", Country: "NG", CompanyAddress: addr},
		Shareholders: []onboarding.PayloadShareholder{{Name: "Ada Obi", Email: "a@b.co", Phone: "+234",
			Documents: []onboarding.PayloadDocument{{TypeID: "t1", DocumentID: "d1"}}}},
	})
	if w.LegalName != "Ada Obi" || w.Email != "a@b.co" || w.Address != "1 Marina, Lagos, NG" {
		t.Fatalf("flat fields wrong: %+v", w)
	}
	if len(w.DocumentIDs) != 1 || w.DocumentIDs[0] != "d1" {
		t.Fatalf("documents: %v", w.DocumentIDs)
	}
	if !strings.Contains(w.Extra["shareholders"], "Ada Obi") || w.Extra["company_type"] != "SOLE_TRADER" {
		t.Fatalf("extra: %v", w.Extra)
	}
}
