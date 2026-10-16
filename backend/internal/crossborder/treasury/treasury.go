// Package treasury is READ-ONLY monitoring of the Verto master wallets and the
// unswept platform fees (spec §9, §12 A6; decision D7: NGN master pre-funding
// focus). It never posts ledger entries and never moves money. Scheduling and
// alert delivery are wired by the caller.
package treasury

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"spotlight/backend/internal/finance/ledger"
)

const unsweptTypePrefix = "fees_unswept:"

// Balance is one master wallet balance in minor units.
type Balance struct {
	Currency string
	Minor    int64
}

// BalanceReader reads live master wallet balances from the provider. The
// Verto side is modeled behind this interface (V-items).
type BalanceReader interface {
	MasterBalances(ctx context.Context) ([]Balance, error)
}

// UnsweptLedger is the READ-ONLY ledger slice treasury needs (Task 5 read).
type UnsweptLedger interface {
	ListPositiveBalancesByTypePrefix(ctx context.Context, prefix string) ([]ledger.AccountBalance, error)
}

var _ UnsweptLedger = (*ledger.Service)(nil)

// Thresholds maps currency to the minimum acceptable master balance (minor).
type Thresholds map[string]int64

// Alert is a low-balance alert.
type Alert struct {
	Currency  string
	Balance   int64
	Threshold int64
	Shortfall int64 // Threshold - Balance, always > 0
}

// UnsweptRow is the unswept fee balance of one sub-account.
type UnsweptRow struct {
	AccountID string
	Company   string
	Currency  string
	Minor     int64
}

// FundingForecast is a deterministic pre-funding projection.
type FundingForecast struct {
	BalanceMinor   int64
	RequiredMinor  int64 // dailyOutflow * horizonDays
	ShortfallMinor int64 // max(0, Required - Balance): top-up needed
	DaysOfCover    int64 // whole days the balance covers; -1 when outflow is zero
}

// Monitor provides the read-only treasury views.
type Monitor struct {
	reader BalanceReader
	led    UnsweptLedger
}

// New builds a Monitor.
func New(reader BalanceReader, led UnsweptLedger) *Monitor {
	return &Monitor{reader: reader, led: led}
}

// MasterBalances returns the master wallet balance per currency.
func (m *Monitor) MasterBalances(ctx context.Context) ([]Balance, error) {
	bs, err := m.reader.MasterBalances(ctx)
	if err != nil {
		return nil, fmt.Errorf("treasury: master balances: %w", err)
	}
	return bs, nil
}

// LowBalanceAlerts returns an alert for every master balance strictly below
// its configured threshold. Currencies without a threshold are not alerted.
func (m *Monitor) LowBalanceAlerts(ctx context.Context, th Thresholds) ([]Alert, error) {
	bs, err := m.MasterBalances(ctx)
	if err != nil {
		return nil, err
	}
	var out []Alert
	for _, b := range bs {
		t, ok := th[b.Currency]
		if !ok || b.Minor >= t {
			continue
		}
		out = append(out, Alert{Currency: b.Currency, Balance: b.Minor, Threshold: t, Shortfall: t - b.Minor})
	}
	return out, nil
}

// UnsweptFeesByAccount rolls fees_unswept:{company}:{ccy} positive balances up
// per sub-account, ordered by company then currency.
func (m *Monitor) UnsweptFeesByAccount(ctx context.Context) ([]UnsweptRow, error) {
	accts, err := m.led.ListPositiveBalancesByTypePrefix(ctx, unsweptTypePrefix)
	if err != nil {
		return nil, fmt.Errorf("treasury: list unswept: %w", err)
	}
	rows := make([]UnsweptRow, 0, len(accts))
	for _, a := range accts {
		rest, ok := strings.CutPrefix(string(a.Type), unsweptTypePrefix)
		company, ccy, ok2 := strings.Cut(rest, ":")
		if !ok || !ok2 || company == "" || ccy == "" {
			return nil, fmt.Errorf("treasury: malformed fees_unswept account type %q", a.Type)
		}
		rows = append(rows, UnsweptRow{AccountID: a.AccountID, Company: company, Currency: ccy, Minor: a.BalanceKobo})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Company != rows[j].Company {
			return rows[i].Company < rows[j].Company
		}
		return rows[i].Currency < rows[j].Currency
	})
	return rows, nil
}

// TotalsByCurrency sums unswept rows per currency.
func TotalsByCurrency(rows []UnsweptRow) map[string]int64 {
	out := map[string]int64{}
	for _, r := range rows {
		out[r.Currency] += r.Minor
	}
	return out
}

// Forecast projects pre-funding need: required = dailyOutflow*horizonDays,
// shortfall = max(0, required-balance), cover = balance/dailyOutflow (floor).
// Pure int64 arithmetic with overflow checks.
func Forecast(balanceMinor, dailyOutflowMinor, horizonDays int64) (FundingForecast, error) {
	if balanceMinor < 0 || dailyOutflowMinor < 0 {
		return FundingForecast{}, errors.New("treasury: balance and outflow must be non-negative")
	}
	if horizonDays <= 0 {
		return FundingForecast{}, errors.New("treasury: horizon must be positive")
	}
	if dailyOutflowMinor > 0 && horizonDays > math.MaxInt64/dailyOutflowMinor {
		return FundingForecast{}, errors.New("treasury: forecast overflow")
	}
	f := FundingForecast{BalanceMinor: balanceMinor, RequiredMinor: dailyOutflowMinor * horizonDays, DaysOfCover: -1}
	if f.RequiredMinor > balanceMinor {
		f.ShortfallMinor = f.RequiredMinor - balanceMinor
	}
	if dailyOutflowMinor > 0 {
		f.DaysOfCover = balanceMinor / dailyOutflowMinor
	}
	return f, nil
}

// PrefundForecast forecasts one currency's master pre-funding (NGN per D7)
// against its live master balance.
func (m *Monitor) PrefundForecast(ctx context.Context, currency string, dailyOutflowMinor, horizonDays int64) (FundingForecast, error) {
	bs, err := m.MasterBalances(ctx)
	if err != nil {
		return FundingForecast{}, err
	}
	for _, b := range bs {
		if b.Currency == currency {
			return Forecast(b.Minor, dailyOutflowMinor, horizonDays)
		}
	}
	return FundingForecast{}, fmt.Errorf("treasury: no master balance for %s", currency)
}
