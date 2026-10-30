package transport

import (
	"testing"
	"time"
)

func TestDecideManualRefund(t *testing.T) {
	now := time.Now()
	stale := now.Add(-10 * time.Minute)
	fresh := now.Add(-30 * time.Second)
	base := manualRefundState{
		RefundStatus: RefundManualRequired, SettlementStatus: "settled", FundingSource: "wallet",
		TotalKobo: 500_000, ProviderKobo: 450_000, FeeKobo: 50_000,
	}
	cases := []struct {
		name string
		mut  func(*manualRefundState)
		req  BusManualRefundRequest
		want manualRefundVerdict
		code string
	}{
		{"wallet ok", nil, BusManualRefundRequest{Method: "wallet_refund", Reason: "r"}, manualRefundProceed, ""},
		{"offline ok", nil, BusManualRefundRequest{Method: "offline", Reason: "r", Reference: "BANK-1"}, manualRefundProceed, ""},
		{"reason required", nil, BusManualRefundRequest{Method: "wallet_refund"}, manualRefundReject, "REASON_REQUIRED"},
		{"offline needs reference", nil, BusManualRefundRequest{Method: "offline", Reason: "r"}, manualRefundReject, "REFERENCE_REQUIRED"},
		{"unknown method", nil, BusManualRefundRequest{Method: "cash", Reason: "r"}, manualRefundReject, "INVALID_METHOD"},
		{"already refunded replays", func(s *manualRefundState) { s.RefundStatus = RefundRefunded }, BusManualRefundRequest{Method: "offline", Reason: "r", Reference: "x"}, manualRefundReplay, ""},
		{"not in queue", func(s *manualRefundState) { s.RefundStatus = RefundPending }, BusManualRefundRequest{Method: "wallet_refund", Reason: "r"}, manualRefundReject, CodeInvalidState},
		{"wallet needs settled", func(s *manualRefundState) { s.SettlementStatus = "disputed" }, BusManualRefundRequest{Method: "wallet_refund", Reason: "r"}, manualRefundReject, CodeInvalidState},
		{"wallet needs wallet funding", func(s *manualRefundState) { s.FundingSource = "external" }, BusManualRefundRequest{Method: "wallet_refund", Reason: "r"}, manualRefundReject, CodeInvalidState},
		{"legs must sum to total", func(s *manualRefundState) { s.FeeKobo = 1 }, BusManualRefundRequest{Method: "wallet_refund", Reason: "r"}, manualRefundReject, "SETTLEMENT_LEGS_MISMATCH"},
		{"offline on disputed ok", func(s *manualRefundState) { s.SettlementStatus = "disputed" }, BusManualRefundRequest{Method: "offline", Reason: "r", Reference: "x"}, manualRefundProceed, ""},
		{"same claimed method resumes", func(s *manualRefundState) { s.ClaimedMethod = "wallet_refund"; s.ClaimedAt = &fresh }, BusManualRefundRequest{Method: "wallet_refund", Reason: "r"}, manualRefundProceed, ""},
		{"switch away from fresh wallet claim", func(s *manualRefundState) { s.ClaimedMethod = "wallet_refund"; s.ClaimedAt = &fresh }, BusManualRefundRequest{Method: "offline", Reason: "r", Reference: "x"}, manualRefundReject, "METHOD_LOCKED"},
		{"switch away once a leg posted", func(s *manualRefundState) {
			s.ClaimedMethod = "wallet_refund"
			s.ClaimedAt = &stale
			s.AnyLegPosted = true
		}, BusManualRefundRequest{Method: "offline", Reason: "r", Reference: "x"}, manualRefundReject, "METHOD_LOCKED"},
		{"switch away from stale unposted wallet claim", func(s *manualRefundState) { s.ClaimedMethod = "wallet_refund"; s.ClaimedAt = &stale }, BusManualRefundRequest{Method: "offline", Reason: "r", Reference: "x"}, manualRefundProceed, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := base
			if tc.mut != nil {
				tc.mut(&st)
			}
			v, ce := decideManualRefund(st, tc.req, now)
			if v != tc.want {
				t.Fatalf("verdict = %v, want %v (err %v)", v, tc.want, ce)
			}
			got := ""
			if ce != nil {
				got = ce.Code
			}
			if got != tc.code {
				t.Fatalf("code = %q, want %q", got, tc.code)
			}
		})
	}
}

func TestBusAdminTicketFilterClamp(t *testing.T) {
	f := BusAdminTicketFilter{Limit: 0, Offset: -3}
	f.normalize()
	if f.Limit != 50 || f.Offset != 0 {
		t.Fatalf("defaults: %+v", f)
	}
	f = BusAdminTicketFilter{Limit: 5000}
	f.normalize()
	if f.Limit != 100 {
		t.Fatalf("max page size not enforced: %d", f.Limit)
	}
}
