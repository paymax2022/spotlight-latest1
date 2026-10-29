// Wire shapes (snake_case, integer minor units) for POST /api/v1/crypto/swap[/quote].
export interface SwapQuoteWire {
  quotation_id: string;
  from_asset_id: string;
  to_asset_id: string;
  from_units: number;
  to_units: number;
  from_price_kobo: number;
  to_price_kobo: number;
  expires_at: string; // ISO
}

export interface SwapOrderWire {
  id: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  from_units: number;
  to_units: number;
  from_price_kobo?: number;
  to_price_kobo?: number;
  cash_kobo?: number;
  spread_kobo: number;
  spread_bps: number;
}

/** Settlement lookup from GET /api/v1/crypto/swaps/:id/settlement (member-scoped). */
export interface SettlementStatus {
  ledger_settled: boolean;
  settled_at?: string | null; // ISO timestamp; null until settled
}

export type SwapStatus = 'idle' | 'confirming' | 'executing' | 'complete' | 'failed';
