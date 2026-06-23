package fx

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider/maplerad"
)

const quoteTTL = 5 * time.Minute

// Service manages FX quotes, conversions, and currency wallets.
type Service struct {
	db       *pgxpool.Pool
	ledger   *ledger.Service
	provider *maplerad.Client
	redis    *goredis.Client // for quote reservation
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service, provider *maplerad.Client, redis *goredis.Client) *Service {
	return &Service{db: db, ledger: ledger, provider: provider, redis: redis}
}

// GetOrCreateCurrencyWallet returns the user's wallet for a currency, creating it if absent.
func (s *Service) GetOrCreateCurrencyWallet(ctx context.Context, userID, currency string) (*CurrencyWallet, error) {
	const upsert = `
		INSERT INTO currency_wallets (user_id, currency, balance_minor)
		VALUES ($1, $2, 0)
		ON CONFLICT (user_id, currency) DO NOTHING
		RETURNING id, user_id, currency, balance_minor, created_at`
	w := &CurrencyWallet{}
	err := s.db.QueryRow(ctx, upsert, userID, currency).
		Scan(&w.ID, &w.UserID, &w.Currency, &w.BalanceMinor, &w.CreatedAt)
	if err != nil {
		const fetch = `SELECT id, user_id, currency, balance_minor, created_at FROM currency_wallets WHERE user_id=$1 AND currency=$2`
		err = s.db.QueryRow(ctx, fetch, userID, currency).
			Scan(&w.ID, &w.UserID, &w.Currency, &w.BalanceMinor, &w.CreatedAt)
	}
	if err != nil {
		return nil, fmt.Errorf("fx: get/create currency wallet user=%s currency=%s: %w", userID, currency, err)
	}
	return w, nil
}

// GetQuote obtains an FX rate from Maplerad, stores it, and reserves it in Redis.
func (s *Service) GetQuote(ctx context.Context, userID string, req QuoteRequest) (*FXQuote, error) {
	providerResp, err := s.provider.GetFXQuote(ctx, maplerad.FXQuoteRequest{
		SourceCurrency: req.SourceCurrency,
		TargetCurrency: req.TargetCurrency,
		AmountKobo:     req.AmountKobo,
	})
	if err != nil {
		return nil, fmt.Errorf("fx: get quote: %w", err)
	}

	expiresAt := time.Now().Add(quoteTTL)
	q := &FXQuote{
		ID:               uuid.New().String(),
		UserID:           userID,
		ProviderQuoteID:  providerResp.QuoteID,
		SourceCurrency:   req.SourceCurrency,
		TargetCurrency:   req.TargetCurrency,
		SourceAmountKobo: req.AmountKobo,
		TargetAmountMinor: providerResp.TargetAmountMinor,
		Rate:             providerResp.Rate,
		FeeKobo:          providerResp.Fee,
		ExpiresAt:        expiresAt,
		CreatedAt:        time.Now(),
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

	// Reserve in Redis so it can be looked up quickly at convert time.
	if s.redis != nil {
		_ = s.redis.SetEx(ctx, "fx:quote:"+q.ID, q.ID, quoteTTL).Err()
	}
	return q, nil
}

// Convert executes the FX conversion for a valid, unexpired quote.
func (s *Service) Convert(ctx context.Context, userID string, req ConvertRequest) (*FXConversion, error) {
	// Duplicate check.
	var existingID string
	const checkDup = `SELECT id FROM fx_conversions WHERE idempotency_key=$1 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, req.IdempotencyKey).Scan(&existingID)
	if existingID != "" {
		return s.getConversion(ctx, existingID)
	}

	// Fetch and validate quote.
	q, err := s.getQuote(ctx, req.QuoteID, userID)
	if err != nil {
		return nil, err
	}
	if time.Now().After(q.ExpiresAt) {
		return nil, fmt.Errorf("fx: quote %s has expired", req.QuoteID)
	}

	totalDebitKobo := q.SourceAmountKobo + q.FeeKobo
	reference := "fx:" + uuid.New().String()

	// Debit source wallet.
	fxSpreadAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFXSpreadIncome)
	if err != nil {
		return nil, err
	}
	if err := s.ledger.Debit(ctx, userID, reference, req.IdempotencyKey+":debit", fxSpreadAcc.ID, totalDebitKobo); err != nil {
		return nil, fmt.Errorf("fx: debit source wallet: %w", err)
	}

	// Execute conversion via Maplerad.
	convResp, err := s.provider.ConvertFX(ctx, maplerad.ConvertFXRequest{
		QuoteID:        q.ProviderQuoteID,
		SourceCurrency: q.SourceCurrency,
		TargetCurrency: q.TargetCurrency,
		AmountKobo:     q.SourceAmountKobo,
		Reference:      reference,
	})
	if err != nil {
		// Conversion failed after debit — post reversal and return error.
		_ = s.postReversal(ctx, userID, reference, req.IdempotencyKey, totalDebitKobo, fxSpreadAcc.ID)
		return nil, fmt.Errorf("fx: provider convert: %w", err)
	}

	// Credit target currency wallet.
	if err := s.creditCurrencyWallet(ctx, userID, q.TargetCurrency, convResp.TargetAmountMinor); err != nil {
		return nil, fmt.Errorf("fx: credit target wallet: %w", err)
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
	const insertConv = `
		INSERT INTO fx_conversions (id, user_id, quote_id, provider_txn_id, source_currency, target_currency,
		    source_amount_kobo, target_amount_minor, rate, fee_kobo, status, reference, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',$11,$12)`
	if _, err := s.db.Exec(ctx, insertConv,
		conv.ID, conv.UserID, conv.QuoteID, conv.ProviderTxnID,
		conv.SourceCurrency, conv.TargetCurrency,
		conv.SourceAmountKobo, conv.TargetAmountMinor, conv.Rate, conv.FeeKobo,
		conv.Reference, conv.IdempotencyKey,
	); err != nil {
		return nil, fmt.Errorf("fx: store conversion: %w", err)
	}
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
	var out []FXConversion
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
	return fq, err
}

func (s *Service) getConversion(ctx context.Context, id string) (*FXConversion, error) {
	const q = `SELECT id, user_id, quote_id, provider_txn_id, source_currency, target_currency, source_amount_kobo, target_amount_minor, rate, fee_kobo, status, reference, idempotency_key, created_at FROM fx_conversions WHERE id=$1`
	c := &FXConversion{}
	return c, s.db.QueryRow(ctx, q, id).Scan(
		&c.ID, &c.UserID, &c.QuoteID, &c.ProviderTxnID, &c.SourceCurrency, &c.TargetCurrency,
		&c.SourceAmountKobo, &c.TargetAmountMinor, &c.Rate, &c.FeeKobo, &c.Status, &c.Reference, &c.IdempotencyKey, &c.CreatedAt,
	)
}

func (s *Service) creditCurrencyWallet(ctx context.Context, userID, currency string, amountMinor int64) error {
	const update = `UPDATE currency_wallets SET balance_minor = balance_minor + $3 WHERE user_id=$1 AND currency=$2`
	_, err := s.db.Exec(ctx, update, userID, currency, amountMinor)
	return err
}

func (s *Service) postReversal(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64, creditAccountID string) error {
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFXSpreadIncome)
	if err != nil {
		return err
	}
	return s.ledger.Credit(ctx, userID, "fx:reversal:"+reference, idempotencyKey+":reversal", revAcc.ID, amountKobo)
}
