package money

import (
	"errors"
	"math"
	"testing"

	"github.com/shopspring/decimal"
)

func d(s string) decimal.Decimal {
	v, err := decimal.NewFromString(s)
	if err != nil {
		panic(err)
	}
	return v
}

func TestKoboAddSubChecked(t *testing.T) {
	if got, err := Kobo(150).Add(250); err != nil || got != 400 {
		t.Fatalf("add = %v, %v", got, err)
	}
	if _, err := Kobo(math.MaxInt64).Add(1); !errors.Is(err, ErrOverflow) {
		t.Fatalf("add overflow err = %v, want ErrOverflow", err)
	}
	if _, err := Kobo(math.MinInt64).Add(-1); !errors.Is(err, ErrOverflow) {
		t.Fatalf("add underflow err = %v, want ErrOverflow", err)
	}
	if got, err := Kobo(100).Sub(40); err != nil || got != 60 {
		t.Fatalf("sub = %v, %v", got, err)
	}
	if _, err := Kobo(0).Sub(math.MinInt64); !errors.Is(err, ErrOverflow) {
		t.Fatalf("sub MinInt64 err = %v, want ErrOverflow", err)
	}
}

func TestKoboStringIsExact(t *testing.T) {
	cases := map[Kobo]string{0: "0.00", 5: "0.05", 1234: "12.34", 150000000: "1500000.00"}
	for k, want := range cases {
		if got := k.String(); got != want {
			t.Errorf("Kobo(%d).String() = %q, want %q", k, got, want)
		}
	}
}

func TestKoboFromNGNRounding(t *testing.T) {
	cases := []struct {
		in   string
		mode Rounding
		want Kobo
	}{
		{"12.345", RoundDown, 1234},
		{"12.345", RoundUp, 1235},
		{"12.345", RoundNearest, 1235},
		{"12.344", RoundNearest, 1234},
		{"100", RoundDown, 10000},
	}
	for _, c := range cases {
		got, err := KoboFromNGN(d(c.in), c.mode)
		if err != nil || got != c.want {
			t.Errorf("KoboFromNGN(%s, %d) = %d, %v; want %d", c.in, c.mode, got, err, c.want)
		}
	}
}

func TestKoboFromNGNOverflowFailsClosed(t *testing.T) {
	huge := decimal.NewFromInt(math.MaxInt64).Div(decimal.NewFromInt(50))
	if _, err := KoboFromNGN(huge, RoundDown); !errors.Is(err, ErrOverflow) {
		t.Fatalf("err = %v, want ErrOverflow", err)
	}
}

func TestNewAssetBounds(t *testing.T) {
	if _, err := NewAsset("", 6); err == nil {
		t.Error("empty code accepted")
	}
	if _, err := NewAsset("USDT", -1); err == nil {
		t.Error("negative decimals accepted")
	}
	if _, err := NewAsset("ETH", 19); err == nil {
		t.Error("decimals > 18 accepted")
	}
	if a, err := NewAsset("ETH", 18); err != nil || a.Decimals != 18 {
		t.Errorf("ETH/18 = %+v, %v", a, err)
	}
}

func TestAssetQuantizeDirection(t *testing.T) {
	usdt, _ := NewAsset("USDT", 2)
	got, _ := usdt.Quantize(d("1.239"), RoundDown)
	if got.String() != "1.23" {
		t.Errorf("down = %s", got)
	}
	got, _ = usdt.Quantize(d("1.231"), RoundUp)
	if got.String() != "1.24" {
		t.Errorf("up = %s", got)
	}
}

func TestAssetValidateRejectsFinerThanPrecision(t *testing.T) {
	usdt, _ := NewAsset("USDT", 2)
	if err := usdt.Validate(d("1.23")); err != nil {
		t.Errorf("exact value rejected: %v", err)
	}
	if err := usdt.Validate(d("1.234")); !errors.Is(err, ErrPrecision) {
		t.Errorf("finer value err = %v, want ErrPrecision", err)
	}
	if err := usdt.Validate(d("0")); !errors.Is(err, ErrNotPositive) {
		t.Errorf("zero err = %v, want ErrNotPositive", err)
	}
	if err := usdt.Validate(d("-1")); !errors.Is(err, ErrNotPositive) {
		t.Errorf("negative err = %v, want ErrNotPositive", err)
	}
}

func TestEighteenDecimalAssetKeepsFullPrecision(t *testing.T) {
	eth, _ := NewAsset("ETH", 18)
	v := d("0.000000000000000001")
	if err := eth.Validate(v); err != nil {
		t.Fatalf("1 wei rejected: %v", err)
	}
}
