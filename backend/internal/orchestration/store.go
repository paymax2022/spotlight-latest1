package orchestration

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"
)

// TxView is the unified-ledger transaction row (spec §5.6 GET /v1/transactions).
type TxView struct {
	ID           string    `json:"id"`
	Reference    string    `json:"reference"`
	Type         string    `json:"type"` // conversion | transfer | collection
	Status       string    `json:"status"`
	Title        string    `json:"title"`
	Source       Money     `json:"source"`
	Destination  Money     `json:"destination"`
	Direction    string    `json:"direction"` // in | out
	Route        Route     `json:"route"`
	QuotedRate   float64   `json:"quotedRate"`
	ExecutedRate float64   `json:"executedRate"`
	Fees         []Fee     `json:"fees"`
	ProviderRef  string    `json:"providerRef"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Store is the persistence boundary for the orchestration ledger and records.
// It guarantees balanced, idempotent money movements (the one ledger, spec §8).
type Store interface {
	Balance(ctx context.Context, customerID, currency string) (int64, error)
	Balances(ctx context.Context, customerID string) ([]Money, error)

	// ApplyConversion debits sourceTotalMinor of the source currency and credits
	// the destination amount, atomically, recording the conversion and its
	// idempotency key. Returns ErrInsufficientBalance (APIError) when short.
	ApplyConversion(ctx context.Context, c *Conversion, sourceTotalMinor int64) error
	ConversionByIdem(ctx context.Context, idemKey string) (*Conversion, bool, error)

	// ApplyTransfer debits sourceTotalMinor of the source currency (payout leaves
	// the platform), recording the transfer and its idempotency key.
	ApplyTransfer(ctx context.Context, t *Transfer, sourceTotalMinor int64) error
	TransferByIdem(ctx context.Context, idemKey string) (*Transfer, bool, error)

	SaveCollection(ctx context.Context, va *VirtualAccount) error
	SaveQuote(ctx context.Context, q *Quote) error

	Transactions(ctx context.Context, customerID string) ([]TxView, error)
	Transaction(ctx context.Context, customerID, id string) (*TxView, bool, error)

	// Global reads for reconciliation + webhook status updates.
	AllConversions(ctx context.Context) ([]*Conversion, error)
	AllTransfers(ctx context.Context) ([]*Transfer, error)
	UpdateConversionStatus(ctx context.Context, reference, status string) error
	UpdateTransferStatus(ctx context.Context, reference, status string) error

	// SeedBalance credits an opening balance (dev/onboarding helper).
	SeedBalance(ctx context.Context, customerID, currency string, amountMinor int64) error

	// OpenWallet makes a currency visible to the customer at a zero balance, so
	// the wallet survives a refetch instead of being a response the server never
	// remembered. Re-opening an existing wallet is a no-op, never a reset.
	OpenWallet(ctx context.Context, customerID, currency string) error

	// VirtualAccountByProviderRef resolves the virtual account an inbound deposit
	// was paid into. ok=false means nothing matched — the caller must NOT credit,
	// because an unmatched deposit has no owner and no currency to credit.
	VirtualAccountByProviderRef(ctx context.Context, provider, ref string) (*VirtualAccount, bool, error)

	// ApplyCollection credits an inbound deposit and records it, atomically.
	// applied=false means a redelivered webhook that was already credited.
	ApplyCollection(ctx context.Context, c *CollectionCredit) (applied bool, err error)
}

// --- in-memory implementation (dev/test; production uses the pgx store) ---

type memStore struct {
	mu          sync.Mutex
	balances    map[string]map[string]int64 // customer -> currency -> minor
	conversions []*Conversion
	transfers   []*Transfer
	collections []*VirtualAccount
	convByIdem  map[string]*Conversion
	trByIdem    map[string]*Transfer
	// collectionByEvent dedupes redelivered collection webhooks by
	// provider:provider_event_id, mirroring the SQL store's unique index.
	collectionByEvent map[string]*CollectionCredit
}

// NewMemStore returns an in-memory Store.
func NewMemStore() Store {
	return &memStore{
		balances:          map[string]map[string]int64{},
		convByIdem:        map[string]*Conversion{},
		trByIdem:          map[string]*Transfer{},
		collectionByEvent: map[string]*CollectionCredit{},
	}
}

func (m *memStore) bal(customer, currency string) int64 {
	if b, ok := m.balances[customer]; ok {
		return b[currency]
	}
	return 0
}

func (m *memStore) credit(customer, currency string, amt int64) {
	if m.balances[customer] == nil {
		m.balances[customer] = map[string]int64{}
	}
	m.balances[customer][currency] += amt
}

func (m *memStore) Balance(_ context.Context, customer, currency string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.bal(customer, currency), nil
}

func (m *memStore) Balances(_ context.Context, customer string) ([]Money, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Money
	for cur, amt := range m.balances[customer] {
		out = append(out, NewMoney(amt, cur))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Currency < out[j].Currency })
	return out, nil
}

func (m *memStore) SeedBalance(_ context.Context, customer, currency string, amt int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.credit(customer, currency, amt)
	return nil
}

func (m *memStore) OpenWallet(_ context.Context, customer, currency string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur := strings.ToUpper(strings.TrimSpace(currency))
	if m.balances[customer] == nil {
		m.balances[customer] = map[string]int64{}
	}
	if _, ok := m.balances[customer][cur]; !ok {
		m.balances[customer][cur] = 0
	}
	return nil
}

func (m *memStore) ApplyConversion(_ context.Context, c *Conversion, sourceTotalMinor int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.bal(c.CustomerID, c.Source.Currency) < sourceTotalMinor {
		return NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient balance for this conversion.")
	}
	m.credit(c.CustomerID, c.Source.Currency, -sourceTotalMinor)
	m.credit(c.CustomerID, c.Destination.Currency, c.Destination.AmountMinor)
	m.conversions = append(m.conversions, c)
	if c.IdempotencyKey != "" {
		m.convByIdem[c.IdempotencyKey] = c
	}
	return nil
}

func (m *memStore) ConversionByIdem(_ context.Context, key string) (*Conversion, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.convByIdem[key]
	return c, ok, nil
}

func (m *memStore) ApplyTransfer(_ context.Context, t *Transfer, sourceTotalMinor int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.bal(t.CustomerID, t.Source.Currency) < sourceTotalMinor {
		return NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient balance for this payout.")
	}
	m.credit(t.CustomerID, t.Source.Currency, -sourceTotalMinor)
	m.transfers = append(m.transfers, t)
	if t.IdempotencyKey != "" {
		m.trByIdem[t.IdempotencyKey] = t
	}
	return nil
}

func (m *memStore) TransferByIdem(_ context.Context, key string) (*Transfer, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.trByIdem[key]
	return t, ok, nil
}

func (m *memStore) VirtualAccountByProviderRef(_ context.Context, provider, ref string) (*VirtualAccount, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if strings.TrimSpace(ref) == "" {
		return nil, false, nil
	}
	for _, va := range m.collections {
		if va.Provider == provider && (va.ProviderRef == ref || va.Details["account_number"] == ref) {
			return va, true, nil
		}
	}
	return nil, false, nil
}

func (m *memStore) ApplyCollection(_ context.Context, c *CollectionCredit) (bool, error) {
	if c.AmountMinor <= 0 {
		return false, NewError(ErrInvalidRequest, "invalid_amount", "Collection amount must be a positive minor-unit value.")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	key := c.Provider + ":" + c.ProviderEventID
	if m.collectionByEvent == nil {
		m.collectionByEvent = map[string]*CollectionCredit{}
	}
	if _, seen := m.collectionByEvent[key]; seen {
		return false, nil // redelivery
	}
	m.collectionByEvent[key] = c
	m.credit(c.CustomerID, strings.ToUpper(c.Currency), c.AmountMinor)
	return true, nil
}

func (m *memStore) SaveCollection(_ context.Context, va *VirtualAccount) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.collections = append(m.collections, va)
	return nil
}

func (m *memStore) SaveQuote(_ context.Context, _ *Quote) error { return nil }

func (m *memStore) AllConversions(_ context.Context) ([]*Conversion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]*Conversion(nil), m.conversions...), nil
}

func (m *memStore) AllTransfers(_ context.Context) ([]*Transfer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]*Transfer(nil), m.transfers...), nil
}

func (m *memStore) UpdateConversionStatus(_ context.Context, reference, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range m.conversions {
		if c.Reference == reference {
			c.Status = ConversionStatus(status)
			return nil
		}
	}
	return nil
}

func (m *memStore) UpdateTransferStatus(_ context.Context, reference, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.transfers {
		if t.Reference == reference {
			t.Status = TransferStatus(status)
			t.StatusHistory = append(t.StatusHistory, StatusEvent{Status: status, At: time.Now()})
			return nil
		}
	}
	return nil
}

func (m *memStore) Transactions(_ context.Context, customer string) ([]TxView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []TxView
	for _, c := range m.conversions {
		if c.CustomerID == customer {
			out = append(out, conversionView(c))
		}
	}
	for _, t := range m.transfers {
		if t.CustomerID == customer {
			out = append(out, transferView(t))
		}
	}
	for _, v := range m.collections {
		if v.CustomerID == customer {
			out = append(out, collectionView(v))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (m *memStore) Transaction(ctx context.Context, customer, id string) (*TxView, bool, error) {
	all, _ := m.Transactions(ctx, customer)
	for i := range all {
		if all[i].ID == id || all[i].Reference == id {
			return &all[i], true, nil
		}
	}
	return nil, false, nil
}

// --- view mappers (shared by mem + sql stores) ---

func conversionView(c *Conversion) TxView {
	return TxView{
		ID: c.ID, Reference: c.Reference, Type: "conversion", Status: string(c.Status),
		Title:  c.Source.Currency + " → " + c.Destination.Currency,
		Source: c.Source, Destination: c.Destination, Direction: "in",
		Route: c.Route, QuotedRate: c.Rate, ExecutedRate: c.AllInRate, Fees: c.Fees,
		ProviderRef: c.ProviderRef, CreatedAt: c.CreatedAt,
	}
}

func transferView(t *Transfer) TxView {
	return TxView{
		ID: t.ID, Reference: t.Reference, Type: "transfer", Status: string(t.Status),
		Title:  "Payout · " + t.Destination.Currency,
		Source: t.Source, Destination: t.Destination, Direction: "out",
		Route: t.Route, QuotedRate: t.QuotedRate, ExecutedRate: t.ExecutedRate, Fees: t.Fees,
		ProviderRef: t.ProviderRef, CreatedAt: t.CreatedAt,
	}
}

func collectionView(v *VirtualAccount) TxView {
	return TxView{
		ID: v.ID, Reference: v.ID, Type: "collection", Status: v.Status,
		Title:     "Collection account · " + v.Currency,
		CreatedAt: v.CreatedAt,
	}
}
