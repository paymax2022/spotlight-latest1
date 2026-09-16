package orchestration

// cards_store.go — Postgres-backed persistence for the FX virtual-cards vertical
// (mobile src/features/fx/api/fxCards.api.ts). Replaces the honest stubs in
// handler_cards.go with real rows in orch_fx_cards / orch_fx_card_txns.
//
// Tenant model: the FX account owner (the authenticated customer id) IS the
// business/tenant, so every query is scoped by business_id (= customerID(c)) for
// object-level authorization — the same convention as the other orch_fx_* tables.
// A nil store makes the handlers fall back to the existing stubs so a DB-less dev
// setup still renders.
//
// Card FUNDING is a money path: it debits the customer's wallet and credits the
// card balance atomically (single tx, wallet lock then row locks, fail-closed on
// insufficient funds) and is deduped on (business_id, idempotency_key) via
// orch_fx_card_txns. Because business_id == customer id for FX, the same id
// scopes the card and keys the wallet. Which pot that wallet debit lands in is
// decided in ONE place — customer_wallet.go: NGN in the main platform ledger,
// every other currency in orch_balances.
//
// Requires migration 20261003000000_fx_cards_collections.sql.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/provider"
)

// ─── Sentinel errors (mapped to HTTP status in the handlers) ──────────────────

var (
	// ErrCardNotFound is returned when a card id is not found for the business.
	ErrCardNotFound = errors.New("card not found")
	// ErrInsufficientCardBalance is returned by FundCard when the funding wallet
	// balance is short. The handler maps this to HTTP 402 Payment Required.
	ErrInsufficientCardBalance = errors.New("insufficient balance to fund card")
)

// ─── Contract-shaped records (camelCase JSON mirrors mobile fx.types.ts) ──────

// SpendingControls mirrors the mobile SpendingControls contract. Limits are
// pointers so an unset limit serializes as JSON null (= "no limit").
type SpendingControls struct {
	MonthlyLimit  *int64 `json:"monthlyLimit"`
	PerTxLimit    *int64 `json:"perTxLimit"`
	Online        bool   `json:"online"`
	Atm           bool   `json:"atm"`
	International bool   `json:"international"`
	Contactless   bool   `json:"contactless"`
}

// Card mirrors the mobile Card contract. balance/spentThisMonth are minor units.
type Card struct {
	ID             string           `json:"id"`
	Label          string           `json:"label"`
	Brand          string           `json:"brand"`
	Currency       string           `json:"currency"`
	Last4          string           `json:"last4"`
	ExpMonth       int              `json:"expMonth"`
	ExpYear        int              `json:"expYear"`
	CardholderName string           `json:"cardholderName"`
	Balance        int64            `json:"balance"`
	Status         string           `json:"status"`
	Color          string           `json:"color"`
	SpentThisMonth int64            `json:"spentThisMonth"`
	Controls       SpendingControls `json:"controls"`
	Provider       string           `json:"provider"`
	CreatedAt      string           `json:"createdAt"`
}

// CardTransaction mirrors the mobile CardTransaction contract.
type CardTransaction struct {
	ID            string  `json:"id"`
	CardID        string  `json:"cardId"`
	Merchant      string  `json:"merchant"`
	Category      string  `json:"category"`
	Icon          string  `json:"icon"`
	Amount        int64   `json:"amount"`
	Currency      string  `json:"currency"`
	Status        string  `json:"status"`
	CreatedAt     string  `json:"createdAt"`
	DeclineReason *string `json:"declineReason,omitempty"`
}

// CardSensitive mirrors the mobile CardSensitive contract (revealed on demand).
type CardSensitive struct {
	Pan    string `json:"pan"`
	Cvv    string `json:"cvv"`
	Expiry string `json:"expiry"`
}

// CardDraft is the create-card request (mobile CreateCardDraft).
type CardDraft struct {
	Label         string
	Brand         string
	Currency      string
	Color         string
	FundingAmount int64
}

// ─── Store interface ──────────────────────────────────────────────────────────

// CardStore persists the FX virtual-cards tables. An interface so handlers stay
// testable and so a nil store degrades to the existing stubs.
type CardStore interface {
	ListCards(ctx context.Context, business string) ([]Card, error)
	GetCard(ctx context.Context, business, id string) (Card, bool, error)
	CreateCard(ctx context.Context, business string, draft CardDraft) (Card, error)
	// FundCard is money-path: atomic wallet-debit + card-credit, idempotent on
	// idemKey. Returns ErrInsufficientCardBalance when the wallet is short and
	// ErrCardNotFound when the card does not exist for the business.
	FundCard(ctx context.Context, business, id string, amountMinor int64, idemKey string) (Card, error)
	FreezeCard(ctx context.Context, business, id string) (Card, bool, error)
	UnfreezeCard(ctx context.Context, business, id string) (Card, bool, error)
	// TerminateCard refunds any residual card balance back to the wallet then
	// marks the card terminated (money-path when a refund is due).
	TerminateCard(ctx context.Context, business, id string) error
	UpdateControls(ctx context.Context, business, id string, controls SpendingControls) (Card, bool, error)
	ListCardTransactions(ctx context.Context, business, cardID string) ([]CardTransaction, error)
	RevealCard(ctx context.Context, business, id string) (CardSensitive, bool, error)
}

// sqlCardStore is the Postgres-backed implementation.
type sqlCardStore struct {
	db *pgxpool.Pool
	// issuer is the optional card-issuing provider seam (Maplerad). When nil the
	// store keeps the deterministic synthesized last4/PAN behaviour so a DB-less or
	// provider-less dev setup still works. Only the card LIFECYCLE (issue / reveal /
	// freeze / terminate) routes through the issuer; FUNDING stays on the ledger.
	issuer provider.CardIssuer
}

// NewCardStore returns a Postgres-backed card store. issuer may be nil (falls back
// to synthesized card material for offline/provider-less dev).
func NewCardStore(db *pgxpool.Pool, issuer provider.CardIssuer) CardStore {
	return &sqlCardStore{db: db, issuer: issuer}
}

// cardCols is the ordered projection scanCard expects.
const cardCols = `id, label, brand, currency, last4, exp_month, exp_year, cardholder_name,
	balance_minor, status, color, spent_this_month_minor, controls, provider, created_at`

func controlsJSON(sc SpendingControls) string { b, _ := json.Marshal(sc); return string(b) }

func defaultCardControls() SpendingControls {
	return SpendingControls{Online: true, Atm: false, International: true, Contactless: true}
}

// scanCard scans a row matching cardCols into a Card. pgx.Rows satisfies pgx.Row.
func scanCard(row pgx.Row) (Card, error) {
	var cd Card
	var controls []byte
	var created time.Time
	err := row.Scan(&cd.ID, &cd.Label, &cd.Brand, &cd.Currency, &cd.Last4, &cd.ExpMonth, &cd.ExpYear,
		&cd.CardholderName, &cd.Balance, &cd.Status, &cd.Color, &cd.SpentThisMonth, &controls, &cd.Provider, &created)
	if err != nil {
		return Card{}, err
	}
	cd.Controls = defaultCardControls()
	if len(controls) > 0 {
		_ = json.Unmarshal(controls, &cd.Controls)
	}
	cd.CreatedAt = created.UTC().Format(time.RFC3339)
	return cd, nil
}

// ─── Reads ────────────────────────────────────────────────────────────────────

func (s *sqlCardStore) ListCards(ctx context.Context, business string) ([]Card, error) {
	rows, err := s.db.Query(ctx, `SELECT `+cardCols+` FROM orch_fx_cards WHERE business_id=$1 ORDER BY created_at DESC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Card, 0)
	for rows.Next() {
		cd, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, cd)
	}
	return out, rows.Err()
}

func (s *sqlCardStore) GetCard(ctx context.Context, business, id string) (Card, bool, error) {
	cd, err := scanCard(s.db.QueryRow(ctx, `SELECT `+cardCols+` FROM orch_fx_cards WHERE id=$1 AND business_id=$2`, id, business))
	if errors.Is(err, pgx.ErrNoRows) {
		return Card{}, false, nil
	}
	if err != nil {
		return Card{}, false, err
	}
	return cd, true, nil
}

// ─── Create ───────────────────────────────────────────────────────────────────

// CreateCard inserts a zero-balance active card. The initial funding load (if any)
// is applied separately via FundCard so it stays on the idempotent money path.
func (s *sqlCardStore) CreateCard(ctx context.Context, business string, draft CardDraft) (Card, error) {
	id := stubID("card")
	now := time.Now()
	label := strings.TrimSpace(draft.Label)
	if label == "" {
		label = "Virtual card"
	}
	brand := draft.Brand
	if brand == "" {
		brand = "visa"
	}
	color := draft.Color
	if color == "" {
		color = "purple"
	}
	currency := strings.ToUpper(draft.Currency)
	if currency == "" {
		currency = "USD"
	}
	last4 := fmt.Sprintf("%04d", now.UnixNano()%10000)
	expMonth := int(now.Month())
	expYear := (now.Year() + 3) % 100
	cardholder := "SPOTLIGHT USER"
	var providerCardID string

	// Card LIFECYCLE seam: issue the card at the provider when an issuer is wired.
	// On success adopt the provider's last4/expiry/brand and persist its card id.
	// Issuing may be async / flaky, so an issuer error is NON-FATAL: log and fall
	// back to synthesized metadata rather than failing card creation.
	if s.issuer != nil {
		issued, err := s.issuer.IssueCard(ctx, provider.IssueCardRequest{
			Customer:       business,
			Currency:       currency,
			Brand:          brand,
			Label:          label,
			CardholderName: cardholder,
		})
		if err != nil {
			log.Printf("[cards] issuer IssueCard failed (business=%s), continuing synthesized: %v", business, err)
		} else if issued != nil {
			providerCardID = issued.ProviderCardID
			if issued.Last4 != "" {
				last4 = issued.Last4
			}
			if issued.ExpMonth != 0 {
				expMonth = issued.ExpMonth
			}
			if issued.ExpYear != 0 {
				expYear = issued.ExpYear
			}
			if issued.Brand != "" {
				brand = issued.Brand
			}
		}
	}

	var providerCardIDArg *string
	if providerCardID != "" {
		providerCardIDArg = &providerCardID
	}

	cd, err := scanCard(s.db.QueryRow(ctx, `
		INSERT INTO orch_fx_cards
			(id, business_id, label, brand, currency, last4, exp_month, exp_year, cardholder_name,
			 balance_minor, status, color, spent_this_month_minor, controls, provider, provider_card_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'active',$10,0,$11,'maplerad',$12)
		RETURNING `+cardCols,
		id, business, label, brand, currency, last4, expMonth, expYear, cardholder,
		color, controlsJSON(defaultCardControls()), providerCardIDArg))
	if err != nil {
		return Card{}, err
	}
	return cd, nil
}

// ─── Fund (money path) ────────────────────────────────────────────────────────

// cardFundIdem derives the main-ledger idempotency key for a card-funding leg.
// When the caller supplied an Idempotency-Key the derived key is stable, so a
// replayed funding request replays the SAME ledger key and cannot post twice.
// Without one (the existing contract permits it) we fall back to a fresh key and
// the orch_fx_card_txns row remains the only dedupe — exactly as before.
func cardFundIdem(business, cardID, idemKey string) string {
	if strings.TrimSpace(idemKey) == "" {
		return "cardfund:" + business + ":" + cardID + ":" + uuid.NewString()
	}
	return "cardfund:" + business + ":" + idemKey
}

// FundCard atomically moves value from the customer's wallet into
// the card balance. Idempotent on (business, idemKey): a retried key returns the
// current card without re-funding. Fail-closed: short wallet → ErrInsufficientCardBalance.
func (s *sqlCardStore) FundCard(ctx context.Context, business, id string, amountMinor int64, idemKey string) (Card, error) {
	if amountMinor <= 0 {
		return Card{}, NewError(ErrInvalidRequest, "invalid_request", "Funding amount must be a positive minor-unit value.")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Card{}, err
	}
	defer tx.Rollback(ctx)

	// Wallet lock FIRST, before the card row lock, so card funding orders its
	// locks the same way conversions and payouts do and no cycle can form.
	if err = lockCustomerWallet(ctx, tx, business); err != nil {
		return Card{}, err
	}

	// Idempotency: if a funding txn with this key already applied, return the card as-is.
	if idemKey != "" {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM orch_fx_card_txns WHERE business_id=$1 AND idempotency_key=$2)`, business, idemKey).Scan(&exists); err != nil {
			return Card{}, err
		}
		if exists {
			cd, err := scanCard(tx.QueryRow(ctx, `SELECT `+cardCols+` FROM orch_fx_cards WHERE id=$1 AND business_id=$2`, id, business))
			if errors.Is(err, pgx.ErrNoRows) {
				return Card{}, ErrCardNotFound
			}
			if err != nil {
				return Card{}, err
			}
			return cd, tx.Commit(ctx)
		}
	}

	// Lock the card row.
	var currency string
	err = tx.QueryRow(ctx, `SELECT currency FROM orch_fx_cards WHERE id=$1 AND business_id=$2 FOR UPDATE`, id, business).Scan(&currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return Card{}, ErrCardNotFound
	}
	if err != nil {
		return Card{}, err
	}

	// Debit the funding wallet (business == customer id for FX) through the same
	// pot selector as conversions and payouts, so an NGN card top-up draws down
	// the main-ledger wallet rather than a private FX pot that is always empty.
	// Missing/short → fail-closed.
	if err = debitCustomerWallet(ctx, tx, business, currency, amountMinor, "card-funding:"+id, cardFundIdem(business, id, idemKey)); err != nil {
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.Type == ErrInsufficientBalance {
			return Card{}, ErrInsufficientCardBalance
		}
		return Card{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE orch_fx_cards SET balance_minor = balance_minor + $3, updated_at=now() WHERE id=$1 AND business_id=$2`, id, business, amountMinor); err != nil {
		return Card{}, err
	}

	// Record the funding txn (also the idempotency dedupe record). Its id doubles as
	// the ledger reference so the two double-entry legs below tie back to it.
	txnID := stubID("ctxn")
	var idem *string
	if idemKey != "" {
		idem = &idemKey
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_fx_card_txns (id, card_id, business_id, merchant, category, icon, amount_minor, currency, status, idempotency_key)
		VALUES ($1,$2,$3,'Card funding','Top-up','wallet',$4,$5,'approved',$6)`,
		txnID, id, business, amountMinor, currency, idem); err != nil {
		return Card{}, err
	}

	// Double-entry: DEBIT the customer wallet balance, CREDIT the card balance. Idem
	// keys are suffixed :src/:dst (unique per funding via txnID) to match the
	// conversion/transfer ledger convention in repository.go.
	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
		VALUES ($1,'customer_balance',$2,'DEBIT',$3,$4,$5)`,
		business, currency, amountMinor, txnID, txnID+":src"); err != nil {
		return Card{}, err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
		VALUES ($1,'card_balance',$2,'CREDIT',$3,$4,$5)`,
		business, currency, amountMinor, txnID, txnID+":dst"); err != nil {
		return Card{}, err
	}

	cd, err := scanCard(tx.QueryRow(ctx, `SELECT `+cardCols+` FROM orch_fx_cards WHERE id=$1 AND business_id=$2`, id, business))
	if err != nil {
		return Card{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Card{}, err
	}
	return cd, nil
}

// ─── Status transitions ───────────────────────────────────────────────────────

func (s *sqlCardStore) setStatus(ctx context.Context, business, id, status string) (Card, bool, error) {
	cd, err := scanCard(s.db.QueryRow(ctx, `
		UPDATE orch_fx_cards SET status=$3, updated_at=now()
		WHERE id=$1 AND business_id=$2
		RETURNING `+cardCols, id, business, status))
	if errors.Is(err, pgx.ErrNoRows) {
		return Card{}, false, nil
	}
	if err != nil {
		return Card{}, false, err
	}
	return cd, true, nil
}

// providerCardID reads the issuer card id for a card (empty when unset). Best-effort
// lookup used by the lifecycle mirror calls; a read error yields "".
func (s *sqlCardStore) providerCardID(ctx context.Context, business, id string) string {
	var pcid *string
	if err := s.db.QueryRow(ctx, `SELECT provider_card_id FROM orch_fx_cards WHERE id=$1 AND business_id=$2`, id, business).Scan(&pcid); err != nil || pcid == nil {
		return ""
	}
	return *pcid
}

func (s *sqlCardStore) FreezeCard(ctx context.Context, business, id string) (Card, bool, error) {
	cd, ok, err := s.setStatus(ctx, business, id, "frozen")
	if err == nil && ok {
		// Best-effort lifecycle mirror to the issuer; local status is authoritative.
		if pcid := s.providerCardID(ctx, business, id); s.issuer != nil && pcid != "" {
			if ferr := s.issuer.SetCardFrozen(ctx, pcid, true); ferr != nil {
				log.Printf("[cards] issuer freeze failed (card=%s), local status kept: %v", id, ferr)
			}
		}
	}
	return cd, ok, err
}

func (s *sqlCardStore) UnfreezeCard(ctx context.Context, business, id string) (Card, bool, error) {
	cd, ok, err := s.setStatus(ctx, business, id, "active")
	if err == nil && ok {
		// Best-effort lifecycle mirror to the issuer; local status is authoritative.
		if pcid := s.providerCardID(ctx, business, id); s.issuer != nil && pcid != "" {
			if ferr := s.issuer.SetCardFrozen(ctx, pcid, false); ferr != nil {
				log.Printf("[cards] issuer unfreeze failed (card=%s), local status kept: %v", id, ferr)
			}
		}
	}
	return cd, ok, err
}

// TerminateCard refunds any residual balance to the wallet (money-path) then marks
// the card terminated, atomically.
func (s *sqlCardStore) TerminateCard(ctx context.Context, business, id string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Same lock ordering as FundCard: wallet first, then the card row.
	if err = lockCustomerWallet(ctx, tx, business); err != nil {
		return err
	}

	var currency string
	var balance int64
	var providerCardID *string
	err = tx.QueryRow(ctx, `SELECT currency, balance_minor, provider_card_id FROM orch_fx_cards WHERE id=$1 AND business_id=$2 FOR UPDATE`, id, business).Scan(&currency, &balance, &providerCardID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrCardNotFound
	}
	if err != nil {
		return err
	}

	if balance > 0 {
		refundTxn := stubID("ctxn")
		// Refund the residual card balance into whichever pot holds this currency
		// (main ledger for NGN). Refunding into orch_balances while the customer
		// spends the main wallet would strand the money where nothing reads it.
		if err = creditCustomerWallet(ctx, tx, business, currency, balance, "card-termination-refund:"+id, refundTxn); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO orch_fx_card_txns (id, card_id, business_id, merchant, category, icon, amount_minor, currency, status)
			VALUES ($1,$2,$3,'Card termination refund','Refund','wallet',$4,$5,'refunded')`,
			refundTxn, id, business, balance, currency); err != nil {
			return err
		}
		// Double-entry: DEBIT the card balance, CREDIT the customer wallet balance.
		if _, err = tx.Exec(ctx, `
			INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
			VALUES ($1,'card_balance',$2,'DEBIT',$3,$4,$5)`,
			business, currency, balance, refundTxn, refundTxn+":src"); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
			VALUES ($1,'customer_balance',$2,'CREDIT',$3,$4,$5)`,
			business, currency, balance, refundTxn, refundTxn+":dst"); err != nil {
			return err
		}
	}

	if _, err = tx.Exec(ctx, `UPDATE orch_fx_cards SET balance_minor=0, status='terminated', updated_at=now() WHERE id=$1 AND business_id=$2`, id, business); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Best-effort lifecycle mirror to the issuer AFTER the local refund+status tx
	// commits; local termination is authoritative and must not be rolled back on a
	// provider error (provider-side settlement is treasury-level, out of scope).
	if s.issuer != nil && providerCardID != nil && *providerCardID != "" {
		if terr := s.issuer.TerminateCard(ctx, *providerCardID); terr != nil {
			log.Printf("[cards] issuer terminate failed (card=%s), local termination kept: %v", id, terr)
		}
	}
	return nil
}

// ─── Controls ─────────────────────────────────────────────────────────────────

func (s *sqlCardStore) UpdateControls(ctx context.Context, business, id string, controls SpendingControls) (Card, bool, error) {
	cd, err := scanCard(s.db.QueryRow(ctx, `
		UPDATE orch_fx_cards SET controls=$3, updated_at=now()
		WHERE id=$1 AND business_id=$2
		RETURNING `+cardCols, id, business, controlsJSON(controls)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Card{}, false, nil
	}
	if err != nil {
		return Card{}, false, err
	}
	return cd, true, nil
}

// ─── Card transactions ────────────────────────────────────────────────────────

func (s *sqlCardStore) ListCardTransactions(ctx context.Context, business, cardID string) ([]CardTransaction, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, card_id, merchant, category, icon, amount_minor, currency, status, decline_reason, created_at
		FROM orch_fx_card_txns WHERE business_id=$1 AND card_id=$2
		ORDER BY created_at DESC`, business, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CardTransaction, 0)
	for rows.Next() {
		var t CardTransaction
		var created time.Time
		if err := rows.Scan(&t.ID, &t.CardID, &t.Merchant, &t.Category, &t.Icon, &t.Amount, &t.Currency, &t.Status, &t.DeclineReason, &created); err != nil {
			return nil, err
		}
		t.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, t)
	}
	return out, rows.Err()
}

// ─── Reveal ───────────────────────────────────────────────────────────────────

// RevealCard returns the sensitive PAN/CVV/expiry for a card. When a real issuer is
// wired AND the card has a provider_card_id, the material comes from the provider's
// PCI-isolated vault. Otherwise it falls back to a DETERMINISTIC, SYNTHESIZED PAN/CVV
// derived from the card id — clearly TEST DATA, NOT a real PCI PAN.
func (s *sqlCardStore) RevealCard(ctx context.Context, business, id string) (CardSensitive, bool, error) {
	var expMonth, expYear int
	var providerCardID *string
	err := s.db.QueryRow(ctx, `SELECT exp_month, exp_year, provider_card_id FROM orch_fx_cards WHERE id=$1 AND business_id=$2`, id, business).Scan(&expMonth, &expYear, &providerCardID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CardSensitive{}, false, nil
	}
	if err != nil {
		return CardSensitive{}, false, err
	}

	// Live issuer path: fetch the real secrets from the provider vault.
	if s.issuer != nil && providerCardID != nil && *providerCardID != "" {
		secrets, err := s.issuer.RevealCard(ctx, *providerCardID)
		if err != nil {
			return CardSensitive{}, false, err
		}
		return CardSensitive{Pan: secrets.PAN, Cvv: secrets.CVV, Expiry: secrets.Expiry}, true, nil
	}

	h := fnv.New64a()
	_, _ = h.Write([]byte(id))
	n := h.Sum64()
	pan := fmt.Sprintf("%016d", n%10_000_000_000_000_000)
	grouped := pan[0:4] + " " + pan[4:8] + " " + pan[8:12] + " " + pan[12:16]
	return CardSensitive{
		Pan:    grouped,
		Cvv:    fmt.Sprintf("%03d", n%1000),
		Expiry: fmt.Sprintf("%02d/%02d", expMonth, expYear),
	}, true, nil
}
