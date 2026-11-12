// Client presentation copy for crypto assets. Nothing in this file is money: no
// price, no fee, no limit, no capability flag — every one of those arrives from the
// server (see ../api/wire.ts). What lives here are the three things the Go crypto
// plane has no column for: the glyph colour, the risk rating a member sees next to
// an asset, and the short blurb on the asset page.
//
// The network entry is the one factual claim here. It records the chain Paymax's
// exchange partner settles a symbol on — observed from that partner's deposit-address
// responses — and it exists because an address screen must label the chain a member is
// pasting into. A symbol with no entry has no published network, and the screens that
// read it must say so rather than offering a picker full of chains Paymax cannot settle.

import type { RiskRating } from '../types/crypto.types';

export interface AssetNetwork {
  id: string;
  name: string;
  confirmations: number;
}

export interface AssetCopy {
  brandColor: string;
  riskRating: RiskRating;
  blurb: string;
  riskNote: string;
  network?: AssetNetwork;
}

const DEFAULT_RISK_NOTE =
  'Crypto is volatile and you can lose money. This is not investment advice, and past prices do not predict future ones.';

const FALLBACK = (name: string): AssetCopy => ({
  brandColor: '#7C6BF2',
  riskRating: 'high',
  blurb: `${name} is listed in the Paymax crypto catalogue.`,
  riskNote: DEFAULT_RISK_NOTE,
});

const BY_SYMBOL: Record<string, AssetCopy> = {
  BTC: {
    brandColor: '#F7931A',
    riskRating: 'high',
    blurb: 'Bitcoin is the oldest and most liquid cryptocurrency, settling on its own chain.',
    riskNote: 'Bitcoin moves in large daily swings. Only trade an amount you can afford to leave invested.',
    network: { id: 'bitcoin', name: 'Bitcoin', confirmations: 3 },
  },
  ETH: {
    brandColor: '#627EEA',
    riskRating: 'high',
    blurb: 'Ethereum is the largest programmable blockchain, used as money and as an application platform.',
    riskNote: 'Ethereum moves in large daily swings. Only trade an amount you can afford to leave invested.',
    network: { id: 'ethereum', name: 'Ethereum (ERC-20)', confirmations: 12 },
  },
  USDT: {
    brandColor: '#26A17B',
    riskRating: 'low',
    blurb: 'Tether USDT is a dollar-pegged token used to hold value without holding naira.',
    riskNote: 'A stablecoin targets one US dollar but the peg is not guaranteed, and its issuer carries risk.',
    network: { id: 'tron', name: 'Tron (TRC-20)', confirmations: 19 },
  },
};

export function assetCopy(symbol: string, name: string): AssetCopy {
  return BY_SYMBOL[symbol.toUpperCase()] ?? FALLBACK(name);
}

/** A neutral colour for a history row when the symbol carries no brand entry. */
export function iconColorFor(symbol: string): string {
  return BY_SYMBOL[symbol.toUpperCase()]?.brandColor ?? '#7C6BF2';
}
