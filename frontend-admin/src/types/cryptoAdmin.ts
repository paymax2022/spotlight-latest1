// Paymax Crypto admin console — domain types.
// Mirrors backend/internal/crypto/model.go. Admin routes are mounted at
// /api/v1/admin/crypto (member routes at /api/v1/crypto), gated by
// FEATURE_CRYPTO_ENABLED and RBAC guard(crypto.admin) — see
// backend/internal/app/finance_routes.go and backend/internal/crypto/routes.go.
// Backend RBAC is authoritative — permission gates in the UI are UX-only.
//
// Money: price_kobo / cash_kobo / value_kobo are integers (NGN kobo). NEVER do
// math on these in floats — format-only via formatKobo() in the service layer.
// `units` / `minor_unit_scale` are integer asset-minor-unit fields (not money).

export type CryptoOrderSide = 'buy' | 'sell';

export type CryptoOrderStatus = 'pending' | 'filled' | 'failed' | 'reversed' | string;

export interface CryptoAsset {
  id: string;
  symbol: string;
  name: string;
  minor_unit_scale: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CryptoOrder {
  id: string;
  user_id: string;
  asset_id: string;
  symbol?: string;
  side: CryptoOrderSide;
  status: CryptoOrderStatus;
  cash_kobo: number;
  units: number;
  price_kobo: number;
  reference?: string;
  created_at: string;
}

// POST /api/v1/admin/crypto/assets body — create or update a catalogue asset.
export interface CryptoAssetConfigRequest {
  symbol: string;
  name: string;
  minor_unit_scale: number;
  is_active: boolean;
}
