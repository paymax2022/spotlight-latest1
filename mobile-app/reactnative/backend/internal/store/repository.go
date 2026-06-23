package store

import "paymax/crypto-backend/internal/domain"

// Repository is the persistence seam the HTTP layer and provider adapters depend
// on. The in-memory Store implements it today; a Postgres-backed implementation
// (see ../../migrations) is a drop-in replacement — no handler or adapter change.
//
// Keeping the contract here (not *Store) means swapping storage engines is a
// one-line change in cmd/server.
type Repository interface {
	// Market data
	Assets() []domain.Asset
	Asset(key string) (domain.Asset, bool)

	// Quotes (server-persisted; execution runs against a stored quote)
	PutQuote(q domain.Quote)
	GetQuote(id string) (domain.Quote, bool)
	PutSwapQuote(q domain.SwapQuote)
	GetSwapQuote(id string) (domain.SwapQuote, bool)

	// Idempotency
	Idempotent(key string) (any, bool)
	SaveIdempotent(key string, v any)

	// Portfolio / history
	Portfolio() domain.Portfolio
	Positions() []domain.Position
	Transactions(side string) []domain.TxSummary
	Transaction(id string) (domain.TxDetail, bool)

	// Watchlist
	Watchlist() []domain.Asset
	AddWatch(assetID string)
	RemoveWatch(assetID string)

	// Alerts
	Alerts() []domain.PriceAlert
	CreateAlert(assetID, condition string, target int64, currency string) (domain.PriceAlert, bool)
	DeleteAlert(id string)

	// Address book
	Addresses(symbol string) []domain.Address
	AddAddress(label, symbol, networkID, address string) (domain.Address, bool)
	DeleteAddress(id string)
	AddressByID(id string) (domain.Address, bool)

	// Execution (writes positions + double-entry ledger + history)
	ExecuteBuy(q domain.Quote) (domain.Order, *ExecError)
	ExecuteSell(q domain.Quote) (domain.Order, *ExecError)
	ExecuteSwap(q domain.SwapQuote) (domain.SwapResult, *ExecError)
}

// Compile-time assertion that the in-memory Store satisfies the contract.
var _ Repository = (*Store)(nil)
