package provider

import "context"

// PaymentProvider abstracts a payment gateway (Paystack, Maplerad, etc.).
type PaymentProvider interface {
	// InitializePayment creates a payment session and returns the authorization URL.
	InitializePayment(ctx context.Context, req InitializePaymentRequest) (*InitializePaymentResponse, error)

	// VerifyPayment checks the status of a payment by its reference.
	VerifyPayment(ctx context.Context, reference string) (*PaymentStatus, error)

	// InitiatePayout sends funds from the platform to a bank account.
	InitiatePayout(ctx context.Context, req PayoutRequest) (*PayoutResponse, error)

	// VerifyWebhookSignature returns true if the payload matches the HMAC signature.
	VerifyWebhookSignature(payload []byte, signature string) bool

	// Name returns the provider identifier (e.g. "paystack").
	Name() string
}

// CardIssuer abstracts a card-issuing gateway (Maplerad, etc.). It covers the card
// LIFECYCLE only — issue / reveal / freeze / terminate. Card FUNDING is NOT here:
// funding stays on the internal double-entry ledger (orch_fx_card_txns). Any
// provider-side settlement of card spend is treasury-level reconciliation and is
// out of scope for this seam.
//
// Provider credentials are server-side only. Card secrets (PAN/CVV) live in the
// provider's PCI-isolated vault and are fetched on demand via RevealCard.
type CardIssuer interface {
	// Name returns the provider identifier (e.g. "maplerad").
	Name() string
	// IssueCard provisions a virtual card at the provider and returns the
	// provider card id plus the non-secret metadata (last4, expiry, brand).
	IssueCard(ctx context.Context, req IssueCardRequest) (*IssuedCard, error)
	// RevealCard fetches the sensitive PAN/CVV/expiry for a provider card id.
	RevealCard(ctx context.Context, providerCardID string) (*CardSecrets, error)
	// SetCardFrozen freezes (true) or unfreezes (false) a provider card.
	SetCardFrozen(ctx context.Context, providerCardID string, frozen bool) error
	// TerminateCard permanently deactivates a provider card.
	TerminateCard(ctx context.Context, providerCardID string) error
}

// IssueCardRequest is the card-issuing request. Amounts (if any) are integer minor
// units; this seam carries no funding amount (funding is ledger-side).
type IssueCardRequest struct {
	Customer       string
	Currency       string
	Brand          string
	Label          string
	CardholderName string
}

// IssuedCard is the non-secret result of issuing a card.
type IssuedCard struct {
	ProviderCardID string
	Last4          string
	Brand          string
	ExpMonth       int
	ExpYear        int
}

// CardSecrets is the sensitive card material fetched on demand from the provider
// vault. Never logged, never persisted.
type CardSecrets struct {
	PAN    string
	CVV    string
	Expiry string
}

// DisbursementProvider abstracts a bank-payout gateway (Paystack, Monnify, …).
// It is an ADDITIVE capability — kept separate from PaymentProvider so existing
// adapters need not change. A single concrete client may satisfy both.
//
// All amounts are integer kobo. Provider credentials are server-side only.
type DisbursementProvider interface {
	// ListBanks returns the provider's supported destination banks.
	ListBanks(ctx context.Context) ([]Bank, error)
	// ResolveAccount performs a name enquiry against a NUBAN + bank code.
	ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*AccountResolution, error)
	// CreateTransferRecipient registers (or returns) a payout recipient code.
	CreateTransferRecipient(ctx context.Context, req RecipientRequest) (*Recipient, error)
	// InitiatePayout sends funds to a previously-created recipient.
	InitiatePayout(ctx context.Context, req PayoutRequest) (*PayoutResponse, error)
	// GetTransferStatus polls the status of a payout by its provider reference.
	GetTransferStatus(ctx context.Context, providerRef string) (*PayoutStatus, error)
	// VerifyWebhookSignature returns true if the payload matches the signature.
	VerifyWebhookSignature(payload []byte, signature string) bool
	// ParseWebhook normalizes a raw provider webhook into a WebhookEvent.
	ParseWebhook(payload []byte) (*WebhookEvent, error)
	// Name returns the provider identifier (e.g. "paystack", "monnify").
	Name() string
}

// VirtualAccountProvider abstracts DVA provisioning.
type VirtualAccountProvider interface {
	// ProvisionVirtualAccount creates a dedicated virtual account for a user.
	ProvisionVirtualAccount(ctx context.Context, req ProvisionVARequest) (*VirtualAccount, error)

	// GetVirtualAccount fetches an existing virtual account by user.
	GetVirtualAccount(ctx context.Context, userID string) (*VirtualAccount, error)

	// Name returns the provider identifier.
	Name() string
}

// --- Request / Response types ---

type InitializePaymentRequest struct {
	Email          string
	AmountKobo     int64
	Reference      string
	CallbackURL    string
	IdempotencyKey string
}

type InitializePaymentResponse struct {
	Reference        string
	AuthorizationURL string
	AccessCode       string
}

type PaymentStatus struct {
	Reference  string
	Status     string // success | failed | pending
	AmountKobo int64
	Channel    string
	PaidAt     *string
}

type PayoutRequest struct {
	RecipientCode  string
	AmountKobo     int64
	Reference      string
	Narration      string
	IdempotencyKey string
}

type PayoutResponse struct {
	TransferCode string
	Status       string
	Reference    string
	// ProviderRef is the provider-side transfer reference used to route inbound
	// webhooks back to the originating transfer (additive for disbursement).
	ProviderRef string
}

// --- Disbursement (multi-provider bank payout) types ---

// Bank is one destination bank in the provider's supported list.
type Bank struct {
	Code string `json:"code"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// AccountResolution is the result of a NUBAN name enquiry.
type AccountResolution struct {
	AccountName   string `json:"account_name"`
	AccountNumber string `json:"account_number"`
	BankCode      string `json:"bank_code"`
}

// RecipientRequest registers a payout recipient with the provider.
type RecipientRequest struct {
	AccountName   string
	AccountNumber string
	BankCode      string
	Currency      string // default "NGN"
}

// Recipient is a provider-side payout recipient.
type Recipient struct {
	Code string `json:"code"`
}

// PayoutStatus is the polled status of a payout.
type PayoutStatus struct {
	Status string `json:"status"`
}

// WebhookEvent is the normalized form of a provider transfer/collection webhook.
type WebhookEvent struct {
	Type        string // "transfer" | "collection" | "bill" | "unknown"
	ProviderRef string // provider transfer ref (routes to bank_transfers)
	Reference   string // our reference echoed back, when present
	Status      string // normalized: successful | failed | reversed | pending
	AmountKobo  int64
	// EventID is the provider-side unique event identifier used by the webhook
	// pipeline to dedupe redeliveries (webhook_event unique key). Additive:
	// providers that don't surface an event id leave this empty and the domain
	// falls back to reading it from the parsed payload.
	EventID string
	// Raw carries the unmodified webhook payload for audit/storage of unknown or
	// not-yet-modeled event types (never dropped). Additive; may be nil.
	Raw []byte
}

type ProvisionVARequest struct {
	UserID      string
	Email       string
	FirstName   string
	LastName    string
	PhoneNumber string
	BVN         string
}

type VirtualAccount struct {
	AccountNumber string
	AccountName   string
	BankName      string
	BankCode      string
}
