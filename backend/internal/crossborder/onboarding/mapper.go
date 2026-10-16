package onboarding

import (
	"errors"
	"fmt"
	"strings"
)

const (
	// CompanyTypeSoleTrader is the company type used for individual (sole-prop)
	// accounts (design D1).
	CompanyTypeSoleTrader = "SOLE_TRADER"
	// RoleDirector is the shareholder role for the sole-prop owner.
	RoleDirector = "director"

	// FullOwnershipBps is 100% in basis points.
	FullOwnershipBps = 10000
	// UBOThresholdBps is the beneficial-ownership threshold (25%).
	UBOThresholdBps = 2500
)

// DefaultProducts are selected when ActivateExtras.SelectedProducts is empty.
var DefaultProducts = []string{"Collect", "Convert", "Pay", "Hold"}

// BuildOnboardingData maps the Spotlight profile + existing KYC + extras to the
// provider onboarding payload. It fails closed: any missing compliance-relevant
// field is an error, never a silent default.
func BuildOnboardingData(subjectType SubjectType, profile Profile, kyc KYCView, extras ActivateExtras) (OnboardingPayload, error) {
	products := append([]string(nil), extras.SelectedProducts...)
	if len(products) == 0 {
		products = append(products, DefaultProducts...)
	}
	out := OnboardingPayload{
		SubjectType:      subjectType,
		SelectedProducts: products,
		RiskAnswers:      append([]RiskAnswer(nil), extras.RiskAnswers...),
	}
	docs, err := resolveDocs(extras.DocumentTypeIDs, extras.Documents)
	if err != nil {
		return OnboardingPayload{}, err
	}

	switch subjectType {
	case SubjectIndividual:
		sh, company, err := soleProp(profile, kyc)
		if err != nil {
			return OnboardingPayload{}, err
		}
		// The user's ID + address proof attach to the sole shareholder.
		sh.Documents = docs
		out.Company = company
		out.Shareholders = []PayloadShareholder{sh}
	case SubjectBusiness:
		company, shs, err := business(profile, extras)
		if err != nil {
			return OnboardingPayload{}, err
		}
		out.Company = company
		out.Shareholders = shs
		out.Documents = docs
	default:
		return OnboardingPayload{}, fmt.Errorf("onboarding: unknown subject type %q", subjectType)
	}
	return out, nil
}

func soleProp(profile Profile, kyc KYCView) (PayloadShareholder, PayloadCompany, error) {
	name := strings.TrimSpace(kyc.FirstName + " " + kyc.LastName)
	switch {
	case kyc.FirstName == "" || kyc.LastName == "":
		return PayloadShareholder{}, PayloadCompany{}, errors.New("onboarding: KYC legal name is required")
	case kyc.DateOfBirth == "":
		return PayloadShareholder{}, PayloadCompany{}, errors.New("onboarding: KYC date of birth is required")
	case kyc.Nationality == "":
		return PayloadShareholder{}, PayloadCompany{}, errors.New("onboarding: KYC nationality is required")
	case !kyc.Address.complete():
		return PayloadShareholder{}, PayloadCompany{}, errors.New("onboarding: KYC address is required")
	case !kyc.HasBVN && !kyc.HasNIN:
		return PayloadShareholder{}, PayloadCompany{}, errors.New("onboarding: BVN or NIN verification is required")
	case profile.Email == "" || profile.Phone == "":
		return PayloadShareholder{}, PayloadCompany{}, errors.New("onboarding: profile email and phone are required")
	}
	sh := PayloadShareholder{
		Type:               ShareholderIndividual,
		Name:               name,
		Email:              profile.Email,
		Phone:              profile.Phone,
		DateOfBirth:        kyc.DateOfBirth,
		Nationality:        kyc.Nationality,
		Address:            kyc.Address,
		OwnershipBps:       FullOwnershipBps,
		ControllingOfficer: true,
		Role:               RoleDirector,
	}
	company := PayloadCompany{
		LegalName:      name,
		Type:           CompanyTypeSoleTrader,
		Country:        kyc.Address.Country,
		CompanyAddress: kyc.Address,
	}
	return sh, company, nil
}

func business(profile Profile, extras ActivateExtras) (PayloadCompany, []PayloadShareholder, error) {
	b := profile.Business
	if b == nil {
		return PayloadCompany{}, nil, errors.New("onboarding: business details are required")
	}
	switch {
	case b.LegalName == "" || b.RegistrationNumber == "" || b.CompanyType == "" || b.Country == "":
		return PayloadCompany{}, nil, errors.New("onboarding: company name, registration number, type and country are required")
	case !b.RegisteredAddress.complete():
		return PayloadCompany{}, nil, errors.New("onboarding: company registered address is required")
	case !b.OperatingAddress.complete():
		return PayloadCompany{}, nil, errors.New("onboarding: company operating address is required")
	case len(b.Shareholders) == 0:
		return PayloadCompany{}, nil, errors.New("onboarding: at least one shareholder is required")
	}

	total := 0
	officer := false
	shs := make([]PayloadShareholder, 0, len(b.Shareholders))
	for i, in := range b.Shareholders {
		if in.OwnershipBps <= 0 || in.OwnershipBps > FullOwnershipBps {
			return PayloadCompany{}, nil, fmt.Errorf("onboarding: shareholder %d ownership out of range", i)
		}
		total += in.OwnershipBps
		if total > FullOwnershipBps {
			return PayloadCompany{}, nil, errors.New("onboarding: total ownership exceeds 100%")
		}
		if in.Name == "" {
			return PayloadCompany{}, nil, fmt.Errorf("onboarding: shareholder %d name is required", i)
		}
		ubo := in.OwnershipBps >= UBOThresholdBps
		switch in.Type {
		case ShareholderIndividual:
			if (ubo || in.ControllingOfficer) &&
				(in.Email == "" || in.Phone == "" || in.DateOfBirth == "" || in.Nationality == "" || !in.Address.complete()) {
				return PayloadCompany{}, nil, fmt.Errorf("onboarding: shareholder %d requires full identity data", i)
			}
			if in.ControllingOfficer {
				officer = true
			}
		case ShareholderCorporate:
			if in.ControllingOfficer {
				return PayloadCompany{}, nil, fmt.Errorf("onboarding: shareholder %d: a corporate cannot be a controlling officer", i)
			}
			if ubo && (in.RegistrationNo == "" || in.Country == "") {
				return PayloadCompany{}, nil, fmt.Errorf("onboarding: corporate shareholder %d requires registration number and country", i)
			}
		default:
			return PayloadCompany{}, nil, fmt.Errorf("onboarding: shareholder %d has unknown type %q", i, in.Type)
		}
		docs, err := resolveDocs(extras.DocumentTypeIDs, in.Documents)
		if err != nil {
			return PayloadCompany{}, nil, err
		}
		shs = append(shs, PayloadShareholder{
			Type: in.Type, Name: in.Name, Email: in.Email, Phone: in.Phone,
			DateOfBirth: in.DateOfBirth, Nationality: in.Nationality, Address: in.Address,
			RegistrationNo: in.RegistrationNo, Country: in.Country,
			OwnershipBps: in.OwnershipBps, ControllingOfficer: in.ControllingOfficer,
			Role: in.Role, Documents: docs,
		})
	}
	if !officer {
		return PayloadCompany{}, nil, errors.New("onboarding: an individual controlling officer is required")
	}
	return PayloadCompany{
		LegalName:          b.LegalName,
		RegistrationNumber: b.RegistrationNumber,
		Type:               b.CompanyType,
		Country:            b.Country,
		CompanyAddress:     b.RegisteredAddress,
		OperatingAddress:   b.OperatingAddress,
	}, shs, nil
}

// resolveDocs tags each document with its provider type id from config.
func resolveDocs(typeIDs map[DocumentKind]string, refs []DocumentRef) ([]PayloadDocument, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	out := make([]PayloadDocument, 0, len(refs))
	for _, r := range refs {
		id := typeIDs[r.Kind]
		if id == "" {
			return nil, fmt.Errorf("onboarding: no provider document type configured for %q", r.Kind)
		}
		if r.DocumentID == "" {
			return nil, fmt.Errorf("onboarding: document of kind %q has no document id", r.Kind)
		}
		out = append(out, PayloadDocument{TypeID: id, DocumentID: r.DocumentID})
	}
	return out, nil
}
