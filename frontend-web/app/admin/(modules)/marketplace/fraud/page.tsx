'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listFraudSignals } from '@/services/marketplaceAdminService';
import type { MktFraudSignal } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, DisclosureNote, StateBlock, FilterBar,
  PermissionBanner, btn, th, td, select, label as lbl, timeAgo,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

type Sev = 'low' | 'medium' | 'high';
const SEV_COLORS: Record<Sev, { fg: string; bg: string }> = {
  high: { fg: '#b91c1c', bg: '#fee2e2' },
  medium: { fg: '#9a3412', bg: '#ffedd5' },
  low: { fg: '#6b7280', bg: '#f3f4f6' },
};

export default function FraudSignalsPage() {
  const { allowed: canView } = useMarketplacePermission(MARKETPLACE_PERMS.usersView, MARKETPLACE_PERMS.usersAction);
  const [rows, setRows] = useState<MktFraudSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<Sev | ''>('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listFraudSignals(severity || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [severity]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Fraud signals"
        subtitle="Automated risk signals for triage: velocity, duplicate devices, account rings, and payment-evasion patterns."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="fraud" />
      <DisclosureNote>
        These are <strong>leads, not verdicts</strong> (USR-004). Open the user to act. A single device or IP across many
        accounts (USR-006) surfaces the whole ring for a coordinated action.
      </DisclosureNote>

      {!canView && <PermissionBanner permission={MARKETPLACE_PERMS.usersView} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <FilterBar>
        <div>
          <label style={lbl()}>Severity</label>
          <select style={select()} value={severity} onChange={(e) => setSeverity(e.target.value as Sev | '')}>
            <option value="">All</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No fraud signals match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Signal</th><th style={th()}>User</th><th style={th()}>Severity</th>
              <th style={th()}>Detail</th><th style={th()}>Ring</th><th style={th()}>Seen</th>
            </tr></thead>
            <tbody>
              {rows.map((s) => {
                const c = SEV_COLORS[s.severity];
                return (
                  <tr key={s.id}>
                    <td style={td()}>{s.kind.replace(/_/g, ' ')}</td>
                    <td style={td()}><Link href={`/admin/marketplace/users/${s.user_id}`} style={{ color: '#340075', fontWeight: 600, textDecoration: 'none' }}>{s.user_display_name}</Link><div style={{ fontSize: '0.7rem', color: '#9ca3af' }}><code>{s.user_id}</code></div></td>
                    <td style={td()}><span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700, color: c.fg, background: c.bg }}>{s.severity}</span></td>
                    <td style={td()}><span style={{ maxWidth: 320, display: 'inline-block', color: '#4b5563' }}>{s.detail}</span></td>
                    <td style={td()}>{s.related_user_ids.length > 1 ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>{s.related_user_ids.length} accounts</span> : '—'}</td>
                    <td style={td()}>{timeAgo(s.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
