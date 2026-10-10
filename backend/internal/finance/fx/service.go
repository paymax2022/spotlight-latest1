package fx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/provider/maplerad"
)

const (
	keyError           = "error"
	msgUnauthenticated = "unauthenticated"
	keyData            = "data"
)

const quoteTTL = 5 * time.Minute

// walletDebitLimiter is the minimal seam for the fail-closed KYC-tier /
// daily-debit gate (mirrors social's walletDebitLimiter). A conversion's source
// leg is a wallet DEBIT, so the STRICT gate applies — the Tier-0 checkout
// allowance (ADR-043) does NOT.
type walletDebitLimiter interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// ErrTierGateUnwired is returned when a Service has no tier gate — a nil gate
// must fail CLOSED, never debit ungated (mirrors social.ErrTierGateUnwired).
var ErrTierGateUnwired = errors.New("fx: money path requires a tier gate (not wired)")

// ErrQuoteNotFound is returned when a conversion references a quote id that does
// not exist for this user — or one that is not a uuid at all (a malformed id can
// never name a row, so it gets the same 404, never a raw driver error → 500).
var ErrQuoteNotFound = errors.New("fx: quote not found")

// ErrConversionNotFound is returned when a conversion lookup by id or
// idempotency key misses. Convert's replay paths surface it as a clean 404 —
// never a raw pgx.ErrNoRows → 500.
var ErrConversionNotFound = errors.New("fx: conversion not found")

// ErrInvalidCurrency is returned when a currency code is not a 3-letter ISO
// 4217 code. Currency is normalized (trimmed + uppercased) BEFORE the check so
// 'ngn' and 'NGN' resolve to the same row — the CHECK constraint on
// currency_wallets.currency would otherwise 500 on 'ZZZ9' and the naive upsert
// would store a second, lowercase wallet.
var ErrInvalidCurrency = errors.New("fx: currency must be a 3-letter ISO code")

// normalizeCurrency canonicalises a currency code for storage/lookup.
func normalizeCurrency(c string) string { return strings.ToUpper(strings.TrimSpace(c)) }

// validCurrency reports whether c is a plausible ISO 4217 alphabetic code.
func validCurrency(c string) bool {
	if len(c) != 3 {
		return false
	}
	for _, r := range c {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

// Service manages FX quotes, conversions, and currency wallets.
type Service struct {
	db         *pgxpool.Pool
	ledger     *ledger.Service
	provider   *maplerad.Client
	redis      *goredis.Client    // for quote reservation
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	markup     MarkupResolver     // Paymax FX markup; never nil after NewService
	tiers      walletDebitLimiter
}

// NewService builds the FX service. The tier-limit gate is constructed from the
// same pool (tiers.NewService needs only the DB), so no extra wiring is required
// at the call site — same convention as social.NewService. A nil pool leaves the
// gate nil, and enforceDebitLimit then fails closed via ErrTierGateUnwired.
func NewService(db *pgxpool.Pool, ledger *ledger.Service, provider *maplerad.Client, redis *goredis.Client) *Service {
	s := &Service{db: db, ledger: ledger, provider: provider, redis: redis, markup: DefaultMarkup()}
	if db != nil {
		s.tiers = tiers.NewService(db)
	}
	return s
}

// WithTiers injects a pre-configured tier gate (app-wiring / tests). A nil
// argument is ignored so an unwired injection can never strip the gate.
func (s *Service) WithTiers(t walletDebitLimiter) *Service {
	if t != nil {
		s.tiers = t
	}
	return s
}

// enforceDebitLimit is the fail-closed guard before the Convert source debit
// (E2E-FIN-046) — the same EnforceWalletDebitLimit the transfer rail runs; a
// missing gate refuses via ErrTierGateUnwired. The error propagates UNWRAPPED
// so the handler maps tier sentinels to 403 via errors.Is.
func (s *Service) enforceDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	if s.tiers == nil {
		return ErrTierGateUnwired
	}
	return s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo)
}

// SetMarkup overrides the Paymax FX markup resolver (app-wiring injects the
// DB-backed MarkupStore; tests pin a static Markup). A nil argument is ignored so
// the service can never end up without one.
func (s *Service) SetMarkup(m MarkupResolver) {
	if m != nil {
		s.markup = m
	}
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (local interface so fx never imports commission; mirrors transport).
// It records realized profit ONLY and never moves money — the injected recorder
// is built WITHOUT a ledger so it appends the immutable earning row only.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized profit for a completed conversion.
// Best-effort: nil-safe and errors are swallowed so it can never fail/reverse
// the conversion. The actual earning is the FeeKobo, NOT a % of principal, so
// RecordExact is used; the conversion id is source ref + idempotency key.
func (s *Service) recordCommissionSafe(ctx context.Context, grossKobo, feeKobo int64, sourceRef string, userID *string) {
	if s.commission == nil || feeKobo <= 0 {
		return
	}
	if err := s.commission.RecordExact(ctx, "Finance", "Currency Exchange", "", grossKobo, feeKobo,
		"fx", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[fx] commission record (source=%s gross=%d fee=%d) failed, continuing: %v", sourceRef, grossKobo, feeKobo, err)
	}
}

// GetCurrencyWallet reads the user's wallet projection for a currency.
// PURE READ — a GET must never write (a SELECT…else-INSERT here was a side
// effect on a read). The row is materialised lazily by the first conversion's
// mirror (mirrorCurrencyWalletTx), so an absent row is not an error: its
// balance projection is genuinely zero and a zero-balance view is returned
// unpersisted.
// The currency is normalized + validated first, so 'ngn'/'NGN' resolve to the
// same row and a non-code like 'ZZZ9' is refused before it can ever reach the
// CHECK constraint.
func (s *Service) GetCurrencyWallet(ctx context.Context, userID, currency string) (*CurrencyWallet, error) {
	currency = normalizeCurrency(currency)
	if !validCurrency(currency) {
		return nil, ErrInvalidCurrency
	}
	const fetch = `SELECT id, user_id, currency, balance_minor, created_at FROM currency_wallets WHERE user_id=$1 AND currency=$2`
	w := &CurrencyWallet{}
	err := s.db.QueryRow(ctx, fetch, userID, currency).
		Scan(&w.ID, &w.UserID, &w.Currency, &w.BalanceMinor, &w.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return &CurrencyWallet{UserID: userID, Currency: currency}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("fx: get currency wallet user=%s currency=%s: %w", userID, currency, err)
	}
	return w, nil
}

// GetQuote obtains an FX rate from Maplerad, stores it, and reserves it in Redis.
func (s *Service) GetQuote(ctx context.Context, userID string, req QuoteRequest) (*FXQuote, error) {
	// CreateFXQuote (not the /fx/rates board): Convert needs the provider
	// reference the board never issues. Maplerad's reference is single-use and
	// expires, so a Convert after quoteTTL fails closed.
	providerResp, err := s.provider.CreateFXQuote(ctx, maplerad.FXQuoteRequest{
		SourceCurrency: req.SourceCurrency,
		TargetCurrency: req.TargetCurrency,
		AmountKobo:     req.AmountKobo,
	})
	if err != nil {
		return nil, fmt.Errorf("fx: get quote: %w", err)
	}

	// Maplerad prices its margin into the rate (no fee field), so the customer
	// fee is OUR markup on the source principal. It is persisted on the quote so
	// Convert debits the disclosed amount even if the markup changes meanwhile.
	// Fail closed: an unresolvable rate refuses rather than charging a fee
	// nobody configured.
	feeKobo, err := s.markup.FeeMinor(ctx, req.SourceCurrency, req.TargetCurrency, req.AmountKobo)
	if err != nil {
		return nil, fmt.Errorf("fx: resolve markup: %w", err)
	}

	expiresAt := time.Now().Add(quoteTTL)
	q := &FXQuote{
		ID:                uuid.New().String(),
		UserID:            userID,
		ProviderQuoteID:   providerResp.QuoteID,
		SourceCurrency:    req.SourceCurrency,
		TargetCurrency:    req.TargetCurrency,
		SourceAmountKobo:  req.AmountKobo,
		TargetAmountMinor: providerResp.TargetAmountMinor,
		Rate:              providerResp.Rate,
		FeeKobo:           feeKobo,
		ExpiresAt:         expiresAt,
		CreatedAt:         time.Now(),
	}

	const insert = `
		INSERT INTO fx_quotes (id, user_id, provider_quote_id, source_currency, target_currency,
		    source_amount_kobo, target_amount_minor, rate, fee_kobo, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	if _, err := s.db.Exec(ctx, insert,
		q.ID, q.UserID, q.ProviderQuoteID, q.SourceCurrency, q.TargetCurrency,
		q.SourceAmountKobo, q.TargetAmountMinor, q.Rate, q.FeeKobo, q.ExpiresAt,
	); err != nil {
		return nil, fmt.Errorf("fx: store quote: %w", err)
	}

	if s.redis != nil {
		_ = s.redis.SetEx(ctx, "fx:quote:"+q.ID, q.ID, quoteTTL).Err()
	}
	return q, nil
}

// Convert executes the FX conversion for a valid, unexpired quote.
// Money-path invariants (docs/qa/money-paths.md):
//   - RISK-FX-2: the whole conversion is idempotent on req.IdempotencyKey —
//     replays return the existing row; ledger legs carry ":debit"/":credit"
//     suffixed keys; UNIQUE(idempotency_key) + ON CONFLICT means concurrent
//     identical Converts can never double-credit the target wallet.
//   - RISK-FX-1: both legs post balanced double-entries (source = user-wallet
//     Debit; target = DR settlement → CR fx-spread). currency_wallets is NEVER
//     a bare UPDATE — only a mirror of the target leg in the same tx as the
//     conversion row, so the projection cannot drift.
//   - RISK-FX-3: provider failure reverses the full debit (fail-closed); the
//     mirror + conversion row commit in ONE tx so a crash cannot leave a
//     credited wallet with no conversion record (or vice-versa).
func (s *Service) Convert(ctx context.Context, userID string, req ConvertRequest) (*FXConversion, error) {
	// Fast replay short-circuit — an optimisation only; the durable guard is the
	// UNIQUE(idempotency_key) ON CONFLICT insert below (no TOCTOU dependency).
	var existingID string
	const checkDup = `SELECT id FROM fx_conversions WHERE idempotency_key=$1 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, req.IdempotencyKey).Scan(&existingID)
	if existingID != "" {
		return s.getConversion(ctx, existingID)
	}

	q, err := s.getQuote(ctx, req.QuoteID, userID)
	if err != nil {
		return nil, err
	}
	if time.Now().After(q.ExpiresAt) {
		return nil, fmt.Errorf("fx: quote %s has expired", req.QuoteID)
	}

	totalDebitKobo := q.SourceAmountKobo + q.FeeKobo
	reference := "fx:" + uuid.New().String()

	// Tier gate on the TOTAL debit (source+fee) BEFORE money moves — a refusal
	// posts zero ledger legs (E2E-FIN-046). Completed replays short-circuit on
	// the fx_conversions row above; the ledger probe covers the remaining case
	// (F2): a retry whose debit committed but whose conversion row never
	// inserted converges through DebitGated's in-tx replay verification.
	if posted, err := s.ledger.Posted(ctx, req.IdempotencyKey+":debit"); err != nil {
		return nil, err
	} else if !posted {
		if err := s.enforceDebitLimit(ctx, userID, totalDebitKobo); err != nil {
			return nil, err
		}
	}

	// idempotent on req.IdempotencyKey+":debit". ErrDuplicate on a replay is success.
	fxSpreadAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFXSpreadIncome)
	if err != nil {
		return nil, err
	}
	if err := s.ledger.DebitGated(ctx, userID, reference, req.IdempotencyKey+":debit", fxSpreadAcc.ID, totalDebitKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return nil, fmt.Errorf("fx: debit source wallet: %w", err)
	}

	// Maplerad's exchange endpoint has no client-reference field; our reference
	// guards the ledger legs, not the provider call.
	convResp, err := s.provider.ConvertFX(ctx, maplerad.ConvertFXRequest{
		QuoteID: q.ProviderQuoteID,
	})
	if err != nil {
		// Provider failed after the debit — reverse it (fail-closed, net-zero).
		_ = s.postReversal(ctx, userID, reference, req.IdempotencyKey, totalDebitKobo, fxSpreadAcc.ID)
		return nil, fmt.Errorf("fx: provider convert: %w", err)
	}

	// Target leg: DR settlement → CR fx-spread, keyed ":credit" (RISK-FX-1);
	// currency_wallets is only a mirror of this post inside the conversion tx.
	settlementAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, err
	}
	if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       reference,
		IdempotencyKey:  req.IdempotencyKey + ":credit",
		AmountKobo:      convResp.TargetAmountMinor,
		DebitAccountID:  settlementAcc.ID,
		CreditAccountID: fxSpreadAcc.ID,
	}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return nil, fmt.Errorf("fx: post target-leg journal: %w", err)
	}

	conv := &FXConversion{
		ID:                uuid.New().String(),
		UserID:            userID,
		QuoteID:           q.ID,
		ProviderTxnID:     convResp.TransactionID,
		SourceCurrency:    q.SourceCurrency,
		TargetCurrency:    q.TargetCurrency,
		SourceAmountKobo:  q.SourceAmountKobo,
		TargetAmountMinor: convResp.TargetAmountMinor,
		Rate:              convResp.Rate,
		FeeKobo:           q.FeeKobo,
		Status:            "completed",
		Reference:         reference,
		IdempotencyKey:    req.IdempotencyKey,
		CreatedAt:         time.Now(),
	}

	// Conversion row + wallet mirror commit in ONE tx gated by
	// UNIQUE(idempotency_key) (RISK-FX-3). A lost race skips the mirror and
	// returns the persisted conversion — never a double credit.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("fx: begin conversion tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertConv = `
		INSERT INTO fx_conversions (id, user_id, quote_id, provider_txn_id, source_currency, target_currency,
		    source_amount_kobo, target_amount_minor, rate, fee_kobo, status, reference, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',$11,$12)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id`
	var insertedID string
	err = tx.QueryRow(ctx, insertConv,
		conv.ID, conv.UserID, conv.QuoteID, conv.ProviderTxnID,
		conv.SourceCurrency, conv.TargetCurrency,
		conv.SourceAmountKobo, conv.TargetAmountMinor, conv.Rate, conv.FeeKobo,
		conv.Reference, conv.IdempotencyKey,
	).Scan(&insertedID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost the race — idempotent replay: skip the mirror, return existing.
		_ = tx.Rollback(ctx)
		return s.getConversionByKey(ctx, req.IdempotencyKey)
	}
	if err != nil {
		return nil, fmt.Errorf("fx: store conversion: %w", err)
	}

	if err := s.mirrorCurrencyWalletTx(ctx, tx, userID, q.TargetCurrency, convResp.TargetAmountMinor); err != nil {
		return nil, fmt.Errorf("fx: mirror target wallet: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("fx: commit conversion tx: %w", err)
	}
	// Only reached on a genuinely new conversion — replays return earlier, so
	// profit is never double-counted.
	s.recordCommissionSafe(ctx, conv.SourceAmountKobo, conv.FeeKobo, conv.ID, &conv.UserID)
	return conv, nil
}

// ListConversions returns the FX history for a user.
func (s *Service) ListConversions(ctx context.Context, userID string, limit, offset int) ([]FXConversion, error) {
	const q = `
		SELECT id, user_id, quote_id, provider_txn_id, source_currency, target_currency,
		       source_amount_kobo, target_amount_minor, rate, fee_kobo, status, reference, idempotency_key, created_at
		FROM fx_conversions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// [] not nil: a user with no conversions must read as an empty list —
	// `conversions:null` breaks clients iterating the field and diverges from
	// the other list endpoints, which answer [].
	out := make([]FXConversion, 0)
	for rows.Next() {
		var c FXConversion
		if err := rows.Scan(
			&c.ID, &c.UserID, &c.QuoteID, &c.ProviderTxnID, &c.SourceCurrency, &c.TargetCurrency,
			&c.SourceAmountKobo, &c.TargetAmountMinor, &c.Rate, &c.FeeKobo, &c.Status, &c.Reference, &c.IdempotencyKey, &c.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Service) getQuote(ctx context.Context, id, userID string) (*FXQuote, error) {
	const q = `
		SELECT id, user_id, provider_quote_id, source_currency, target_currency,
		       source_amount_kobo, target_amount_minor, rate, fee_kobo, expires_at, created_at
		FROM fx_quotes WHERE id=$1 AND user_id=$2`
	fq := &FXQuote{}
	err := s.db.QueryRow(ctx, q, id, userID).Scan(
		&fq.ID, &fq.UserID, &fq.ProviderQuoteID, &fq.SourceCurrency, &fq.TargetCurrency,
		&fq.SourceAmountKobo, &fq.TargetAmountMinor, &fq.Rate, &fq.FeeKobo, &fq.ExpiresAt, &fq.CreatedAt,
	)
	if err != nil {
		// Bogus quote_id — a fabricated/expired id or a non-uuid string can
		// never name this user's quote: 404, not a raw pgx error → 500.
		if errors.Is(err, pgx.ErrNoRows) || dbutil.SQLState(err) == "22P02" {
			return nil, ErrQuoteNotFound
		}
		return nil, err
	}
	return fq, nil
}

func (s *Service) getConversion(ctx context.Context, id string) (*FXConversion, error) {
	const q = `SELECT id, user_id, quote_id, provider_txn_id, source_currency, target_currency, source_amount_kobo, target_amount_minor, rate, fee_kobo, status, reference, idempotency_key, created_at FROM fx_conversions WHERE id=$1`
	c := &FXConversion{}
	err := s.db.QueryRow(ctx, q, id).Scan(
		&c.ID, &c.UserID, &c.QuoteID, &c.ProviderTxnID, &c.SourceCurrency, &c.TargetCurrency,
		&c.SourceAmountKobo, &c.TargetAmountMinor, &c.Rate, &c.FeeKobo, &c.Status, &c.Reference, &c.IdempotencyKey, &c.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConversionNotFound
	}
	return c, err
}

// mirrorCurrencyWalletTx updates the currency_wallets projection as a MIRROR of
// the posted target-leg entry, inside the caller's tx with the fx_conversions
// insert (UNIQUE idempotency key). It is never called on its own: the row moves
// only when a ledger post + conversion record commit together (RISK-FX-1/2/3).
// This upsert is also what materialises the wallet row lazily — the GET
// surface (GetCurrencyWallet) is a pure read and never writes it.
func (s *Service) mirrorCurrencyWalletTx(ctx context.Context, tx pgx.Tx, userID, currency string, amountMinor int64) error {
	currency = normalizeCurrency(currency) // canonical code — never a lowercase twin row
	const upsert = `
		INSERT INTO currency_wallets (user_id, currency, balance_minor)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, currency)
		DO UPDATE SET balance_minor = currency_wallets.balance_minor + EXCLUDED.balance_minor`
	_, err := tx.Exec(ctx, upsert, userID, currency, amountMinor)
	return err
}

func (s *Service) getConversionByKey(ctx context.Context, idempotencyKey string) (*FXConversion, error) {
	const q = `SELECT id, user_id, quote_id, provider_txn_id, source_currency, target_currency, source_amount_kobo, target_amount_minor, rate, fee_kobo, status, reference, idempotency_key, created_at FROM fx_conversions WHERE idempotency_key=$1`
	c := &FXConversion{}
	err := s.db.QueryRow(ctx, q, idempotencyKey).Scan(
		&c.ID, &c.UserID, &c.QuoteID, &c.ProviderTxnID, &c.SourceCurrency, &c.TargetCurrency,
		&c.SourceAmountKobo, &c.TargetAmountMinor, &c.Rate, &c.FeeKobo, &c.Status, &c.Reference, &c.IdempotencyKey, &c.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConversionNotFound
	}
	return c, err
}

func (s *Service) postReversal(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64, creditAccountID string) error {
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFXSpreadIncome)
	if err != nil {
		return err
	}
	return s.ledger.Credit(ctx, userID, "fx:reversal:"+reference, idempotencyKey+":reversal", revAcc.ID, amountKobo)
}

// CurrencyWallet is a user's balance in a non-NGN currency.
type CurrencyWallet struct {
	// id is omitted on the unpersisted zero-balance view GetCurrencyWallet
	// returns for a currency with no row yet — "" would masquerade as a real id.
	ID           string    `json:"id,omitempty"`
	UserID       string    `json:"user_id"`
	Currency     string    `json:"currency"`      // ISO 4217: "USD", "GBP", "EUR"
	BalanceMinor int64     `json:"balance_minor"` // cents/pence/cents in minor units
	CreatedAt    time.Time `json:"created_at"`
}

// FXQuote holds a Maplerad rate quote that is Redis-reserved with a TTL.
type FXQuote struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	ProviderQuoteID   string    `json:"provider_quote_id"`
	SourceCurrency    string    `json:"source_currency"`
	TargetCurrency    string    `json:"target_currency"`
	SourceAmountKobo  int64     `json:"source_amount_kobo"`
	TargetAmountMinor int64     `json:"target_amount_minor"`
	Rate              float64   `json:"rate"`
	FeeKobo           int64     `json:"fee_kobo"`
	ExpiresAt         time.Time `json:"expires_at"`
	CreatedAt         time.Time `json:"created_at"`
}

// FXConversion is the executed record of a currency exchange.
type FXConversion struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	QuoteID           string    `json:"quote_id"`
	ProviderTxnID     string    `json:"provider_txn_id"`
	SourceCurrency    string    `json:"source_currency"`
	TargetCurrency    string    `json:"target_currency"`
	SourceAmountKobo  int64     `json:"source_amount_kobo"`
	TargetAmountMinor int64     `json:"target_amount_minor"`
	Rate              float64   `json:"rate"`
	FeeKobo           int64     `json:"fee_kobo"`
	Status            string    `json:"status"` // pending | completed | failed
	Reference         string    `json:"reference"`
	IdempotencyKey    string    `json:"idempotency_key"`
	CreatedAt         time.Time `json:"created_at"`
}

// QuoteRequest is the body for POST /finance/fx/quote.
type QuoteRequest struct {
	SourceCurrency string `json:"source_currency" binding:"required"`
	TargetCurrency string `json:"target_currency" binding:"required"`
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100"`
}

// ConvertRequest is the body for POST /finance/fx/convert.
type ConvertRequest struct {
	QuoteID string `json:"quote_id" binding:"required"`
	// Not binding-required: the Idempotency-Key header supplies it for header-only
	// callers, and Convert merges the header before validating non-empty.
	IdempotencyKey string `json:"idempotency_key"`
}

// RateResponse is returned from GET /finance/fx/rates.
type RateResponse struct {
	SourceCurrency string  `json:"source_currency"`
	TargetCurrency string  `json:"target_currency"`
	Rate           float64 `json:"rate"`
	UpdatedAt      string  `json:"updated_at"`
}

// Handler exposes FX endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetQuote handles POST /finance/fx/quote
func (h *Handler) GetQuote(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	var req QuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	quote, err := h.svc.GetQuote(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, quote)
}

// Convert handles POST /finance/fx/convert
func (h *Handler) Convert(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	var req ConvertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if k := ginutil.IdempotencyKey(c); k != "" {
		req.IdempotencyKey = k
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key required"})
		return
	}
	conv, err := h.svc.Convert(c.Request.Context(), userID, req)
	if err != nil {
		// Tier-limit refusals → 403 (same mapping the transfer rail uses);
		// an unwired/degraded gate is a dependency failure → 503 (E2E-FIN-046).
		switch {
		case errors.Is(err, ErrQuoteNotFound), errors.Is(err, ErrConversionNotFound):
			c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		case errors.Is(err, tiers.ErrWalletDisabled), errors.Is(err, tiers.ErrDailyLimitExceeded):
			c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		case errors.Is(err, ErrTierGateUnwired):
			c.JSON(http.StatusServiceUnavailable, gin.H{keyError: httperr.Msg(c, http.StatusServiceUnavailable, err)})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		}
		return
	}
	c.JSON(http.StatusOK, conv)
}

// ListHistory handles GET /finance/fx/history
func (h *Handler) ListHistory(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	history, err := h.svc.ListConversions(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"conversions": history, "limit": limit, "offset": offset})
}

// GetWallet handles GET /finance/fx/wallets/:currency — a pure read (never
// creates the row; the projection is zero until the first conversion writes it).
func (h *Handler) GetWallet(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	currency := c.Param("currency")
	w, err := h.svc.GetCurrencyWallet(c.Request.Context(), userID, currency)
	if err != nil {
		if errors.Is(err, ErrInvalidCurrency) {
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, w)
}

// MarkupHandler is the admin console for the Paymax FX markup
// (RBAC finance.admin.fx_markup). Operators work in PERCENT; the store keeps
// integer basis points.
type MarkupHandler struct {
	store *MarkupStore
}

// NewMarkupHandler builds the admin handler over a markup store.
func NewMarkupHandler(store *MarkupStore) *MarkupHandler { return &MarkupHandler{store: store} }

// SetMarkupRequest is the admin payload for PUT /api/finance/admin/fx/markup.
// RatePercent is a json.Number so the submitted literal survives parsing: "1.15"
// stays "1.15" and converts to exactly 115 bps, where a float64 round-trip yields
// 114.999…. Corridor defaults to the DEFAULT row and Tier to "" (any tier), so
// the common case ("set the platform rate to 1%") is a one-field body.
// Tier only affects the orchestration surface, which prices per customer tier;
// the legacy wallet FX service always resolves the tier-agnostic rows (ADR-032).
type SetMarkupRequest struct {
	Corridor    string      `json:"corridor"`
	Tier        string      `json:"tier"`
	RatePercent json.Number `json:"ratePercent" binding:"required"`
	Active      *bool       `json:"active"`
	Notes       string      `json:"notes"`
	Note        string      `json:"note"` // free-text reason, recorded in the audit row
}

// ListRates handles GET /api/finance/admin/fx/markup.
func (h *MarkupHandler) ListRates(c *gin.Context) {
	rates, err := h.store.ListRates(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: rates})
}

// SetRate handles PUT /api/finance/admin/fx/markup.
// This changes what every customer pays on FX, so it is deliberately strict: an
// unparseable, too-precise, or out-of-range percentage is a 400 with a message
// naming the limit, never a silent clamp to something we invented.
func (h *MarkupHandler) SetRate(c *gin.Context) {
	var req SetMarkupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	bps, err := PercentToBPS(req.RatePercent.String())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	corridor := req.Corridor
	if NormalizeCorridor(corridor) == "" {
		corridor = DefaultCorridor
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}

	rate, err := h.store.SetRate(c.Request.Context(), corridor, req.Tier, bps, active,
		req.Notes, ginutil.UserID(c), req.Note)
	if err != nil {
		if errors.Is(err, ErrMarkupOutOfRange) {
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: rate})
}

// ListAudit handles GET /api/finance/admin/fx/markup/audit?corridor=&limit=.
func (h *MarkupHandler) ListAudit(c *gin.Context) {
	limit := ptr.DerefZero(ginutil.IntParam(c, "limit"))
	entries, err := h.store.ListAudit(c.Request.Context(), c.Query("corridor"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: entries})
}

// Paymax FX markup. Maplerad prices its margin into the rate (no `fee` field on
// the wire), so Paymax revenue here is an EXPLICIT markup, operator-tunable via
// public.fx_markup_rates / PUT /api/finance/admin/fx/markup (ADR-030).
// Operators work in PERCENT; the store keeps integer BASIS POINTS and
// conversion is exact rational arithmetic — a float percent would make the
// charged fee non-reproducible. The markup is charged ON TOP of the principal:
// Convert debits SourceAmountKobo + FeeKobo, keeping the journal balanced.

// DefaultCorridor is the rate row applied to any corridor without its own
// override. Mirrors the seeded 'DEFAULT' row in fx_markup_rates.
const DefaultCorridor = "DEFAULT"

// DefaultMarkupBPS is the fallback markup (1%) used when no rate store is wired.
// The live value is the 'DEFAULT' row in fx_markup_rates.
const DefaultMarkupBPS = 100

// MaxMarkupBPS is a fat-finger ceiling (10%), mirroring the CHECK constraint on
// fx_markup_rates.rate_bps. It is not a pricing decision — it exists so a
// mistyped "100" (meaning 1%) cannot charge 100% of the principal.
const MaxMarkupBPS = 1000

// ErrMarkupOutOfRange is returned when a submitted rate is negative or above
// MaxMarkupBPS.
var ErrMarkupOutOfRange = errors.New("fx: markup rate must be between 0% and 10%")

// ErrMarkupTooPrecise is returned when a submitted percentage is finer than
// 0.01% (one basis point), which the integer store cannot represent exactly.
var ErrMarkupTooPrecise = errors.New("fx: markup percentage cannot be finer than 0.01%")

// MarkupResolver returns the Paymax markup for a corridor, in the SOURCE
// currency's minor units. Implemented by the static Markup (tests, fallback) and
// by the DB-backed store (production).
// An error MUST fail the quote rather than default to some other rate: charging a
// fee we cannot confirm is worse than not quoting.
type MarkupResolver interface {
	FeeMinor(ctx context.Context, source, target string, amountMinor int64) (int64, error)
}

// MarkupRule overrides the default markup for one corridor ("USD-NGN").
type MarkupRule struct {
	Corridor string
	BPS      int
}

// Markup is a static, in-memory MarkupResolver. Production wires the DB-backed
// store instead; this is the fallback when none is configured, and what tests pin
// so they assert behaviour rather than production pricing.
type Markup struct {
	defaultBPS int
	rules      map[string]int
}

// NewMarkup builds a static markup with a flat default and optional per-corridor
// overrides. A negative default is clamped to zero and negative overrides are
// dropped: a markup may be zero (no Paymax margin) but never negative, which
// would pay the customer to convert.
func NewMarkup(defaultBPS int, rules ...MarkupRule) *Markup {
	if defaultBPS < 0 {
		defaultBPS = 0
	}
	m := &Markup{defaultBPS: defaultBPS, rules: make(map[string]int, len(rules))}
	for _, r := range rules {
		if r.BPS < 0 {
			continue
		}
		m.rules[NormalizeCorridor(r.Corridor)] = r.BPS
	}
	return m
}

// DefaultMarkup is the fallback rate table (a flat 1%) used when no rate store is
// wired. The operator-visible source of truth is fx_markup_rates.
func DefaultMarkup() *Markup { return NewMarkup(DefaultMarkupBPS) }

// NormalizeCorridor canonicalises a "usd-ngn" style corridor label.
func NormalizeCorridor(corridor string) string {
	return strings.ToUpper(strings.TrimSpace(corridor))
}

// CorridorKey builds the canonical corridor label for a currency pair.
func CorridorKey(source, target string) string {
	return NormalizeCorridor(source) + "-" + NormalizeCorridor(target)
}

// BPS returns the effective markup in basis points for a corridor.
func (m *Markup) BPS(source, target string) int {
	if m == nil {
		return 0
	}
	if bps, ok := m.rules[CorridorKey(source, target)]; ok {
		return bps
	}
	return m.defaultBPS
}

// FeeMinor implements MarkupResolver. Never errors.
func (m *Markup) FeeMinor(_ context.Context, source, target string, amountMinor int64) (int64, error) {
	if m == nil {
		return 0, nil
	}
	return FeeFromBPS(m.BPS(source, target), amountMinor), nil
}

// FeeFromBPS applies a basis-point rate to a minor-unit amount using exact
// rational arithmetic with half-even (banker's) rounding — never float
// multiplication — so the charged fee is deterministic, reproducible, and does
// not drift in Paymax's favour over a long run of conversions.
func FeeFromBPS(bps int, amountMinor int64) int64 {
	if bps <= 0 || amountMinor <= 0 {
		return 0
	}
	r := new(big.Rat).SetInt64(amountMinor)
	r.Mul(r, big.NewRat(int64(bps), 10_000))
	return roundRatHalfEven(r)
}

// PercentToBPS converts an operator-entered percentage ("1", "1.5", "0.25") to
// integer basis points. The input is taken as a STRING (json.Number preserves the
// literal) and parsed exactly, so 1.15% becomes 115 bps rather than the 114.999…
// a float64 round-trip produces.
// Rejects: unparseable input, anything finer than one basis point (0.01%), and
// anything outside [0, MaxMarkupBPS].
func PercentToBPS(percent string) (int, error) {
	p := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(percent), "%"))
	if p == "" {
		return 0, errors.New("fx: markup percentage is required")
	}
	r, ok := new(big.Rat).SetString(p)
	if !ok {
		return 0, fmt.Errorf("fx: %q is not a valid percentage", percent)
	}
	r.Mul(r, big.NewRat(100, 1)) // 1% -> 100 bps
	if !r.IsInt() {
		return 0, ErrMarkupTooPrecise
	}
	bps := r.Num().Int64()
	if bps < 0 || bps > MaxMarkupBPS {
		return 0, ErrMarkupOutOfRange
	}
	return int(bps), nil
}

// BPSToPercent renders basis points as an operator-facing percentage string,
// trimmed of trailing zeros ("100" -> "1", "150" -> "1.5", "25" -> "0.25").
func BPSToPercent(bps int) string {
	whole, frac := bps/100, bps%100
	if frac == 0 {
		return strconv.Itoa(whole)
	}
	s := fmt.Sprintf("%d.%02d", whole, frac)
	return strings.TrimRight(s, "0")
}

// roundRatHalfEven rounds an exact rational to the nearest integer, ties to even.
func roundRatHalfEven(r *big.Rat) int64 {
	num, den := r.Num(), r.Denom()
	q, rem := new(big.Int).QuoRem(num, den, new(big.Int))

	twice := new(big.Int).Abs(rem)
	twice.Mul(twice, big.NewInt(2))
	cmp := twice.Cmp(new(big.Int).Abs(den))

	roundAway := cmp > 0 || (cmp == 0 && q.Bit(0) == 1)
	if roundAway && rem.Sign() != 0 {
		if r.Sign() < 0 {
			q.Sub(q, big.NewInt(1))
		} else {
			q.Add(q, big.NewInt(1))
		}
	}
	return q.Int64()
}
