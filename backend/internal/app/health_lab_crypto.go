package app

import (
	"context"

	"spotlight/backend/internal/crypto"
	healthlab "spotlight/backend/internal/health/lab"
)

// labCryptoAdapter satisfies healthlab.CryptoPayer over the ledger-integrated
// crypto service. Sell credits the patient's NGN wallet from the escrow standing
// account (balanced ledger legs, idempotent on the key); the lab then HELDs it.
type labCryptoAdapter struct{ c *crypto.Service }

func (a labCryptoAdapter) AssetPrice(ctx context.Context, assetID string) (*healthlab.CryptoAssetPrice, error) {
	assets, err := a.c.ListAssets(ctx, true) // active only
	if err != nil {
		return nil, err
	}
	q, err := a.c.Quote(ctx, assetID)
	if err != nil {
		return nil, err
	}
	for _, as := range assets {
		if as.ID == assetID {
			return &healthlab.CryptoAssetPrice{AssetID: as.ID, Symbol: as.Symbol, PriceKobo: q.PriceKobo, MinorUnitScale: as.MinorUnitScale}, nil
		}
	}
	return nil, crypto.ErrAssetInactive
}

func (a labCryptoAdapter) SellToWallet(ctx context.Context, userID, assetID string, units int64, idemKey string) (int64, error) {
	o, err := a.c.Sell(ctx, userID, assetID, units, idemKey)
	if err != nil {
		return 0, err
	}
	return o.CashKobo, nil
}
