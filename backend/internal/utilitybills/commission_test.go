package utilitybills

import "testing"

// The (service, subtype) pair selects which commission_config row prices a
// transaction, which decides both the convenience fee the CUSTOMER pays and the
// revenue Paymax books. A wrong match mis-prices real money, so these pin the
// exact matching rules ported from commission/config.ts.

func TestCategoryToCommissionService(t *testing.T) {
	cases := map[Category]string{
		CategoryElectricity: "Electricity",
		CategoryCableTV:     "CableTv",
		CategoryAirtime:     "Airtime",
		CategoryData:        "Data",
		CategoryEducation:   "Education",
		// 'internet' has NO mapped service, deliberately: the TS source lets it
		// resolve to null so the caller keeps legacy utility_products pricing.
		CategoryInternet: "",
	}
	for category, want := range cases {
		if got := CategoryToCommissionService(category); got != want {
			t.Fatalf("%s: got %q want %q", category, got, want)
		}
	}
}

func TestDeriveCommissionSubtype_ExactMatchWinsOverSubstring(t *testing.T) {
	// The collision the TS source's comment calls out: 'Aba' is a substring of
	// 'Abuja'. An exact-equality pass must run FIRST, or an Aba customer is priced
	// off Abuja's rate card.
	if got := DeriveCommissionSubtype("Electricity", "vtpass-aba-electric", "Aba Electric"); got != "Aba" {
		t.Fatalf("aba: got %q want %q", got, "Aba")
	}
	if got := DeriveCommissionSubtype("Electricity", "vtpass-abuja-electric", "Abuja Electric"); got != "Abuja" {
		t.Fatalf("abuja: got %q want %q", got, "Abuja")
	}
}

func TestDeriveCommissionSubtype_BillerCodeNormalisation(t *testing.T) {
	cases := []struct {
		service    string
		billerCode string
		billerName string
		want       string
	}{
		{"Electricity", "vtpass-portharcourt-electric", "Port Harcourt Electric", "PortHarcourt"},
		{"Electricity", "ikeja-electric", "Ikeja Electric", "Ikeja"},
		{"Electricity", "vtpass-eko-electric", "Eko Electric", "Eko"},
		{"CableTv", "vtpass-dstv", "DStv", "DSTV"},
		{"CableTv", "vtpass-gotv", "GOtv", "GoTV"},
		{"Airtime", "vtpass-mtn-airtime", "MTN Nigeria", "MTN"},
		{"Data", "vtpass-spectranet-data", "Spectranet", "Spectranet"},
		{"Education", "waec", "WAEC Result Checker", "WAEC"},
	}
	for _, tc := range cases {
		if got := DeriveCommissionSubtype(tc.service, tc.billerCode, tc.billerName); got != tc.want {
			t.Fatalf("%s/%s: got %q want %q", tc.service, tc.billerCode, got, tc.want)
		}
	}
}

func TestDeriveCommissionSubtype_LooseMatchFindsStartimes(t *testing.T) {
	// 'startimes' contains 'Startime' — the pass-2 substring case the TS comment
	// gives as its example.
	if got := DeriveCommissionSubtype("CableTv", "vtpass-startimes", "StarTimes"); got != "Startime" {
		t.Fatalf("got %q want %q", got, "Startime")
	}
}

func TestDeriveCommissionSubtype_NoMatchFallsBackToServiceLevel(t *testing.T) {
	// An unmatched biller returns "" so the caller falls back to the service-level
	// ('') config row — never an arbitrary subtype.
	if got := DeriveCommissionSubtype("Electricity", "vtpass-unknown-disco", "Somewhere Else Power"); got != "" {
		t.Fatalf("got %q want empty", got)
	}
	// A service with no subtype table at all likewise yields "".
	if got := DeriveCommissionSubtype("Internet", "vtpass-smile", "Smile"); got != "" {
		t.Fatalf("unknown service: got %q want empty", got)
	}
}

func TestApplyCommissionConvenienceFee_NoConfigIsIdentity(t *testing.T) {
	in := Pricing{
		AmountKobo: 500_000, MarkupKobo: 0, ConvenienceFeeKobo: 10_000,
		RetailAmountKobo: 510_000, ProviderCostKobo: 490_000,
		GrossProfitKobo: 20_000, GrossMarginBps: 392,
	}
	if got := ApplyCommissionConvenienceFee(in, 0, false); got != in {
		t.Fatalf("no config must be identity: got %+v want %+v", got, in)
	}
}

func TestApplyCommissionConvenienceFee_SameFeeIsIdentity(t *testing.T) {
	// The current seeded case for every category: the config fee equals the
	// utility_products fee, so amounts must not move at all.
	in := Pricing{
		AmountKobo: 500_000, ConvenienceFeeKobo: 10_000,
		RetailAmountKobo: 510_000, ProviderCostKobo: 490_000,
		GrossProfitKobo: 20_000, GrossMarginBps: 392,
	}
	if got := ApplyCommissionConvenienceFee(in, 10_000, true); got != in {
		t.Fatalf("identical fee must be identity: got %+v want %+v", got, in)
	}
}

func TestApplyCommissionConvenienceFee_HigherFeeMovesRetailAndProfit(t *testing.T) {
	in := Pricing{
		AmountKobo: 500_000, MarkupKobo: 0, ConvenienceFeeKobo: 10_000,
		RetailAmountKobo: 510_000, ProviderCostKobo: 490_000,
		GrossProfitKobo: 20_000, GrossMarginBps: 392,
	}
	got := ApplyCommissionConvenienceFee(in, 15_000, true)

	if got.ConvenienceFeeKobo != 15_000 {
		t.Fatalf("fee: got %d want 15000", got.ConvenienceFeeKobo)
	}
	if got.RetailAmountKobo != 515_000 {
		t.Fatalf("retail: got %d want 515000", got.RetailAmountKobo)
	}
	if got.GrossProfitKobo != 25_000 {
		t.Fatalf("gross profit: got %d want 25000", got.GrossProfitKobo)
	}
	// floor(25000 * 10000 / 515000) == floor(485.43…) == 485
	if got.GrossMarginBps != 485 {
		t.Fatalf("margin bps: got %d want 485", got.GrossMarginBps)
	}
	// Everything upstream of the fee is untouched.
	if got.AmountKobo != in.AmountKobo || got.MarkupKobo != in.MarkupKobo || got.ProviderCostKobo != in.ProviderCostKobo {
		t.Fatalf("upstream fields moved: %+v", got)
	}
}

func TestApplyCommissionConvenienceFee_LowerFeeReducesRetail(t *testing.T) {
	in := Pricing{
		AmountKobo: 500_000, ConvenienceFeeKobo: 10_000,
		RetailAmountKobo: 510_000, ProviderCostKobo: 490_000,
		GrossProfitKobo: 20_000, GrossMarginBps: 392,
	}
	got := ApplyCommissionConvenienceFee(in, 0, true)
	if got.ConvenienceFeeKobo != 0 || got.RetailAmountKobo != 500_000 || got.GrossProfitKobo != 10_000 {
		t.Fatalf("fee removal: got %+v", got)
	}
	// floor(10000 * 10000 / 500000) == 200
	if got.GrossMarginBps != 200 {
		t.Fatalf("margin bps: got %d want 200", got.GrossMarginBps)
	}
}

func TestApplyCommissionConvenienceFee_NegativeProfitFloorsTowardNegativeInfinity(t *testing.T) {
	// An underpriced product can price at a loss. The margin must truncate the same
	// direction the original pricing math does (Math.floor), not toward zero.
	in := Pricing{
		AmountKobo: 100_000, ConvenienceFeeKobo: 5_000,
		RetailAmountKobo: 105_000, ProviderCostKobo: 110_000,
		GrossProfitKobo: -5_000, GrossMarginBps: -477,
	}
	got := ApplyCommissionConvenienceFee(in, 4_000, true)
	// retail 104000, profit -6000 → floor(-6000*10000/104000) = floor(-576.92…) = -577
	if got.GrossMarginBps != -577 {
		t.Fatalf("negative margin: got %d want -577 (must floor, not truncate toward zero)", got.GrossMarginBps)
	}
}
