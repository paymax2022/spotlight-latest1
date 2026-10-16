package treasury

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/finance/ledger"
)

type fakeReader struct {
	bals []Balance
	err  error
}

func (f fakeReader) MasterBalances(context.Context) ([]Balance, error) { return f.bals, f.err }

type fakeLedger struct {
	accts  []ledger.AccountBalance
	err    error
	prefix string
}

func (f *fakeLedger) ListPositiveBalancesByTypePrefix(_ context.Context, p string) ([]ledger.AccountBalance, error) {
	f.prefix = p
	return f.accts, f.err
}

func TestMasterBalancesPerCurrency(t *testing.T) {
	m := New(fakeReader{bals: []Balance{{Currency: "NGN", Minor: 5_000_000}, {Currency: "USD", Minor: 100}}}, &fakeLedger{})
	got, err := m.MasterBalances(context.Background())
	if err != nil || len(got) != 2 || got[0].Currency != "NGN" || got[0].Minor != 5_000_000 {
		t.Fatalf("got %v err %v", got, err)
	}
}

func TestMasterBalancesError(t *testing.T) {
	m := New(fakeReader{err: errors.New("boom")}, &fakeLedger{})
	if _, err := m.MasterBalances(context.Background()); err == nil {
		t.Fatal("want error")
	}
}

func TestLowBalanceAlerts(t *testing.T) {
	m := New(fakeReader{bals: []Balance{
		{Currency: "NGN", Minor: 999},
		{Currency: "USD", Minor: 500}, // at threshold: no alert
		{Currency: "GBP", Minor: 900}, // above
		{Currency: "EUR", Minor: 1},   // no threshold configured: no alert
	}}, &fakeLedger{})
	alerts, err := m.LowBalanceAlerts(context.Background(), Thresholds{"NGN": 1000, "USD": 500, "GBP": 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(alerts) != 1 || alerts[0].Currency != "NGN" || alerts[0].Balance != 999 || alerts[0].Threshold != 1000 || alerts[0].Shortfall != 1 {
		t.Fatalf("alerts %+v", alerts)
	}
}

func TestUnsweptFeesByAccount(t *testing.T) {
	l := &fakeLedger{accts: []ledger.AccountBalance{
		{AccountID: "a1", Type: "fees_unswept:co1:NGN", BalanceKobo: 300},
		{AccountID: "a2", Type: "fees_unswept:co2:NGN", BalanceKobo: 200},
		{AccountID: "a3", Type: "fees_unswept:co1:USD", BalanceKobo: 50},
	}}
	m := New(fakeReader{}, l)
	rows, err := m.UnsweptFeesByAccount(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if l.prefix != "fees_unswept:" {
		t.Fatalf("prefix %q", l.prefix)
	}
	if len(rows) != 3 || rows[0].Company != "co1" || rows[0].Currency != "NGN" || rows[0].Minor != 300 {
		t.Fatalf("rows %+v", rows)
	}
	tot := TotalsByCurrency(rows)
	if tot["NGN"] != 500 || tot["USD"] != 50 {
		t.Fatalf("totals %v", tot)
	}
}

func TestUnsweptMalformedType(t *testing.T) {
	m := New(fakeReader{}, &fakeLedger{accts: []ledger.AccountBalance{{Type: "fees_unswept:bad", BalanceKobo: 1}}})
	if _, err := m.UnsweptFeesByAccount(context.Background()); err == nil {
		t.Fatal("want error")
	}
}

func TestForecast(t *testing.T) {
	f, err := Forecast(1_000_000, 300_000, 7)
	if err != nil {
		t.Fatal(err)
	}
	// need 2_100_000 over 7 days; balance 1_000_000 -> shortfall 1_100_000; cover 3 full days.
	if f.RequiredMinor != 2_100_000 || f.ShortfallMinor != 1_100_000 || f.DaysOfCover != 3 {
		t.Fatalf("%+v", f)
	}
	f, _ = Forecast(5_000_000, 300_000, 7)
	if f.ShortfallMinor != 0 || f.DaysOfCover != 16 {
		t.Fatalf("%+v", f)
	}
	f, _ = Forecast(10, 0, 7)
	if f.ShortfallMinor != 0 || f.DaysOfCover != -1 {
		t.Fatalf("zero outflow: %+v", f)
	}
	if _, err := Forecast(1, -1, 7); err == nil {
		t.Fatal("negative outflow must error")
	}
	if _, err := Forecast(1, 1, 0); err == nil {
		t.Fatal("horizon must be positive")
	}
	if _, err := Forecast(1, 1<<62, 10); err == nil {
		t.Fatal("overflow must error")
	}
}

func TestPrefundForecastNGN(t *testing.T) {
	m := New(fakeReader{bals: []Balance{{Currency: "NGN", Minor: 1_000_000}}}, &fakeLedger{})
	f, err := m.PrefundForecast(context.Background(), "NGN", 500_000, 4)
	if err != nil || f.ShortfallMinor != 1_000_000 || f.DaysOfCover != 2 || f.BalanceMinor != 1_000_000 {
		t.Fatalf("%+v %v", f, err)
	}
	if _, err := m.PrefundForecast(context.Background(), "KES", 1, 1); err == nil {
		t.Fatal("missing currency must error")
	}
}
