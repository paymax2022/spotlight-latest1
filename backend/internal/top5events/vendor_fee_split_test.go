package top5events

import "testing"

func TestVendorFeeSplit(t *testing.T) {
	cases := []struct {
		gross   int64
		bps     int
		fee     int64
		netKobo int64
	}{
		{0, 500, 0, 0},
		{-10, 500, 0, 0},
		{10_000, 0, 0, 10_000},
		{10_000, 250, 250, 9_750},
		{33_33, 750, 249, 3_084}, // truncates toward zero, in the vendor's favour
		{1, 9_999, 0, 1},
		{10_000, 10_000, 10_000, 0},
	}
	for _, c := range cases {
		fee, net := vendorFeeSplit(c.gross, c.bps)
		if fee != c.fee || net != c.netKobo {
			t.Errorf("vendorFeeSplit(%d, %d) = %d/%d, want %d/%d", c.gross, c.bps, fee, net, c.fee, c.netKobo)
		}
		if c.gross > 0 && fee+net != c.gross {
			t.Errorf("vendorFeeSplit(%d, %d): fee+net = %d, want gross", c.gross, c.bps, fee+net)
		}
	}
}
