'use client';

import type { TransferStatus, TransferProvider } from '@/types/transfersAdmin';

// Status colour map: terminal-success = green, failure = red, in-flight = amber/blue.
const STATUS_COLORS: Record<TransferStatus, { fg: string; bg: string }> = {
  successful:         { fg: '#15803d', bg: '#dcfce7' }, // green
  failed:            { fg: '#b91c1c', bg: '#fee2e2' }, // red
  reversed:          { fg: '#6b21a8', bg: '#f3e8ff' }, // purple (corrected)
  funds_reserved:    { fg: '#9a3412', bg: '#ffedd5' }, // amber (held)
  awaiting_funding:  { fg: '#9a3412', bg: '#ffedd5' }, // amber (held)
  funded:            { fg: '#1d4ed8', bg: '#dbeafe' }, // blue (in-flight)
  provider_initiated:{ fg: '#1d4ed8', bg: '#dbeafe' }, // blue (in-flight)
};

export function StatusBadge({ status }: { status: TransferStatus }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize' }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const PROVIDER_COLORS: Record<TransferProvider, { fg: string; bg: string }> = {
  paystack: { fg: '#0c5d56', bg: '#d1faf3' },
  monnify:  { fg: '#1e3a8a', bg: '#dbeafe' },
};

export function ProviderBadge({ provider, failoverFrom }: { provider: TransferProvider; failoverFrom?: TransferProvider | null }) {
  const c = PROVIDER_COLORS[provider] ?? { fg: '#374151', bg: '#f3f4f6' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
      <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize' }}>
        {provider}
      </span>
      {failoverFrom ? (
        <span style={{ fontSize: '0.68rem', color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 9999, padding: '0.05rem 0.4rem' }}>
          ⇄ from {failoverFrom}
        </span>
      ) : null}
    </span>
  );
}
