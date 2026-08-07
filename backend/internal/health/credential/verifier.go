// Package credential implements provider-agnostic credential verification for the
// health verticals. It introduces the CredentialVerifier interface and the first
// concrete adapter — VCNAdapter (Mode B: document + assisted, ops decides
// out-of-band). The interface is source-agnostic so a future Mode A (official
// VCN API) adapter, or PCN/MLSCN adapters, slot in WITHOUT changing the vet flow:
// the service treats the VerifyResult uniformly (PENDING ⇒ await ops decision;
// VERIFIED/REJECTED ⇒ apply immediately).
//
// HL-1: this is a workflow/identity-binding layer — it never diagnoses, dispenses
// or tests. HL-2: capability is granted only on VERIFIED. NDPA: we persist only a
// result + reference (regNumber, matchedFields, licenceExpiry) and signed-URL doc
// refs — never a copy of any external register.
package credential

import "context"

// Source identifies the issuing register the credential is checked against.
type Source string

const (
	SourceVCN   Source = "VCN"   // Veterinary Council of Nigeria
	SourceMDCN  Source = "MDCN"  // Medical and Dental Council of Nigeria
	SourcePCN   Source = "PCN"   // Pharmacists Council (future)
	SourceMLSCN Source = "MLSCN" // Med Lab Science Council (future)
)

// Method is HOW a credential is verified.
type Method string

const (
	// MethodAssisted (Mode B): the provider submits docs + details in-app; an ops
	// reviewer confirms them out-of-band and records the decision. No external API.
	MethodAssisted Method = "ASSISTED"
	// MethodAPI (Mode A, future): an official register API returns a synchronous
	// verdict. Not built here; the interface accommodates it with no flow change.
	MethodAPI Method = "API"
)

// Outcome is the normalised, source-agnostic verdict a verifier returns.
type Outcome string

const (
	OutcomePending  Outcome = "PENDING"  // assisted: awaiting ops decision
	OutcomeVerified Outcome = "VERIFIED" // api: confirmed by register
	OutcomeRejected Outcome = "REJECTED" // api: not found / invalid
)

// VerifyRequest carries the provider-entered details + uploaded evidence for a
// verification attempt. The verifier NEVER receives raw register data.
type VerifyRequest struct {
	ApplicationID string
	OwnerUserID   string
	Capability    string   // "vet"
	RegNumber     string   // e.g. VCN registration number (entered by the vet)
	FullName      string   // entered, for register cross-check
	DOB           string   // entered (YYYY-MM-DD), for register cross-check
	EvidenceDocs  []string // CredentialDoc ids (VCN_CERT, ANNUAL_LICENCE, GOV_ID)
}

// VerifyResult is the normalised verdict. For ASSISTED it is always PENDING; a
// future API adapter would populate Outcome + LicenceExpiry from the register.
type VerifyResult struct {
	Source        Source
	Method        Method
	Outcome       Outcome
	LicenceExpiry *string // ISO date when the verifier itself can determine it (API mode)
	// Notes carries adapter-side context for the audit/reviewer; never PII.
	Notes string
}

// CredentialVerifier is the one interface every register/method implements.
// Adding PCN/MLSCN, or VCN Mode A, is a new adapter + config — not a flow change.
type CredentialVerifier interface {
	Source() Source
	Method() Method
	// Verify kicks off verification for a submitted application.
	Verify(ctx context.Context, req VerifyRequest) (VerifyResult, error)
}

// VCNAdapter is the Mode B (assisted) verifier for the Veterinary Council of
// Nigeria. It performs NO external call: it records intent and returns PENDING so
// an ops reviewer can confirm out-of-band. A future VCNAPIAdapter (Mode A) would
// implement the same interface with Method()=API and a synchronous Outcome.
type VCNAdapter struct{}

func NewVCNAdapter() *VCNAdapter { return &VCNAdapter{} }

func (a *VCNAdapter) Source() Source { return SourceVCN }
func (a *VCNAdapter) Method() Method { return MethodAssisted }

func (a *VCNAdapter) Verify(_ context.Context, req VerifyRequest) (VerifyResult, error) {
	// Mode B: no register call. The vet never sees the VCN portal; ops confirms
	// out-of-band and records the decision via the service. We return PENDING.
	return VerifyResult{
		Source:  SourceVCN,
		Method:  MethodAssisted,
		Outcome: OutcomePending,
		Notes:   "assisted: awaiting out-of-band ops confirmation against VCN register",
	}, nil
}

// MDCNAdapter is the Mode B (assisted) verifier for the Medical and Dental
// Council of Nigeria — covers both medical doctors and dentists. Like the VCN
// adapter it performs NO external call: the doctor never sees the MDCN portal
// (https://portal.mdcn.gov.ng/get-doctor-status); an ops reviewer confirms the
// MDCN registration out-of-band and records the decision. A future MDCN API
// adapter (Mode A) would implement the same interface with Method()=API.
type MDCNAdapter struct{}

func NewMDCNAdapter() *MDCNAdapter { return &MDCNAdapter{} }

func (a *MDCNAdapter) Source() Source { return SourceMDCN }
func (a *MDCNAdapter) Method() Method { return MethodAssisted }

func (a *MDCNAdapter) Verify(_ context.Context, req VerifyRequest) (VerifyResult, error) {
	return VerifyResult{
		Source:  SourceMDCN,
		Method:  MethodAssisted,
		Outcome: OutcomePending,
		Notes:   "assisted: awaiting out-of-band ops confirmation against MDCN register",
	}, nil
}
