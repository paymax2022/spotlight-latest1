package app

import (
	"context"
	"errors"
	"testing"

	providerInterfaces "spotlight/backend/internal/provider"
)

type stubResolver struct {
	providerInterfaces.DisbursementProvider
	name  string
	err   error
	calls *int
}

func (s stubResolver) ResolveAccount(_ context.Context, bankCode, acct string) (*providerInterfaces.AccountResolution, error) {
	*s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return &providerInterfaces.AccountResolution{AccountName: s.name, AccountNumber: acct, BankCode: bankCode}, nil
}

func TestNameEnquiryResolver_PrefersMonnifyThenPaystack(t *testing.T) {
	ctx := context.Background()
	var mCalls, pCalls int
	monnify := stubResolver{name: "JOHN SMITH", calls: &mCalls}
	paystack := stubResolver{name: "PAYSTACK NAME", calls: &pCalls}

	r := newNameEnquiryResolver(monnify, paystack)
	res, err := r.ResolveAccount(ctx, "057", "0123456789")
	if err != nil || res.AccountName != "JOHN SMITH" || pCalls != 0 {
		t.Fatalf("monnify first: res=%+v err=%v paystack calls=%d", res, err, pCalls)
	}

	// Monnify rejects (e.g. a bank code it does not know) → Paystack answers.
	r = newNameEnquiryResolver(stubResolver{err: errors.New("invalid bank code"), calls: &mCalls}, paystack)
	if res, err := r.ResolveAccount(ctx, "50211", "0123456789"); err != nil || res.AccountName != "PAYSTACK NAME" {
		t.Fatalf("fallback: res=%+v err=%v", res, err)
	}

	// An empty holder name is not an answer.
	r = newNameEnquiryResolver(stubResolver{name: "  ", calls: &mCalls}, paystack)
	if res, _ := r.ResolveAccount(ctx, "057", "0123456789"); res == nil || res.AccountName != "PAYSTACK NAME" {
		t.Fatalf("blank monnify name must fall through: %+v", res)
	}

	// Both fail → error, never a made-up name.
	r = newNameEnquiryResolver(stubResolver{err: errors.New("down"), calls: &mCalls}, stubResolver{err: errors.New("down"), calls: &pCalls})
	if _, err := r.ResolveAccount(ctx, "057", "0123456789"); err == nil {
		t.Fatal("both providers failing must be an error")
	}

	// Only configured clients are used; none configured → nil (no verification).
	if r := newNameEnquiryResolver(nil, paystack); r == nil {
		t.Fatal("paystack alone should still resolve")
	}
	if r := newNameEnquiryResolver(nil, nil); r != nil {
		t.Fatal("no configured provider must give nil, not a mock")
	}
}
