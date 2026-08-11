import type { OnboardingStatus } from '@/types/onboarding';

const STATUS_COLORS: Record<OnboardingStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: '#374151', fg: '#d1d5db' },
  SUBMITTED: { bg: '#1e3a8a', fg: '#bfdbfe' },
  UNDER_REVIEW: { bg: '#78350f', fg: '#fde68a' },
  NEEDS_MORE_INFO: { bg: '#7c2d12', fg: '#fed7aa' },
  APPROVED: { bg: '#064e3b', fg: '#a7f3d0' },
  REJECTED: { bg: '#7f1d1d', fg: '#fecaca' },
};

export function StatusBadge({ status }: { status: OnboardingStatus }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT;
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
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const RISK_COLORS: Record<string, { bg: string; fg: string }> = {
  low: { bg: '#064e3b', fg: '#a7f3d0' },
  medium: { bg: '#78350f', fg: '#fde68a' },
  high: { bg: '#7f1d1d', fg: '#fecaca' },
};

export function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' | null }) {
  if (!level) return <span style={{ opacity: 0.5 }}>—</span>;
  const c = RISK_COLORS[level];
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {level}
    </span>
  );
}
