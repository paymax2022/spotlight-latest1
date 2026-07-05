// ── Fractional Real Estate — Deferred scope (NOT built in this MVP) ──────────
// Per the build brief, the following PRD §8 capabilities are intentionally
// deferred and left as placeholders for a later iteration:
//
//   • Diaspora / USD-FX wallet (multi-currency funding & FX settlement).
//   • Syndicate / group investing (pooled SPVs across multiple investors).
//   • REIT wrapper / listed REIT units.
//   • Sharia-compliant (non-riba) offerings & screening.
//   • Blockchain-title overlay (on-chain title registry / tokenised units).
//
// Reuse notes (wired, not rebuilt):
//   • KYC → routes to the existing /kyc flow.
//   • Wallet top-up → uses the existing wallet add-money flow.
//
// This module is feature-flagged via EXPO_PUBLIC_FRACTIONALRE_USE_MOCK
// (default 'true'); set it to 'false' to hit the live Go backend under
// /api/finance/fractionalre.

export const FRACTIONALRE_DEFERRED = [
  'diaspora-usd-fx-wallet',
  'syndicate-group-investing',
  'reit-wrapper',
  'sharia-compliant',
  'blockchain-title-overlay',
] as const;
