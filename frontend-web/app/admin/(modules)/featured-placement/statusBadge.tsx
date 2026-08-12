import type { CampaignState } from '@/types/featuredPlacementAdmin';

const STATE_COLORS: Record<CampaignState, { bg: string; fg: string }> = {
  DRAFT: { bg: '#374151', fg: '#d1d5db' },
  SUBMITTED: { bg: '#1e3a8a', fg: '#bfdbfe' },
  UNDER_REVIEW: { bg: '#78350f', fg: '#fde68a' },
  NEEDS_MORE_INFO: { bg: '#7c2d12', fg: '#fed7aa' },
  REJECTED: { bg: '#7f1d1d', fg: '#fecaca' },
  PENDING_PAYMENT: { bg: '#3730a3', fg: '#c7d2fe' },
  SCHEDULED: { bg: '#155e75', fg: '#a5f3fc' },
  ACTIVE: { bg: '#064e3b', fg: '#a7f3d0' },
  PAUSED: { bg: '#713f12', fg: '#fde68a' },
  SUSPENDED: { bg: '#7f1d1d', fg: '#fecaca' },
  CANCELLED: { bg: '#3f3f46', fg: '#d4d4d8' },
  CANCELLED_EARLY: { bg: '#3f3f46', fg: '#d4d4d8' },
  COMPLETED: { bg: '#1f2937', fg: '#9ca3af' },
};

export function StatusBadge({ status }: { status: CampaignState }) {
  const c = STATE_COLORS[status] ?? STATE_COLORS.DRAFT;
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
