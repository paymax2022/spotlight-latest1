package transfers

import "testing"

// requirePayoutableStatus is the non-terminal guard every payout-leg call site
// now runs under the claim lock on a freshly re-read row. The bug it closes: a
// reversal or settle landing between the caller's reserve/fund commit and the
// leg claim — with no guard, the leg fired the provider against an already-
// refunded row (refund + payout = double spend).

func TestRequirePayoutableStatus(t *testing.T) {
	accept := []BankTransferStatus{
		BankTransferFundsReserved,
		BankTransferFunded,
		BankTransferProviderInitiated,
	}
	reject := []BankTransferStatus{
		BankTransferAwaitingFunding, // bank→bank not yet paid in — nothing to disburse
		BankTransferSuccessful,
		BankTransferFailed,
		BankTransferReversed,
	}
	for _, st := range accept {
		if err := requirePayoutableStatus(&BankTransfer{Status: st}); err != nil {
			t.Errorf("requirePayoutableStatus(%q) = %v, want nil", st, err)
		}
	}
	for _, st := range reject {
		if err := requirePayoutableStatus(&BankTransfer{Status: st}); err == nil {
			t.Errorf("requirePayoutableStatus(%q) = nil, want refusal", st)
		}
	}
}
