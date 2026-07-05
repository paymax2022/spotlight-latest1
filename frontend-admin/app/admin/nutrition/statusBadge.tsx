import type {
  Grounding,
  Confidence,
  ProfileStatus,
  ReviewState,
  NutritionSource,
} from '@/types/nutritionAdmin';

// Dark-theme badge palette (matches merchant-onboarding statusBadge).

// Composition-table provenance (WAFCT/NFCT/…). This is the source of a
// composition reference row — distinct from a profile's AI grounding.
const SOURCE_COLORS: Record<NutritionSource, { bg: string; fg: string }> = {
  WAFCT: { bg: '#064e3b', fg: '#a7f3d0' },
  NFCT: { bg: '#1e3a8a', fg: '#bfdbfe' },
  OFF: { bg: '#78350f', fg: '#fde68a' },
  FALLBACK: { bg: '#7c2d12', fg: '#fed7aa' },
  CUSTOM: { bg: '#374151', fg: '#d1d5db' },
};

export function SourceBadge({ source }: { source: NutritionSource }) {
  const c = SOURCE_COLORS[source] ?? SOURCE_COLORS.CUSTOM;
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {source}
    </span>
  );
}

// Grounding — which knowledge source the AI used for the estimate (v2).
const GROUNDING_COLORS: Record<Grounding, { bg: string; fg: string }> = {
  LABEL: { bg: '#064e3b', fg: '#a7f3d0' },
  LIBRARY_MATCHED: { bg: '#1e3a8a', fg: '#bfdbfe' },
  FREE_ESTIMATED: { bg: '#78350f', fg: '#fde68a' },
  RECIPE: { bg: '#374151', fg: '#d1d5db' },
};

const GROUNDING_LABELS: Record<Grounding, string> = {
  LABEL: 'Label',
  LIBRARY_MATCHED: 'Library-matched',
  FREE_ESTIMATED: 'Free-estimated',
  RECIPE: 'Recipe',
};

export function GroundingBadge({ grounding }: { grounding: Grounding }) {
  const c = GROUNDING_COLORS[grounding] ?? GROUNDING_COLORS.FREE_ESTIMATED;
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {GROUNDING_LABELS[grounding] ?? grounding}
    </span>
  );
}

// Confidence in a resolved profile (v2: EXACT | MEDIUM | LOW).
const CONFIDENCE_COLORS: Record<Confidence, { bg: string; fg: string }> = {
  EXACT: { bg: '#064e3b', fg: '#a7f3d0' },
  MEDIUM: { bg: '#78350f', fg: '#fde68a' },
  LOW: { bg: '#7f1d1d', fg: '#fecaca' },
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  EXACT: 'Exact',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const c = CONFIDENCE_COLORS[level] ?? CONFIDENCE_COLORS.LOW;
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {CONFIDENCE_LABELS[level] ?? level}
    </span>
  );
}

// Honesty state (v2). RESTAURANT_CONFIRMED is approved but STILL an estimate;
// EXACT is label-only; AI_ESTIMATE is the auto-published default.
const STATUS_COLORS: Record<ProfileStatus, { bg: string; fg: string }> = {
  AI_ESTIMATE: { bg: '#78350f', fg: '#fde68a' },
  RESTAURANT_CONFIRMED: { bg: '#1e3a8a', fg: '#bfdbfe' },
  EXACT: { bg: '#064e3b', fg: '#a7f3d0' },
  STALE: { bg: '#7f1d1d', fg: '#fecaca' },
};

const STATUS_LABELS: Record<ProfileStatus, string> = {
  AI_ESTIMATE: 'AI estimate',
  RESTAURANT_CONFIRMED: 'Confirmed (estimate)',
  EXACT: 'Exact (label)',
  STALE: 'Stale',
};

export function StatusBadge({ status }: { status: ProfileStatus }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.AI_ESTIMATE;
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// Operator review-queue lifecycle badge (distinct from the honesty state).
const REVIEW_COLORS: Record<ReviewState, { bg: string; fg: string }> = {
  FLAGGED: { bg: '#7f1d1d', fg: '#fecaca' },
  REVIEWED: { bg: '#1e3a8a', fg: '#bfdbfe' },
  RESOLVED: { bg: '#064e3b', fg: '#a7f3d0' },
};

export function ReviewStateBadge({ state }: { state: ReviewState }) {
  const c = REVIEW_COLORS[state] ?? REVIEW_COLORS.FLAGGED;
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {state}
    </span>
  );
}
