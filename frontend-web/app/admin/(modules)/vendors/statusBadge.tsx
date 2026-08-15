import type { VendorStatus, VendorJobStatus } from '@/types/vendorsAdmin';

// Dark-theme badge palette (matches merchant-onboarding / nutrition statusBadge).

const VENDOR_COLORS: Record<VendorStatus, { bg: string; fg: string }> = {
  pending: { bg: '#78350f', fg: '#fde68a' },
  verified: { bg: '#064e3b', fg: '#a7f3d0' },
  suspended: { bg: '#7f1d1d', fg: '#fecaca' },
};

export function VendorStatusBadge({ status }: { status: VendorStatus }) {
  const c = VENDOR_COLORS[status] ?? VENDOR_COLORS.pending;
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
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

const JOB_COLORS: Record<VendorJobStatus, { bg: string; fg: string }> = {
  available: { bg: '#374151', fg: '#d1d5db' },
  accepted: { bg: '#1e3a8a', fg: '#bfdbfe' },
  rejected: { bg: '#7f1d1d', fg: '#fecaca' },
  en_route: { bg: '#1e3a8a', fg: '#bfdbfe' },
  in_progress: { bg: '#78350f', fg: '#fde68a' },
  completed: { bg: '#065f46', fg: '#a7f3d0' },
  paid: { bg: '#064e3b', fg: '#a7f3d0' },
};

export function JobStatusBadge({ status }: { status: VendorJobStatus }) {
  const c = JOB_COLORS[status] ?? JOB_COLORS.available;
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
