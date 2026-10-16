package vertofx

import (
	"context"
	"errors"
	"net/http"
)

// WalletTransfer is a booked wallet-to-wallet transfer.
type WalletTransfer struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	PaymentID string `json:"paymentId"`
}

// WalletToWallet moves amountMinor of currency between two Verto wallets
// (POST /wallets/transfer). Idempotent by paymentID, so transient failures are
// safely retried and a replay returns the original transfer.
//
// MODELED: the path, body and response shape are NOT confirmed against the
// Verto sandbox (sweep approval V5/V18 is open). The amount field is named
// "amountMinor" deliberately: if Verto expects major units or another name the
// call is rejected (fails closed) rather than moving a wrong magnitude. Confirm
// shape, units and paymentID idempotency at the V5/V18 sandbox before enabling
// FEATURE_VERTO_FEE_SWEEP.
func (c *Client) WalletToWallet(ctx context.Context, fromWalletID, toWalletID, currency string, amountMinor int64, paymentID string) (WalletTransfer, error) {
	switch {
	case fromWalletID == "" || toWalletID == "":
		return WalletTransfer{}, errors.New("vertofx: wallet transfer: both wallet ids are required")
	case fromWalletID == toWalletID:
		return WalletTransfer{}, errors.New("vertofx: wallet transfer: source and target wallets are identical")
	case currency == "":
		return WalletTransfer{}, errors.New("vertofx: wallet transfer: currency is required")
	case amountMinor <= 0:
		return WalletTransfer{}, errors.New("vertofx: wallet transfer: amount must be positive")
	case paymentID == "":
		return WalletTransfer{}, errors.New("vertofx: wallet transfer: paymentID (idempotency key) is required")
	}
	if !c.live() {
		return WalletTransfer{ID: "mock-w2w-" + paymentID, Status: "completed", PaymentID: paymentID}, nil
	}
	body := map[string]any{
		"paymentId":      paymentID,
		"sourceWalletId": fromWalletID,
		"targetWalletId": toWalletID,
		"currency":       currency,
		"amountMinor":    amountMinor,
	}
	var resp struct {
		Data WalletTransfer `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/wallets/transfer", body, &resp, true); err != nil {
		return WalletTransfer{}, err
	}
	if resp.Data.ID == "" {
		return WalletTransfer{}, errors.New("vertofx: wallet transfer: invalid response")
	}
	return resp.Data, nil
}
