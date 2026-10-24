package app

import (
	"context"
	"errors"
	"strings"

	providerInterfaces "spotlight/backend/internal/provider"
)

// nameEnquiryResolver answers bank name-enquiry (account number → holder name)
// for payout-account verification: Monnify first, then Paystack.
//
// It holds only REAL, configured clients — never the disbursement registry,
// whose entry for an unconfigured provider is a mock that invents holder names
// and would silently defeat the name check. A provider that errors (for example
// a bank code it does not recognise: the app's bank list uses Paystack codes,
// which differ from Monnify's for some fintech banks) or returns a blank name
// falls through to the next one; if none answers, the caller gets an error and
// the account stays unverified.
type nameEnquiryResolver struct {
	// The base provider supplies the rest of the interface; only ResolveAccount
	// is used by payout-account verification.
	providerInterfaces.DisbursementProvider
	order []providerInterfaces.DisbursementProvider
}

// newNameEnquiryResolver returns nil when neither client is configured, so
// callers keep their "no provider ⇒ no verification" behaviour.
func newNameEnquiryResolver(monnify, paystack providerInterfaces.DisbursementProvider) providerInterfaces.DisbursementProvider {
	var order []providerInterfaces.DisbursementProvider
	for _, p := range []providerInterfaces.DisbursementProvider{monnify, paystack} {
		if p != nil {
			order = append(order, p)
		}
	}
	if len(order) == 0 {
		return nil
	}
	return nameEnquiryResolver{DisbursementProvider: order[0], order: order}
}

func (r nameEnquiryResolver) ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*providerInterfaces.AccountResolution, error) {
	var errs []error
	for _, p := range r.order {
		res, err := p.ResolveAccount(ctx, bankCode, accountNumber)
		if err == nil && res != nil && strings.TrimSpace(res.AccountName) != "" {
			return res, nil
		}
		if err == nil {
			err = errors.New("blank account name")
		}
		errs = append(errs, err)
	}
	return nil, errors.Join(append([]error{errors.New("name enquiry failed on every provider")}, errs...)...)
}
