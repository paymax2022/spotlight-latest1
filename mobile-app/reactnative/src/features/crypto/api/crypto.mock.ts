// ── Paymax Invest · Crypto — Mock fixtures ───────────────────────────────────
// Deterministic seed data so every UI state renders in mock mode. Flip
// EXPO_PUBLIC_CRYPTO_USE_MOCK=false to hit the real Go endpoints (crypto.api.ts).
// All fiat is NGN kobo (minor units); crypto is base-unit minor units.

import { Colors } from '@/constants/colors';
import type {
  CryptoAsset,
  CryptoTransactionDetail,
  Position,
} from '../types/crypto.types';

const ngn = (major: number) => Math.round(major * 100);

// ─── Whitelisted assets (admin-controlled in production) ──────────────────────

export const MOCK_ASSETS: CryptoAsset[] = [
  {
    id: 'ast_btc', type: 'crypto', symbol: 'BTC', name: 'Bitcoin', decimals: 8,
    iconColor: '#F7931A', riskRating: 'medium', status: 'active',
    buyEnabled: true, sellEnabled: true, depositEnabled: true, withdrawalEnabled: true,
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(50_000_000),
    price: { amount: ngn(98_420_000), currency: 'NGN' }, change24hPct: 2.41,
    marketCap: { amount: ngn(1_940_000_000_000_000), currency: 'NGN' },
    volume24h: { amount: ngn(48_200_000_000_000), currency: 'NGN' },
    supportedNetworks: [{ id: 'bitcoin', name: 'Bitcoin', confirmations: 2 }],
    description:
      'Bitcoin is the first and largest cryptocurrency by market value. It runs on a decentralised network and is often used as a long-term store of value.',
    riskDisclosure:
      'Bitcoin is volatile and its price can move sharply in either direction within a single day.',
    kycTierRequired: 2,
  },
  {
    id: 'ast_eth', type: 'crypto', symbol: 'ETH', name: 'Ethereum', decimals: 8,
    iconColor: '#627EEA', riskRating: 'medium', status: 'active',
    buyEnabled: true, sellEnabled: true, depositEnabled: true, withdrawalEnabled: true,
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(30_000_000),
    price: { amount: ngn(5_280_000), currency: 'NGN' }, change24hPct: -1.18,
    marketCap: { amount: ngn(640_000_000_000_000), currency: 'NGN' },
    volume24h: { amount: ngn(22_400_000_000_000), currency: 'NGN' },
    supportedNetworks: [
      { id: 'ethereum', name: 'Ethereum (ERC-20)', confirmations: 12 },
      { id: 'base', name: 'Base', confirmations: 30 },
    ],
    description:
      'Ethereum is a programmable blockchain that powers smart contracts and most of the decentralised-app ecosystem.',
    riskDisclosure:
      'Ethereum is volatile. Network upgrades and demand shifts can cause sharp price swings.',
    kycTierRequired: 2,
  },
  {
    id: 'ast_usdt', type: 'crypto', symbol: 'USDT', name: 'Tether USD', decimals: 6,
    iconColor: '#26A17B', riskRating: 'low', status: 'active',
    buyEnabled: true, sellEnabled: true, depositEnabled: true, withdrawalEnabled: true,
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(20_000_000),
    price: { amount: ngn(1_605), currency: 'NGN' }, change24hPct: 0.05,
    marketCap: { amount: ngn(180_000_000_000_000), currency: 'NGN' },
    volume24h: { amount: ngn(70_000_000_000_000), currency: 'NGN' },
    supportedNetworks: [
      { id: 'tron', name: 'Tron (TRC-20)', confirmations: 20 },
      { id: 'ethereum', name: 'Ethereum (ERC-20)', confirmations: 12 },
    ],
    description:
      'Tether (USDT) is a stablecoin designed to track the US dollar 1:1. It is widely used to hold value in dollars and to move between assets.',
    riskDisclosure:
      'Stablecoins aim to hold a fixed value but can de-peg. They are not the same as a bank deposit and are not guaranteed.',
    kycTierRequired: 1,
  },
  {
    id: 'ast_usdc', type: 'crypto', symbol: 'USDC', name: 'USD Coin', decimals: 6,
    iconColor: '#2775CA', riskRating: 'low', status: 'active',
    buyEnabled: true, sellEnabled: true, depositEnabled: true, withdrawalEnabled: true,
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(20_000_000),
    price: { amount: ngn(1_604), currency: 'NGN' }, change24hPct: 0.02,
    marketCap: { amount: ngn(56_000_000_000_000), currency: 'NGN' },
    volume24h: { amount: ngn(12_000_000_000_000), currency: 'NGN' },
    supportedNetworks: [
      { id: 'ethereum', name: 'Ethereum (ERC-20)', confirmations: 12 },
      { id: 'base', name: 'Base', confirmations: 30 },
    ],
    description:
      'USD Coin (USDC) is a fully-reserved stablecoin pegged to the US dollar, issued by regulated financial institutions.',
    riskDisclosure:
      'Stablecoins aim to hold a fixed value but can de-peg. They are not a bank deposit and are not guaranteed.',
    kycTierRequired: 1,
  },
  {
    id: 'ast_sol', type: 'crypto', symbol: 'SOL', name: 'Solana', decimals: 8,
    iconColor: '#9945FF', riskRating: 'high', status: 'active',
    buyEnabled: true, sellEnabled: true, depositEnabled: true, withdrawalEnabled: true,
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(10_000_000),
    price: { amount: ngn(238_500), currency: 'NGN' }, change24hPct: 5.83,
    marketCap: { amount: ngn(112_000_000_000_000), currency: 'NGN' },
    volume24h: { amount: ngn(9_400_000_000_000), currency: 'NGN' },
    supportedNetworks: [{ id: 'solana', name: 'Solana', confirmations: 32 }],
    description:
      'Solana is a high-throughput blockchain known for fast, low-cost transactions and a growing app ecosystem.',
    riskDisclosure:
      'Solana is a higher-risk asset with large price swings and periods of network congestion.',
    kycTierRequired: 2,
  },
  {
    id: 'ast_xrp', type: 'crypto', symbol: 'XRP', name: 'XRP', decimals: 6,
    iconColor: '#23292F', riskRating: 'high', status: 'paused',
    buyEnabled: false, sellEnabled: false, depositEnabled: false, withdrawalEnabled: false,
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(10_000_000),
    price: { amount: ngn(3_640), currency: 'NGN' }, change24hPct: -0.74,
    marketCap: { amount: ngn(205_000_000_000_000), currency: 'NGN' },
    volume24h: { amount: ngn(6_200_000_000_000), currency: 'NGN' },
    supportedNetworks: [{ id: 'xrpl', name: 'XRP Ledger', confirmations: 1 }],
    description:
      'XRP is the native asset of the XRP Ledger, designed for fast, low-cost cross-border value transfer.',
    riskDisclosure:
      'XRP is a higher-risk asset and is temporarily paused for trading on Paymax.',
    kycTierRequired: 2,
  },
];

// ─── Holdings (portfolio positions) ───────────────────────────────────────────

const btc = MOCK_ASSETS[0];
const eth = MOCK_ASSETS[1];
const usdt = MOCK_ASSETS[2];

function buildPosition(
  asset: CryptoAsset,
  qtyMajor: number,
  avgCostMajor: number,
): Position {
  const quantityMinor = Math.round(qtyMajor * 10 ** asset.decimals);
  const marketValue = Math.round(qtyMajor * (asset.price.amount / 100)) * 100;
  const costBasis = Math.round(qtyMajor * avgCostMajor * 100);
  const gain = marketValue - costBasis;
  return {
    assetId: asset.id, symbol: asset.symbol, name: asset.name,
    iconColor: asset.iconColor, riskRating: asset.riskRating,
    quantity: { amount: quantityMinor, symbol: asset.symbol },
    averageCost: { amount: Math.round(avgCostMajor * 100), currency: 'NGN' },
    marketValue: { amount: marketValue, currency: 'NGN' },
    costBasis: { amount: costBasis, currency: 'NGN' },
    unrealizedGainLoss: { amount: gain, currency: 'NGN' },
    unrealizedPct: costBasis ? +((gain / costBasis) * 100).toFixed(2) : 0,
    price: asset.price, change24hPct: asset.change24hPct,
  };
}

export const MOCK_POSITIONS: Position[] = [
  buildPosition(btc, 0.0182, 92_100_000),
  buildPosition(eth, 0.94, 5_460_000),
  buildPosition(usdt, 1_250, 1_598),
];

// ─── Transaction history ──────────────────────────────────────────────────────

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export const MOCK_TRANSACTIONS: CryptoTransactionDetail[] = [
  {
    id: 'cx_1', reference: 'PMX-CR-840192', side: 'buy', symbol: 'BTC',
    assetName: 'Bitcoin', iconColor: btc.iconColor, status: 'Filled',
    fiat: { amount: ngn(500_000), currency: 'NGN' },
    crypto: { amount: Math.round(0.00508 * 1e8), symbol: 'BTC' },
    createdAt: hoursAgo(5),
    allInRate: { amount: ngn(98_900_000), currency: 'NGN' },
    fees: [
      { type: 'spread', amount: { amount: ngn(2_450), currency: 'NGN' } },
      { type: 'paymax_fee', amount: { amount: ngn(4_500), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(1_000), currency: 'NGN' } },
    ],
    totalFiat: { amount: ngn(505_500), currency: 'NGN' },
    provider: 'mock-liquidity', providerReference: 'LP-77120-AB',
    liquidityProvider: 'mock-liquidity', custodyProvider: 'mock-custody',
    statusHistory: [
      { status: 'QuoteAccepted', at: hoursAgo(5) },
      { status: 'Processing', at: hoursAgo(5) },
      { status: 'Filled', at: hoursAgo(5) },
    ],
  },
  {
    id: 'cx_2', reference: 'PMX-CR-839004', side: 'buy', symbol: 'USDT',
    assetName: 'Tether USD', iconColor: usdt.iconColor, status: 'Filled',
    fiat: { amount: ngn(200_000), currency: 'NGN' },
    crypto: { amount: Math.round(124.6 * 1e6), symbol: 'USDT' },
    createdAt: hoursAgo(28),
    allInRate: { amount: ngn(1_605), currency: 'NGN' },
    fees: [
      { type: 'spread', amount: { amount: ngn(1_000), currency: 'NGN' } },
      { type: 'paymax_fee', amount: { amount: ngn(1_800), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(400), currency: 'NGN' } },
    ],
    totalFiat: { amount: ngn(202_200), currency: 'NGN' },
    provider: 'mock-liquidity', providerReference: 'LP-76551-CD',
    liquidityProvider: 'mock-liquidity', custodyProvider: 'mock-custody',
    statusHistory: [
      { status: 'QuoteAccepted', at: hoursAgo(28) },
      { status: 'Filled', at: hoursAgo(28) },
    ],
  },
  {
    id: 'cx_3', reference: 'PMX-CR-835517', side: 'sell', symbol: 'ETH',
    assetName: 'Ethereum', iconColor: eth.iconColor, status: 'Processing',
    fiat: { amount: ngn(310_000), currency: 'NGN' },
    crypto: { amount: Math.round(0.0588 * 1e8), symbol: 'ETH' },
    createdAt: hoursAgo(1),
    allInRate: { amount: ngn(5_270_000), currency: 'NGN' },
    fees: [
      { type: 'spread', amount: { amount: ngn(2_800), currency: 'NGN' } },
      { type: 'paymax_fee', amount: { amount: ngn(2_790), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(620), currency: 'NGN' } },
    ],
    totalFiat: { amount: ngn(303_790), currency: 'NGN' },
    provider: 'mock-liquidity', providerReference: 'LP-78003-EF',
    liquidityProvider: 'mock-liquidity', custodyProvider: 'mock-custody',
    statusHistory: [
      { status: 'QuoteAccepted', at: hoursAgo(1) },
      { status: 'Processing', at: hoursAgo(1) },
    ],
  },
  {
    id: 'cx_5', reference: 'PMX-WD-811245', side: 'withdraw', symbol: 'BTC',
    assetName: 'Bitcoin', iconColor: btc.iconColor, status: 'WithdrawalPendingReview',
    fiat: { amount: ngn(420_000), currency: 'NGN' },
    crypto: { amount: Math.round(0.00426 * 1e8), symbol: 'BTC' },
    createdAt: hoursAgo(3),
    allInRate: { amount: ngn(98_500_000), currency: 'NGN' },
    fees: [{ type: 'network_fee', amount: { amount: ngn(1_200), currency: 'NGN' } }],
    totalFiat: { amount: ngn(420_000), currency: 'NGN' },
    provider: 'mock-custody', providerReference: 'CU-90021-WD',
    liquidityProvider: 'mock-liquidity', custodyProvider: 'mock-custody',
    statusHistory: [
      { status: 'WithdrawalPendingReview', at: hoursAgo(3) },
    ],
  },
  {
    id: 'cx_6', reference: 'PMX-DP-805510', side: 'deposit', symbol: 'USDT',
    assetName: 'Tether USD', iconColor: usdt.iconColor, status: 'DepositConfirmed',
    fiat: { amount: ngn(321_000), currency: 'NGN' },
    crypto: { amount: Math.round(200 * 1e6), symbol: 'USDT' },
    createdAt: hoursAgo(40),
    allInRate: { amount: ngn(1_605), currency: 'NGN' },
    fees: [],
    totalFiat: { amount: ngn(321_000), currency: 'NGN' },
    provider: 'mock-custody', providerReference: 'CU-88410-DP',
    liquidityProvider: 'mock-liquidity', custodyProvider: 'mock-custody',
    statusHistory: [
      { status: 'DepositDetected', at: hoursAgo(40) },
      { status: 'DepositConfirmed', at: hoursAgo(40) },
    ],
  },
  {
    id: 'cx_4', reference: 'PMX-CR-829884', side: 'buy', symbol: 'SOL',
    assetName: 'Solana', iconColor: MOCK_ASSETS[4].iconColor, status: 'Failed',
    fiat: { amount: ngn(150_000), currency: 'NGN' },
    crypto: { amount: Math.round(0.628 * 1e8), symbol: 'SOL' },
    createdAt: hoursAgo(50),
    allInRate: { amount: ngn(239_800), currency: 'NGN' },
    fees: [
      { type: 'spread', amount: { amount: ngn(2_100), currency: 'NGN' } },
      { type: 'paymax_fee', amount: { amount: ngn(1_350), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(300), currency: 'NGN' } },
    ],
    totalFiat: { amount: ngn(151_650), currency: 'NGN' },
    provider: 'mock-liquidity', providerReference: 'LP-75110-GH',
    liquidityProvider: 'mock-liquidity', custodyProvider: 'mock-custody',
    failureReason: 'The liquidity quote expired before the order could be filled. No funds were debited.',
    statusHistory: [
      { status: 'QuoteAccepted', at: hoursAgo(50) },
      { status: 'Failed', at: hoursAgo(50) },
    ],
  },
];
