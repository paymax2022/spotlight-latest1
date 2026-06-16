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
	Reference      string
	AuthorizationURL string
	AccessCode     string
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
