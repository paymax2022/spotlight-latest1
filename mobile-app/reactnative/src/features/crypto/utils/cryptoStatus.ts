// What the customer can do right now, from the server's operational controls
// (GET /crypto/status: trading pause, withdrawal kill switch, switched-off markets, banner)
// and the asset itself. The SERVER enforces all of this; the app only explains it up front
// instead of letting someone fill in a form the server will refuse. Pure, for node --test.

export type BannerSeverity = 'info' | 'warning' | 'critical';

export interface CryptoStatus {
  tradingPaused: boolean;
  withdrawalsPaused: boolean;
  disabledAssets: string[];
  maxQuoteKobo: number;
  banner: { message: string; severity: BannerSeverity } | null;
}

/** 'unknown' = the status could not be read; the server refuses trades then too. */
export type StatusRead = CryptoStatus | 'unknown' | null; // null = this backend has no status route

export function parseStatus(raw: unknown): CryptoStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const b = r.banner as Record<string, unknown> | null | undefined;
  const sev = b?.severity;
  return {
    tradingPaused: r.trading_paused === true,
    withdrawalsPaused: r.withdrawals_paused === true,
    disabledAssets: Array.isArray(r.disabled_assets) ? r.disabled_assets.filter((a): a is string => typeof a === 'string').map((a) => a.toUpperCase()) : [],
    maxQuoteKobo: typeof r.max_quote_kobo === 'number' && Number.isSafeInteger(r.max_quote_kobo) ? r.max_quote_kobo : 0,
    banner: b && typeof b.message === 'string' && b.message.trim() && (sev === 'info' || sev === 'warning' || sev === 'critical')
      ? { message: b.message.trim(), severity: sev }
      : null,
  };
}

export interface AssetFlags {
  symbol: string;
  status: string; // 'active' | 'paused' | 'delisted' | …
  buyEnabled: boolean;
  sellEnabled: boolean;
  withdrawalEnabled?: boolean;
}

export interface Availability {
  canBuy: boolean;
  canSell: boolean;
  /** One plain sentence for why trading is off, or null when it's on. */
  tradeReason: string | null;
}

export function tradeAvailability(st: StatusRead, a: AssetFlags): Availability {
  const sym = a.symbol.toUpperCase();
  if (a.status === 'delisted') return { canBuy: false, canSell: false, tradeReason: `${sym} has been delisted and is no longer tradable on Paymax.` };
  if (st === 'unknown') return { canBuy: false, canSell: false, tradeReason: "We can't confirm crypto trading is available right now. Try again in a moment." };
  if (st && st.tradingPaused) return { canBuy: false, canSell: false, tradeReason: 'Crypto trading is paused for maintenance. Your holdings are safe and you can still track prices.' };
  if (st && st.disabledAssets.includes(sym)) return { canBuy: false, canSell: false, tradeReason: `Trading in ${sym} is paused. You can still track its price here.` };
  if (a.status !== 'active') return { canBuy: false, canSell: false, tradeReason: `Trading for ${sym} is temporarily paused. You can still track its price here.` };
  const canBuy = a.buyEnabled;
  const canSell = a.sellEnabled;
  return { canBuy, canSell, tradeReason: canBuy || canSell ? null : `Trading for ${sym} is temporarily paused.` };
}

/** Why withdrawals are off, or null when they're on. */
export function withdrawalBlock(st: StatusRead): string | null {
  if (st === 'unknown') return "We can't confirm withdrawals are available right now, so none can be sent. Try again in a moment.";
  if (st && st.withdrawalsPaused) return 'Crypto withdrawals are paused for now. Your crypto is safe in your account, and nothing has been sent.';
  return null;
}
