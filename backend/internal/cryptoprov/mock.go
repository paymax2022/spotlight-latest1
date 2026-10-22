package cryptoprov

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// Mock is an in-memory provider for service tests. It is deterministic, honours
// idempotency keys like a real provider should, and lets a test inject errors and
// choose when a swap or withdrawal completes. It must never reach production:
// callers register it only behind the mock flag.
type Mock struct {
	mu       sync.Mutex
	name     string
	now      func() time.Time
	quoteTTL time.Duration

	prices      map[string]decimal.Decimal
	quotes      map[string]SwapQuote
	swaps       map[string]Swap // keyed by swap id
	swapByQuote map[string]string
	withdraws   map[string]Withdrawal // keyed by Reference
	nextID      int
	faults      map[string]error      // keyed by operation name, consumed once
	accounts    map[string]AccountRef // keyed by UserRef.UserID
	created     int
	wallets     map[string][]Wallet // keyed by account id
	deposits    map[string]Deposit  // keyed by deposit id
	addrPending bool
	addrCreates int
}

// AccountsCreated counts provider accounts created, to prove a service never makes a second one.
func (m *Mock) AccountsCreated() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.created
}

// CreateAccount returns a stable account per platform user, creating it once.
func (m *Mock) CreateAccount(_ context.Context, u UserRef) (AccountRef, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("createaccount"); err != nil {
		return AccountRef{}, err
	}
	if a, ok := m.accounts[u.UserID]; ok {
		return a, nil
	}
	m.created++
	a := AccountRef{ID: m.newID("acct")}
	m.accounts[u.UserID] = a
	return a, nil
}

// NewMock returns a mock with the given clock. A nil clock uses time.Now.
func NewMock(name string, now func() time.Time) *Mock {
	if now == nil {
		now = time.Now
	}
	return &Mock{
		name:        name,
		now:         now,
		quoteTTL:    15 * time.Second,
		prices:      map[string]decimal.Decimal{},
		quotes:      map[string]SwapQuote{},
		swaps:       map[string]Swap{},
		swapByQuote: map[string]string{},
		withdraws:   map[string]Withdrawal{},
		faults:      map[string]error{},
		accounts:    map[string]AccountRef{},
		wallets:     map[string][]Wallet{},
		deposits:    map[string]Deposit{},
	}
}

func (m *Mock) Name() string           { return m.name }
func (m *Mock) AssetClass() AssetClass { return AssetClassCrypto }

// SetPrice sets the price for a market such as "BTCNGN".
func (m *Mock) SetPrice(market string, price decimal.Decimal) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prices[market] = price
}

// FailNext makes the next call to op return err, then resumes normal behaviour.
// op is one of: ticker, quote, confirm, getswap, withdraw, getwithdraw.
func (m *Mock) FailNext(op string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.faults[op] = err
}

// CompleteSwap moves a swap to a terminal status, as a provider webhook would.
func (m *Mock) CompleteSwap(swapID string, status SwapStatus) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.swaps[swapID]
	if !ok {
		return ErrNotFound
	}
	s.Status = status
	m.swaps[swapID] = s
	return nil
}

// SetSwapAmount overrides the received amount of an existing swap, to test how a
// service treats a provider that reports completion with a zero amount.
func (m *Mock) SetSwapAmount(swapID string, amt decimal.Decimal) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.swaps[swapID]; ok {
		s.ToAmt = amt
		m.swaps[swapID] = s
	}
}

// CompleteWithdrawal moves a withdrawal to a terminal status.
func (m *Mock) CompleteWithdrawal(reference string, status WithdrawalStatus) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	w, ok := m.withdraws[reference]
	if !ok {
		return ErrNotFound
	}
	w.Status = status
	m.withdraws[reference] = w
	return nil
}

// take consumes an injected fault for op, if any. Caller holds m.mu.
func (m *Mock) take(op string) error {
	err, ok := m.faults[op]
	if !ok {
		return nil
	}
	delete(m.faults, op)
	return err
}

func (m *Mock) newID(prefix string) string {
	m.nextID++
	return fmt.Sprintf("%s_%06d", prefix, m.nextID)
}

// Ticker implements MarketProvider.
func (m *Mock) Ticker(_ context.Context, market string) (Ticker, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("ticker"); err != nil {
		return Ticker{}, err
	}
	p, ok := m.prices[market]
	if !ok {
		return Ticker{}, ErrNotFound
	}
	return Ticker{Market: market, Last: p, At: m.now()}, nil
}

// QuoteSwap implements SwapProvider. The quote price is the market price.
func (m *Mock) QuoteSwap(_ context.Context, req SwapQuoteRequest) (SwapQuote, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("quote"); err != nil {
		return SwapQuote{}, err
	}
	if req.FromAmount.IsPositive() == req.ToAmount.IsPositive() {
		return SwapQuote{}, &APIError{Provider: m.name, Status: 422, Code: "bad_side", Message: "set exactly one amount"}
	}
	price, ok := m.prices[req.From+req.To]
	if !ok {
		return SwapQuote{}, ErrNotFound
	}
	q := SwapQuote{
		QuoteID:   m.newID("qt"),
		From:      req.From,
		To:        req.To,
		Price:     price,
		ExpiresAt: m.now().Add(m.quoteTTL),
	}
	if req.FromAmount.IsPositive() {
		q.FromAmt = req.FromAmount
		q.ToAmt = req.FromAmount.Mul(price)
	} else {
		q.ToAmt = req.ToAmount
		q.FromAmt = req.ToAmount.Div(price)
	}
	m.quotes[q.QuoteID] = q
	return q, nil
}

// ConfirmSwap implements SwapProvider. It is idempotent per quote id: a second
// confirm returns the same swap and never executes twice.
func (m *Mock) ConfirmSwap(_ context.Context, _, quoteID string) (Swap, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("confirm"); err != nil {
		return Swap{}, err
	}
	if id, ok := m.swapByQuote[quoteID]; ok {
		return m.swaps[id], nil
	}
	q, ok := m.quotes[quoteID]
	if !ok {
		return Swap{}, &APIError{Provider: m.name, Status: 404, Code: "quote_not_found", Message: quoteID}
	}
	if m.now().After(q.ExpiresAt) {
		return Swap{}, &APIError{Provider: m.name, Status: 422, Code: "quote_expired", Message: quoteID}
	}
	s := Swap{ID: m.newID("sw"), QuoteID: quoteID, Status: SwapPending, ToAmt: q.ToAmt}
	m.swaps[s.ID] = s
	m.swapByQuote[quoteID] = s.ID
	return s, nil
}

// GetSwap implements SwapProvider.
func (m *Mock) GetSwap(_ context.Context, _, swapID string) (Swap, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("getswap"); err != nil {
		return Swap{}, err
	}
	s, ok := m.swaps[swapID]
	if !ok {
		return Swap{}, ErrNotFound
	}
	return s, nil
}

// Withdraw implements WithdrawalProvider. Reference is the idempotency key: a
// repeated reference returns the original withdrawal, never a second transfer.
func (m *Mock) Withdraw(_ context.Context, req WithdrawRequest) (Withdrawal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("withdraw"); err != nil {
		return Withdrawal{}, err
	}
	if req.Reference == "" {
		return Withdrawal{}, &APIError{Provider: m.name, Status: 422, Code: "reference_required", Message: "reference"}
	}
	if w, ok := m.withdraws[req.Reference]; ok {
		return w, nil
	}
	w := Withdrawal{ID: m.newID("wd"), Status: WithdrawalProcessing}
	m.withdraws[req.Reference] = w
	return w, nil
}

// GetWithdrawal implements WithdrawalProvider, looking up by provider id.
func (m *Mock) GetWithdrawal(_ context.Context, _, id string) (Withdrawal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("getwithdraw"); err != nil {
		return Withdrawal{}, err
	}
	for _, w := range m.withdraws {
		if w.ID == id {
			return w, nil
		}
	}
	return Withdrawal{}, ErrNotFound
}

// SetWallets sets the balances an account reports.
func (m *Mock) SetWallets(accountID string, w ...Wallet) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.wallets[accountID] = append([]Wallet(nil), w...)
}

// Wallets implements WalletProvider.
func (m *Mock) Wallets(_ context.Context, accountID string) ([]Wallet, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("wallets"); err != nil {
		return nil, err
	}
	return append([]Wallet(nil), m.wallets[accountID]...), nil
}

// CreateDepositAddress implements WalletProvider with a deterministic address.
func (m *Mock) CreateDepositAddress(_ context.Context, accountID, currency, network string) (DepositAddress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("depositaddress"); err != nil {
		return DepositAddress{}, err
	}
	m.addrCreates++
	if m.addrPending {
		return DepositAddress{}, ErrAddressPending
	}
	return DepositAddress{Currency: currency, Network: network, Address: fmt.Sprintf("mock-%s-%s-%s", accountID, currency, network)}, nil
}

// DepositAddress implements WalletProvider (a read; same deterministic address as Create).
func (m *Mock) DepositAddress(_ context.Context, accountID, currency, network string) (DepositAddress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.addrPending {
		return DepositAddress{}, ErrAddressPending
	}
	return DepositAddress{Currency: currency, Network: network, Address: fmt.Sprintf("mock-%s-%s-%s", accountID, currency, network)}, nil
}

// AddressCreates counts CreateDepositAddress calls.
func (m *Mock) AddressCreates() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.addrCreates
}

// SetAddressPending makes deposit-address reads report ErrAddressPending.
func (m *Mock) SetAddressPending(p bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.addrPending = p
}

// PutDeposit records (or replaces) the deposit GetDeposit reports.
func (m *Mock) PutDeposit(d Deposit) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deposits[d.ID] = d
}

// GetDeposit implements DepositProvider.
func (m *Mock) GetDeposit(_ context.Context, accountID, id string) (Deposit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.take("getdeposit"); err != nil {
		return Deposit{}, err
	}
	d, ok := m.deposits[id]
	if !ok || d.AccountID != accountID {
		return Deposit{}, &APIError{Provider: m.name, Status: 404, Code: "not_found"}
	}
	return d, nil
}
