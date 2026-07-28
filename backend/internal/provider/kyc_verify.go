package provider

import "context"

// Named identifies an adapter for routing, metrics, and audit (e.g. "dojah").
type Named interface {
	Name() string
}

// Multi-provider KYC verification ports (ADR-013). Adapters (Dojah, Smile ID,
// Youverify) implement ONLY the ports they serve; the gateway dispatches per
// check type by config. Everything normalizes to KycCheckResult — the domain
// never sees a provider-specific DTO. This mirrors the existing provider-agnostic
// pattern used by PaymentProvider / MapService.

// KycCheckType is the normalized check category.
type KycCheckType string

const (
	KycIDNumber KycCheckType = "ID_NUMBER"
	KycIDFacial KycCheckType = "ID_FACIAL"
	KycLiveness KycCheckType = "LIVENESS"
	KycDocument KycCheckType = "DOCUMENT"
	KycAML      KycCheckType = "AML"
)

// KycCheckStatus is the normalized per-check status (matches DB CHECK).
type KycCheckStatus string

const (
	KycInitiated KycCheckStatus = "INITIATED"
	KycPending   KycCheckStatus = "PENDING"
	KycPassed    KycCheckStatus = "PASSED"
	KycFailed    KycCheckStatus = "FAILED"
	KycReview    KycCheckStatus = "REVIEW"
)

// KycVerifyRequest is the normalized input to any KYC port. ClientRef is the
// idempotency key that flows through to the provider and back on the webhook.
type KycVerifyRequest struct {
	ClientRef string
	UserID    string
	Type      KycCheckType

	// Identity fields (data-match / facial).
	IDType    string // "bvn" | "nin" | "vnin" | "passport" | "drivers_license" | "pvc"
	IDNumber  string
	FirstName string
	LastName  string
	DOB       string // YYYY-MM-DD

	// Biometric / document capture (base64; adapters upload to the provider).
	SelfieB64    string
	DocFrontB64  string
	DocBackB64   string
	DocType      string // "passport" | "drivers_license" | "national_id" | ...

	// Threshold gates facial PASS vs REVIEW (default from routing rule).
	Threshold int
	Extra     map[string]string
}

// KycCheckResult is the normalized output every adapter returns.
type KycCheckResult struct {
	Status          KycCheckStatus
	Match           bool
	Confidence      float64
	ExtractedFields map[string]string
	Reason          string
	ProviderRef     string // provider job/reference id
	Raw             []byte // raw provider payload (encrypted by the store, not here)
	// Terminal is true when this response is authoritative (sync result); false
	// when the true outcome will arrive via webhook/callback (status = PENDING).
	Terminal bool
}

// KycWebhookEvent is the normalized shape a provider webhook/callback maps to.
type KycWebhookEvent struct {
	Provider    string
	EventID     string // dedupe key (provider event/job id)
	ClientRef   string // correlates back to verification_check.client_ref
	ProviderRef string
	Status      KycCheckStatus
	Match       bool
	Confidence  float64
	Reason      string
	Raw         []byte
}

// ── Ports (capability-scoped) ────────────────────────────────────────────────

// IdNumberPort — BVN/NIN/vNIN/passport/DL/PVC data-match (no image).
type IdNumberPort interface {
	Named
	VerifyIDNumber(ctx context.Context, req KycVerifyRequest) (KycCheckResult, error)
}

// FacialPort — ID + face match (BVN/NIN facial; enhanced KYC + selfie).
type FacialPort interface {
	Named
	VerifyIDFacial(ctx context.Context, req KycVerifyRequest) (KycCheckResult, error)
}

// LivenessPort — selfie anti-spoof / biometric.
type LivenessPort interface {
	Named
	VerifyLiveness(ctx context.Context, req KycVerifyRequest) (KycCheckResult, error)
}

// DocumentPort — OCR + authenticity + face-match on an ID document.
type DocumentPort interface {
	Named
	VerifyDocument(ctx context.Context, req KycVerifyRequest) (KycCheckResult, error)
}

// AmlPort — AML / PEP screening.
type AmlPort interface {
	Named
	ScreenAML(ctx context.Context, req KycVerifyRequest) (KycCheckResult, error)
}

// KycWebhookParser — hardened ingestion: verify signature, then normalize.
type KycWebhookParser interface {
	Named
	VerifyKycSignature(payload []byte, signature string) bool
	ParseKycWebhook(payload []byte) (*KycWebhookEvent, error)
}
