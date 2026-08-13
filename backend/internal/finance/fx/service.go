package fx

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider/maplerad"
)

const quoteTTL = 5 * time.Minute

// Service manages FX quotes, conversions, and currency wallets.
type Service struct {
	db         *pgxpool.Pool
	ledger     *ledger.Service
	provider   *maplerad.Client
	redis      *goredis.Client    // for quote reservation
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	markup     MarkupResolver     // Paymax FX markup; never nil after NewService
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service, provider *maplerad.Client, redis *goredis.Client) *Service {
	return &Service{db: db, ledger: ledger, provider: provider, redis: redis, markup: DefaultMarkup()}
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
// module. app-wiring injects a thin adapter over the finance commission service;
// when the commission feature is off (or no recorder is wired) the field is nil and
// recording is a silent no-op. Modeled as a LOCAL interface so fx never imports the
// commission package at compile time (mirrors transport/service.go).
//
// This records realized profit ONLY; it never moves money. The conversion's own
// ledger legs are unchanged, and the injected recorder is deliberately constructed
// WITHOUT a ledger so RecordFor never re-posts to the ledger — it appends the
// immutable earning row only.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a completed FX
// conversion. Best-effort + MUST NEVER affect the caller: a nil recorder is a no-op,
// and any error is logged and swallowed so a profit-registry failure can never fail
// or reverse the conversion. The module's ACTUAL earning is the provider spread /
// FeeKobo, NOT a % of the source principal, so we record the EXACT feeKobo via
// RecordExact (grossKobo = the source/principal amount is passed for context only).
// The conversion id doubles as source ref + idempotency key so replays never
// double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, grossKobo, feeKobo int64, sourceRef string, userID *string) {
	if s.commission == nil || feeKobo <= 0 {
		return
	}
	if err := s.commission.RecordExact(ctx, "Finance", "Currency Exchange", "", grossKobo, feeKobo,
		"fx", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[fx] commission record (source=%s gross=%d fee=%d) failed, continuing: %v", sourceRef, grossKobo, feeKobo, err)
	}
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
	// CreateFXQuote (not the /fx/rates board): this quote is persisted and
	// exchanged later by Convert, which needs a provider reference — the board
	// issues none. Maplerad's reference is single-use and expires, so a Convert
	// after our own quoteTTL fails closed with "could not find quote".
	providerResp, err := s.provider.CreateFXQuote(ctx, maplerad.FXQuoteRequest{
		SourceCurrency: req.SourceCurrency,
		TargetCurrency: req.TargetCurrency,
		AmountKobo:     req.AmountKobo,
	})
	if err != nil {
		return nil, fmt.Errorf("fx: get quote: %w", err)
	}

	// Maplerad returns no fee — its margin is priced into the rate — so the fee
	// the customer pays is OUR markup, computed on the source principal. Quoted
	// here and persisted, so Convert debits exactly what was disclosed even if the
	// admin changes the markup between quote and execution.
	//
	// Fail closed: if the rate cannot be resolved we do not quote. Falling back to
	// some other rate would charge a fee nobody configured.
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

	// Reserve in Redis so it can be looked up quickly at convert time.
	if s.redis != nil {
		_ = s.redis.SetEx(ctx, "fx:quote:"+q.ID, q.ID, quoteTTL).Err()
	}
	return q, nil
}

// Convert executes the FX conversion for a valid, unexpired quote.
//
// Money-path invariants (see docs/qa/money-paths.md RISK-FX-1/2/3):
//   - RISK-FX-2: the WHOLE conversion is idempotent on the single req.IdempotencyKey.
//     A replay returns the existing conversion. The two ledger legs carry per-leg
//     suffixed keys (":debit" / ":credit") so a replay is a per-leg no-op, and the
//     fx_conversions row is guarded by its UNIQUE(idempotency_key) constraint via
//     INSERT ... ON CONFLICT DO NOTHING RETURNING — so two concurrent identical
//     Converts can never both win the insert and double-credit the target wallet.
//   - RISK-FX-1: BOTH legs hit the finance ledger as balanced double-entries. The
//     source (NGN) leg is a user-wallet Debit; the target-currency leg is a balanced
//     PostJournal (DR settlement standing account → CR fx-spread standing account)
//     recording the foreign-currency movement. currency_wallets is NEVER a bare
//     UPDATE: it is only ever mutated as a MIRROR of the target-leg ledger post,
//     inside the SAME tx that persists the conversion row, so the fast projection
//     can never drift from a committed conversion.
//   - RISK-FX-3: provider-failure reverses the full debit (fail-closed); and the
//     currency_wallets mirror + conversion-row insert commit together in ONE pgx tx
//     gated by the unique idempotency key, so a crash can never leave a credited
//     wallet with no conversion record (or vice-versa).
func (s *Service) Convert(ctx context.Context, userID string, req ConvertRequest) (*FXConversion, error) {
	// Fast idempotency short-circuit: if this key already produced a conversion,
	// return it (a genuine replay). The durable guard is the UNIQUE(idempotency_key)
	// constraint enforced by the ON CONFLICT insert below — this SELECT is only an
	// optimization and is NOT relied on for correctness (no TOCTOU dependency).
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

	// --- LEG 1: debit source (NGN) wallet — balanced double-entry via the ledger,
	// idempotent on req.IdempotencyKey+":debit". ErrDuplicate on a replay is success.
	fxSpreadAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFXSpreadIncome)
	if err != nil {
		return nil, err
	}
	if err := s.ledger.Debit(ctx, userID, reference, req.IdempotencyKey+":debit", fxSpreadAcc.ID, totalDebitKobo); err != nil && err != ledger.ErrDuplicate {
		return nil, fmt.Errorf("fx: debit source wallet: %w", err)
	}

	// Execute conversion via Maplerad.
	// Only the provider quote reference is sent — currencies and amount are fixed
	// by the quote, and Maplerad's exchange endpoint has no client-reference field
	// (our `reference` guards the ledger legs above, not the provider call).
	convResp, err := s.provider.ConvertFX(ctx, maplerad.ConvertFXRequest{
		QuoteID: q.ProviderQuoteID,
	})
	if err != nil {
		// Conversion failed after debit — post reversal (fail-closed) and return.
		// Nothing was credited or recorded, so the user is left net-zero.
		_ = s.postReversal(ctx, userID, reference, req.IdempotencyKey, totalDebitKobo, fxSpreadAcc.ID)
		return nil, fmt.Errorf("fx: provider convert: %w", err)
	}

	// --- LEG 2: the target-currency credit must ALSO be a ledger projection, not a
	// bare stored-balance write. Post a balanced double-entry recording the foreign
	// leg: DR settlement standing account → CR fx-spread standing account, keyed
	// ":credit" so a replay is a no-op. This gives the target side a ledger
	// counterpart (double-entry restored); currency_wallets is then updated ONLY as
	// a mirror of this post, inside the conversion tx below.
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
	}); err != nil && err != ledger.ErrDuplicate {
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

	// Persist the conversion row AND mirror the currency_wallets projection in ONE
	// pgx tx, gated by UNIQUE(idempotency_key). If the INSERT loses the race (a
	// concurrent identical Convert already committed), ON CONFLICT DO NOTHING returns
	// no row: we skip the wallet mirror and return the already-persisted conversion —
	// so the target wallet can never be double-credited. Crash-safety (RISK-FX-3):
	// the mirror and the record commit atomically, so we never credit the wallet
	// without a durable conversion row.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("fx: begin conversion tx: %w", err)
	}
	defer tx.Rollback(ctx)

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
	if err == pgx.ErrNoRows {
		// A concurrent identical Convert won the race and already credited the wallet.
		// Do NOT mirror the credit again; roll back this (empty) tx and return the
		// existing conversion. This is the idempotent replay path.
		_ = tx.Rollback(ctx)
		return s.getConversionByKey(ctx, req.IdempotencyKey)
	}
	if err != nil {
		return nil, fmt.Errorf("fx: store conversion: %w", err)
	}

	// Mirror the target-leg credit into the fast currency_wallets projection, in the
	// SAME tx as the conversion insert. currency_wallets is thus only ever moved as a
	// mirror of a committed ledger post + conversion record — never a bare UPDATE.
	if err := s.mirrorCurrencyWalletTx(ctx, tx, userID, q.TargetCurrency, convResp.TargetAmountMinor); err != nil {
		return nil, fmt.Errorf("fx: mirror target wallet: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("fx: commit conversion tx: %w", err)
	}
	// Record realized Spotlight profit into the central Commission & Profit registry
	// at the ONLY successful-conversion point (NOT the idempotent replay short-circuits
	// above, which return before here, so replays never double-count). gross = the
	// source/principal amount; source ref + idempotency key = the conversion id.
	// Best-effort + nil-safe — a recorder failure can never fail/reverse the conversion.
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

// mirrorCurrencyWalletTx updates the fast currency_wallets projection as a MIRROR of
// the already-posted target-leg ledger entry, inside the caller's transaction. It is
// NEVER called on its own — only from Convert, in the same tx that inserts the
// fx_conversions row (guarded by UNIQUE(idempotency_key)). This preserves the iron
// rule that balances are ledger-derived: the currency_wallets row moves only when a
// balanced ledger post AND a durable conversion record commit together, so it can
// never be a bare stored-balance write with no ledger counterpart (RISK-FX-1), and
// can never be double-applied (RISK-FX-2/3 — the conflicting insert short-circuits
// before we ever reach here).
//
// Upsert semantics mirror GetOrCreateCurrencyWallet so a first conversion into a
// currency the user has never held still lands correctly.
func (s *Service) mirrorCurrencyWalletTx(ctx context.Context, tx pgx.Tx, userID, currency string, amountMinor int64) error {
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
	return c, s.db.QueryRow(ctx, q, idempotencyKey).Scan(
		&c.ID, &c.UserID, &c.QuoteID, &c.ProviderTxnID, &c.SourceCurrency, &c.TargetCurrency,
		&c.SourceAmountKobo, &c.TargetAmountMinor, &c.Rate, &c.FeeKobo, &c.Status, &c.Reference, &c.IdempotencyKey, &c.CreatedAt,
	)
}

func (s *Service) postReversal(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64, creditAccountID string) error {
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFXSpreadIncome)
	if err != nil {
		return err
	}
	return s.ledger.Credit(ctx, userID, "fx:reversal:"+reference, idempotencyKey+":reversal", revAcc.ID, amountKobo)
}
