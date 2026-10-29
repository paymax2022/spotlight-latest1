package ledger

import (
	"context"
	"errors"
	"testing"
)

type fakeResolver struct {
	prefix string
	detail *ModuleTransactionDetail
	err    error
}

func (f fakeResolver) Resolve(_ context.Context, ref string) (*ModuleTransactionDetail, bool, error) {
	if len(ref) < len(f.prefix) || ref[:len(f.prefix)] != f.prefix {
		return nil, false, nil
	}
	if f.err != nil {
		return nil, false, f.err
	}
	return f.detail, true, nil
}

func TestResolveModuleDetail(t *testing.T) {
	biller := "MTN"
	want := &ModuleTransactionDetail{Module: "utility_bill", PaymentMethod: "paystack", Biller: &biller}
	s := &Service{}
	s.SetResolvers([]TransactionDetailResolver{
		fakeResolver{prefix: "fx:", err: errors.New("boom")},
		fakeResolver{prefix: "UTL-", detail: want},
	})

	if got := s.resolveModuleDetail(context.Background(), "UTL-20261025-AB12"); got != want {
		t.Fatalf("matching reference: got %+v, want %+v", got, want)
	}
	if got := s.resolveModuleDetail(context.Background(), "fx:abc"); got != nil {
		t.Fatalf("a failing resolver must be skipped, got %+v", got)
	}
	if got := s.resolveModuleDetail(context.Background(), "unknown-ref"); got != nil {
		t.Fatalf("unmatched reference must yield nil, got %+v", got)
	}
}
