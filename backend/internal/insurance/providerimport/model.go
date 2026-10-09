// Package providerimport mirrors the policies the PROVIDER (MyCover) holds for
// our distributor account into insurance_provider_policy, so the admin
// dashboard can show what exists at the provider that is not in Paymax's own
// book (insurance_policy).
//
// It is READ-ONLY with respect to money: it creates nothing at the provider,
// posts nothing to the ledger, touches no wallet, and never writes to
// insurance_policy. The mirror is displayed beside the book, never summed into
// its premium or commission figures.
package providerimport

import (
	"context"
	"errors"
	"time"
)

// Summary is one provider policy, stripped of personal data.
type Summary struct {
	ProviderPolicyRef string    `json:"provider_policy_ref"`
	PolicyNumber      string    `json:"policy_number"`
	ProductID         string    `json:"provider_product_id"`
	ProductName       string    `json:"product_name"`
	Underwriter       string    `json:"underwriter"`
	Status            string    `json:"status"`
	PremiumKobo       int64     `json:"premium_kobo"`
	StartsAt          time.Time `json:"starts_at"`
	ExpiresAt         time.Time `json:"expires_at"`
	CertificateURL    string    `json:"certificate_url"`
	ProviderCreatedAt time.Time `json:"provider_created_at"`
}

// Source lists the provider's policies page by page (1-based).
type Source interface {
	Configured() bool
	ListSummaries(ctx context.Context, page, limit int) (items []Summary, total int, err error)
}

// Row is a mirrored policy plus whether Paymax's own book has the same policy.
type Row struct {
	Summary
	FirstSeenAt  time.Time `json:"first_seen_at"`
	LastSeenAt   time.Time `json:"last_seen_at"`
	InPaymax     bool      `json:"in_paymax"`
	PaymaxPolicy string    `json:"paymax_policy_id,omitempty"`
	PaymaxState  string    `json:"paymax_state,omitempty"`
}

// Overview summarises the mirror. Unmatched premium is informational — it is
// NOT revenue and is never added to the dashboard's gross premium.
type Overview struct {
	Provider        string     `json:"provider"`
	Total           int        `json:"total"`
	InPaymax        int        `json:"in_paymax"`
	NotInPaymax     int        `json:"not_in_paymax"`
	NotInPaymaxKobo int64      `json:"not_in_paymax_premium_kobo"`
	LastSyncedAt    *time.Time `json:"last_synced_at"`
}

// SyncResult reports one sync run.
type SyncResult struct {
	Provider      string    `json:"provider"`
	ProviderTotal int       `json:"provider_total"`
	Fetched       int       `json:"fetched"`
	Inserted      int       `json:"inserted"`
	Updated       int       `json:"updated"`
	SyncedAt      time.Time `json:"synced_at"`
}

// Store persists the mirror.
type Store interface {
	Upsert(ctx context.Context, provider string, s Summary) (inserted bool, err error)
	List(ctx context.Context, provider string, inPaymax *bool, limit, offset int) ([]Row, error)
	Overview(ctx context.Context, provider string) (Overview, error)
}

var (
	// ErrNotConfigured means the provider API key is not set on this server.
	ErrNotConfigured = errors.New("providerimport: provider is not configured")
)
