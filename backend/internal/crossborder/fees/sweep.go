package fees

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider/vertofx"
)

// Daily fee sweep (spec §7.4, strategy A). Platform fees charged in OUR ledger
// sit as money in each user's Verto sub-account wallet, tracked in
// fees_unswept:{company}:{ccy}. The sweep moves them sub-account -> master via
// a Verto wallet-to-wallet transfer and settles the platform-fee component
// (revenue.MarkSettled, via FeeSettler), which posts the fees_unswept drain
// and the NGN commission roll-up. The sweep never posts its own journal.
//
// Source of truth is the LEDGER, never an in-memory list: accounts with a
// positive fees_unswept balance are discovered from ledger_entries, and each
// account's pending fees are the accrual entries (reference
// cb:fees_unswept:{transfer}:{service}) that have no settle leg and whose
// component the recogniser still reports ACCRUED.
//
// Granularity: ONE transfer per accrued fee (not one per account). MarkSettled
// is keyed per transfer and the ledger has no durable "sweep batch", so an
// aggregated transfer could not be retried exactly-once after a partial settle
// (the pending set — hence the amount — would change under the same
// paymentID). A per-fee paymentID derived from the fee's own idempotency key is
// stable forever, so Verto's paymentID idempotency + MarkSettled idempotency
// make every retry converge: transfer(ok) then settle(fail) re-runs as the same
// transfer and a settle.
//
// Failure model: a failed transfer is never settled; a failed settle after a
// successful transfer is retried next run under the same paymentID. Errors are
// aggregated; one bad account/fee never blocks the rest. No outbox: in-tx
// idempotency + retry.

// Transferer moves funds between two Verto wallets, idempotent by paymentID.
type Transferer interface {
	WalletToWallet(ctx context.Context, fromWalletID, toWalletID, currency string, amountMinor int64, paymentID string) (vertofx.WalletTransfer, error)
}

var _ Transferer = (*vertofx.Client)(nil)

// FeeSettler reads and settles one transfer's platform-fee component. It is
// implemented by the revenue package (revenue.NewFeeSettler) — fees cannot
// import revenue (revenue imports fees).
type FeeSettler interface {
	// PendingFee returns the amount to sweep and whether the fee is still
	// ACCRUED. SETTLED and REVERSED fees are not pending (never swept).
	PendingFee(ctx context.Context, transferID, service string) (amountMinor int64, pending bool, err error)
	// SettleFee marks the fee SETTLED (idempotent), referencing the sweep.
	SettleFee(ctx context.Context, transferID, service, sweepRef string) error
}

// SweepLedger is the READ-ONLY slice of the ledger the sweep needs.
type SweepLedger interface {
	ListPositiveBalancesByTypePrefix(ctx context.Context, prefix string) ([]ledger.AccountBalance, error)
	ListAccountEntries(ctx context.Context, accountID string, limit, offset int) ([]ledger.Entry, error)
	EntryByKey(ctx context.Context, idempotencyKey string) (*ledger.Entry, bool, error)
}

var _ SweepLedger = (*ledger.Service)(nil)

// WalletLookup resolves a Verto company's wallet id for a currency.
type WalletLookup func(ctx context.Context, companyID, currency string) (walletID string, err error)

// SweeperConfig configures the sweep.
type SweeperConfig struct {
	Enabled         bool   // FEATURE_VERTO_FEE_SWEEP (default off until V5/V18)
	MasterCompanyID string // the master Verto company that receives swept fees
}

// SweepResult summarises one run.
type SweepResult struct {
	Accounts   int   // fees_unswept accounts inspected
	Swept      int   // fees transferred and settled this run
	SweptMinor int64 // total minor units moved this run
	Skipped    int   // already settled / reversed
	Failed     int   // transfer, settle or lookup failures (retried next run)
}

// Sweeper runs the daily fee sweep.
type Sweeper struct {
	cfg     SweeperConfig
	l       SweepLedger
	settler FeeSettler
	x       Transferer
	wallets WalletLookup
	log     *slog.Logger
}

// NewSweeper builds the sweeper.
func NewSweeper(cfg SweeperConfig, l SweepLedger, s FeeSettler, x Transferer, w WalletLookup) *Sweeper {
	return &Sweeper{cfg: cfg, l: l, settler: s, x: x, wallets: w, log: slog.Default()}
}

const (
	unsweptTypePrefix = "fees_unswept:"
	accrualRefPrefix  = "cb:fees_unswept:"
	settleRefPrefix   = "cb:fees_unswept:settle:"
	entryPageSize     = 500
)

// SweepFees sweeps every pending fee. A no-op (logged) when the flag is off.
func (s *Sweeper) SweepFees(ctx context.Context) (SweepResult, error) {
	var res SweepResult
	if !s.cfg.Enabled {
		s.log.Info("fee sweep disabled (FEATURE_VERTO_FEE_SWEEP off); no-op")
		return res, nil
	}
	if s.cfg.MasterCompanyID == "" {
		return res, errors.New("fees: sweep requires a master company id")
	}
	accts, err := s.l.ListPositiveBalancesByTypePrefix(ctx, unsweptTypePrefix)
	if err != nil {
		return res, fmt.Errorf("fees: list unswept accounts: %w", err)
	}
	var errs []error
	for _, a := range accts {
		if err := ctx.Err(); err != nil {
			errs = append(errs, err)
			break
		}
		res.Accounts++
		if err := s.sweepAccount(ctx, a, &res); err != nil {
			errs = append(errs, fmt.Errorf("account %s: %w", a.Type, err))
		}
	}
	s.log.Info("fee sweep finished", "accounts", res.Accounts, "swept", res.Swept,
		"swept_minor", res.SweptMinor, "skipped", res.Skipped, "failed", res.Failed)
	return res, errors.Join(errs...)
}

func parseUnsweptType(t ledger.AccountType) (company, ccy string, err error) {
	rest, ok := strings.CutPrefix(string(t), unsweptTypePrefix)
	if !ok {
		return "", "", fmt.Errorf("not a fees_unswept account: %q", t)
	}
	company, ccy, ok = strings.Cut(rest, ":")
	if !ok || company == "" || !currencyRe.MatchString(ccy) {
		return "", "", fmt.Errorf("malformed fees_unswept account type %q", t)
	}
	return company, ccy, nil
}

type pendingFee struct {
	transferID, service, paymentID string
}

func (s *Sweeper) sweepAccount(ctx context.Context, a ledger.AccountBalance, res *SweepResult) error {
	company, ccy, err := parseUnsweptType(a.Type)
	if err != nil {
		res.Failed++
		return err
	}
	if ccy != "NGN" { // the main ledger is NGN-kobo only; fail closed
		res.Failed++
		return fmt.Errorf("fees: sweep is NGN-only, account currency %s", ccy)
	}
	items, err := s.pendingItems(ctx, a.AccountID)
	if err != nil {
		res.Failed++
		return err
	}
	var from, to string
	var errs []error
	for _, it := range items {
		amt, pending, err := s.settler.PendingFee(ctx, it.transferID, it.service)
		if err != nil {
			res.Failed++
			errs = append(errs, fmt.Errorf("fee %s/%s: %w", it.transferID, it.service, err))
			continue
		}
		if !pending {
			res.Skipped++ // settled elsewhere, or reversed: never move its money
			continue
		}
		if amt <= 0 {
			res.Failed++
			errs = append(errs, fmt.Errorf("fee %s/%s: non-positive amount %d", it.transferID, it.service, amt))
			continue
		}
		if from == "" {
			if from, err = s.wallets(ctx, company, ccy); err == nil {
				to, err = s.wallets(ctx, s.cfg.MasterCompanyID, ccy)
			}
			if err != nil || from == "" || to == "" {
				from, to = "", ""
				res.Failed++
				return errors.Join(append(errs, fmt.Errorf("resolve wallets: %v", err))...)
			}
		}
		tr, err := s.x.WalletToWallet(ctx, from, to, ccy, amt, it.paymentID)
		if err != nil {
			res.Failed++ // not settled: nothing moved as far as we know
			errs = append(errs, fmt.Errorf("transfer %s: %w", it.paymentID, err))
			continue
		}
		if err := s.settler.SettleFee(ctx, it.transferID, it.service, tr.ID); err != nil {
			res.Failed++ // moved; the next run re-uses the same paymentID and settles
			errs = append(errs, fmt.Errorf("settle %s/%s after transfer %s: %w", it.transferID, it.service, tr.ID, err))
			continue
		}
		res.Swept++
		res.SweptMinor += amt
	}
	return errors.Join(errs...)
}

// pendingItems lists the account's accrual entries that have no settle leg in
// the ledger. Whether each is still ACCRUED (vs reversed) is the settler's call.
func (s *Sweeper) pendingItems(ctx context.Context, accountID string) ([]pendingFee, error) {
	var out []pendingFee
	seen := map[string]bool{}
	for offset := 0; ; offset += entryPageSize {
		page, err := s.l.ListAccountEntries(ctx, accountID, entryPageSize, offset)
		if err != nil {
			return nil, fmt.Errorf("list entries: %w", err)
		}
		for _, e := range page {
			if e.Type != ledger.EntryCredit || !strings.HasPrefix(e.Reference, accrualRefPrefix) ||
				strings.HasPrefix(e.Reference, settleRefPrefix) || !strings.HasSuffix(e.IdempotencyKey, ":credit") {
				continue
			}
			rest := strings.TrimPrefix(e.Reference, accrualRefPrefix)
			i := strings.LastIndex(rest, ":")
			if i <= 0 || i == len(rest)-1 {
				continue
			}
			base := strings.TrimSuffix(e.IdempotencyKey, ":credit")
			if seen[base] {
				continue
			}
			seen[base] = true
			if _, settled, err := s.l.EntryByKey(ctx, base+":settle:debit"); err != nil {
				return nil, fmt.Errorf("settle probe %s: %w", base, err)
			} else if settled {
				continue
			}
			out = append(out, pendingFee{transferID: rest[:i], service: rest[i+1:], paymentID: base + ":sweep"})
		}
		if len(page) < entryPageSize {
			return out, nil
		}
	}
}
