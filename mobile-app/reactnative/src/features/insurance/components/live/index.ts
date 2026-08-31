// ── Insurance (live) — component barrel ─────────────────────────────────────
// Everything the reworked Protection screens draw with. The legacy mock-era
// components stay in `../index.ts` and are only used by the fixtures-backed
// agent/partner/embedded surfaces that have no live endpoint yet.

export { default as CategoryTile } from './CategoryTile';
export { default as DynamicField } from './DynamicField';
export { default as DynamicForm, outstandingCount } from './DynamicForm';
export { default as HtmlContent, HtmlSection } from './HtmlContent';
export { default as InsuranceErrorState, InsuranceErrorBanner } from './InsuranceErrorState';
export { default as LivePolicyCard, expiryNote } from './LivePolicyCard';
export { default as LiveProductCard } from './LiveProductCard';
export { default as PriceLabel, PricingModeBadge } from './PriceLabel';
export { default as StatusPill, claimStatusLabel, policyStatusLabel } from './StatusPill';
export {
  default as UnderwriterMark,
  UnderwriterRow,
  initialsFor,
} from './UnderwriterMark';
export {
  DetailSkeleton,
  PolicyCardSkeleton,
  PolicyListSkeleton,
  ProductCardSkeleton,
  ProductListSkeleton,
  SkeletonBlock,
} from './Skeleton';
export { toneTokens } from './tone';
