package onboarding

import (
	"reflect"
	"strings"
	"testing"
)

func testExtras() ActivateExtras {
	return ActivateExtras{
		DocumentTypeIDs: map[DocumentKind]string{
			DocIdentity: "dt-id", DocAddressProof: "dt-addr", DocIncorporation: "dt-inc",
		},
		RiskAnswers: []RiskAnswer{{QuestionID: "q-1", Answer: "a-1"}},
		Documents: []DocumentRef{
			{Kind: DocIdentity, DocumentID: "doc-1"},
			{Kind: DocAddressProof, DocumentID: "doc-2"},
		},
	}
}

func testKYC() KYCView {
	return KYCView{
		FirstName: "Ada", LastName: "Obi", DateOfBirth: "1990-04-02", Nationality: "NG",
		Address: Address{Line1: "1 Marina", City: "Lagos", State: "LA", PostalCode: "101", Country: "NG"},
		HasBVN:  true,
	}
}

func TestBuildOnboardingData_Individual(t *testing.T) {
	p := Profile{UserID: "u1", Email: "ada@example.com", Phone: "+2348000000000"}
	got, err := BuildOnboardingData(SubjectIndividual, p, testKYC(), testExtras())
	if err != nil {
		t.Fatal(err)
	}
	addr := testKYC().Address
	want := OnboardingPayload{
		SubjectType:      SubjectIndividual,
		SelectedProducts: []string{"Collect", "Convert", "Pay", "Hold"},
		Company: PayloadCompany{
			LegalName: "Ada Obi", Type: CompanyTypeSoleTrader, Country: "NG",
			CompanyAddress: addr,
		},
		Shareholders: []PayloadShareholder{{
			Type: ShareholderIndividual, Name: "Ada Obi", Email: "ada@example.com",
			Phone: "+2348000000000", DateOfBirth: "1990-04-02", Nationality: "NG",
			Address: addr, OwnershipBps: 10000, ControllingOfficer: true, Role: RoleDirector,
			Documents: []PayloadDocument{{TypeID: "dt-id", DocumentID: "doc-1"}, {TypeID: "dt-addr", DocumentID: "doc-2"}},
		}},
		RiskAnswers: []RiskAnswer{{QuestionID: "q-1", Answer: "a-1"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("mismatch\n got: %+v\nwant: %+v", got, want)
	}
}

func TestBuildOnboardingData_IndividualFailsClosed(t *testing.T) {
	p := Profile{UserID: "u1", Email: "ada@example.com", Phone: "+234"}
	k := testKYC()
	k.HasBVN = false
	if _, err := BuildOnboardingData(SubjectIndividual, p, k, testExtras()); err == nil {
		t.Fatal("expected error without BVN/NIN")
	}
	k = testKYC()
	k.DateOfBirth = ""
	if _, err := BuildOnboardingData(SubjectIndividual, p, k, testExtras()); err == nil {
		t.Fatal("expected error without DOB")
	}
	ex := testExtras()
	ex.DocumentTypeIDs = nil
	if _, err := BuildOnboardingData(SubjectIndividual, p, testKYC(), ex); err == nil || !strings.Contains(err.Error(), "document type") {
		t.Fatalf("expected missing document type error, got %v", err)
	}
}

func TestBuildOnboardingData_Business(t *testing.T) {
	reg := Address{Line1: "5 Broad St", City: "Lagos", Country: "NG"}
	op := Address{Line1: "9 Ikoyi Rd", City: "Lagos", Country: "NG"}
	p := Profile{UserID: "u1", Email: "ops@acme.ng", Phone: "+2348111111111", Business: &BusinessProfile{
		LegalName: "Acme Ltd", RegistrationNumber: "RC123", CompanyType: "LIMITED_COMPANY", Country: "NG",
		RegisteredAddress: reg, OperatingAddress: op,
		Shareholders: []ShareholderInput{
			{Type: ShareholderIndividual, Name: "Bola Ade", Email: "b@acme.ng", Phone: "+234", DateOfBirth: "1985-01-01",
				Nationality: "NG", Address: reg, OwnershipBps: 6000, ControllingOfficer: true, Role: RoleDirector,
				Documents: []DocumentRef{{Kind: DocIdentity, DocumentID: "sh-doc"}}},
			{Type: ShareholderCorporate, Name: "Holdco Ltd", RegistrationNo: "RC9", Country: "GB", OwnershipBps: 4000},
		},
	}}
	ex := testExtras()
	ex.Documents = []DocumentRef{{Kind: DocIncorporation, DocumentID: "co-doc"}}
	got, err := BuildOnboardingData(SubjectBusiness, p, KYCView{}, ex)
	if err != nil {
		t.Fatal(err)
	}
	if got.Company.LegalName != "Acme Ltd" || got.Company.Type != "LIMITED_COMPANY" ||
		got.Company.CompanyAddress != reg || got.Company.OperatingAddress != op {
		t.Fatalf("company: %+v", got.Company)
	}
	if len(got.Shareholders) != 2 || got.Shareholders[0].OwnershipBps != 6000 ||
		got.Shareholders[1].Type != ShareholderCorporate || got.Shareholders[1].RegistrationNo != "RC9" {
		t.Fatalf("shareholders: %+v", got.Shareholders)
	}
	if !reflect.DeepEqual(got.Shareholders[0].Documents, []PayloadDocument{{TypeID: "dt-id", DocumentID: "sh-doc"}}) {
		t.Fatalf("sh docs: %+v", got.Shareholders[0].Documents)
	}
	if !reflect.DeepEqual(got.Documents, []PayloadDocument{{TypeID: "dt-inc", DocumentID: "co-doc"}}) {
		t.Fatalf("docs: %+v", got.Documents)
	}
	if !reflect.DeepEqual(got.SelectedProducts, []string{"Collect", "Convert", "Pay", "Hold"}) {
		t.Fatalf("products: %v", got.SelectedProducts)
	}
}

func TestBuildOnboardingData_BusinessFailsClosed(t *testing.T) {
	reg := Address{Line1: "5 Broad St", City: "Lagos", Country: "NG"}
	base := func() Profile {
		return Profile{Email: "e", Phone: "p", Business: &BusinessProfile{
			LegalName: "Acme", RegistrationNumber: "RC1", CompanyType: "LTD", Country: "NG",
			RegisteredAddress: reg, OperatingAddress: reg,
			Shareholders: []ShareholderInput{{Type: ShareholderIndividual, Name: "B", Email: "b@x", Phone: "1",
				DateOfBirth: "1980-01-01", Nationality: "NG", Address: reg, OwnershipBps: 10000, ControllingOfficer: true, Role: RoleDirector}},
		}}
	}
	if _, err := BuildOnboardingData(SubjectBusiness, base(), KYCView{}, testExtras()); err != nil {
		t.Fatalf("base should pass: %v", err)
	}
	p := base()
	p.Business = nil
	if _, err := BuildOnboardingData(SubjectBusiness, p, KYCView{}, testExtras()); err == nil {
		t.Fatal("expected error: no business")
	}
	p = base()
	p.Business.Shareholders[0].DateOfBirth = ""
	if _, err := BuildOnboardingData(SubjectBusiness, p, KYCView{}, testExtras()); err == nil {
		t.Fatal("expected error: UBO missing DOB")
	}
	p = base()
	p.Business.Shareholders[0].OwnershipBps = 10001
	if _, err := BuildOnboardingData(SubjectBusiness, p, KYCView{}, testExtras()); err == nil {
		t.Fatal("expected error: ownership > 100%")
	}
	p = base()
	p.Business.Shareholders[0].ControllingOfficer = false
	if _, err := BuildOnboardingData(SubjectBusiness, p, KYCView{}, testExtras()); err == nil {
		t.Fatal("expected error: no controlling officer")
	}
	if _, err := BuildOnboardingData("weird", base(), KYCView{}, testExtras()); err == nil {
		t.Fatal("expected error: unknown subject")
	}
}

func TestBuildOnboardingData_WhitespaceOnlyRejected(t *testing.T) {
	p := Profile{Email: "ada@example.com", Phone: "+234"}
	k := testKYC()
	k.FirstName = "   "
	if _, err := BuildOnboardingData(SubjectIndividual, p, k, testExtras()); err == nil {
		t.Fatal("expected error: whitespace-only first name")
	}
	p2 := Profile{Email: "  ", Phone: "+234"}
	if _, err := BuildOnboardingData(SubjectIndividual, p2, testKYC(), testExtras()); err == nil {
		t.Fatal("expected error: whitespace-only email")
	}
	reg := Address{Line1: "5 Broad St", City: "Lagos", Country: "NG"}
	bp := Profile{Business: &BusinessProfile{
		LegalName: "Acme", RegistrationNumber: "RC1", CompanyType: "LTD", Country: "NG",
		RegisteredAddress: reg, OperatingAddress: reg,
		Shareholders: []ShareholderInput{{Type: ShareholderIndividual, Name: "  ", Email: "b@x", Phone: "1",
			DateOfBirth: "1980-01-01", Nationality: "NG", Address: reg, OwnershipBps: 10000, ControllingOfficer: true, Role: RoleDirector}},
	}}
	if _, err := BuildOnboardingData(SubjectBusiness, bp, KYCView{}, testExtras()); err == nil {
		t.Fatal("expected error: whitespace-only shareholder name")
	}
}

func TestBuildOnboardingData_BusinessShareholderRules(t *testing.T) {
	reg := Address{Line1: "5 Broad St", City: "Lagos", Country: "NG"}
	officer := ShareholderInput{Type: ShareholderIndividual, Name: "B", Email: "b@x", Phone: "1",
		DateOfBirth: "1980-01-01", Nationality: "NG", Address: reg, OwnershipBps: 5000, ControllingOfficer: true, Role: RoleDirector}
	mk := func(extra ...ShareholderInput) Profile {
		return Profile{Business: &BusinessProfile{
			LegalName: "Acme", RegistrationNumber: "RC1", CompanyType: "LTD", Country: "NG",
			RegisteredAddress: reg, OperatingAddress: reg,
			Shareholders: append([]ShareholderInput{officer}, extra...),
		}}
	}
	run := func(p Profile) error {
		_, err := BuildOnboardingData(SubjectBusiness, p, KYCView{}, testExtras())
		return err
	}
	if err := run(mk(ShareholderInput{Type: ShareholderCorporate, Name: "H", RegistrationNo: "R", Country: "GB", OwnershipBps: 1000, ControllingOfficer: true})); err == nil {
		t.Fatal("corporate controlling officer must be rejected")
	}
	if err := run(mk(
		ShareholderInput{Type: ShareholderCorporate, Name: "H1", RegistrationNo: "R", Country: "GB", OwnershipBps: 3000},
		ShareholderInput{Type: ShareholderCorporate, Name: "H2", RegistrationNo: "R2", Country: "GB", OwnershipBps: 2001},
	)); err == nil {
		t.Fatal("multi-holder total > 100% must be rejected")
	}
	if err := run(mk(ShareholderInput{Type: "TRUST", Name: "T", OwnershipBps: 1000})); err == nil {
		t.Fatal("unknown shareholder type must be rejected")
	}
	noRole := mk()
	noRole.Business.Shareholders[0].Role = "  "
	if err := run(noRole); err == nil {
		t.Fatal("controlling officer without role must be rejected")
	}
	if err := run(mk(ShareholderInput{Type: ShareholderIndividual, Name: "Minor Holder", OwnershipBps: 1000})); err != nil {
		t.Fatalf("sub-25%% name-only non-officer should pass: %v", err)
	}
}
